/* Station Attunement Pass — surface-agnostic client.
   Posts to same-origin relative /api/attunement/*. Breath cycle:
   12 s per station = 6.9 s rise / 0.3 s hold / 4.8 s fall; a full
   root-to-crown pass is 7 stations = 84 s. An optional pre-pass
   self-scan may start the ascent at a later station; expected length
   is then (7 - start_station) * 12 s. No camera APIs are used here. */
(function(){
  "use strict";
  /* LABELLING LAW: this station -> feeling mapping is DECLARED_GRAMMAR
     (traditional association), never a diagnosis and never a
     measurement. No frequency claims are made anywhere in this file. */
  var STATIONS = [
    {name:"Mūlādhāra",   gloss:"root",         scan:"root",         feeling:"always on edge",        color:"#ff2a1a"},
    {name:"Svādhiṣṭhāna", gloss:"sacral flow",  scan:"sacral",       feeling:"no spark, no joy",      color:"#ff7a00"},
    {name:"Maṇipūra",     gloss:"navel fire",   scan:"solar plexus", feeling:"can't say no",          color:"#ffd400"},
    {name:"Anāhata",      gloss:"heart",        scan:"heart",        feeling:"hard to let people in", color:"#2ee66b"},
    {name:"Viśuddha",     gloss:"throat",       scan:"throat",       feeling:"words get stuck",       color:"#1e9bff"},
    {name:"Ājñā",         gloss:"brow insight", scan:"third eye",    feeling:"doubting your gut",     color:"#5a3dff"},
    {name:"Sahasrāra",    gloss:"crown",        scan:"crown",        feeling:"feeling disconnected",  color:"#b45cff"}
  ];
  var RISE = 6.9, HOLD = 0.3, FALL = 4.8, PER = RISE + HOLD + FALL; // 12 s
  var root = document.getElementById("attunement");
  if (!root) return;
  var spine = root.querySelector(".att-spine");
  var light = root.querySelector(".att-light");
  var statusEl = root.querySelector(".att-status");
  var beginBtn = root.querySelector(".att-begin");
  var abortBtn = root.querySelector(".att-abort");
  var nodes = Array.prototype.slice.call(root.querySelectorAll(".att-station"));
  var chips = Array.prototype.slice.call(root.querySelectorAll(".att-chip"));
  var raf = null, passId = null, t0 = 0, running = false;
  var selected = null;   // self-scan selection: station index or null
  var startIdx = 0;      // station the running pass starts from

  chips.forEach(function(chip){
    chip.addEventListener("click", function(){
      if (running) return;
      var idx = parseInt(chip.getAttribute("data-idx"), 10);
      if (selected === idx){ selected = null; chip.classList.remove("sel"); }
      else {
        selected = idx;
        chips.forEach(function(c){ c.classList.remove("sel"); });
        chip.classList.add("sel");
      }
      setStatus(selected === null
        ? "ready — press Begin when you are."
        : "beginning at " + STATIONS[selected].name + " · " +
          STATIONS[selected].scan + " — the ascent runs from there to the crown.");
    });
  });

  function setStatus(t){ statusEl.textContent = t; }
  function stationY(i){
    var n = nodes[i]; if (!n || !spine) return 0;
    var dot = n.querySelector(".att-node") || n;
    var sr = spine.getBoundingClientRect(), dr = dot.getBoundingClientRect();
    return dr.top - sr.top + dr.height / 2;
  }
  function tint(color, strength){
    light.style.background =
      "radial-gradient(circle, " + color + " 0%, " + color +
      Math.round(strength * 99).toString(16).padStart(2, "0") +
      " 34%, transparent 70%)";
    light.style.opacity = String(0.25 + 0.75 * strength);
    light.style.boxShadow = "0 0 " + (30 + 70 * strength) + "px " + color;
  }
  function frame(now){
    if (!running) return;
    var elapsed = (now - t0) / 1000;
    var step = Math.floor(elapsed / PER);
    var idx = startIdx + step;
    if (idx >= STATIONS.length){ finish(); return; }
    var phase = elapsed - step * PER;
    var dest = STATIONS[idx];
    for (var i = startIdx; i < idx; i++) nodes[i].classList.add("lit");
    if (phase < RISE){
      // Rise: light ascends from the current station toward the next,
      // tinted with the DESTINATION station's spectral colour.
      var from = idx === startIdx ? stationY(idx) : stationY(idx - 1);
      var to = stationY(idx);
      var p = phase / RISE;
      var ease = 0.5 - 0.5 * Math.cos(Math.PI * p);
      light.style.top = (from + (to - from) * ease) + "px";
      tint(dest.color, 0.35 + 0.45 * p);
      setStatus("rising to " + dest.name + " · " + dest.gloss +
                " — station " + (idx + 1) + " of 7");
    } else if (phase < RISE + HOLD){
      // Hold: bloom peak at the arrived station.
      nodes[idx].classList.add("lit");
      light.style.top = stationY(idx) + "px";
      tint(dest.color, 1);
      setStatus(dest.name + " · " + dest.gloss + " — held at the bloom peak");
    } else {
      // Fall: light rests; the station node stays lit (stations accumulate).
      nodes[idx].classList.add("lit");
      light.style.top = stationY(idx) + "px";
      var q = 1 - (phase - RISE - HOLD) / FALL;
      tint(dest.color, 0.15 + 0.25 * q);
      setStatus(dest.name + " · " + dest.gloss + " — resting, station lit");
    }
    raf = requestAnimationFrame(frame);
  }
  function finish(){
    running = false;
    nodes.forEach(function(n, i){ if (i >= startIdx) n.classList.add("lit"); });
    // Gentle completion bloom at the crown.
    light.style.top = stationY(STATIONS.length - 1) + "px";
    tint(STATIONS[STATIONS.length - 1].color, 1);
    setStatus("pass complete — writing the receipt…");
    fetch("/api/attunement/complete", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({pass_id: passId})
    }).then(function(r){ return r.json(); }).then(function(d){
      if (d && d.event_id){
        setStatus("pass complete — receipt " + d.event_id +
                  " · " + d.elapsed_s + " s (" + d.status + ")");
      } else {
        setStatus("pass complete — receipt failed: " +
                  ((d && d.error) || "unknown error"));
      }
    }).catch(function(e){
      setStatus("pass complete — receipt failed: " + e);
    }).finally(function(){
      beginBtn.disabled = false; abortBtn.disabled = true;
    });
  }
  beginBtn.addEventListener("click", function(){
    if (running) return;
    startIdx = (selected === null ? 0 : selected);
    nodes.forEach(function(n, i){
      n.classList.remove("lit");
      // Stations below the start are shown already-dimmed/pre-lit as
      // "passed" — they are not ascended through.
      n.classList.toggle("passed", i < startIdx);
    });
    beginBtn.disabled = true; abortBtn.disabled = false;
    setStatus("beginning the ascent…");
    var body = (selected === null) ? {}
                                   : {start_station: selected};
    fetch("/api/attunement/start", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body)
    })
      .then(function(r){ return r.json(); })
      .then(function(d){
        passId = d.pass_id;
        running = true;
        t0 = performance.now();
        raf = requestAnimationFrame(frame);
      })
      .catch(function(e){
        setStatus("could not start: " + e);
        beginBtn.disabled = false; abortBtn.disabled = true;
      });
  });
  abortBtn.addEventListener("click", function(){
    if (!running) return;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    light.style.opacity = "0";
    setStatus("pass ended — no receipt written");
    beginBtn.disabled = false; abortBtn.disabled = true;
  });
})();
