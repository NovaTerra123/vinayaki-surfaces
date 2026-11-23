/* Sri Yantra Dashboard V4 — app.js
   Engine amendments bound by the V4 command §7: dual analysers (0.05 fast /
   0.30 slow), lookahead scheduling on the audio clock, decode-ahead with
   Play gated at 9/9, per-file firstOnsetOffset re-zeroing, per-output
   latency compensation, granthi dwell plateaus, sync-health readout,
   announced degradation. Sanctuary fail-closed (manifest M-16): the full
   figure is veiled until the ready-handshake — 9/9 decoded + schedule
   armed — so a silent or unsynchronised presentation cannot occur.
   Geometry is constant data (data.js); audio moves light only. */
(function(){
"use strict";
var D = window.V4DATA, C = window.V4Core;
var $ = function(s, r){ return (r||document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };

/* ---------- entrance stagger: 50–80 ms steps, ±8–12% organic variance (Battery #23 design) ---------- */
$$(".panel").forEach(function(p, i){
  var base = 60 * i, jitter = base * (0.88 + Math.random() * 0.24);
  p.style.setProperty("--enter-delay", Math.round(jitter) + "ms");
});

/* ---------- quiet hours (22:00–07:00 his local time) ---------- */
var hour = new Date().getHours();
if (hour >= 22 || hour < 7) $("#quietNote").hidden = false;

/* ---------- calm / reduced motion ---------- */
var calm = false;
function setCalm(on){
  calm = on; document.body.classList.toggle("calm", on);
  $("#calmToggle").setAttribute("aria-pressed", String(on));
}
if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) setCalm(true);
$("#calmToggle").addEventListener("click", function(){ setCalm(!calm); });

/* ---------- figure (SVG, solver data verbatim) ---------- */
var SVGNS = "http://www.w3.org/2000/svg";
var S = 104; /* unit R -> svg units */
function el(name, attrs, parent){
  var e = document.createElementNS(SVGNS, name);
  for (var k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
var fig = $("#figure");
var breathG = el("g", { id: "breathG" }, fig);
(function buildFigure(){
  var defs = el("defs", {}, fig);
  var glowF = el("filter", { id: "glyphGlow", x: "-60%", y: "-60%", width: "220%", height: "220%" }, defs);
  el("feGaussianBlur", { stdDeviation: "1.6", result: "b" }, glowF);
  var merge = el("feMerge", {}, glowF);
  el("feMergeNode", { in: "b" }, merge); el("feMergeNode", { in: "SourceGraphic" }, merge);

  /* bhūpura: square ±125, four T-gates, gold tracery ≤2px */
  var g = el("g", { stroke: "#e6c35c", "stroke-width": "1.5", fill: "none", id: "bhupura" }, breathG);
  var B = 125, gap = 15;
  [[-B,-B,-gap,-B],[gap,-B,B,-B],[B,-B,B,-gap],[B,gap,B,B],[B,B,gap,B],[-gap,B,-B,B],[-B,B,-B,gap],[-B,-gap,-B,-B]]
    .forEach(function(s){ el("line", { x1: s[0], y1: s[1], x2: s[2], y2: s[3] }, g); });
  /* T-gates: outward step at each side's middle */
  [[0,-1],[0,1],[-1,0],[1,0]].forEach(function(d){
    var cx = d[0]*B, cy = d[1]*B, px = d[1], py = d[0], o = 7;
    var pts = [
      [cx - px*gap + d[0]*0, cy - py*gap + d[1]*0],
      [cx - px*gap + d[0]*o, cy - py*gap + d[1]*o],
      [cx - px*(gap-6) + d[0]*o, cy - py*(gap-6) + d[1]*o],
      [cx + px*(gap-6) + d[0]*o, cy + py*(gap-6) + d[1]*o],
      [cx + px*gap + d[0]*o, cy + py*gap + d[1]*o],
      [cx + px*gap, cy + py*gap]
    ];
    el("polyline", { points: pts.map(function(p){ return p[0]+","+p[1]; }).join(" ") }, g);
  });
  /* circles */
  [104, 110, 116].forEach(function(r){ el("circle", { cx: 0, cy: 0, r: r, fill: "none", stroke: "#e6c35c", "stroke-width": "1.2", opacity: "0.85" }, breathG); });

  /* petals: leaf path between two radii at angle th (svg coords) */
  function petal(parent, thDeg, rIn, rOut, attrs){
    var th = thDeg * Math.PI / 180, half = (rIn + rOut) / 2;
    var tip = [rOut * Math.cos(th), rOut * Math.sin(th)];
    var spread = Math.PI / 16 * (rIn > 100 ? 1 : 1.35);
    var b1 = [rIn * Math.cos(th - spread), rIn * Math.sin(th - spread)];
    var b2 = [rIn * Math.cos(th + spread), rIn * Math.sin(th + spread)];
    var c1 = [half * Math.cos(th - spread * 0.55), half * Math.sin(th - spread * 0.55)];
    var c2 = [half * Math.cos(th + spread * 0.55), half * Math.sin(th + spread * 0.55)];
    var p = el("path", { d: "M"+b1[0].toFixed(2)+","+b1[1].toFixed(2)+" Q"+c1[0].toFixed(2)+","+c1[1].toFixed(2)+" "+tip[0].toFixed(2)+","+tip[1].toFixed(2)+" Q"+c2[0].toFixed(2)+","+c2[1].toFixed(2)+" "+b2[0].toFixed(2)+","+b2[1].toFixed(2)+" Z" }, parent);
    for (var k in attrs) p.setAttribute(k, attrs[k]);
    return p;
  }
  var petals16 = el("g", { id: "petals16", fill: "none", stroke: "#c9a44e", "stroke-width": "1" }, breathG);
  var lettersG = el("g", { id: "letters", "text-anchor": "middle", "dominant-baseline": "central" }, breathG);
  for (var i = 0; i < 16; i++){
    /* math angle CCW from east; svg y is flipped, so use -angle */
    var pos = C.petalPos(i, 110);
    petal(petals16, -C.petalAngleDeg(i), 104, 116, {});
    var t = el("text", { x: pos.x, y: pos.y, "font-size": "11.5", fill: "#F2C94C", "class": "vowel" }, lettersG);
    t.textContent = D.vowels16[i];
    t.setAttribute("transform", "rotate(" + (-C.petalAngleDeg(i) + 90) + " " + pos.x + " " + pos.y + ")");
  }
  /* 8 petals: NO letters — contested placement, ring stays blank (C-18) */
  var petals8 = el("g", { id: "petals8", fill: "none", stroke: "#c9a44e", "stroke-width": "1", opacity: "0.9" }, breathG);
  for (var j = 0; j < 8; j++) petal(petals8, -(j * 45 + 22.5), 92, 104, {});

  /* the nine triangles — constants; audio never touches these points (Battery #32) */
  var triG = el("g", { id: "triangles", fill: "none", "stroke-width": "1.3" }, breathG);
  D.triangles_R.forEach(function(tri, ti){
    var pts = tri.map(function(p){ return (p[0]*S).toFixed(2) + "," + (-p[1]*S).toFixed(2); }).join(" ");
    el("polygon", { points: pts, "class": "tri", "data-tri": ti }, triG);
  });
  /* bindu at the incentre */
  el("circle", { id: "binduDot", cx: D.svg.bindu[0], cy: D.svg.bindu[1], r: "2.3", fill: "#fdf6dd" }, breathG);
  /* centre glyph */
  var glyph = el("text", { id: "centreGlyph", x: 0, y: 1, "text-anchor": "middle", "dominant-baseline": "central", "font-size": "30", fill: "#F2C94C" }, breathG);
  glyph.textContent = "";
})();

/* ---------- schemes (must differ VISIBLY; Battery: scheme leg of #15/#16) ---------- */
var scheme = "classical";
function applyScheme(){
  var modern = scheme === "modern";
  $$("#triangles .tri").forEach(function(p, i){
    p.setAttribute("stroke", modern ? D.spectral[i % 6] : (i % 2 ? "#d8cfc0" : "#e8e2d4"));
    p.setAttribute("stroke-opacity", modern ? "0.95" : "0.8");
  });
  $$("#letters .vowel").forEach(function(t){
    t.setAttribute("fill", modern ? "#ffffff" : "#F2C94C");
    t.setAttribute("filter", modern ? "url(#glyphGlow)" : "");
  });
  $("#centreGlyph").setAttribute("fill", modern ? "#ffffff" : "#F2C94C");
  $("#centreGlyph").setAttribute("filter", modern ? "url(#glyphGlow)" : "");
  $("#schemeToggle").textContent = modern ? "Colours: Modern rainbow (20th c.)" : "Colours: Traditional";
  $("#schemeToggle").setAttribute("aria-pressed", String(modern));
}
$("#schemeToggle").addEventListener("click", function(){ scheme = scheme === "modern" ? "classical" : "modern"; applyScheme(); });
applyScheme();

/* ---------- station cards ---------- */
(function cards(){
  var wrap = $("#stationCards");
  D.stations.forEach(function(st, i){
    var card = document.createElement("article"); card.className = "card";
    card.innerHTML = "<h3>" + (i+1) + " · " + st.plain + " <span class='h2sub'>— " + st.name + "</span></h3>" +
      "<p><span class='bija'>" + st.bija + "</span> " + st.translit + " · " + st.petals + " petals · " + st.tattvaWord + "</p>" +
      "<p><span class='swatch' style='background:" + (st.lotusHex || "#444") + "'></span>lotus: " + st.lotusWord + "</p>" +
      "<p>" + st.deity + " · " + st.sakti + " · " + st.animal + "</p>" +
      "<button class='chip tone-btn' data-tone='" + ["lam","vam","ram","yam","ham","om"][i] + "' data-station='" + i + "'>Hear its seed-sound</button>";
    wrap.appendChild(card);
  });
  var crown = document.createElement("article"); crown.className = "card";
  crown.innerHTML = "<h3>7 · Crown <span class='h2sub'>— " + D.crown.name + "</span></h3><p>" + D.crown.note + "</p>";
  wrap.appendChild(crown);
})();

/* ---------- light canvas: sprites, rays, Bessel modes ---------- */
var canvas = $("#lightCanvas"), lctx = canvas.getContext("2d");
var CW = canvas.width, CTR = CW / 2, SCALE = CW / 250;
function glowSprite(hex){
  var c = document.createElement("canvas"); c.width = c.height = 256;
  var x = c.getContext("2d");
  var g = x.createRadialGradient(128,128,0,128,128,128);
  g.addColorStop(0, "#ffffff"); g.addColorStop(0.18, hex); g.addColorStop(0.55, hex + "55"); g.addColorStop(1, "transparent");
  x.fillStyle = g; x.fillRect(0,0,256,256);
  return c;
}
var sprites = D.spectral.map(glowSprite);
var pearlSprite = glowSprite("#efe9ff");
var raySprite = (function(){
  var c = document.createElement("canvas"); c.width = 512; c.height = 32;
  var x = c.getContext("2d");
  var g = x.createLinearGradient(0,0,512,0);
  g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(0.35, "rgba(255,255,255,0.28)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.beginPath(); x.moveTo(0,14); x.lineTo(512,16); x.lineTo(512,18); x.lineTo(0,18); x.closePath(); x.fill();
  return c;
})();

var quality = { rays: 36, level: 0 }; /* level>0 = degraded, ANNOUNCED (Battery #17) */
var frameEMA = 8, slowFrames = 0;
function announceDegradation(){
  var n = $("#degradeNote");
  if (quality.level > 0){
    n.hidden = false;
    n.textContent = "For smoothness on this device, the rays are reduced (" + quality.rays + " of 36). Nothing else changes — the reduction is labelled, never silent.";
  } else { n.hidden = true; n.textContent = ""; }
}

/* ---------- audio engine ---------- */
var AC = null, master = null, fastAn = null, slowAn = null, comp = null;
var buffers = {}, decoded = 0, totalFiles = 9, engineReady = false;
var voiceKeys = Object.keys(D.voices);
var allFiles = voiceKeys.map(function(k){ return [k, D.voices[k].file]; })
  .concat(Object.keys(D.singles).map(function(k){ return [k, D.singles[k].file]; }));
var currentVoice = "sadhguru", playing = null;
var health = new C.SyncHealth();
var calOffsetMs = parseFloat(localStorage.getItem("v4-cal-offset-ms") || "0") || 0;

$$(".voice-btn").forEach(function(b){
  b.addEventListener("click", function(){
    currentVoice = b.getAttribute("data-voice");
    $$(".voice-btn").forEach(function(x){ x.setAttribute("aria-pressed", String(x === b)); });
    if (playing) stopPlayback();
    $("#nowState").textContent = "Chosen: " + D.voices[currentVoice].label + ". Press play when ready.";
  });
});
$$(".voice-btn")[0].setAttribute("aria-pressed", "true");

function initAudio(){
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
  master = AC.createGain(); master.gain.value = 0.9;
  fastAn = AC.createAnalyser(); fastAn.fftSize = C.ANALYSERS.fast.fftSize; fastAn.smoothingTimeConstant = C.ANALYSERS.fast.smoothingTimeConstant;
  slowAn = AC.createAnalyser(); slowAn.fftSize = C.ANALYSERS.slow.fftSize; slowAn.smoothingTimeConstant = C.ANALYSERS.slow.smoothingTimeConstant;
  comp = AC.createDynamicsCompressor();
  master.connect(fastAn); master.connect(slowAn); master.connect(comp); comp.connect(AC.destination);
  if ((AC.outputLatency || 0) > 0.15 || (AC.baseLatency || 0) > 0.15) $("#btWarn").hidden = false;
}
function decodeAll(){
  initAudio();
  var t0 = performance.now();
  allFiles.forEach(function(pair){
    var key = pair[0];
    fetch(pair[1]).then(function(r){ return r.arrayBuffer(); })
      .then(function(ab){ return AC.decodeAudioData(ab); })
      .then(function(buf){
        buffers[key] = buf; decoded++;
        $("#decodeState").textContent = "Decoding the recordings… " + decoded + " of 9 ready (" + Math.round(performance.now() - t0) + " ms so far).";
        if (decoded === totalFiles){
          engineReady = true;
          $("#decodeState").textContent = "All 9 recordings decoded and held in memory — play is instant, nothing decodes late. Decode took " + Math.round(performance.now() - t0) + " ms in this browser.";
          var pb = $("#playBtn"); pb.disabled = false; pb.textContent = "▶ Play the cycle";
          /* Sanctuary ready-handshake (M-16): the veil lifts only now. */
          $("#stage").classList.add("ready");
        }
      })
      .catch(function(err){
        $("#decodeState").textContent = "A recording could not be decoded (" + key + "). The figure stays veiled — a silent presentation is not allowed.";
        console.error("decode failed", key, err);
      });
  });
}
window.addEventListener("load", decodeAll);

function bandLevel(an, hz){
  var data = new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(data);
  var idx = Math.round(hz / (AC.sampleRate / 2) * an.frequencyBinCount);
  return (data[idx] || 0) / 255;
}

/* scheduler: 25 ms lookahead tick on the audio clock (engine-core constants) */
var fireQueue = [], schedTimer = null, startCtx = 0, activeMap = null;
function startScheduler(map){
  var enqueued = new Array(map.events.length).fill(false), crownDone = false;
  schedTimer = setInterval(function(){
    var upto = AC.currentTime + C.SCHED_HORIZON_S;
    map.events.forEach(function(e, i){
      var stamp = startCtx + map.offset + e[0];
      if (!enqueued[i] && stamp <= upto){ enqueued[i] = true; fireQueue.push({ stamp: stamp, ev: i, idx: e[1], dir: e[2] }); }
    });
    var crownStamp = startCtx + map.offset + map.crown;
    if (!crownDone && crownStamp <= upto){ crownDone = true; fireQueue.push({ stamp: crownStamp, ev: -2, idx: -2, dir: "c" }); }
  }, C.SCHED_TICK_S * 1000);
}
function stopScheduler(){ if (schedTimer) clearInterval(schedTimer); schedTimer = null; fireQueue = []; }

var lastCueIdx = -1;
function fireDueCues(){
  var now = AC.currentTime;
  while (fireQueue.length && fireQueue[0].stamp <= now){
    var q = fireQueue.shift();
    var errMs = (now - q.stamp) * 1000 + calOffsetMs;
    var rec = health.record(errMs);
    $("#syncHealth").textContent = "last cue " + rec.lastErrorMs.toFixed(1) + " ms from the sound" +
      (AC.outputLatency ? " · output latency " + Math.round((AC.outputLatency + (AC.baseLatency||0)) * 1000) + " ms" : "");
    $("#driftWarn").hidden = !rec.warning;
    lastCueIdx = q.idx;
    var glyph = $("#centreGlyph");
    if (q.ev === -2){ glyph.textContent = ""; $("#nowState").textContent = "Crown — silence. The point alone holds the light."; }
    else {
      glyph.textContent = D.centreGlyphs[q.idx];
      var st = D.stations[q.idx];
      var pos = now - startCtx - activeMap.offset;
      var state = C.stateAt(activeMap, pos);
      $("#nowState").textContent = "Now sounding: " + st.translit + " — the " + st.plain.toLowerCase() + " centre" +
        (state.granthi ? " · " + state.granthi + " — the sweep rests at the knot." : "");
    }
  }
}

function playVoice(){
  if (!engineReady || playing) return;
  if (AC.state === "suspended") AC.resume();
  var v = D.voices[currentVoice];
  var src = AC.createBufferSource(); src.buffer = buffers[currentVoice];
  var g = AC.createGain(); g.gain.value = Math.pow(10, (v.gain_dB || 0) / 20);
  src.connect(g); g.connect(master);
  activeMap = C.rezeroMap(D.cueMaps[v.map], v.firstOnsetOffset);
  startCtx = AC.currentTime + 0.08;
  src.start(startCtx);
  playing = { src: src, gain: g, startedAt: performance.now() };
  health = new C.SyncHealth(); lastCueIdx = -1;
  startScheduler(activeMap);
  var pb = $("#playBtn"); pb.textContent = "■ Stop"; pb.disabled = false;
  src.onended = function(){ if (playing && playing.src === src) stopPlayback(true); };
}
function stopPlayback(ended){
  if (!playing) return;
  try { playing.src.onended = null; playing.src.stop(); } catch(e){}
  playing = null; stopScheduler();
  $("#centreGlyph").textContent = "";
  $("#playBtn").textContent = "▶ Play the cycle";
  if (!ended) $("#nowState").textContent = "Stopped. The figure returns to its breath.";
}
$("#playBtn").addEventListener("click", function(){ playing ? stopPlayback() : playVoice(); });

/* single bīja tones (silent-armed: they sound only on an explicit tap) */
$$(".tone-btn").forEach(function(b){
  b.addEventListener("click", function(){
    if (!engineReady) { $("#nowState").textContent = "The tones are still decoding — a moment."; return; }
    if (AC.state === "suspended") AC.resume();
    var src = AC.createBufferSource(); src.buffer = buffers[b.getAttribute("data-tone")];
    src.connect(master); src.start();
    var idx = parseInt(b.getAttribute("data-station"), 10);
    $("#centreGlyph").textContent = D.centreGlyphs[idx];
    flashStation = { idx: idx, until: performance.now() + 1600 };
    setTimeout(function(){ if (!playing) $("#centreGlyph").textContent = ""; }, 1700);
  });
});
var flashStation = null;

/* ---------- render loop: breath + light (geometry never moves with audio) ---------- */
var lastFrameT = performance.now();
function frame(now){
  requestAnimationFrame(frame);
  var dt = now - lastFrameT; lastFrameT = now;
  /* frame-cost guard: sustained >8 ms frames reduce rays, ANNOUNCED (#17) */
  frameEMA = frameEMA * 0.95 + Math.min(dt, 100) * 0.05;
  if (frameEMA > 8 && quality.level === 0 && now > 4000){ quality.level = 1; quality.rays = 18; announceDegradation(); }
  if (frameEMA > 12 && quality.level === 1){ quality.level = 2; quality.rays = 8; announceDegradation(); }
  if (frameEMA < 6 && quality.level > 0){ quality.level = 0; quality.rays = 36; announceDegradation(); }

  var b = C.breathAt(now / 1000);
  var amp = calm ? C.BREATH.calmScaleAmp : C.BREATH.scaleAmp;
  var scale = 1 + amp * b.value;
  breathG.setAttribute("transform", "scale(" + scale.toFixed(5) + ")");
  $("#pageGlow").style.opacity = String(0.55 + (calm ? 0.06 : C.BREATH.glowAmp) * b.value);

  /* audio state */
  var S = 0, sweep = 0, dirSign = 1, crown = false, idx = -1, E = 0, slowE = 0;
  var bands = { 82: 0, 164: 0, 246: 0, 328: 0 };
  if (AC && engineReady){
    var fd = new Uint8Array(fastAn.frequencyBinCount); fastAn.getByteFrequencyData(fd);
    var sd = new Uint8Array(slowAn.frequencyBinCount); slowAn.getByteFrequencyData(sd);
    var sum = 0, ssum = 0;
    for (var i = 0; i < fd.length; i++){ sum += fd[i]; ssum += sd[i]; }
    E = sum / fd.length / 255; slowE = ssum / sd.length / 255;
    [82, 164, 246, 328].forEach(function(hz){ bands[hz] = bandLevel(fastAn, hz); });
    $("#band82").value = bands[82]; $("#band164").value = bands[164];
    $("#band246").value = bands[246]; $("#band328").value = bands[328];
  }
  if (playing && activeMap){
    var pos = AC.currentTime - startCtx - activeMap.offset;
    var st = C.stateAt(activeMap, pos);
    S = st.S; sweep = st.sweep; dirSign = st.dirSign; crown = st.crown; idx = st.idx;
    fireDueCues();
    if (pos > activeMap.dur + 0.6 && playing) stopPlayback(true);
  } else if (flashStation && now < flashStation.until){
    idx = flashStation.idx; S = 0.85;
  }

  /* light drawing */
  lctx.clearRect(0, 0, CW, CW);
  lctx.globalCompositeOperation = "lighter";
  var colIdx = crown ? 6 : (idx >= 0 ? idx : 5);
  var sprite = crown ? pearlSprite : sprites[colIdx];
  var glowR = CTR * (0.55 + 0.75 * S + 0.25 * slowE) * (1 + (calm ? 0.02 : C.BREATH.glowAmp) * b.value);
  lctx.globalAlpha = 0.25 + 0.55 * S + 0.2 * slowE;
  lctx.drawImage(sprite, CTR - glowR, CTR - glowR, glowR * 2, glowR * 2);
  /* sweep wavefront: a ring at the sweep radius, full brightness both ways */
  if (playing && (S > 0.02 || crown)){
    var r = (crown ? 1 : sweep) * 116 * SCALE;
    lctx.globalAlpha = crown ? 0.5 : 0.28 + 0.5 * S;
    lctx.strokeStyle = crown ? "#efe9ff" : D.spectral[colIdx];
    lctx.lineWidth = 2.2;
    lctx.beginPath(); lctx.arc(CTR, CTR, Math.max(1, r), 0, Math.PI * 2); lctx.stroke();
  }
  /* rays: Bessel-weighted fan, dissolving with distance */
  var modes = C.lightModes({ 82: -30 + bands[82] * 30, 246: -40 + bands[246] * 40, 328: -40 + bands[328] * 40 });
  var rayBase = crown ? 0.85 : (0.18 + 0.82 * Math.max(S, E * 1.4));
  var nRays = quality.rays;
  for (var ri = 0; ri < nRays; ri++){
    var ang = (ri / nRays) * Math.PI * 2 + now / 24000;
    var w = Math.abs(C.besselJ(0, 3.5 * Math.sin(ang * 2))) * modes.j0 +
            Math.abs(C.besselJ(3, 2.5 * Math.cos(ang * 3))) * modes.j3 +
            Math.abs(C.besselJ(5, 2.0 * Math.sin(ang * 5))) * modes.j5;
    var len = (90 + 240 * rayBase * (0.35 + w)) * SCALE / 2.4;
    if (len < 12) continue;
    lctx.save();
    lctx.translate(CTR, CTR); lctx.rotate(ang);
    lctx.globalAlpha = Math.min(0.75, 0.12 + 0.6 * rayBase * (0.3 + w));
    lctx.globalCompositeOperation = "lighter";
    lctx.drawImage(raySprite, 30 * SCALE / 2.4, -2, len, 4);
    lctx.restore();
  }
  lctx.globalAlpha = 1; lctx.globalCompositeOperation = "source-over";
}
requestAnimationFrame(frame);

/* ---------- Meru: five tiers, drag-orbit + inertia + slow autonomous orbit ---------- */
(function meru(){
  var wrap = $("#meruWrap"), m = $("#meru"), built = false;
  var tiers = [
    ["#3FA34D", 300, 0], ["#2E7CD6", 252, 44], ["#5B4BC4", 204, 88], ["#8B5FC9", 156, 132], ["#CFC4F5", 108, 176]
  ];
  var rotY = -18, rotX = 58, velY = 0, dragging = false, lastX = 0, idleSince = performance.now();
  function build(){
    if (built) return; built = true;
    tiers.forEach(function(t, i){
      var d = document.createElement("div");
      d.className = "meru-tier";
      d.style.width = t[1] + "px"; d.style.height = "150px";
      d.style.marginLeft = (-t[1] / 2) + "px";
      d.style.bottom = t[2] + "px";
      d.style.background = t[0] + "2e";
      d.style.borderColor = t[0];
      d.style.transform = "rotateX(0deg)";
      d.setAttribute("data-tier", i);
      m.appendChild(d);
    });
  }
  function render(){
    $$(".meru-tier", m).forEach(function(d){
      d.style.transform = "rotateX(" + rotX + "deg) rotateZ(" + rotY + "deg)";
      d.style.left = "50%";
    });
  }
  (function spin(){
    requestAnimationFrame(spin);
    if (wrap.hidden) return;
    if (!dragging){
      rotY += velY; velY *= 0.94;
      if (performance.now() - idleSince > 2600) rotY += 0.12; /* slow autonomous orbit */
    }
    render();
  })();
  m.addEventListener("pointerdown", function(e){ dragging = true; lastX = e.clientX; m.setPointerCapture(e.pointerId); });
  m.addEventListener("pointermove", function(e){
    if (!dragging) return;
    var dx = e.clientX - lastX; lastX = e.clientX;
    velY = dx * 0.25; rotY += dx * 0.25; idleSince = performance.now();
  });
  m.addEventListener("pointerup", function(){ dragging = false; idleSince = performance.now(); });
  $("#meruToggle").addEventListener("click", function(){
    var show = wrap.hidden;
    wrap.hidden = !show;
    this.setAttribute("aria-pressed", String(show));
    this.textContent = show ? "See it flat (the plan)" : "See it as a mountain (Meru)";
    if (show) build();
  });
})();

/* ---------- decisions line (Bindu panel closing line) ---------- */
fetch("api/state").then(function(r){ return r.json(); }).then(function(s){
  if (s && typeof s.decisionsToday === "number"){
    $("#decisionsState").textContent = "here are your " + s.decisionsToday + " decisions today.";
  }
}).catch(function(){ /* honest default text stays */ });

/* ---------- chat: one surface per section, NOT INTEGRATED honesty (Ruling 3, C-10) ---------- */
var proactiveUsed = 0, proactiveCap = D.proactivityCapPerSession || 1;
$$("section[data-chat]").forEach(function(sec){
  var name = sec.getAttribute("data-chat");
  var box = document.createElement("div"); box.className = "chat";
  box.innerHTML =
    "<div class='chat-head'><span class='chat-title'>Ask about " + name.toLowerCase() + "</span>" +
    "<span class='chat-state'>not checked yet</span></div>" +
    "<div class='chat-log' hidden></div>" +
    "<p class='chat-note' hidden></p>" +
    "<form class='chat-form'><input type='text' placeholder='Ask a question…' aria-label='Ask a question' disabled>" +
    "<button type='submit' disabled>Ask</button></form>" +
    "<button class='chip chat-open' type='button'>Open the chat</button>";
  sec.appendChild(box);
  var stateEl = $(".chat-state", box), log = $(".chat-log", box), note = $(".chat-note", box),
      form = $(".chat-form", box), input = $("input", form), send = $("button", form),
      openBtn = $(".chat-open", box), history = [], checked = false;

  function setOff(msg){
    stateEl.textContent = "NOT INTEGRATED"; stateEl.classList.add("off");
    note.hidden = false; note.textContent = msg || "The thinking backend on this Mac is not reachable, so this chat honestly stays silent — no canned replies.";
    input.disabled = true; send.disabled = true;
  }
  function setOn(){
    stateEl.textContent = "connected — the canary on this Mac"; stateEl.classList.remove("off");
    note.hidden = true; input.disabled = false; send.disabled = false;
  }
  openBtn.addEventListener("click", function(){
    openBtn.hidden = true; log.hidden = false;
    if (checked) return; checked = true;
    stateEl.textContent = "checking…";
    var ctrl = new AbortController(); var to = setTimeout(function(){ ctrl.abort(); }, 2000);
    fetch("api/chat/health", { signal: ctrl.signal }).then(function(r){ return r.json(); })
      .then(function(s){ clearTimeout(to); if (s && s.backend === "up") setOn(); else setOff(); })
      .catch(function(){ clearTimeout(to); setOff(); });
  });
  form.addEventListener("submit", function(ev){
    ev.preventDefault();
    var text = input.value.trim(); if (!text) return;
    input.value = "";
    addMsg("user", text);
    history.push({ role: "user", content: text });
    fetch("api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: name, message: text, history: history }) })
      .then(function(r){ if (r.status === 503) throw new Error("off"); return r.json(); })
      .then(function(s){
        history.push({ role: "assistant", content: s.reply || "" });
        addMsg("bot", s.reply || "", s.question, s.source);
        if (s.proactive && proactiveUsed < proactiveCap && !playing){
          proactiveUsed++;
          addMsg("bot", s.proactive, null, "a thought, offered once — dismiss by ignoring it");
        }
      })
      .catch(function(){ setOff("The backend stopped answering, so this chat is NOT INTEGRATED again — by design, it will not improvise."); });
  });
  function addMsg(who, text, question, source){
    var d = document.createElement("div"); d.className = "chat-msg " + who;
    d.textContent = text;
    if (source){ var s = document.createElement("span"); s.className = "q"; s.textContent = "Source: " + source; d.appendChild(s); }
    if (question){ var q = document.createElement("span"); q.className = "q"; q.textContent = question; d.appendChild(q); }
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
});

/* ---------- build state footer: honest, always ---------- */
$("#buildState").textContent = "Build state: BUILT (this copy) · battery evidence in RECONCILIATION.md · not deployed — “deployed” is said only after the served state is verified on your screen.";
})();
