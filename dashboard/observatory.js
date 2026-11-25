/* ============================================================
   SWARM OBSERVATORY — UI v2 (2026-11-23)
   The readable multi-channel TantricSync stream.

   Data: ONLY the real feed — {base}/api/events, /api/state,
   /api/jobs, SSE {base}/api/stream. No event is ever fabricated:
   an empty lane renders its true emptiness.

   Nonlinear asynchronous reading, made functional:
   - eight channel lanes (filter toggles) instead of one forced feed
   - pause-the-river: rendering holds, data keeps flowing, the held
     count is shown; resume renders what accumulated
   - jump-to-event by id (full or prefix) or by HH:MM time
   - catch-up compression: a burst (>=4 events, same channel+type+
     actor within 120 s) collapses into one expandable summary line
   - ordering is by event time; arrival time is kept on every record
     and shown in the detail view, so out-of-order arrival is visible

   Honest freshness: the chip says LIVE only while an SSE stream is
   actually open. Otherwise POLLING (local feed) or SNAPSHOT (hosted /
   lagging data), with the view age in seconds, counting up. The word
   "live" is never rendered for snapshot data.
   ============================================================ */
(function (global) {
  "use strict";

  /* ---------- pure core (node-testable) ---------- */

  // The eight feed channels (8794 unified feed vocabulary), each with
  // its plain name, its bus sub-label (bus.py CHANNEL_NAMES lineage,
  // as already used by the Buddhi desk), and a lane accent colour.
  var CHANNELS = [
    { id: "authority",     plain: "Decisions & permissions", bus: "C3 · AUTHORITY",            color: "#FFD97A" },
    { id: "command",       plain: "Commands & commissions",  bus: "C2 · INTENT",               color: "#8FB0FF" },
    { id: "communication", plain: "Who joined & messages",   bus: "C1 · GRAMMAR + C4 · PLAN",  color: "#8FF2FF" },
    { id: "creation",      plain: "Things being made",       bus: "Svādhiṣṭhāna line",         color: "#FF9500" },
    { id: "execution",     plain: "Work running",            bus: "C5 · EXECUTION",            color: "#FFCC00" },
    { id: "integration",   plain: "Changes & deltas",        bus: "C6 · DELTA",                color: "#34C759" },
    { id: "verification",  plain: "Checks & verdicts",       bus: "C0 · EVIDENCE + C7 · VERIFICATION", color: "#E0A6FF" },
    { id: "delivery",      plain: "Deliveries",              bus: "Sahasrāra line",            color: "#AF52DE" }
  ];
  var CH_BY_ID = {}; CHANNELS.forEach(function (c) { CH_BY_ID[c.id] = c; });

  // Provenance types (bus-assigned; the chip is colour + word, always).
  var TYPES = {
    measured:  { word: "measured",         color: "#57C7E3" },
    grammar:   { word: "declared grammar", color: "#D4AF37" },
    wish:      { word: "wish / intent",    color: "#FF8FB3" },
    authority: { word: "authority",        color: "#FF9F57" },
    synthetic: { word: "synthetic test",   color: "#9A8BB8" }
  };

  function sortEvents(events) {
    // Event-time order; arrival sequence breaks ties so out-of-order
    // arrivals stay visible instead of being silently reshuffled.
    return events.slice().sort(function (a, b) {
      var d = (a.epoch || 0) - (b.epoch || 0);
      if (d !== 0) return d;
      return (a._seq || 0) - (b._seq || 0);
    });
  }

  function groupByChannel(events) {
    var out = {}; CHANNELS.forEach(function (c) { out[c.id] = []; });
    sortEvents(events).forEach(function (ev) {
      if (out[ev.channel]) out[ev.channel].push(ev);
      else { (out._other = out._other || []).push(ev); }
    });
    return out;
  }

  var BURST_WINDOW_S = 120, BURST_MIN = 4;
  function compressLane(events) {
    // events: one channel, event-time ascending. Returns items:
    // {kind:"ev", ev} | {kind:"burst", events:[...]}.
    var items = [], run = [];
    function flush() {
      if (run.length >= BURST_MIN) items.push({ kind: "burst", events: run.slice() });
      else run.forEach(function (ev) { items.push({ kind: "ev", ev: ev }); });
      run = [];
    }
    events.forEach(function (ev) {
      if (!run.length) { run = [ev]; return; }
      var first = run[0], last = run[run.length - 1];
      var sameClass = ev.type === first.type && ev.actor === first.actor &&
                      ev.channel === first.channel;
      if (sameClass && (ev.epoch - last.epoch) <= BURST_WINDOW_S &&
          (ev.epoch - first.epoch) <= BURST_WINDOW_S * 2) run.push(ev);
      else { flush(); run = [ev]; }
    });
    flush();
    return items;
  }

  function fmtClock(epoch) {
    if (!epoch) return "—";
    var d = new Date(epoch * 1000);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
  }
  function fmtAge(sec) {
    if (sec == null || !isFinite(sec)) return "—";
    sec = Math.max(0, Math.round(sec));
    if (sec < 90) return sec + "s";
    if (sec < 5400) return Math.round(sec / 60) + " min";
    if (sec < 172800) return (sec / 3600).toFixed(1) + " h";
    return (sec / 86400).toFixed(1) + " d";
  }

  var Core = { CHANNELS: CHANNELS, CH_BY_ID: CH_BY_ID, TYPES: TYPES,
    sortEvents: sortEvents, groupByChannel: groupByChannel,
    compressLane: compressLane, fmtClock: fmtClock, fmtAge: fmtAge,
    BURST_MIN: BURST_MIN, BURST_WINDOW_S: BURST_WINDOW_S };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  global.SwarmObsCore = Core;

  /* ---------- component ---------- */

  function mount(root, opts) {
    opts = opts || {};
    var base = opts.base || "";
    var commissionId = opts.commissionId || "pkt-buddhi-ui-design-2026-11-23";
    var compact = !!opts.compact;
    var RENDER_CAP = compact ? 40 : 80;

    var byId = new Map(), seq = 0, lastEpoch = 0;
    var paused = false, heldCount = 0, compressOn = true;
    var enabled = {}; CHANNELS.forEach(function (c) { enabled[c.id] = true; });
    var typeFilter = ""; // "" = all types
    var mode = "poll";   // live | poll | snapshot | down
    var lastSync = 0, newestEpoch = 0, es = null, esErrors = 0, pollTimer = null;

    root.classList.add("obs"); if (compact) root.classList.add("compact");
    root.innerHTML =
      '<div class="obs-head"><h3 class="obs-title">Swarm Observatory' +
      '<span class="obs-sub">Watch Buddhi\u2019s swarm work \u2014 every line below is a real recorded event on the eight TantricSync channels. Nothing here is simulated.</span></h3>' +
      '<span class="obs-fresh poll" data-r="fresh">connecting\u2026</span></div>' +
      '<div class="obs-controls"><span class="lbl">Channels</span>' +
      CHANNELS.map(function (c) {
        return '<button class="obs-chipbtn" data-r="ch" data-ch="' + c.id +
          '" aria-pressed="true" style="--lane-c:' + c.color + '">' + c.id + '</button>';
      }).join("") +
      '<span class="lbl" style="margin-left:8px">Type</span>' +
      '<button class="obs-chipbtn" data-r="type" data-t="" aria-pressed="true">all</button>' +
      Object.keys(TYPES).map(function (t) {
        return '<button class="obs-chipbtn" data-r="type" data-t="' + t +
          '" aria-pressed="false" style="--lane-c:' + TYPES[t].color + '">' + TYPES[t].word + '</button>';
      }).join("") + '</div>' +
      '<div class="obs-controls">' +
      '<button class="obs-btn" data-r="pause" aria-pressed="false">\u23F8 Pause the river</button>' +
      '<button class="obs-btn ghost" data-r="compress" aria-pressed="true">Catch-up compression: on</button>' +
      '<span class="obs-paused-note" data-r="held"></span>' +
      '<span class="obs-jump"><input data-r="jumpin" type="text" placeholder="jump to event id or HH:MM" aria-label="Jump to event by id or time">' +
      '<button class="obs-btn ghost" data-r="jump">Jump</button>' +
      '<span class="miss" data-r="jumpmiss"></span></span></div>' +
      '<div class="obs-lanes" data-r="lanes"></div>' +
      '<div class="obs-roster" data-r="roster"></div>';

    var lanesEl = root.querySelector('[data-r="lanes"]');
    var freshEl = root.querySelector('[data-r="fresh"]');
    var heldEl = root.querySelector('[data-r="held"]');
    var rosterEl = root.querySelector('[data-r="roster"]');

    // Build lane shells once; bodies re-render on change.
    var laneBodies = {};
    CHANNELS.forEach(function (c) {
      var lane = document.createElement("div");
      lane.className = "obs-lane"; lane.dataset.lane = c.id;
      lane.style.setProperty("--lane-c", c.color);
      lane.innerHTML = '<div class="obs-lane-head"><span class="obs-lane-name">' +
        c.plain + '</span><span class="obs-lane-bus">' + c.bus + '</span>' +
        '<div class="obs-lane-meta" data-r="meta"></div></div>' +
        '<div class="obs-lane-body" data-r="body"></div>';
      lanesEl.appendChild(lane);
      laneBodies[c.id] = { lane: lane, body: lane.querySelector('[data-r="body"]'),
                           meta: lane.querySelector('[data-r="meta"]') };
    });

    function esc(s) { var d = document.createElement("div");
      d.textContent = s == null ? "" : String(s); return d.innerHTML; }

    function evRow(ev) {
      var t = TYPES[ev.type] || TYPES.measured;
      var row = document.createElement("div");
      row.className = "obs-ev"; row.dataset.eid = ev.id;
      row.style.setProperty("--type-c", t.color);
      row.innerHTML =
        '<div class="obs-ev-meta"><span>' + fmtClock(ev.epoch) + ' UTC</span>' +
        '<span class="obs-type">' + t.word + '</span>' +
        (ev.bus_channel ? '<span>' + esc(ev.bus_channel) + '</span>' : '') +
        (ev.station ? '<span>' + esc(ev.station) + '</span>' : '') +
        '<span>' + esc(ev.actor || "") + '</span>' +
        '<span>#' + esc(String(ev.id).slice(0, 8)) + '</span></div>' +
        '<div class="obs-ev-plain">' + esc(ev.plain || ev.summary || "") + '</div>' +
        (ev.plain && ev.summary && ev.summary !== ev.plain ?
          '<div class="obs-ev-sum">' + esc(ev.summary) + '</div>' : '') +
        '<div class="obs-ev-detail"><pre></pre></div>';
      row.addEventListener("click", function () {
        var pre = row.querySelector("pre");
        if (!row.classList.contains("open")) {
          var detail = { id: ev.id, ts: ev.ts, epoch: ev.epoch,
            arrived_seq: ev._seq, source: ev.source, channel: ev.channel,
            bus_channel: ev.bus_channel, type: ev.type, actor: ev.actor,
            station: ev.station, opcode: ev.opcode, yield_kind: ev.yield_kind,
            ref: ev.ref };
          pre.textContent = JSON.stringify(detail, null, 2);
        }
        row.classList.toggle("open");
      });
      return row;
    }

    function renderLane(cid, now) {
      var slot = laneBodies[cid]; if (!slot) return;
      var all = [];
      byId.forEach(function (ev) { if (ev.channel === cid) all.push(ev); });
      all = sortEvents(all);
      var shown = typeFilter ? all.filter(function (e) { return e.type === typeFilter; }) : all;
      slot.lane.classList.toggle("off", !enabled[cid]);
      var last = all[all.length - 1];
      slot.meta.textContent = all.length + " recorded" +
        (last ? " · last " + fmtAge(now - last.epoch) + " ago" : "");
      // Sovereign Ladder (dossier §1): lane freshness rung from the
      // real age of its newest event — lit <60s, kindled <600s,
      // ember beyond; a lane with no events rests at ember.
      var rung = !last ? 1 : (now - last.epoch < 60 ? 3 :
                 (now - last.epoch < 600 ? 2 : 1));
      slot.lane.classList.remove("rung-1", "rung-2", "rung-3");
      slot.lane.classList.add("rung-" + rung);
      slot.body.innerHTML = "";
      if (!all.length) {
        slot.body.innerHTML = '<div class="obs-empty">No traffic recorded on this ' +
          'line yet. The lane is real; the silence is real too.</div>';
        return;
      }
      if (!shown.length) {
        slot.body.innerHTML = '<div class="obs-empty">No events of the chosen ' +
          'type on this line.</div>';
        return;
      }
      var items = compressOn ? compressLane(shown) : shown.map(function (ev) {
        return { kind: "ev", ev: ev }; });
      var nodes = [];
      items.forEach(function (it) {
        if (it.kind === "ev") { nodes.push(evRow(it.ev)); return; }
        var b = document.createElement("div");
        b.className = "obs-burst";
        var f = it.events[0], l = it.events[it.events.length - 1];
        b.innerHTML = '<div class="obs-burst-head"><b>\u00D7' + it.events.length +
          '</b> ' + esc(TYPES[f.type] ? TYPES[f.type].word : f.type) + ' \u00B7 ' +
          esc(f.actor || "") + ' \u00B7 ' + fmtClock(f.epoch) + '\u2013' +
          fmtClock(l.epoch) + ' UTC \u2014 a burst, compressed. Tap to open.</div>';
        var holder = document.createElement("div");
        holder.style.display = "none";
        it.events.forEach(function (ev) { holder.appendChild(evRow(ev)); });
        b.appendChild(holder);
        b.querySelector(".obs-burst-head").addEventListener("click", function () {
          holder.style.display = holder.style.display === "none" ? "" : "none";
        });
        nodes.push(b);
      });
      nodes.reverse(); // newest first for reading
      nodes.slice(0, RENDER_CAP).forEach(function (n) { slot.body.appendChild(n); });
      if (nodes.length > RENDER_CAP) {
        var more = document.createElement("div");
        more.className = "obs-empty";
        more.textContent = "+ " + (nodes.length - RENDER_CAP) +
          " earlier items on this line \u2014 jump by id or time to reach them.";
        slot.body.appendChild(more);
      }
    }

    function renderAll() {
      var now = Date.now() / 1000;
      CHANNELS.forEach(function (c) { renderLane(c.id, now); });
      heldEl.textContent = paused && heldCount ?
        heldCount + " new while paused \u2014 the river kept flowing; press resume to read them." : "";
    }

    function tickFresh() {
      var now = Date.now() / 1000;
      var age = lastSync ? Math.max(0, Math.round(now - lastSync)) : null;
      freshEl.className = "obs-fresh " + mode;
      if (mode === "live") freshEl.textContent = "\u25CF LIVE \u2014 TantricSync stream (SSE) \u00B7 last event " +
        (newestEpoch ? fmtAge(now - newestEpoch) + " ago" : "\u2014");
      else if (mode === "poll") freshEl.textContent = "\u25CC POLLING \u2014 local feed \u00B7 view age " +
        (age == null ? "\u2014" : age + "s") + " \u00B7 last event " +
        (newestEpoch ? fmtAge(now - newestEpoch) + " ago" : "\u2014");
      else if (mode === "snapshot") freshEl.textContent = "\u25A3 SNAPSHOT \u2014 not a live stream \u00B7 data age " +
        (newestEpoch ? fmtAge(now - newestEpoch) : "\u2014") + " \u00B7 view age " +
        (age == null ? "\u2014" : age + "s");
      else freshEl.textContent = "\u25CF FEED DOWN \u2014 no successful sync yet; showing the last record received";
    }

    function ingest(ev, live) {
      if (!ev || !ev.id || byId.has(ev.id)) return false;
      ev._seq = ++seq;
      byId.set(ev.id, ev);
      if (ev.epoch && ev.epoch > lastEpoch) lastEpoch = ev.epoch;
      if (ev.epoch && ev.epoch > newestEpoch) newestEpoch = ev.epoch;
      if (paused) { heldCount++; heldEl.textContent = heldCount +
        " new while paused \u2014 the river kept flowing; press resume to read them."; }
      else if (live) renderAll();
      return true;
    }

    /* --- roster + commission card --- */
    function stateChip(st) { return '<span class="obs-state ' + esc(st || "") + '">' +
      esc(st || "unknown") + '</span>'; }
    function renderRoster(jobs, state) {
      var html = "";
      var parent = jobs.filter(function (j) { return j.id === commissionId; })[0];
      var children = jobs.filter(function (j) {
        return j.lineage === commissionId && j.id !== commissionId; });
      if (parent) {
        var done = children.filter(function (j) { return j.state === "verified"; }).length;
        html += '<div class="obs-commission"><h4>The standing commission \u2014 ' +
          esc(commissionId) + '</h4><div class="cmeta">desk ' + esc(parent.desk || "") +
          ' \u00B7 seat ' + esc(parent.persona || "") + ' \u00B7 state ' + esc(parent.state || "") +
          ' \u00B7 children ' + done + '/' + children.length + ' verified \u00B7 ' +
          'commissioned ' + esc(parent.created_at || "") + '</div>' +
          '<div class="cmeta">' + esc(parent.spec || "") + '</div>';
        if (children.length) {
          html += '<div class="obs-children">' + children.map(function (j) {
            return '<div class="obs-child"><span class="cid">' + esc(j.id) + '</span>' +
              stateChip(j.state) + '<span>' + esc(j.persona || "") + '</span>' +
              '<span class="obs-bar"><i style="width:' + (j.progress || 0) + '%"></i></span>' +
              '<span>' + (j.progress == null ? "\u2014" : j.progress + "%") + '</span></div>';
          }).join("") + '</div>';
        }
        html += '</div>';
      }
      var agents = (state && state.agents) || [];
      var active = agents.filter(function (a) {
        return a.status_class === "working" || a.status_class === "blocked" ||
               a.status_class === "failed"; });
      if (active.length) {
        html += '<div class="obs-agents">' + active.slice(0, compact ? 6 : 12).map(function (a) {
          return '<div class="obs-agent ' + esc(a.status_class) + '"><b>' +
            esc(a.fusion_name || a.source_id) + '</b> \u00B7 ' + esc(a.label || "") +
            '<br>' + esc(a.english_function || a.function || "") + '</div>';
        }).join("") + '</div>';
      }
      var reg = state && state.registry;
      if (reg && reg.entries) html += '<div class="cmeta" style="margin-top:8px;font-size:12px;color:var(--smoke-violet)">Delegation registry: ' +
        reg.entries.length + ' grants on record \u2014 who authorised whom, in the open.</div>';
      rosterEl.innerHTML = html;
    }

    function loadRoster() {
      Promise.all([
        fetch(base + "/api/jobs").then(function (r) { return r.json(); }).catch(function () { return { jobs: [] }; }),
        fetch(base + "/api/state").then(function (r) { return r.json(); }).catch(function () { return null; })
      ]).then(function (res) { renderRoster(res[0].jobs || [], res[1]); });
    }

    /* --- transport: SSE first (the only path allowed to say LIVE),
           polling fallback, snapshot verdict when data lags --- */
    function pollOnce() {
      return fetch(base + "/api/events?since=" + (lastEpoch || 0))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          lastSync = Date.now() / 1000;
          (d.events || []).forEach(function (ev) { ingest(ev, mode !== "live"); });
          if (mode !== "live") {
            var lag = lastSync - (newestEpoch || lastSync);
            mode = (esErrors >= 3 && lag > 120) ? "snapshot" : "poll";
          }
          if (!paused) renderAll();
          tickFresh();
        })
        .catch(function () { if (mode !== "live") { mode = lastSync ? mode : "down"; tickFresh(); } });
    }
    function startTransport() {
      // Backfill the whole record first (the feed is the record).
      fetch(base + "/api/events?since=0").then(function (r) { return r.json(); })
        .then(function (d) {
          lastSync = Date.now() / 1000;
          (d.events || []).forEach(function (ev) { ingest(ev, false); });
          renderAll(); tickFresh();
        }).catch(function () { tickFresh(); })
        .then(function () {
          try {
            es = new EventSource(base + "/api/stream");
            es.onmessage = function (m) {
              esErrors = 0;
              var obj; try { obj = JSON.parse(m.data); } catch (e) { return; }
              if (obj.kind === "event" && obj.event) {
                lastSync = Date.now() / 1000;
                if (mode !== "live") { mode = "live"; }
                ingest(obj.event, true); tickFresh();
              } else if (obj.kind === "state" || obj.kind === "agents") {
                lastSync = Date.now() / 1000; loadRoster();
              }
            };
            es.onerror = function () {
              esErrors++;
              if (esErrors >= 3 && mode === "live") mode = "poll";
              if (!pollTimer) pollTimer = setInterval(pollOnce, 4000);
              tickFresh();
            };
          } catch (e) {
            if (!pollTimer) pollTimer = setInterval(pollOnce, 4000);
          }
          // Even with SSE open, keep the roster fresh.
          setInterval(loadRoster, 30000);
        });
    }

    /* --- controls --- */
    root.querySelectorAll('[data-r="ch"]').forEach(function (b) {
      b.addEventListener("click", function () {
        var cid = b.dataset.ch;
        enabled[cid] = !enabled[cid];
        b.setAttribute("aria-pressed", String(enabled[cid]));
        renderAll();
      });
    });
    root.querySelectorAll('[data-r="type"]').forEach(function (b) {
      b.addEventListener("click", function () {
        typeFilter = b.dataset.t;
        root.querySelectorAll('[data-r="type"]').forEach(function (x) {
          x.setAttribute("aria-pressed", String(x === b)); });
        renderAll();
      });
    });
    var pauseBtn = root.querySelector('[data-r="pause"]');
    pauseBtn.addEventListener("click", function () {
      paused = !paused;
      pauseBtn.setAttribute("aria-pressed", String(paused));
      pauseBtn.textContent = paused ? "\u25B6 Resume the river" : "\u23F8 Pause the river";
      if (!paused) { heldCount = 0; renderAll(); } else tickFresh();
      heldEl.textContent = paused ? "Paused \u2014 new events are being held, not lost." : "";
    });
    var compBtn = root.querySelector('[data-r="compress"]');
    compBtn.addEventListener("click", function () {
      compressOn = !compressOn;
      compBtn.setAttribute("aria-pressed", String(compressOn));
      compBtn.textContent = "Catch-up compression: " + (compressOn ? "on" : "off");
      renderAll();
    });
    function doJump() {
      var q = root.querySelector('[data-r="jumpin"]').value.trim();
      var miss = root.querySelector('[data-r="jumpmiss"]');
      miss.textContent = "";
      if (!q) return;
      var found = null;
      if (/^\d{1,2}:\d{2}/.test(q)) {
        var parts = q.split(":"), hh = +parts[0], mm = +parts[1];
        byId.forEach(function (ev) {
          if (found || !ev.epoch) return;
          var d = new Date(ev.epoch * 1000);
          if (d.getUTCHours() === hh && d.getUTCMinutes() === mm) found = ev;
        });
      } else {
        byId.forEach(function (ev) {
          if (!found && String(ev.id).indexOf(q) === 0) found = ev; });
        if (!found) byId.forEach(function (ev) {
          if (!found && String(ev.id).indexOf(q) >= 0) found = ev; });
      }
      if (!found) { miss.textContent = "no event \u201C" + q + "\u201D in the loaded record"; return; }
      if (!enabled[found.channel]) {
        enabled[found.channel] = true;
        var btn = root.querySelector('[data-ch="' + found.channel + '"]');
        if (btn) btn.setAttribute("aria-pressed", "true");
      }
      if (typeFilter && found.type !== typeFilter) {
        typeFilter = "";
        root.querySelectorAll('[data-r="type"]').forEach(function (x) {
          x.setAttribute("aria-pressed", String(x.dataset.t === "")); });
      }
      renderAll();
      setTimeout(function () {
        var row = root.querySelector('.obs-ev[data-eid="' + found.id + '"]');
        if (!row) { // inside a compressed burst: open the burst first
          var bursts = root.querySelectorAll(".obs-burst");
          for (var i = 0; i < bursts.length; i++) {
            if (bursts[i].querySelector('[data-eid="' + found.id + '"]')) {
              bursts[i].querySelector("div").style.display = "";
              row = bursts[i].querySelector('[data-eid="' + found.id + '"]');
              break;
            }
          }
        }
        if (row) { row.scrollIntoView({ block: "center" });
          row.classList.add("flash");
          setTimeout(function () { row.classList.remove("flash"); }, 2400); }
        else miss.textContent = "event " + found.id.slice(0, 8) +
          " is in the record but beyond this lane\u2019s render cap";
      }, 60);
    }
    root.querySelector('[data-r="jump"]').addEventListener("click", doJump);
    root.querySelector('[data-r="jumpin"]').addEventListener("keydown", function (e) {
      if (e.key === "Enter") doJump();
    });

    loadRoster();
    startTransport();
    setInterval(tickFresh, 1000);
    return { ingest: ingest, renderAll: renderAll,
             _byId: byId, _setPaused: function (v) { if (v !== paused) pauseBtn.click(); } };
  }

  global.SwarmObservatory = { mount: mount, Core: Core };
})(typeof window !== "undefined" ? window : this);
