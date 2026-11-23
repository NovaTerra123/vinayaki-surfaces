/* engine-core.js — Sri Yantra Dashboard V4: pure scheduling/state logic.
   No DOM, no AudioContext: loadable in the browser (window.V4Core) and in
   Node (module.exports) so the acceptance battery can exercise the exact
   code the page runs. Ported from the standing engine (index4) —
   chakraStateAt identity/envelope semantics preserved; amendments per the
   V4 command §7: lookahead scheduling on the audio clock, per-file
   firstOnsetOffset re-zeroing, granthi dwell plateaus, dual-analyser
   constants, sync-health tracking. Geometry is NEVER computed here from
   audio: state carries identity + light parameters only. */
(function (global) {
"use strict";

function clamp01(x){ return x < 0 ? 0 : x > 1 ? 1 : x; }
function smooth01(x){ x = clamp01(x); return x * x * (3 - 2 * x); }

/* ---- cue maps ------------------------------------------------------
   Raw maps are stated from file start (command §1.2). Battery #11 /
   amendment §7.4: each file's firstOnsetOffset (first sample above
   -50 dBFS, measured in evidence/audio-analysis.json) is baked in:
   the shipped map is re-zeroed so position 0 = first audible onset. */
function rezeroMap(map, offset){
  return {
    dur: +(map.dur - offset).toFixed(4),
    crown: +(map.crown - offset).toFixed(4),
    offset: offset,
    events: map.events.map(function(e){ return [+(e[0] - offset).toFixed(4), e[1], e[2]]; })
  };
}

/* Granthi turns: the sweep dwells ~350 ms at the navel (idx 2), heart
   (idx 3) and brow (idx 5) turns — a scheduled plateau in the sweep's
   progress, labelled in the UI as meaning, never as lag (C-19). */
var GRANTHI = {
  2: "Brahmā granthi — the knot at the navel",
  3: "Viṣṇu granthi — the knot at the heart",
  5: "Rudra granthi — the knot at the brow"
};
var GRANTHI_DWELL_S = 0.35;

function sweepProgress(local, G, idx, dirSign){
  var span = Math.min(G, 1.6);
  var p;
  if (GRANTHI[idx] && local < GRANTHI_DWELL_S) {
    p = 0; /* held at the knot */
  } else if (GRANTHI[idx]) {
    p = clamp01((local - GRANTHI_DWELL_S) / Math.max(0.05, span - GRANTHI_DWELL_S));
  } else {
    p = clamp01(local / span);
  }
  return dirSign > 0 ? p : 1 - p;
}

/* Station state at playback position pos (re-zeroed audio time).
   Identity comes from the onset schedule alone; energy never defines
   state (standing-engine rule, preserved). */
function stateAt(map, pos){
  var idle = { idx: -1, S: 0, dirSign: 1, sweep: 0, held: false, crown: false, gap: 0, ev: -1, granthi: null };
  if (!map || pos == null || pos < map.events[0][0]) return idle;
  if (pos >= map.crown) return { idx: -2, S: 0, dirSign: -1, sweep: 1, held: false, crown: true, gap: 0, ev: map.events.length, granthi: null };
  var i = 0;
  while (i + 1 < map.events.length && map.events[i + 1][0] <= pos) i++;
  var evT = map.events[i][0], idx = map.events[i][1], dir = map.events[i][2];
  var nextT = (i + 1 < map.events.length) ? map.events[i + 1][0] : map.crown;
  var G = nextT - evT, local = pos - evT;
  var attack = smooth01(local / 0.16);
  var rel = Math.min(0.40, Math.max(0.25, G * 0.25));
  var relProg = local > G - rel ? smooth01((local - (G - rel)) / rel) : 0;
  var S = attack * (1 - 0.85 * relProg);
  var dirSign = (dir === "a") ? 1 : -1;
  return { idx: idx, S: S, dirSign: dirSign,
           sweep: sweepProgress(local, G, idx, dirSign),
           held: (idx === 5 && G > 3), crown: false, gap: G, ev: i,
           granthi: GRANTHI[idx] || null };
}

/* ---- lookahead scheduler (Wilson pattern, audio clock) -------------
   The browser engine runs this exact loop shape: a 25 ms timer peeks
   horizonS ahead and enqueues cues stamped with their EXACT audio-time
   values; the render loop fires a cue when the audio clock crosses its
   stamp. Cues are never fired by polling the analyser or by timers
   approximating the time (§9 guard 2). simulateScheduler runs the loop
   against a simulated audio clock for Battery #6. */
var SCHED_TICK_S = 0.025, SCHED_HORIZON_S = 0.125;

function simulateScheduler(map, tickS, horizonS){
  tickS = tickS || SCHED_TICK_S; horizonS = horizonS || SCHED_HORIZON_S;
  var enqueued = new Array(map.events.length).fill(null);
  var crownEnqueued = null;
  var t = 0, end = map.dur + 0.5, tickCount = 0;
  while (t < end){
    var upto = t + horizonS;
    for (var i = 0; i < map.events.length; i++){
      if (enqueued[i] === null && map.events[i][0] <= upto){
        enqueued[i] = { cue: map.events[i][0], stamp: map.events[i][0],
                        noticedAt: t, detectLatencyS: +(t - Math.max(0, map.events[i][0] - horizonS)).toFixed(4) };
      }
    }
    if (crownEnqueued === null && map.crown <= upto) crownEnqueued = { cue: map.crown, stamp: map.crown };
    t += tickS; tickCount++;
  }
  var rows = enqueued.map(function(e, i){ return { ev: i, cue: e.cue, stamp: e.stamp, errorMs: +(Math.abs(e.stamp - e.cue) * 1000).toFixed(3) }; });
  return { rows: rows, crown: crownEnqueued, ticks: tickCount,
           maxErrorMs: Math.max.apply(null, rows.map(function(r){ return r.errorMs; })) };
}

/* Offline envelope render (Battery #6 companion): sample stateAt at
   1 ms; for each event, the identity S must leave 0 within 2 ms of the
   cue (attack begins at the cue, by construction of the schedule). */
function envelopeCheck(map){
  var out = [];
  for (var i = 0; i < map.events.length; i++){
    var cue = map.events[i][0];
    var s0 = stateAt(map, cue - 0.001), s1 = stateAt(map, cue + 0.002);
    out.push({ ev: i, cue: cue, activeAtCuePlus2ms: s1.ev === i, idleBefore: s0.ev !== i || cue === map.events[0][0] });
  }
  return out;
}

/* ---- breath --------------------------------------------------------
   One shared phase variable (S5): 12 s period, inhale 57.5% (6.9 s),
   0.30 s top hold (X-7 parameter, claude/perplexity default), exhale
   the remainder (4.8 s). Piecewise smoothstep — never a sine: the
   inhale/exhale ratio is 6.9/4.8 = 1.4375, and a sine-fit test in the
   battery harness proves the asymmetry numerically. */
var BREATH = { periodS: 12.0, inhaleFrac: 0.575, holdS: 0.30, scaleAmp: 0.013, glowAmp: 0.15, calmScaleAmp: 0.008 };
function breathAt(t){
  var P = BREATH.periodS, inh = BREATH.inhaleFrac * P, hold = BREATH.holdS;
  var x = ((t % P) + P) % P;
  if (x < inh) return { phase: "inhale", value: -1 + 2 * smooth01(x / inh), x: x };
  if (x < inh + hold) return { phase: "hold", value: 1, x: x };
  var ex = (x - inh - hold) / (P - inh - hold);
  return { phase: "exhale", value: 1 - 2 * smooth01(ex), x: x };
}

/* ---- Bessel light modes --------------------------------------------
   J0/J3/J5 by series expansion (|x| <= 12 is ample for light modes). */
function besselJ(n, x){
  var sum = 0, term = Math.pow(x / 2, n) / fact(n);
  var m = 0;
  while (Math.abs(term) > 1e-12 && m < 60){
    sum += term;
    m++;
    term *= -(x * x / 4) / (m * (m + n));
  }
  return sum;
  function fact(k){ var f = 1; for (var i = 2; i <= k; i++) f *= i; return f; }
}
/* Light-mode weights from band energies (dB rel): J0 follows the
   fundamental (82), J3 the 246 band, J5 the 328 band (engine spec). */
function lightModes(bandDb){
  function lin(db){ return Math.pow(10, db / 20); }
  return { j0: lin(bandDb[82] || -30), j3: lin(bandDb[246] || -40), j5: lin(bandDb[328] || -40) };
}

/* ---- sync health (Battery #7) ---------------------------------------
   Records each fired cue's measured error (audio-clock stamp vs the
   render frame that presented it). Three consecutive cues > 60 ms
   raises the drift warning. */
function SyncHealth(){
  this.lastErrorMs = null; this.consecutiveBad = 0; this.warning = false; this.count = 0;
}
SyncHealth.prototype.record = function(errMs){
  this.lastErrorMs = errMs; this.count++;
  if (Math.abs(errMs) > 60){ this.consecutiveBad++; } else { this.consecutiveBad = 0; }
  this.warning = this.consecutiveBad >= 3;
  return { lastErrorMs: this.lastErrorMs, warning: this.warning };
};

/* ---- letter placement (Battery #19 math) ----------------------------
   Petal i centre angle, degrees, from east counter-clockwise (math
   convention); SVG position flips y. Deviation from petal centre is
   0 by construction — the battery's screenshot measure is the device
   check of this same function. */
function petalAngleDeg(i){ return i * (360 / 16); }
function petalPos(i, r){
  var th = petalAngleDeg(i) * Math.PI / 180;
  return { x: +(r * Math.cos(th)).toFixed(3), y: +(-r * Math.sin(th)).toFixed(3), angleDeg: petalAngleDeg(i) };
}

/* ---- dual analyser constants (Ruling 2) ---------------------------- */
var ANALYSERS = { fast: { smoothingTimeConstant: 0.05, fftSize: 2048, drives: "onsets+brightness" },
                  slow: { smoothingTimeConstant: 0.30, fftSize: 2048, drives: "ambient-glow-only" } };

var api = { clamp01: clamp01, smooth01: smooth01, rezeroMap: rezeroMap, stateAt: stateAt,
            GRANTHI: GRANTHI, GRANTHI_DWELL_S: GRANTHI_DWELL_S,
            simulateScheduler: simulateScheduler, envelopeCheck: envelopeCheck,
            SCHED_TICK_S: SCHED_TICK_S, SCHED_HORIZON_S: SCHED_HORIZON_S,
            BREATH: BREATH, breathAt: breathAt, besselJ: besselJ, lightModes: lightModes,
            SyncHealth: SyncHealth, petalAngleDeg: petalAngleDeg, petalPos: petalPos,
            ANALYSERS: ANALYSERS };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.V4Core = api;
})(typeof window !== "undefined" ? window : globalThis);
