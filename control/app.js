"use strict";
/* Spandana Control — polls GET /api/state every 2s, POSTs chat to /api/control.
   All server-provided text is inserted via textContent (never innerHTML),
   so control-inbox text and roster data cannot inject markup.
   Any section may be available:false or missing — render the honest state.
   On poll failure the last good render stays visible; only the LIVE
   indicator changes. */

var POLL_MS = 2000;
var lastGood = null;
var postInFlight = false;

/* ---------- tiny DOM helpers (textContent only) ---------- */
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
function str(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback || "";
  return String(v);
}
function num(v, fallback) {
  var n = Number(v);
  return Number.isFinite(n) ? n : (fallback || 0);
}
function chip(text, cls) { return el("span", "chip " + (cls || ""), text); }
function statusChip(status) {
  var s = str(status, "unknown");
  var u = s.toUpperCase();
  var cls = "";
  if (u.indexOf("RULED") !== -1) cls = "chip-ruled";
  else if (u.indexOf("PORT-PENDING") !== -1 || u.indexOf("PORT PENDING") !== -1) cls = "chip-port";
  else if (u.indexOf("SPEC") !== -1) cls = "chip-spec";
  else if (u.indexOf("WIRED") !== -1 && u.indexOf("NOT") === -1) cls = "chip-wired";
  else if (u.indexOf("NOT") !== -1) cls = "chip-not";
  return chip(s, cls);
}
function setSource(id, section) {
  var n = document.getElementById(id);
  if (!n) return;
  if (section && section.source) n.textContent = "source: " + str(section.source);
  else if (section && section.available === false) n.textContent = "no live feed";
  else n.textContent = "";
}
function unavailable(body, title, note) {
  clear(body);
  body.appendChild(el("p", "state-line", title));
  if (note) body.appendChild(el("p", "state-line", str(note)));
}
function formatTime(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return str(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatTs(ts) {
  if (!ts) return "";
  var d = new Date(ts);
  if (isNaN(d.getTime())) return str(ts);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ---------- stations ---------- */
var STATION_ORDER = [
  { match: ["muladhara", "mūlādhāra"], hue: 25 },
  { match: ["svadhisthana", "svādhiṣṭhāna"], hue: 55 },
  { match: ["manipura", "maṇipūra"], hue: 95 },
  { match: ["anahata", "anāhata"], hue: 150 },
  { match: ["vishuddha", "viśuddha"], hue: 215 },
  { match: ["ajna", "ājñā"], hue: 275 },
  { match: ["sahasrara", "sahasrāra"], hue: 310 }
];
function stationInfo(name) {
  var key = str(name).toLowerCase();
  for (var i = 0; i < STATION_ORDER.length; i++) {
    for (var j = 0; j < STATION_ORDER[i].match.length; j++) {
      if (key.indexOf(STATION_ORDER[i].match[j]) !== -1) return { idx: i, hue: STATION_ORDER[i].hue };
    }
  }
  return { idx: 90, hue: 260 };
}

/* Cascade: defensive summary only. We never assume its inner shape;
   we count tiers if a plausible array exists, otherwise just note presence. */
function cascadeSummary(cascade) {
  if (!cascade || cascade.available !== true) return null;
  var payload = cascade.tiers !== undefined ? cascade.tiers : cascade.data;
  if (Array.isArray(payload)) return "cascade: " + payload.length + " tier" + (payload.length === 1 ? "" : "s") + " live";
  if (payload && typeof payload === "object") {
    var keys = Object.keys(payload);
    if (keys.length) return "cascade: " + keys.length + " tier" + (keys.length === 1 ? "" : "s") + " live";
  }
  return "cascade: live";
}
/* Per-seat tier badge: only if cascade exposes a seat->tier map in a
   recognisable shape; otherwise returns null and no badge is shown. */
function seatTierLabel(cascade, seatId) {
  try {
    if (!cascade || cascade.available !== true || !seatId) return null;
    var payload = cascade.tiers !== undefined ? cascade.tiers : cascade.data;
    if (Array.isArray(payload)) {
      for (var i = 0; i < payload.length; i++) {
        var t = payload[i];
        if (!t || typeof t !== "object") continue;
        var members = t.seats || t.members || t.ids || t.seat_ids;
        if (Array.isArray(members) && members.indexOf(seatId) !== -1) {
          return "tier: " + str(t.name || t.id || t.tier || (i + 1));
        }
      }
    }
  } catch (e) { return null; }
  return null;
}

function seatCard(seat, hue, cascade) {
  var card = el("div", "seat-card");
  card.style.setProperty("--hue", String(hue));
  var top = el("div", "seat-top");
  var left = el("div");
  left.appendChild(el("div", "seat-name", str(seat.name || seat.id, "unnamed seat")));
  if (seat.id && seat.name) left.appendChild(el("div", "seat-id", str(seat.id)));
  top.appendChild(left);
  top.appendChild(statusChip(seat.status));
  card.appendChild(top);
  if (seat.role) card.appendChild(el("p", "seat-role", str(seat.role)));
  var tier = seatTierLabel(cascade, seat.id);
  if (tier) {
    var badges = el("div", "seat-badges");
    badges.appendChild(chip(tier, "chip-cascade"));
    card.appendChild(badges);
  }
  return card;
}

function stationPanel(name, seats, hue, cascade) {
  var panel = el("section", "station-panel");
  panel.style.setProperty("--hue", String(hue));
  var head = el("div", "station-head");
  head.appendChild(el("h3", "station-name", name));
  head.appendChild(el("span", "station-count", seats.length + (seats.length === 1 ? " seat" : " seats")));
  panel.appendChild(head);
  var list = el("div", "seat-list");
  if (!seats.length) list.appendChild(el("p", "empty-note", "No seats recorded for this station."));
  seats.forEach(function (s) { list.appendChild(seatCard(s || {}, hue, cascade)); });
  panel.appendChild(list);
  return panel;
}

function renderStations(state) {
  var grid = document.getElementById("stationsGrid");
  var roster = state.roster || {};
  setSource("rosterSource", roster);
  var meta = document.getElementById("rosterMeta");
  if (roster.available === false) {
    clear(grid);
    var p = el("section", "station-panel");
    p.appendChild(el("h3", "station-name", "Roster unavailable"));
    p.appendChild(el("p", "empty-note", "Roster — no live feed yet."));
    grid.appendChild(p);
    if (meta) meta.textContent = "";
    return;
  }
  var stations = Array.isArray(roster.stations) ? roster.stations.slice() : [];
  stations.sort(function (a, b) {
    return stationInfo(a && a.station).idx - stationInfo(b && b.station).idx;
  });
  clear(grid);
  var totalSeats = 0;
  stations.forEach(function (st) {
    if (!st) return;
    var seats = Array.isArray(st.seats) ? st.seats : [];
    totalSeats += seats.length;
    var info = stationInfo(st.station);
    grid.appendChild(stationPanel(str(st.station, "Station"), seats, info.hue, state.cascade));
  });
  var stationless = Array.isArray(roster.stationless) ? roster.stationless : [];
  totalSeats += stationless.length;
  grid.appendChild(stationPanel("Stationless / Axis", stationless, 310, state.cascade));
  if (!stations.length && !stationless.length) {
    clear(grid);
    grid.appendChild(el("p", "empty-note", "Roster feed is live but lists no seats yet."));
  }
  if (meta) {
    var count = roster.count !== undefined ? num(roster.count, totalSeats) : totalSeats;
    meta.textContent = "— " + count + " seat" + (count === 1 ? "" : "s");
  }
}

/* ---------- desks ---------- */
function renderDesks(state) {
  var body = document.getElementById("desksBody");
  var desks = state.desks || {};
  setSource("desksSource", desks);
  if (desks.available === false) { unavailable(body, "Desks — no live feed yet.", desks.note); return; }
  var list = Array.isArray(desks.desks) ? desks.desks : [];
  var total = desks.total !== undefined ? num(desks.total, list.length) : list.length;
  var wired = desks.wired !== undefined ? num(desks.wired, 0)
    : list.filter(function (d) { return d && str(d.status).toUpperCase().indexOf("WIRED") !== -1 && str(d.status).toUpperCase().indexOf("NOT") === -1; }).length;
  clear(body);
  var wrap = el("div", "progress-wrap");
  var label = el("div", "progress-label");
  label.appendChild(el("span", null, "Desks integrated: " + wired + " of " + total));
  label.appendChild(el("span", "pl-dim", total > 0 ? Math.round((wired / total) * 100) + "%" : "—"));
  wrap.appendChild(label);
  var bar = el("div", "progress");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(wired));
  var fill = el("div", "progress-fill");
  fill.style.width = total > 0 ? Math.min(100, (wired / total) * 100) + "%" : "0%";
  bar.appendChild(fill);
  wrap.appendChild(bar);
  body.appendChild(wrap);
  if (!list.length) { body.appendChild(el("p", "empty-note", "No desks recorded yet.")); return; }
  var rows = el("div", "row-list");
  list.forEach(function (d) {
    d = d || {};
    var row = el("div", "row");
    var main = el("div", "row-main");
    main.appendChild(el("div", "row-name", str(d.name || d.id, "unnamed desk")));
    if (d.function) main.appendChild(el("div", "row-sub", str(d.function)));
    row.appendChild(main);
    var side = el("div", "row-side");
    side.appendChild(statusChip(d.status));
    if (d.station) side.appendChild(el("span", "row-station", str(d.station)));
    row.appendChild(side);
    rows.appendChild(row);
  });
  body.appendChild(rows);
}

/* ---------- jobs ---------- */
function renderJobs(state) {
  var body = document.getElementById("jobsBody");
  var jobs = state.jobs || {};
  setSource("jobsSource", jobs);
  if (jobs.available === false) {
    clear(body);
    var line = el("p", "state-line");
    line.appendChild(chip("NOT INTEGRATED", "chip-not"));
    body.appendChild(line);
    if (jobs.note) body.appendChild(el("p", "state-line", str(jobs.note)));
    return;
  }
  var total = num(jobs.total, 0);
  clear(body);
  if (total === 0) {
    /* Honest zero state: the server's note verbatim, and NO bar. */
    body.appendChild(el("p", "state-line", str(jobs.note, "no packets recorded yet")));
    return;
  }
  var summary = el("div", "job-summary");
  summary.appendChild(el("span", "job-total", String(total)));
  summary.appendChild(el("span", "job-total-label", total === 1 ? "job packet recorded" : "job packets recorded"));
  body.appendChild(summary);
  var byState = jobs.by_state && typeof jobs.by_state === "object" ? jobs.by_state : {};
  var keys = Object.keys(byState);
  if (keys.length) {
    var row = el("div", "chip-row");
    keys.sort().forEach(function (k) { row.appendChild(chip(k + ": " + num(byState[k], 0), "chip-count")); });
    body.appendChild(row);
  }
  if (jobs.note) body.appendChild(el("p", "state-line", str(jobs.note)));
}

/* ---------- delegation registry ---------- */
function registryNode(entry) {
  entry = entry || {};
  var node = el("div", "tree-node");
  node.appendChild(el("span", "tree-name", str(entry.name || entry.agent_id || entry.id, "unnamed agent")));
  var metaBits = [];
  if (entry.level !== undefined && entry.level !== null) metaBits.push("level " + str(entry.level));
  if (entry.parent_id) metaBits.push("parent " + str(entry.parent_id));
  else if (entry.parent) metaBits.push("parent " + str(entry.parent));
  if (metaBits.length) node.appendChild(el("span", "tree-meta", metaBits.join(" · ")));
  if (entry.kind) node.appendChild(chip(str(entry.kind), "chip-kind"));
  if (entry.status) node.appendChild(statusChip(entry.status));
  return node;
}
function renderRegistry(state) {
  var body = document.getElementById("registryBody");
  var registry = state.registry || {};
  setSource("registrySource", registry);
  if (registry.available === false || !Array.isArray(registry.entries)) {
    clear(body);
    body.appendChild(el("p", "state-line", "Delegation registry — no live feed yet"));
    if (registry.note) body.appendChild(el("p", "state-line", str(registry.note)));
    return;
  }
  var entries = registry.entries;
  clear(body);
  if (!entries.length) {
    body.appendChild(el("p", "state-line", "Delegation registry — no live feed yet"));
    if (registry.note) body.appendChild(el("p", "state-line", str(registry.note)));
    return;
  }
  /* Build parent -> children map defensively; anything whose parent is
     missing (or which would form a cycle) is rendered at the root. */
  var byId = {};
  entries.forEach(function (e, i) { if (e) byId[str(e.agent_id || e.id || e.name || ("#" + i))] = e; });
  var children = {}, roots = [], seen = {};
  entries.forEach(function (e, i) {
    if (!e) return;
    var id = str(e.agent_id || e.id || e.name || ("#" + i));
    var pid = str(e.parent_id || e.parent || "");
    if (pid && pid !== id && byId[pid] && !seen[id]) { (children[pid] = children[pid] || []).push(e); }
    else roots.push(e);
    seen[id] = true;
  });
  function buildTree(list, depth) {
    var ul = el("ul", depth === 0 ? "tree" : "");
    list.forEach(function (e) {
      var li = document.createElement("li");
      li.appendChild(registryNode(e));
      var id = str(e.agent_id || e.id || e.name || "");
      if (id && children[id] && depth < 12) li.appendChild(buildTree(children[id], depth + 1));
      ul.appendChild(li);
    });
    return ul;
  }
  if (roots.length === entries.length && entries.length > 1 && Object.keys(children).length === 0) {
    var flat = el("div", "tree-flat");
    entries.forEach(function (e) { flat.appendChild(registryNode(e)); });
    body.appendChild(flat);
  } else {
    body.appendChild(buildTree(roots, 0));
  }
  if (registry.note) body.appendChild(el("p", "state-line", str(registry.note)));
}

/* ---------- quotas ---------- */
function renderQuotas(state) {
  var body = document.getElementById("quotasBody");
  var quotas = state.quotas || {};
  setSource("quotasSource", quotas);
  if (quotas.available === false) { unavailable(body, "Quotas — no live feed yet.", quotas.note); return; }
  var items = Array.isArray(quotas.items) ? quotas.items : [];
  clear(body);
  if (!items.length) { body.appendChild(el("p", "empty-note", "No quota items recorded yet.")); return; }
  items.forEach(function (item) {
    item = item || {};
    var box = el("div", "quota-item");
    var head = el("div", "quota-head");
    head.appendChild(el("span", "quota-id", str(item.id, "quota")));
    var limit = item.limit_per_lineage !== undefined ? num(item.limit_per_lineage, 6) : 6;
    head.appendChild(el("span", "quota-limit", "limit per lineage: " + limit));
    box.appendChild(head);
    var deskList = Array.isArray(item.desks) ? item.desks : [];
    if (deskList.length) box.appendChild(el("p", "quota-desks", "Covers: " + deskList.map(function (d) { return str(d); }).join(", ")));
    var usage = item.usage_by_lineage && typeof item.usage_by_lineage === "object" ? item.usage_by_lineage : {};
    var lineages = Object.keys(usage);
    if (!lineages.length) {
      box.appendChild(el("p", "quota-note", str(item.note, "No lineage usage recorded yet.")));
    } else {
      lineages.sort().forEach(function (lin) {
        var used = num(usage[lin], 0);
        var wrap = el("div", "lineage");
        var lab = el("div", "lineage-label");
        lab.appendChild(el("span", null, lin));
        lab.appendChild(el("span", null, used + " / " + limit));
        wrap.appendChild(lab);
        var bar = el("div", "progress");
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", String(limit));
        bar.setAttribute("aria-valuenow", String(used));
        var fill = el("div", "progress-fill quota-fill");
        fill.style.width = limit > 0 ? Math.min(100, (used / limit) * 100) + "%" : "0%";
        bar.appendChild(fill);
        wrap.appendChild(bar);
        box.appendChild(wrap);
      });
      if (item.note) box.appendChild(el("p", "quota-note", str(item.note)));
    }
    body.appendChild(box);
  });
}

/* ---------- control chat ---------- */
function renderControl(state) {
  var log = document.getElementById("controlLog");
  var control = state.control || {};
  var src = document.getElementById("controlSource");
  if (src) src.textContent = str(control.inbox, "control-inbox.jsonl");
  var recent = Array.isArray(control.recent) ? control.recent : [];
  clear(log);
  if (!recent.length) { log.appendChild(el("p", "empty-note", "No instructions logged yet.")); return; }
  recent.forEach(function (entry) {
    entry = entry || {};
    var row = el("div", "control-msg");
    row.appendChild(el("span", "control-ts", formatTs(entry.ts)));
    row.appendChild(el("span", "control-text", str(entry.text)));
    row.appendChild(chip("logged", "chip-not control-tag"));
    log.appendChild(row);
  });
  log.scrollTop = log.scrollHeight;
}

function render(state) {
  lastGood = state;
  renderStations(state);
  renderDesks(state);
  renderJobs(state);
  renderRegistry(state);
  renderQuotas(state);
  renderControl(state);
  var summary = cascadeSummary(state.cascade);
  var wrap = document.getElementById("cascadeWrap");
  var chipNode = document.getElementById("cascadeChip");
  if (summary) { chipNode.textContent = summary; wrap.hidden = false; }
  else wrap.hidden = true;
  var svc = document.getElementById("serviceLine");
  if (svc) svc.textContent = state.service ? "service: " + str(state.service) : "";
  var box = document.getElementById("liveBox");
  box.classList.remove("is-down");
  document.getElementById("liveText").textContent = "LIVE";
  document.getElementById("updatedText").textContent =
    "updated " + (formatTime(state.generated_at) || new Date().toLocaleTimeString());
}

function markFeedDown() {
  /* Keep the last good render on screen; only the indicator changes. */
  var box = document.getElementById("liveBox");
  box.classList.add("is-down");
  document.getElementById("liveText").textContent = "feed interrupted — retrying";
  if (!lastGood) document.getElementById("updatedText").textContent = "no successful poll yet";
}

function poll() {
  fetch("/api/state", { headers: { "Accept": "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error("state poll failed: HTTP " + r.status); return r.json(); })
    .then(function (state) { if (state && typeof state === "object") render(state); else markFeedDown(); })
    .catch(function () { markFeedDown(); });
}

/* ---------- control POST ---------- */
function sendControl(text) {
  var btn = document.getElementById("controlSend");
  var errBox = document.getElementById("controlError");
  postInFlight = true;
  btn.disabled = true;
  errBox.hidden = true;
  return fetch("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ text: text })
  }).then(function (r) {
    if (!r.ok) throw new Error("control POST failed: HTTP " + r.status);
    return r.json();
  }).then(function (res) {
    if (!res || res.ok !== true) throw new Error("control POST was not confirmed by the server");
    poll(); /* re-poll so the entry appears only from server state */
  }).catch(function (err) {
    errBox.textContent = "Could not log instruction: " + (err && err.message ? err.message : "request failed") + ". Nothing was added.";
    errBox.hidden = false;
  }).then(function () {
    postInFlight = false;
    btn.disabled = false;
  });
}

document.getElementById("controlForm").addEventListener("submit", function (ev) {
  ev.preventDefault();
  if (postInFlight) return;
  var input = document.getElementById("controlInput");
  var text = input.value.trim();
  if (!text) return;
  sendControl(text).then(function () {
    if (document.getElementById("controlError").hidden) input.value = "";
    input.focus();
  });
});
/* Enter key sends via native form submission (input is inside the form). */

poll();
setInterval(poll, POLL_MS);
