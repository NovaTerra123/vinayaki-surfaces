/* Camera Studio — spectral layer (pure functions, UMD: browser + node).
   MEASURED side of the Studio panel: everything in this file is signal
   processing on the camera's RGB frames — motion-energy spectra, a
   green-channel pulse estimate, and an approximate scene-light colour.
   The camera is an RGB sensor; the spectral claims of this surface
   extend exactly as far as these functions and no further. Nothing here
   measures chakras, auras, energy fields, or full-spectrum body data,
   and no wording in this file may be read as claiming otherwise.
   The one DECLARED_GRAMMAR element is stationForFrequency(): a declared
   mapping from a MEASURED motion frequency onto the seven-station
   chakra colour grammar (true spectral order, red→violet), used only to
   choose the puppet light's colour. Grammar, not a body scan. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.StudioSpectral = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /* Iterative radix-2 FFT (in place on Float64Arrays re/im). */
  function fft(re, im) {
    var n = re.length, j = 0, i, len, ang, wr, wi, tr, ti, ur, ui;
    for (i = 1; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        tr = re[i]; re[i] = re[j]; re[j] = tr;
        ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (len = 2; len <= n; len <<= 1) {
      ang = -2 * Math.PI / len;
      var wlenR = Math.cos(ang), wlenI = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        wr = 1; wi = 0;
        for (j = 0; j < len / 2; j++) {
          var a = i + j, b = i + j + len / 2;
          ur = re[b] * wr - im[b] * wi;
          ui = re[b] * wi + im[b] * wr;
          re[b] = re[a] - ur; im[b] = im[a] - ui;
          re[a] += ur; im[a] += ui;
          tr = wr * wlenR - wi * wlenI; wi = wr * wlenI + wi * wlenR; wr = tr;
        }
      }
    }
  }

  function nextPow2(n) { var p = 1; while (p < n) p <<= 1; return p; }

  /* Power spectrum of a real series: detrend (mean removal), Hann
     window, zero-pad to >= 2x length. Returns {freqs, power} up to
     Nyquist, or null for a degenerate series. */
  function powerSpectrum(samples, sampleRate) {
    var n = samples.length;
    if (n < 16 || !(sampleRate > 0)) return null;
    var mean = 0, i;
    for (i = 0; i < n; i++) mean += samples[i];
    mean /= n;
    var size = nextPow2(n * 2);
    var re = new Float64Array(size), im = new Float64Array(size);
    var energy = 0;
    for (i = 0; i < n; i++) {
      var w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
      re[i] = (samples[i] - mean) * w;
      energy += Math.abs(samples[i] - mean);
    }
    if (energy <= 1e-12) return null;
    fft(re, im);
    var half = size / 2, freqs = new Float64Array(half + 1),
        power = new Float64Array(half + 1);
    for (i = 0; i <= half; i++) {
      freqs[i] = i * sampleRate / size;
      power[i] = re[i] * re[i] + im[i] * im[i];
    }
    return { freqs: freqs, power: power };
  }

  function bandPeak(spec, minHz, maxHz) {
    if (!spec) return null;
    var best = -1, bestP = -1, i;
    for (i = 0; i < spec.freqs.length; i++) {
      if (spec.freqs[i] >= minHz && spec.freqs[i] <= maxHz &&
          spec.power[i] > bestP) { bestP = spec.power[i]; best = i; }
    }
    if (best < 0) return null;
    // median band power, for a prominence (signal cleanliness) ratio
    var band = [];
    for (i = 0; i < spec.freqs.length; i++) {
      if (spec.freqs[i] >= minHz && spec.freqs[i] <= maxHz) band.push(spec.power[i]);
    }
    band.sort(function (a, b) { return a - b; });
    var median = band.length ? band[Math.floor(band.length / 2)] : 0;
    return { hz: spec.freqs[best], power: bestP,
             prominence: median > 0 ? bestP / median : Infinity };
  }

  /* MEASURED: dominant frequency of a motion-energy series in
     [minHz, maxHz], plus the first-harmonic ratio P(2f)/P(f). */
  function motionSpectrum(samples, sampleRate, minHz, maxHz) {
    var spec = powerSpectrum(samples, sampleRate);
    var peak = bandPeak(spec, minHz, maxHz);
    if (!peak) return null;
    var f0 = peak.hz, p0 = peak.power, p2 = 0, i;
    for (i = 0; i < spec.freqs.length; i++) {
      if (Math.abs(spec.freqs[i] - 2 * f0) <= spec.freqs[1]) {
        if (spec.power[i] > p2) p2 = spec.power[i];
      }
    }
    return { dominant_hz: +f0.toFixed(3),
             harmonic_ratio: p0 > 0 ? +(p2 / p0).toFixed(3) : null,
             prominence: +peak.prominence.toFixed(2) };
  }

  /* MEASURED (ESTIMATE): pulse from a green-channel series — the
     non-contact PPG method of Poh, McDuff & Picard (2010): bandpass
     0.7–2.5 Hz (42–150 BPM), FFT peak. Returns null unless the peak is
     prominent enough to be a signal rather than noise; the caller must
     show "no clean signal" on null and never invent a number. */
  function pulseEstimate(samples, sampleRate) {
    var spec = powerSpectrum(samples, sampleRate);
    var peak = bandPeak(spec, 0.7, 2.5);
    if (!peak || peak.prominence < 6) return null;
    return { bpm: +(peak.hz * 60).toFixed(1), hz: +peak.hz.toFixed(3),
             prominence: +peak.prominence.toFixed(2),
             method: "rPPG green-channel FFT peak, 0.7-2.5 Hz band " +
               "(Poh et al. 2010 non-contact PPG)" };
  }

  /* MEASURED (ESTIMATE): approximate dominant wavelength of an RGB
     colour, after D. Bruton's algorithm. RGB->wavelength is
     approximate by nature; near-grey colours have no dominant
     wavelength and return null. */
  function rgbToWavelengthApprox(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 0.08) return null;      // too grey to name a hue
    // Sector walk (after Bruton): hue -> approximate wavelength.
    var wl, hue;
    var d = max - min;
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60; if (hue < 0) hue += 360;
    if (hue >= 0 && hue < 60) wl = 700 - (hue / 60) * (700 - 620);
    else if (hue < 120) wl = 620 - ((hue - 60) / 60) * (620 - 570);
    else if (hue < 180) wl = 570 - ((hue - 120) / 60) * (570 - 520);
    else if (hue < 240) wl = 520 - ((hue - 180) / 60) * (520 - 470);
    else if (hue < 300) wl = 470 - ((hue - 240) / 60) * (470 - 420);
    else wl = 420 - ((hue - 300) / 60) * (420 - 380);
    // desaturated colours read long; pull toward the middle honestly
    var sat = max === 0 ? 0 : d / max;
    if (sat < 0.35) wl = wl * 0.5 + 550 * 0.5;
    return Math.round(wl);
  }

  /* DECLARED_GRAMMAR — the seven-station chakra colour grammar in true
     spectral order (red at the slow/root end, violet at the fast/crown
     end). This is a declared rendering grammar for the puppet's light,
     chosen by the house; it is not a measurement of any body. The
     input (a measured motion frequency) is MEASURED; the mapping and
     the station names are DECLARED_GRAMMAR. */
  var STATIONS = [
    { name: "root",         nm: 700, css: "#ff2a1a" },
    { name: "sacral",       nm: 620, css: "#ff7a00" },
    { name: "solar plexus", nm: 580, css: "#ffd400" },
    { name: "heart",        nm: 530, css: "#2ee66b" },
    { name: "throat",       nm: 490, css: "#19c2ff" },
    { name: "third eye",    nm: 450, css: "#3a5bff" },
    { name: "crown",        nm: 400, css: "#9b30ff" }
  ];
  var GRAMMAR_MIN_HZ = 0.3, GRAMMAR_MAX_HZ = 3.0;
  function stationForFrequency(hz) {
    if (!(hz > 0)) return null;
    var lo = Math.log(GRAMMAR_MIN_HZ), hi = Math.log(GRAMMAR_MAX_HZ);
    var f = (Math.log(Math.min(Math.max(hz, GRAMMAR_MIN_HZ), GRAMMAR_MAX_HZ)) - lo) / (hi - lo);
    var idx = Math.min(6, Math.max(0, Math.floor(f * 7)));
    var s = STATIONS[idx];
    return { index: idx, name: s.name, wavelength_nm: s.nm, css: s.css,
             typing: "DECLARED_GRAMMAR" };
  }

  return { fft: fft, powerSpectrum: powerSpectrum,
           motionSpectrum: motionSpectrum, pulseEstimate: pulseEstimate,
           rgbToWavelengthApprox: rgbToWavelengthApprox,
           stationForFrequency: stationForFrequency, STATIONS: STATIONS };
});
