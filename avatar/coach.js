/* Coach Mode — surface 8793 (Live Avatar), additive panel client.
   Camera law, same as the surface's eye-contact feature: the camera is
   OFF by default; getUserMedia is called ONLY inside the Start-session
   tap handler below; Stop releases every track immediately.
   Data discipline: all analysis runs on this device. Frames are drawn
   to a local canvas and discarded; nothing is uploaded, streamed, or
   stored during a session. On Stop, a summary receipt exists only in
   this page until the user taps Download or Send receipt to Muse.
   Motion signal: frame-difference motion energy (64x48 grayscale,
   ~10 Hz) is the tempo source — dance and rehearsal are whole-body,
   not face-only. The vendored MediaPipe Face Mesh runs alongside as a
   presence witness only (face present / not), recorded in the receipt.
   The tempo readout is an ESTIMATE and is labelled so on its face. */
(function () {
  "use strict";
  var root = document.getElementById("coach");
  if (!root) return;
  var est = (typeof window !== "undefined" && window.CoachEstimator) || null;

  var video = root.querySelector(".coach-video");
  var light = root.querySelector(".coach-light");
  var bpmInput = root.querySelector(".coach-bpm");
  var tapBtn = root.querySelector(".coach-tap");
  var startBtn = root.querySelector(".coach-start");
  var stopBtn = root.querySelector(".coach-stop");
  var estNum = root.querySelector(".coach-est-num");
  var driftEl = root.querySelector(".coach-drift");
  var statusEl = root.querySelector(".coach-status");
  var summaryBox = root.querySelector(".coach-summary");
  var summaryJson = root.querySelector(".coach-summary-json");
  var downloadBtn = root.querySelector(".coach-download");
  var sendBtn = root.querySelector(".coach-send");
  var sendStatus = root.querySelector(".coach-send-status");

  var SAMPLE_MS = 33;               // ~30 Hz motion-energy sampling —
                                    // the build self-test measured the
                                    // estimator dropping an octave at
                                    // 10 Hz (>120 BPM) and at 20 Hz
                                    // (160 BPM); 30 Hz held 96–180 BPM
  var WINDOW_S = 20;                // rolling estimation window
  var canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 48;
  var ctx = canvas.getContext("2d", { willReadFrequently: true });

  var running = false, stream = null, mesh = null;
  var sampleTimer = null, meshTimer = null, t0 = 0;
  var prevFrame = null;
  var samples = [];                 // {t, e} motion-energy series
  var estimates = [];               // {t, bpm} live estimates (1 per s)
  var lastEstimateAt = 0;
  var faceChecks = 0, facePresent = 0;
  var tapTimes = [];
  var lastReceipt = null;

  function setStatus(s) { statusEl.textContent = s; }
  function targetBPM() {
    var v = parseFloat(bpmInput.value);
    if (!(v >= 40 && v <= 220)) v = 120;
    return v;
  }

  function driftWords(bpm, target) {
    var d = bpm - target;
    if (Math.abs(d) <= 2) return { cls: "steady", text: "holding steady — within " +
      Math.abs(d).toFixed(1) + " BPM of your target" };
    if (d > 0) return { cls: "ahead", text: "pushing ahead of the beat — about " +
      d.toFixed(1) + " BPM fast" };
    return { cls: "behind", text: "falling behind the beat — about " +
      Math.abs(d).toFixed(1) + " BPM slow" };
  }

  function sampleEnergy() {
    if (!running || !video.videoWidth) return;
    ctx.drawImage(video, 0, 0, 64, 48);
    var data;
    try { data = ctx.getImageData(0, 0, 64, 48).data; } catch (e) { return; }
    var gray = new Float32Array(64 * 48);
    for (var i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    if (prevFrame) {
      var sum = 0;
      for (var k = 0; k < gray.length; k++) sum += Math.abs(gray[k] - prevFrame[k]);
      var t = (performance.now() - t0) / 1000;
      samples.push({ t: t, e: sum / gray.length });
      // keep a 30 s tail; estimation uses the last WINDOW_S seconds
      while (samples.length && samples[0].t < t - 30) samples.shift();
      if (est && t - lastEstimateAt >= 1) {
        lastEstimateAt = t;
        var win = samples.filter(function (s) { return s.t >= t - WINDOW_S; });
        var r = est.estimateTempoBPM(win);
        if (r) {
          estimates.push({ t: t, bpm: r.bpm });
          estNum.textContent = r.bpm.toFixed(1);
          var dw = driftWords(r.bpm, targetBPM());
          driftEl.textContent = dw.text;
          light.className = "coach-light " + dw.cls;
        } else {
          estNum.textContent = "—";
          driftEl.textContent = "not enough rhythmic movement yet — " +
            "keep moving to a steady beat (ESTIMATE)";
          light.className = "coach-light";
        }
      }
    }
    prevFrame = gray;
  }

  function startFaceMesh() {
    if (typeof FaceMesh === "undefined") return;
    try {
      mesh = new FaceMesh({ locateFile: function (f) { return "/assets/face/" + f; } });
      mesh.setOptions({ maxNumFaces: 1, refineLandmarks: false,
        minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      mesh.onResults(function (res) {
        faceChecks++;
        if (res && res.multiFaceLandmarks && res.multiFaceLandmarks.length) facePresent++;
      });
      meshTimer = setInterval(function () {
        if (running && video.videoWidth && mesh) {
          mesh.send({ image: video }).catch(function () {});
        }
      }, 300);
    } catch (e) { mesh = null; }
  }

  async function startSession() {
    if (running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("camera unavailable in this browser — Coach cannot start.");
      return;
    }
    startBtn.disabled = true;
    setStatus("camera starting…");
    try {
      // THE camera call of this panel: inside this Start-tap handler only.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (e) {
      setStatus("camera unavailable or permission denied — Coach is off.");
      startBtn.disabled = false;
      return;
    }
    video.srcObject = stream;
    try { await video.play(); } catch (e) {}
    running = true;
    t0 = performance.now();
    samples = []; estimates = []; prevFrame = null;
    faceChecks = 0; facePresent = 0; lastEstimateAt = 0;
    summaryBox.hidden = true; lastReceipt = null;
    stopBtn.disabled = false;
    estNum.textContent = "—";
    driftEl.textContent = "warming up — the estimate needs about 8 seconds of movement.";
    setStatus("session running — analysis is on this device only; frames never leave it.");
    sampleTimer = setInterval(sampleEnergy, SAMPLE_MS);
    startFaceMesh();
  }

  function stopSession() {
    if (!running) return;
    running = false;
    if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
    if (meshTimer) { clearInterval(meshTimer); meshTimer = null; }
    if (mesh && mesh.close) { try { mesh.close(); } catch (e) {} mesh = null; }
    if (stream) { stream.getTracks().forEach(function (tr) { tr.stop(); }); stream = null; }
    video.srcObject = null;
    startBtn.disabled = false; stopBtn.disabled = true;
    light.className = "coach-light";

    var durationS = (performance.now() - t0) / 1000;
    var target = targetBPM();
    var meanBpm = null, meanDrift = null;
    if (estimates.length) {
      var sb = 0, sd = 0;
      estimates.forEach(function (x) { sb += x.bpm; sd += Math.abs(x.bpm - target); });
      meanBpm = +(sb / estimates.length).toFixed(2);
      meanDrift = +(sd / estimates.length).toFixed(2);
    }
    lastReceipt = {
      tool: "coach-mode", version: 1, surface: "8793",
      ended_at: new Date().toISOString(),
      duration_s: +durationS.toFixed(2),
      target_bpm: target,
      motion_samples: samples.length,
      tempo_estimates: estimates.length,
      mean_estimate_bpm: meanBpm,
      mean_abs_drift_bpm: meanDrift,
      face_present_fraction: faceChecks ? +(facePresent / faceChecks).toFixed(3) : null,
      signal: "frame-difference motion energy (64x48 grayscale @ ~30 Hz); " +
        "MediaPipe Face Mesh as presence witness only",
      estimate_label: "ESTIMATE",
      note: "Target tempo is a rehearsal-aid input set on the panel, " +
        "not a production tempo claim. Analysis ran on-device; no " +
        "frames left the device during the session."
    };
    summaryJson.textContent = JSON.stringify(lastReceipt, null, 2);
    summaryBox.hidden = false;
    sendStatus.textContent = "";
    setStatus("session stopped — camera released. The receipt exists only " +
      "in this page until you download it or send it to Muse.");
    driftEl.textContent = estimates.length
      ? "session complete — summary below."
      : "session complete — no tempo estimate formed (too little rhythmic movement).";
  }

  startBtn.addEventListener("click", startSession);
  stopBtn.addEventListener("click", stopSession);

  tapBtn.addEventListener("click", function () {
    var now = performance.now();
    tapTimes.push(now);
    while (tapTimes.length && now - tapTimes[0] > 4000) tapTimes.shift();
    if (tapTimes.length >= 3) {
      var iv = [];
      for (var i = 1; i < tapTimes.length; i++) iv.push(tapTimes[i] - tapTimes[i - 1]);
      iv.sort(function (a, b) { return a - b; });
      var med = iv[Math.floor(iv.length / 2)];
      if (med > 0) {
        bpmInput.value = Math.round(60000 / med);
        setStatus("target set from your taps: " + bpmInput.value + " BPM.");
      }
    }
  });

  downloadBtn.addEventListener("click", function () {
    if (!lastReceipt) return;
    var blob = new Blob([JSON.stringify(lastReceipt, null, 2)],
      { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "coach-session-receipt.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  sendBtn.addEventListener("click", async function () {
    if (!lastReceipt) return;
    sendBtn.disabled = true;
    sendStatus.textContent = "sending…";
    try {
      var r = await fetch("/api/coach/receipt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lastReceipt) });
      var j = await r.json();
      if (r.ok && j.event_id) {
        sendStatus.textContent = "receipt sent — Muse has it on the swarm bus " +
          "(event " + j.event_id + ").";
      } else {
        sendStatus.textContent = "send failed (" + (j.error || r.status) +
          ") — the Download button still gives you the receipt file.";
      }
    } catch (e) {
      sendStatus.textContent = "send failed (network) — the Download button " +
        "still gives you the receipt file.";
    }
    sendBtn.disabled = false;
  });
})();
