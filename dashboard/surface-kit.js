/* surface-kit.js — cycle #3 shared kit copy (byte-identical per surface).
   G-27 identity corner · G-28 UNSEEN seen-receipt · G-31 one freshness
   dialect · G-30 gate strip · G-25/G-26 voice-listen (calls the 8794
   voice service — never forks it) · G-29 Kala strip (8791 mount). */
(function(){
  "use strict";
  var HOST = location.hostname, PROTO = location.protocol;
  var O8791 = PROTO + "//" + HOST + ":8791", O8794 = PROTO + "//" + HOST + ":8794";
  var BUILD = "cycle3-fullui-2026-11-23";
  var SURFACES = {
    "8791": {n:1, name:"Dashboard", plain:"the meeting place — all five surfaces' states in one view", station:"Anahata (heart centre — integration/convergence)"},
    "8792": {n:2, name:"Spandana Control", plain:"the working surface — controls and their receipts", station:"Manipura (navel centre — execution + master clock)"},
    "8793": {n:3, name:"Live Avatar", plain:"the embodied surface — presence, voice and text", station:"Vishuddha (throat centre — voice/intelligibility)"},
    "8794": {n:4, name:"Buddhi Live", plain:"the observability surface — watch Buddhi operate on the real record", station:"Ajna (brow centre — vision/verification)"},
    "8796": {n:5, name:"Spandana Studio", plain:"the commissioning surface — one sentence starts production work", station:"Svadhisthana (sacral centre — creative generation)"}
  };
  /* G-31: ONE freshness dialect. Thresholds unchanged (tuned per poll
     cadence); the LANGUAGE unifies: every chip states transport state,
     view age, and last-event age in the Observatory chip's format. */
  var Freshness = {
    thresholds: {
      controlFeed:   {staleMs:15000,   statement:"stale after 15 s — about 7 missed polls"},
      studioPacket:  {staleMs:900000,  statement:"stale after 15 min without an update"},
      studioView:    {staleMs:90000,   statement:"whole view stale after 90 s"},
      observatory:   {staleMs:120000,  statement:"SNAPSHOT at lag over 120 s; LIVE only on an open stream"},
      avatarHealth:  {staleMs:30000,   statement:"health re-checked every 30 s"}
    },
    describe: function(transport, viewAgeMs, lastEventAgeMs){
      function age(ms){ if (ms == null) return "unknown"; var s = Math.round(ms/1000);
        return s < 60 ? s + "s" : Math.floor(s/60) + "m " + (s%60) + "s"; }
      return transport + " · view age " + age(viewAgeMs) + " · last event " + age(lastEventAgeMs) + " ago";
    }
  };
  window.SurfaceFreshness = Freshness;
  function esc(s){ var d=document.createElement("div"); d.textContent=s==null?"":String(s); return d.innerHTML; }
  /* G-27 + G-28: identity corner, static grading (lit rung) — no JS
     state can change its grade; invariance by construction. UNSEEN:
     a build with no seen-receipt renders UNSEEN beside its live claims;
     on this VM-local edition there is no return path, so the first
     open clears it locally and says so. */
  function identityCorner(){
    var info = SURFACES[location.port]; if (!info || document.querySelector(".identity-corner")) return;
    var seenKey = "surface-seen:" + BUILD + ":" + location.port, unseen = true;
    try { unseen = !localStorage.getItem(seenKey); if (unseen) localStorage.setItem(seenKey, new Date().toISOString()); } catch(e){}
    var d = document.createElement("div"); d.className = "identity-corner";
    d.innerHTML = "<span class='ic-name'>" + esc(info.name) + "</span> — surface " + info.n + " of 5<br>" +
      esc(info.plain) + "<br>Station (energy centre): " + esc(info.station) +
      (unseen ? "<br><span class='ic-unseen'>UNSEEN</span> — this build had not been seen on your screen yet; no return path exists on this edition, so this first open clears the label locally." : "");
    document.body.appendChild(d);
  }
  /* G-30: compact gate strip — display-only everywhere (rulings ride
     the ruling path, never a button here). Reads the same gates section
     of 8791's /api/state that the dashboard consumes. */
  function gateStrip(el){
    if (!el) return;
    el.classList.add("gate-strip");
    el.innerHTML = "<b>Open decisions</b> <span style='font-size:12px;opacity:.8'>(gates — decisions only you can make; display only here, ruling rides the ruling path)</span><div class='gs-body'>Reading the decision record…</div>";
    var body = el.querySelector(".gs-body");
    fetch(O8791 + "/api/state").then(function(r){ return r.json(); }).then(function(s){
      if (!s || !s.gates || !Array.isArray(s.gates.gates)) { body.textContent = "The decision record carries no gates section in this copy — open gates are unknown, not assumed to be none."; return; }
      var open = s.gates.gates.filter(function(g){ return g && g.status === "open"; });
      el.classList.toggle("awaiting", open.length > 0);
      if (!open.length) { body.textContent = "No gates are open right now."; return; }
      var g = open.slice().sort(function(a,b){ return String(a.gate_id || a.id || "").localeCompare(String(b.gate_id || b.id || "")); })[0];
      body.innerHTML = open.length + " open · nearest: <b>" + esc(g.gate_id || g.title || g.id || "gate") + "</b>" +
        (g.decision ? " — " + esc(g.decision) : "") +
        (g.default_on_expiry ? " · if unanswered: " + esc(g.default_on_expiry) : "") +
        (g.age_h != null ? " · waiting " + esc(Math.round(g.age_h * 10) / 10) + "h" : (g.age_human || g.age ? " · waiting " + esc(g.age_human || g.age) : ""));
    }).catch(function(){ body.textContent = "Kala/gate record unreachable — open gates are unknown, not assumed to be none."; });
  }
  /* G-29: compact read-only Kala (time) strip for 8791 — three typed
     layers kept separate; on failure it says unreachable, never assumes. */
  function kalaStrip(el){
    if (!el) return;
    el.classList.add("kala-strip");
    el.innerHTML = "<b>Kala</b> <span style='font-size:12px;opacity:.8'>(time — the measured temporal register; full register on Buddhi Live, 8794)</span><div class='ks-body'>Reading the register…</div>";
    var body = el.querySelector(".ks-body");
    fetch(O8794 + "/api/kala").then(function(r){ return r.json(); }).then(function(k){
      if (!k || k.available === false) { body.innerHTML = "<span class='ks-down'>Kala register unreachable — not assumed.</span>"; return; }
      var a = k.astronomy || k.measured || {}, parts = [];
      if (a.sunrise_hhmm || k.sunrise_hhmm) parts.push("MEASURED (measured sky): sunrise " + esc(a.sunrise_hhmm || k.sunrise_hhmm) + " · sunset " + esc(a.sunset_hhmm || k.sunset_hhmm));
      var wins = k.windows || k.grammar_windows || [];
      if (wins.length) parts.push("DECLARED_GRAMMAR (declared windows, tradition's grammar — not measured fact): " + wins.slice(0,3).map(function(w){ return esc(w.name || w.key) + " " + esc(w.start_hhmm||"") + "–" + esc(w.end_hhmm||""); }).join(" · "));
      var sen = k.sentinel || k.nearest_exposure;
      if (sen) parts.push("Sentinel (dated exposure watch): " + esc(typeof sen === "string" ? sen : (sen.label || sen.name || "")));
      body.innerHTML = parts.length ? parts.join("<br>") : "Register answered but carried no layers this read — shown as empty, not filled in.";
    }).catch(function(){ body.innerHTML = "<span class='ks-down'>Kala register unreachable — not assumed.</span>"; });
  }
  /* G-25/G-26: listen toggles + cycle-#2 voice casting, consumed from
     the 8794 voice service (GET /api/voice/signals, POST /api/voice/speak).
     Nothing is re-cast or forked here. 8793 is a deliberate exclusion
     (it IS a voice; recorded in surfaces-build.md). */
  function voiceListen(el, channels){
    if (!el) return;
    el.classList.add("voice-listen");
    el.innerHTML = "<b>Listen to the swarm</b> <span style='font-size:12px;opacity:.8'>(synthetic voices, cast on Buddhi Live 8794 — the same casting serves every surface; sound never plays on its own)</span><div class='vl-body'>Reading the voice service…</div>";
    var body = el.querySelector(".vl-body"), muted = {};
    function render(d){
      var sigs = (d && (d.signals || d.events)) || [];
      if (!sigs.length) { body.textContent = "No voice signals right now — silence is the honest state when nothing was said."; return; }
      body.innerHTML = "";
      sigs.slice(0,8).forEach(function(sg){
        var row = document.createElement("div");
        var who = sg.agent || sg.actor || sg.channel || "event";
        row.innerHTML = "<label><input type='checkbox' " + (muted[who] ? "" : "checked") + "> listen: " + esc(who) + "</label>" +
          "<span style='font-size:12px;opacity:.8'>" + esc(sg.voice || sg.casting || "synthetic voice") + (sg.bhava ? " · bhava (emotional tone): " + esc(sg.bhava) : "") + "</span> " +
          "<button type='button'>Speak</button> <span class='vl-line' style='font-size:13px'>" + esc((sg.text || sg.summary || "").slice(0,140)) + "</span>";
        var cb = row.querySelector("input"), btn = row.querySelector("button");
        cb.addEventListener("change", function(){ muted[who] = !cb.checked; });
        btn.addEventListener("click", function(){
          if (muted[who]) { return; }
          btn.disabled = true; btn.textContent = "Speaking…";
          fetch(O8794 + "/api/voice/speak", {method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({event_id: sg.event_id || sg.id, text: sg.text || sg.summary || ""})})
            .then(function(r){ return r.json(); }).then(function(out){
              btn.disabled = false; btn.textContent = "Speak";
              if (out && out.audio_url) { var au = new Audio(out.audio_url.indexOf("http")===0 ? out.audio_url : O8794 + out.audio_url); au.play().catch(function(){}); }
            }).catch(function(){ btn.disabled = false; btn.textContent = "Speak — voice lane down"; });
        });
        body.appendChild(row);
      });
    }
    fetch(O8794 + "/api/voice/signals?limit=8").then(function(r){ return r.json(); }).then(render)
      .catch(function(){ body.innerHTML = "<span class='vl-down'>Voice service on 8794 is down — listening is unavailable here, and nothing is simulated.</span>"; });
  }
  window.SurfaceKit = {identityCorner: identityCorner, gateStrip: gateStrip, kalaStrip: kalaStrip, voiceListen: voiceListen, Freshness: Freshness};
  document.addEventListener("DOMContentLoaded", identityCorner);
})();
