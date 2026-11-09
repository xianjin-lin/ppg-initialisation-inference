/* Synthetic recursion lab — pure, deterministic core.
 * SYNTHETIC ILLUSTRATION ONLY: every distribution, sequence and transition matrix here is generated in the browser
 * from toy settings. Nothing is a participant signal, a trained network output or a trained DaLiA matrix.
 * Recurrence: s[t] = normalise((T × s[t−1]) ⊙ p[t]); local ±5-bin readout with boundary clamping (repeated indices).
 */
(function (root) {
  "use strict";
  var NB = 191, HR0 = 30, HALF = 5;
  var BINS = new Float64Array(NB);
  for (var k = 0; k < NB; k++) BINS[k] = HR0 + k;

  /* Complementary error function with small RELATIVE error (Chebyshev fit, Numerical Recipes erfcc, < 1.2e-7),
   * so that far-tail differences keep their accuracy. */
  function erfc(x) {
    var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  function erf(x) { return 1 - erfc(x); }
  function Q(z) { return 0.5 * erfc(z / Math.SQRT2); }            // upper tail 1 - Phi(z)
  function Phi(z) { return 1 - Q(z); }
  /* Phi(hi) - Phi(lo) computed from the nearer tail to avoid cancellation. */
  function phiDiff(hi, lo) {
    if (lo > 0) return Q(lo) - Q(hi);
    if (hi < 0) return Q(-hi) - Q(-lo);
    return 1 - Q(hi) - Q(-lo);
  }

  /* Toy Gaussian transition in log-HR space on the 191 one-bpm bins (destination i, source j), half-bin edges.
   * T is deliberately not normalised, as in the described construction; normalisation happens in the update. */
  function transitionMatrix(sigma, mu) {
    mu = mu || 0;
    var T = new Float64Array(NB * NB), lo = new Float64Array(NB), hi = new Float64Array(NB);
    for (var k = 0; k < NB; k++) { lo[k] = Math.log(BINS[k] - 0.5); hi[k] = Math.log(BINS[k] + 0.5); }
    for (var i = 0; i < NB; i++) {
      for (var j = 0; j < NB; j++) {
        var a = hi[i] - lo[j], b = lo[i] - hi[j], c = hi[i] - hi[j], d = lo[i] - lo[j];
        var dp = Math.max(a, b, c, d), dm = Math.min(a, b, c, d);
        T[i * NB + j] = phiDiff((dp - mu) / sigma, (dm - mu) / sigma);
      }
    }
    return T;
  }

  function uniform() { var u = new Float64Array(NB); u.fill(1 / NB); return u; }

  function prior(T, sPrev) {
    var q = new Float64Array(NB);
    for (var i = 0; i < NB; i++) {
      var acc = 0, row = i * NB;
      for (var j = 0; j < NB; j++) acc += T[row + j] * sPrev[j];
      q[i] = acc;
    }
    return q;
  }

  function normalise(v) {
    var z = 0, out = new Float64Array(v.length);
    for (var i = 0; i < v.length; i++) z += v[i];
    if (!(z > 0) || !isFinite(z)) throw new Error("normalisation constant not positive");
    for (i = 0; i < v.length; i++) out[i] = v[i] / z;
    return out;
  }

  /* One update. Returns {prior (normalised for display), s}. */
  function step(T, sPrev, p) {
    var q = prior(T, sPrev), u = new Float64Array(NB);
    for (var i = 0; i < NB; i++) u[i] = q[i] * p[i];
    return { prior: normalise(q), s: normalise(u) };
  }

  function argmax(v) { var k = 0; for (var i = 1; i < v.length; i++) if (v[i] > v[k]) k = i; return k; }

  /* Local ±5-bin readout around the maximum-probability bin; out-of-range offsets clamp to the boundary bin,
   * which then enters both sums more than once. */
  function localReadout(prob) {
    var ks = argmax(prob), num = 0, den = 0;
    for (var m = -HALF; m <= HALF; m++) {
      var c = Math.min(NB - 1, Math.max(0, ks + m));
      num += prob[c] * BINS[c]; den += prob[c];
    }
    return num / den;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(center, width, w, out) {
    for (var k = 0; k < NB; k++) { var z = (BINS[k] - center) / width; out[k] += w * Math.exp(-0.5 * z * z); }
  }

  var N_STEPS = 60, STRIDE_S = 2;
  var PRESETS = {
    transient: {
      label: "Transient ambiguous output", seed: 1101, ambiguity: 0.75, sigma: 0.018,
      note: "In windows 36–40 s this preset can inject a competing band near 152 bpm into the toy output.",
      truth: function (t) { return 92 + 3 * Math.sin(t / 7); },
      comp: function (t) { return (t >= 18 && t <= 20) ? 152 : null; },
      gaps: []
    },
    persistent: {
      label: "Persistent competing mode", seed: 2202, ambiguity: 0.52, sigma: 0.018,
      note: "In windows 24–100 s this preset can inject a competing band near 84 bpm while the toy target rises.",
      truth: function (t) { return t < 18 ? 86 : (t < 42 ? 86 + (t - 18) * 1.4 : 119.6); },
      comp: function (t) { return (t >= 12 && t <= 50) ? 84 : null; },
      gaps: []
    },
    rapid: {
      label: "Rapid change with a gap", seed: 3303, ambiguity: 0.0, sigma: 0.018,
      note: "The toy target rises quickly at about 50 s. A narrow transition prior makes the recursive state lag behind. A gap at 80 s resets the state to uniform before that update.",
      truth: function (t) { return t < 25 ? 80 : (t < 29 ? 80 + (t - 24) * 11 : 124); },
      comp: function () { return null; },
      gaps: [40]
    }
  };

  /* Deterministic toy sequence. ambiguity = weight of the competing band where present (0..0.9). */
  function makeSequence(presetId, ambiguity) {
    var P = PRESETS[presetId];
    if (!P) throw new Error("unknown preset " + presetId);
    var amb = (ambiguity == null) ? P.ambiguity : ambiguity;
    var rnd = mulberry32(P.seed), truth = [], ps = [], resets = [], injected = [];
    for (var t = 0; t < N_STEPS; t++) {
      var y = P.truth(t), jit = (rnd() - 0.5) * 4, wid = 3 + rnd() * 1.5, flick = rnd();
      var comp = P.comp(t), p = new Float64Array(NB);
      var wc = 0;
      if (comp !== null) wc = Math.min(0.9, Math.max(0, amb * (presetId === "persistent" ? (0.75 + 0.5 * flick) : 1)));
      gauss(y + jit, wid, 1 - wc, p);
      if (comp !== null && wc > 0) gauss(comp + (rnd() - 0.5) * 2, 3, wc, p);
      for (var k = 0; k < NB; k++) p[k] += 0.002;   // small floor keeps every update well defined
      injected.push(comp !== null && wc > 0 ? wc : 0);  // record of what was actually injected (display only)
      truth.push(y); ps.push(normalise(p));
      resets.push(t === 0 || P.gaps.indexOf(t) >= 0);
    }
    return { preset: presetId, n: N_STEPS, stride: STRIDE_S, truth: truth, p: ps, reset: resets, injected: injected, ambiguity: amb };
  }

  /* Full deterministic run (bounded: 60 steps). */
  function run(seq, sigma) {
    var T = transitionMatrix(sigma, 0), out = [], s = uniform();
    for (var t = 0; t < seq.n; t++) {
      var sPrev = seq.reset[t] ? uniform() : s;
      var r = step(T, sPrev, seq.p[t]);
      s = r.s;
      out.push({ t: t, time_s: t * seq.stride, p: seq.p[t], prior: r.prior, s: s, reset: seq.reset[t],
                 direct: localReadout(seq.p[t]), recursive: localReadout(s), truth: seq.truth[t] });
    }
    return out;
  }

  root.P2Lab = { NB: NB, BINS: BINS, HALF: HALF, N_STEPS: N_STEPS, PRESETS: PRESETS, erf: erf, erfc: erfc, Phi: Phi, phiDiff: phiDiff,
                 transitionMatrix: transitionMatrix, uniform: uniform, prior: prior, normalise: normalise, step: step,
                 argmax: argmax, localReadout: localReadout, mulberry32: mulberry32, makeSequence: makeSequence, run: run };
})(typeof window !== "undefined" ? window : this);
