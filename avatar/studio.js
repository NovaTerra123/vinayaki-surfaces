/* Camera Studio — surface 8793 (Live Avatar), additive panel client.
   Tier LIVE: on-device pose tracking (MediaPipe Pose / BlazePose,
   vendored under /assets/pose/ — no runtime CDN) drives a luminous
   puppet figure on a canvas. Tier FILM: an optional in-browser
   MediaRecorder recording, offered as a download to this device only.
   Camera law, same as Coach: the camera is OFF by default; getUserMedia
   is called ONLY inside the Start-session tap handler below; Stop
   releases every track immediately. Nothing leaves the device during a
   session; the only outbound path is the counts/spectra receipt the
   user taps Send on (no video, no landmark coordinates).

   Spectral layer typing (house law):
   - MEASURED, computed on-device from the RGB camera signal: the
     motion-energy spectrum (FFT per rolling window), a green-channel
     pulse estimate in shoulders-up framing (non-contact PPG, Poh et
     al. 2010 — an ESTIMATE, shown as "no clean signal" when the peak
     is not prominent; a number is never invented), and the scene's
     mean colour as an approximate dominant wavelength (ESTIMATE —
     RGB->wavelength is approximate by nature).
   - DECLARED_GRAMMAR: the puppet light's colour is those measured
     features mapped through the seven-station chakra colour grammar
     (true spectral order). Grammar, not a body scan.
   - The camera is an RGB sensor. Nothing here measures chakras, auras,
     energy fields, or full-spectrum body data, and no copy in this
     panel claims otherwise.
   Multi-person bound, plainly: MediaPipe Pose tracks ONE person. One
   figure is driven; a second dancer is not tracked by this tier. */
