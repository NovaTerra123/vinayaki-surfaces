/* Coach tempo estimator — PURE, no DOM, no I/O.
   Estimates the dominant pulse rate of a motion-energy series by
   autocorrelation over the lag range for 40–220 BPM.

   Honest bound, stated on the record: the estimator measures the rate
   at which motion ENERGY pulses. An impact per beat (a step, a bounce,
   a head-nod landing) pulses once per beat. A smooth sway through a
   beat produces two energy pulses per cycle (one per direction
   change), so a swaying mover can read at twice the beat. This is a
   known limitation of the proof, not a hidden one.

   UMD: browser -> window.CoachEstimator; node -> module.exports. */
(function (root) {
  "use strict";

  function estimateTempoBPM(samples, opts) {
    opts = opts || {};
    var minBPM = opts.minBPM || 40;
    var maxBPM = opts.maxBPM || 220;
    var minSeconds = opts.minSeconds || 8;
    var minPeak = opts.minPeak || 0.25;
    if (!samples || samples.length < 20) return null;
    var t0 = samples[0].t, t1 = samples[samples.length - 1].t;
    if (!(t1 - t0 >= minSeconds)) return null;

    // Sample interval from the median dt (robust to jitter).
    var dts = [];
    for (var i = 1; i < samples.length; i++) dts.push(samples[i].t - samples[i - 1].t);
    dts.sort(function (a, b) { return a - b; });
    var dt = dts[Math.floor(dts.length / 2)];
    if (!(dt > 0)) return null;
    var fs = 1 / dt;

    var n = samples.length, mean = 0, j;
    for (j = 0; j < n; j++) mean += samples[j].e;
    mean /= n;
    var x = new Array(n), energy = 0;
    for (j = 0; j < n; j++) { x[j] = samples[j].e - mean; energy += x[j] * x[j]; }
    if (energy <= 1e-12) return null;

    var minLagF = Math.max(1, fs * 60 / maxBPM);
    var maxLagF = Math.min(n - 2, fs * 60 / minBPM);
    if (maxLagF <= minLagF) return null;

    // Fractional-lag autocorrelation (0.25-sample steps, linear
    // interpolation of the series). Integer lags alone are too coarse:
    // at 10 Hz sampling one lag step is ~15 BPM at 120 BPM, and over a
    // long window a slightly-wrong integer lag drifts out of phase,
    // which can make an exact multiple of the period (half tempo)
    // outscore the true fundamental. Fractional lags remove both traps.
    function corr(lagF) {
      var lo = Math.floor(lagF), frac = lagF - lo, s = 0, cnt = 0;
      for (var i = 0; i + lo + 1 < n; i++) {
        var v = x[i + lo] * (1 - frac) + x[i + lo + 1] * frac;
        s += x[i] * v; cnt++;
      }
      // Normalise by the zero-lag energy scaled to the overlap length,
      // so the value approximates a correlation coefficient.
      return s / (energy * cnt / n);
    }

    var STEP = 0.25, lags = [], acs = [], best = -Infinity;
    for (var lf = minLagF; lf <= maxLagF; lf += STEP) {
      var ac = corr(lf);
      lags.push(lf); acs.push(ac);
      if (ac > best) best = ac;
    }
    if (best < minPeak) return null;
    // Octave guard: a periodic signal correlates almost as strongly at
    // 2x, 3x the true lag as at the fundamental. Prefer the SMALLEST lag
    // whose correlation is within 8% of the peak — the fundamental.
    var idx = -1;
    for (var k = 0; k < lags.length; k++) {
      if (acs[k] >= 0.92 * best) { idx = k; break; }
    }
    if (idx < 0) return null;
    // Parabolic refinement around the chosen grid point.
    var lagBest = lags[idx];
    if (idx > 0 && idx < lags.length - 1) {
      var denom = acs[idx - 1] - 2 * acs[idx] + acs[idx + 1];
      if (denom !== 0) {
        var shift = 0.5 * (acs[idx - 1] - acs[idx + 1]) / denom;
        if (shift > -1 && shift < 1) lagBest += shift * STEP;
      }
    }
    return { bpm: 60 / (lagBest * dt), confidence: best, lag_s: lagBest * dt };
  }

  var api = { estimateTempoBPM: estimateTempoBPM };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CoachEstimator = api;
})(typeof window !== "undefined" ? window : this);