(function () {
  "use strict";
  var root = document.getElementById("studio");
  if (!root) return;
  var S = (typeof window !== "undefined" && window.StudioSpectral) || null;

  var video = root.querySelector(".studio-video");
  var canvas = root.querySelector(".studio-canvas");
  var ctx2d = canvas.getContext("2d");
  var bloom = root.querySelector(".studio-bloom");
  var fullBtn = root.querySelector(".studio-frame-full");
  var shBtn = root.querySelector(".studio-frame-shoulders");
  var recordChk = root.querySelector(".studio-record");
  var startBtn = root.querySelector(".studio-start");
  var stopBtn = root.querySelector(".studio-stop");
  var statusEl = root.querySelector(".studio-status");
  var domEl = root.querySelector(".studio-dom");
  var harmEl = root.querySelector(".studio-harm");
  var pulseEl = root.querySelector(".studio-pulse");
  var lightEl = root.querySelector(".studio-light");
  var stationEl = root.querySelector(".studio-station");
  var dlBox = root.querySelector(".studio-download");
  var dlLink = root.querySelector(".studio-download-link");
  var summaryBox = root.querySelector(".studio-summary");
  var summaryJson = root.querySelector(".studio-summary-json");
  var dlReceiptBtn = root.querySelector(".studio-download-receipt");
  var sendBtn = root.querySelector(".studio-send");
  var sendStatus = root.querySelector(".studio-send-status");

  /* BlazePose 33-landmark skeleton (MediaPipe POSE_CONNECTIONS). */
  var CONNECTIONS = [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],
    [9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
    [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],
    [23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],
    [30,32],[27,31],[28,32]];
  var SHOULDER_SET = {};
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]
    .forEach(function (i) { SHOULDER_SET[i] = true; });

  var SAMPLE_MS = 33;                 // ~30 Hz, as Coach measured
  var small = document.createElement("canvas");
  small.width = 64; small.height = 48;
  var sctx = small.getContext("2d", { willReadFrequently: true });
  var roiCanvas = document.createElement("canvas");
  roiCanvas.width = 24; roiCanvas.height = 18;
  var rctx = roiCanvas.getContext("2d", { willReadFrequently: true });

  var running = false, stream = null, pose = null, faceMesh = null;
  var framing = "full";               // "full" | "shoulders"
  var sampleTimer = null, poseTimer = null, meshTimer = null,
      spectralTimer = null, rafId = null, t0 = 0;
  var prevFrame = null;
  var energy = [];                    // {t, e}
  var rgbAcc = null, rgbCount = 0;    // per-second mean colour
  var greenSeries = [];               // {t, g} forehead ROI green mean
  var faceROI = null;                 // {x, y, w, h} in video pixels
  var latestPose = null, latestFace = null;
  var poseSent = 0, poseHits = 0;
  var spectralSeries = [];            // {t, dominant_hz, harmonic_ratio}
  var sceneNm = [];                   // per-second wavelength estimates
  var pulseNow = null;                // last good pulse estimate or null
  var pulseSeen = false;              // a clean pulse was measured once
  var stationNow = null;
  var recorder = null, recordChunks = [], recorded = false, recordUrl = null;
  var lastReceipt = null;

  function setStatus(s) { statusEl.textContent = s; }

  /* ---------- puppet rendering ---------- */
  function drawPuppet() {
    var W = canvas.width, H = canvas.height;
    ctx2d.fillStyle = "#060510";
    ctx2d.fillRect(0, 0, W, H);
    var lm = latestPose;
    if (lm) {
      var colour = stationNow ? stationNow.css : "#8f86c9";
      var pts = [], i, p;
      if (framing === "full") {
        for (i = 0; i < lm.length; i++) {
          pts.push({ x: lm[i].x * W, y: lm[i].y * H, v: lm[i].visibility });
        }
      } else {
        var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, any = false;
        for (i = 0; i < lm.length; i++) {
          if (!SHOULDER_SET[i]) continue;
          if ((lm[i].visibility || 0) < 0.3) continue;
          any = true;
          minX = Math.min(minX, lm[i].x); maxX = Math.max(maxX, lm[i].x);
          minY = Math.min(minY, lm[i].y); maxY = Math.max(maxY, lm[i].y);
        }
        if (any && maxX > minX && maxY > minY) {
          var bw = (maxX - minX) * W, bh = (maxY - minY) * H;
          var sc = Math.min((W * 0.86) / bw, (H * 0.86) / bh);
          var cx = (minX + maxX) / 2 * W, cy = (minY + maxY) / 2 * H;
          for (i = 0; i < lm.length; i++) {
            pts.push({ x: W / 2 + (lm[i].x * W - cx) * sc,
                       y: H / 2 + (lm[i].y * H - cy) * sc,
                       v: lm[i].visibility });
          }
        }
      }
      if (pts.length) {
        ctx2d.lineCap = "round";
        ctx2d.shadowColor = colour; ctx2d.shadowBlur = 16;
        ctx2d.strokeStyle = colour; ctx2d.lineWidth = 3;
        ctx2d.beginPath();
        CONNECTIONS.forEach(function (c) {
          var a = pts[c[0]], b = pts[c[1]];
          if (!a || !b) return;
          if ((a.v || 0) < 0.35 || (b.v || 0) < 0.35) return;
          if (framing === "shoulders" && (!SHOULDER_SET[c[0]] || !SHOULDER_SET[c[1]])) return;
          ctx2d.moveTo(a.x, a.y); ctx2d.lineTo(b.x, b.y);
        });
        ctx2d.stroke();
        ctx2d.fillStyle = "#ffffff";
        pts.forEach(function (q, qi) {
          if ((q.v || 0) < 0.35) return;
          if (framing === "shoulders" && !SHOULDER_SET[qi]) return;
          ctx2d.beginPath(); ctx2d.arc(q.x, q.y, 3.4, 0, 6.2832); ctx2d.fill();
        });
        ctx2d.shadowBlur = 0;
      }
      // face-mesh witness points in shoulders-up (nose tip, forehead)
      if (framing === "shoulders" && latestFace && latestFace.length > 160) {
        ctx2d.fillStyle = "rgba(232,228,245,.85)";
        [1, 10, 151].forEach(function (idx) {
          var f = latestFace[idx];
          if (!f) return;
          ctx2d.beginPath();
          ctx2d.arc(f.x * W, f.y * H, 2.2, 0, 6.2832); ctx2d.fill();
        });
      }
    }
    if (running) rafId = requestAnimationFrame(drawPuppet);
  }

  /* ---------- sampling: motion energy + scene colour + rPPG ROI --- */
  function sampleFrame() {
    if (!running || !video.videoWidth) return;
    sctx.drawImage(video, 0, 0, 64, 48);
    var data;
    try { data = sctx.getImageData(0, 0, 64, 48).data; } catch (e) { return; }
    var gray = new Float32Array(64 * 48);
    var rS = 0, gS = 0, bS = 0;
    for (var i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      rS += data[i]; gS += data[i + 1]; bS += data[i + 2];
    }
    var n = 64 * 48;
    rgbAcc = { r: rS / n, g: gS / n, b: bS / n }; rgbCount++;
    var t = (performance.now() - t0) / 1000;
    if (prevFrame) {
      var sum = 0;
      for (var k = 0; k < gray.length; k++) sum += Math.abs(gray[k] - prevFrame[k]);
      energy.push({ t: t, e: sum / gray.length });
      while (energy.length && energy[0].t < t - 30) energy.shift();
    }
    prevFrame = gray;
    // rPPG: green mean over the forehead ROI (refreshed by Face Mesh)
    if (framing === "shoulders" && faceROI && video.videoWidth) {
      try {
        rctx.drawImage(video, faceROI.x, faceROI.y, faceROI.w, faceROI.h, 0, 0, 24, 18);
        var rd = rctx.getImageData(0, 0, 24, 18).data, gs = 0, cnt = 0;
        for (var j = 1; j < rd.length; j += 4) { gs += rd[j]; cnt++; }
        greenSeries.push({ t: t, g: gs / cnt });
        while (greenSeries.length && greenSeries[0].t < t - 20) greenSeries.shift();
      } catch (e) { /* ROI off-frame this tick — skip, never invent */ }
    }
  }

  /* ---------- spectral tick (1 Hz): spectrum, pulse, scene light -- */
  function spectralTick() {
    if (!running || !S) return;
    var t = (performance.now() - t0) / 1000;
    var win = energy.filter(function (s) { return s.t >= t - 10; });
    if (win.length > 120) {
      var vals = win.map(function (s) { return s.e; });
      var ms = S.motionSpectrum(vals, 1000 / SAMPLE_MS, 0.3, 4.0);
      if (ms) {
        spectralSeries.push({ t: +t.toFixed(2), dominant_hz: ms.dominant_hz,
                              harmonic_ratio: ms.harmonic_ratio });
        domEl.textContent = ms.dominant_hz.toFixed(2);
        harmEl.textContent = ms.harmonic_ratio === null ? "—" : ms.harmonic_ratio.toFixed(2);
        stationNow = S.stationForFrequency(ms.dominant_hz);
        if (stationNow) {
          stationEl.textContent = stationNow.name + " light (" +
            stationNow.wavelength_nm + " nm grammar colour)";
          bloom.style.background = "radial-gradient(circle," +
            stationNow.css + " 0%,transparent 65%)";
          bloom.style.opacity = ".8";
        }
      }
    }
    if (rgbAcc) {
      var nm = S.rgbToWavelengthApprox(rgbAcc.r, rgbAcc.g, rgbAcc.b);
      if (nm) {
        sceneNm.push(nm);
        lightEl.textContent = "≈ " + nm + " nm (ESTIMATE — RGB approximation)";
      } else {
        lightEl.textContent = "neutral — no dominant wavelength (ESTIMATE)";
      }
      rgbAcc = null; rgbCount = 0;
    }
    if (framing === "shoulders") {
      var gw = greenSeries.filter(function (s) { return s.t >= t - 12; });
      if (gw.length > 240) {
        var p = S.pulseEstimate(gw.map(function (s) { return s.g; }), 1000 / SAMPLE_MS);
        if (p) {
          pulseNow = p; pulseSeen = true;
          pulseEl.textContent = "≈ " + p.bpm.toFixed(0) +
            " BPM · ESTIMATE — non-contact PPG (Poh et al. 2010), camera RGB, not a medical measurement";
        } else {
          pulseEl.textContent = "pulse: no clean signal — hold still, face the light";
        }
      } else {
        pulseEl.textContent = "pulse: gathering signal… (needs ~10 s of still face)";
      }
    } else {
      pulseEl.textContent = "shoulders-up framing only";
    }
  }

  /* ---------- trackers ---------- */
  function startPose() {
    if (typeof Pose === "undefined") {
      setStatus("pose library unavailable — Studio runs on motion signal only.");
      return;
    }
    try {
      pose = new Pose({ locateFile: function (f) { return "/assets/pose/" + f; } });
      pose.setOptions({ modelComplexity: 1, smoothLandmarks: true,
        enableSegmentation: false, minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5 });
      pose.onResults(function (res) {
        if (res && res.poseLandmarks && res.poseLandmarks.length === 33) {
          latestPose = res.poseLandmarks; poseHits++;
        } else { latestPose = null; }
      });
      poseTimer = setInterval(function () {
        if (running && video.videoWidth && pose) {
          poseSent++;
          pose.send({ image: video }).catch(function () {});
        }
      }, 50);
    } catch (e) { pose = null; }
  }

  function startFaceMesh() {
    if (faceMesh || typeof FaceMesh === "undefined") return;
    try {
      faceMesh = new FaceMesh({ locateFile: function (f) { return "/assets/face/" + f; } });
      faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true,
        minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      faceMesh.onResults(function (res) {
        if (res && res.multiFaceLandmarks && res.multiFaceLandmarks.length) {
          latestFace = res.multiFaceLandmarks[0];
          var lm = latestFace;
          if (lm[151] && lm[234] && lm[454] && video.videoWidth) {
            var vw = video.videoWidth, vh = video.videoHeight;
            var faceW = Math.abs(lm[454].x - lm[234].x) * vw;
            var w = Math.max(12, faceW * 0.30), h = w * 0.62;
            faceROI = { x: Math.min(Math.max(lm[151].x * vw - w / 2, 0), vw - w),
                        y: Math.min(Math.max(lm[151].y * vh - h / 2, 0), vh - h),
                        w: w, h: h };
          }
        } else { latestFace = null; faceROI = null; }
      });
      meshTimer = setInterval(function () {
        if (running && video.videoWidth && faceMesh) {
          faceMesh.send({ image: video }).catch(function () {});
        }
      }, 200);
    } catch (e) { faceMesh = null; }
  }

  /* ---------- session control ---------- */
  async function startSession() {
    if (running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("camera unavailable in this browser — Camera Studio cannot start.");
      return;
    }
    startBtn.disabled = true;
    setStatus("camera starting…");
    try {
      // THE camera call of this panel: inside this Start-tap handler only.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (e) {
      setStatus("camera unavailable or permission denied — Camera Studio is off.");
      startBtn.disabled = false;
      return;
    }
    video.srcObject = stream;
    try { await video.play(); } catch (e) {}
    running = true;
    t0 = performance.now();
    energy = []; greenSeries = []; spectralSeries = []; sceneNm = [];
    prevFrame = null; latestPose = null; latestFace = null; faceROI = null;
    poseSent = 0; poseHits = 0; pulseNow = null; pulseSeen = false;
    stationNow = null; lastReceipt = null;
    summaryBox.hidden = true; dlBox.hidden = true;
    if (recordUrl) { URL.revokeObjectURL(recordUrl); recordUrl = null; }
    stopBtn.disabled = false;
    domEl.textContent = "—"; harmEl.textContent = "—";
    pulseEl.textContent = framing === "shoulders"
      ? "pulse: gathering signal…" : "shoulders-up framing only";
    lightEl.textContent = "—"; stationEl.textContent = "—";
    recorded = false; recordChunks = []; recorder = null;
    if (recordChk.checked && typeof MediaRecorder !== "undefined") {
      try {
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = function (ev) {
          if (ev.data && ev.data.size) recordChunks.push(ev.data);
        };
        recorder.onstop = function () {
          if (!recordChunks.length) return;
          var blob = new Blob(recordChunks,
            { type: recordChunks[0].type || "video/webm" });
          recordUrl = URL.createObjectURL(blob);
          dlLink.href = recordUrl;
          dlLink.download = "camera-studio-session.webm";
          dlBox.hidden = false;
        };
        recorder.start(1000);
        recorded = true;
      } catch (e) { recorder = null; }
    }
    setStatus("session running — pose and spectra are computed on this device; " +
      "nothing is uploaded" + (recorded
        ? "; recording in this browser only, for download to this device." : "."));
    sampleTimer = setInterval(sampleFrame, SAMPLE_MS);
    spectralTimer = setInterval(spectralTick, 1000);
    startPose();
    if (framing === "shoulders") startFaceMesh();
    rafId = requestAnimationFrame(drawPuppet);
  }

  function stopSession() {
    if (!running) return;
    running = false;
    if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch (e) {} }
    [sampleTimer, poseTimer, meshTimer, spectralTimer].forEach(function (tm) {
      if (tm) clearInterval(tm);
    });
    sampleTimer = poseTimer = meshTimer = spectralTimer = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (pose && pose.close) { try { pose.close(); } catch (e) {} pose = null; }
    if (faceMesh && faceMesh.close) { try { faceMesh.close(); } catch (e) {} faceMesh = null; }
    if (stream) { stream.getTracks().forEach(function (tr) { tr.stop(); }); stream = null; }
    video.srcObject = null;
    startBtn.disabled = false; stopBtn.disabled = true;
    bloom.style.opacity = ".3";

    var durationS = (performance.now() - t0) / 1000;
    var meanDom = null;
    if (spectralSeries.length) {
      var sd = 0;
      spectralSeries.forEach(function (w) { sd += w.dominant_hz; });
      meanDom = +(sd / spectralSeries.length).toFixed(3);
    }
    var meanNm = null;
    if (sceneNm.length) {
      var sn = 0;
      sceneNm.forEach(function (v) { sn += v; });
      meanNm = Math.round(sn / sceneNm.length);
    }
    lastReceipt = {
      tool: "camera-studio", version: 1, surface: "8793",
      ended_at: new Date().toISOString(),
      duration_s: +durationS.toFixed(2),
      framing_final: framing,
      tracker: "MediaPipe Pose (BlazePose), vendored on-surface; single-person",
      pose_frames_sent: poseSent,
      frames_with_pose: poseHits,
      pose_present_fraction: poseSent ? +(poseHits / poseSent).toFixed(3) : null,
      spectral_windows: spectralSeries,
      mean_dominant_hz: meanDom,
      pulse: pulseSeen && pulseNow
        ? { bpm_estimate: pulseNow.bpm, prominence: pulseNow.prominence,
            method: pulseNow.method,
            label: "ESTIMATE — non-contact PPG from the camera's green " +
              "channel; not a medical measurement" }
        : { bpm_estimate: null,
            note: "no clean pulse signal was measured (shoulders-up " +
              "framing only; a number is never invented)" },
      scene_light_nm_mean: meanNm,
      scene_light_label: "ESTIMATE — RGB->wavelength is approximate by nature",
      grammar: {
        mapping: "MEASURED dominant motion frequency -> seven-station " +
          "chakra colour grammar, true spectral order (red slow/root to " +
          "violet fast/crown), log band 0.3-3.0 Hz",
        typing: "DECLARED_GRAMMAR",
        note: "The figure light is a declared grammar rendering of " +
          "measured features. The camera is an RGB sensor; no chakra, " +
          "aura, energy-field, or full-spectrum body measurement is " +
          "made or claimed."
      },
      recorded_in_browser: recorded,
      note: "Nothing left the device during the session. This receipt " +
        "carries counts and spectra only — no video, no landmark " +
        "coordinates. Any session recording exists only as the " +
        "download offered on this page."
    };
    summaryJson.textContent = JSON.stringify(lastReceipt, null, 2);
    summaryBox.hidden = false;
    sendStatus.textContent = "";
    setStatus("session stopped — camera released. The receipt exists only " +
      "in this page until you download it or send it to Muse.");
    drawPuppetFinal();
  }
  function drawPuppetFinal() {
    ctx2d.fillStyle = "#060510";
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  }

  startBtn.addEventListener("click", startSession);
  stopBtn.addEventListener("click", stopSession);
  fullBtn.addEventListener("click", function () {
    framing = "full";
    fullBtn.setAttribute("aria-pressed", "true");
    shBtn.setAttribute("aria-pressed", "false");
    pulseEl.textContent = "shoulders-up framing only";
  });
  shBtn.addEventListener("click", function () {
    framing = "shoulders";
    shBtn.setAttribute("aria-pressed", "true");
    fullBtn.setAttribute("aria-pressed", "false");
    if (running) startFaceMesh();
    pulseEl.textContent = "pulse: gathering signal…";
  });

  dlReceiptBtn.addEventListener("click", function () {
    if (!lastReceipt) return;
    var blob = new Blob([JSON.stringify(lastReceipt, null, 2)],
      { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "camera-studio-receipt.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  sendBtn.addEventListener("click", async function () {
    if (!lastReceipt) return;
    sendBtn.disabled = true;
    sendStatus.textContent = "sending…";
    try {
      var r = await fetch("/api/studio/receipt", {
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

  drawPuppetFinal();
})();
