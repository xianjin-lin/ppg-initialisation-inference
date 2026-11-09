/* Synthetic recursion lab — UI. All data come from lab-core.js toy generators (no participant data). */
(function () {
  "use strict";
  var L = window.P2Lab; if (!L) return;
  function $(s) { return document.querySelector(s); }
  var MINUS = "−";
  var presetSel = $("#lab-preset"), play = $("#lab-play"), back = $("#lab-back"), fwd = $("#lab-step"), reset = $("#lab-reset");
  var scrub = $("#lab-scrub"), tlabel = $("#lab-tlabel"), note = $("#lab-note"), summary = $("#lab-summary");
  var amb = $("#lab-amb"), ambOut = $("#lab-amb-out"), sig = $("#lab-sig"), sigOut = $("#lab-sig-out");
  var cTrace = $("#lab-trace"), cDist = $("#lab-dist"), section = $("#demo");
  var STEP_MS = 280;

  var state = { preset: "transient", t: 0, playing: false, amb: null, sigma: null, run: null, timer: null, visible: true };

  Object.keys(L.PRESETS).forEach(function (k) {
    var o = document.createElement("option"); o.value = k; o.textContent = L.PRESETS[k].label; presetSel.appendChild(o);
  });

  function compute() {
    var seq = L.makeSequence(state.preset, state.amb);
    state.seq = seq;
    state.run = L.run(seq, state.sigma);
  }
  function loadPreset(id) {
    stop();
    var P = L.PRESETS[id];
    state.preset = id; state.t = 0; state.amb = P.ambiguity; state.sigma = P.sigma;
    presetSel.value = id; amb.value = P.ambiguity; sig.value = P.sigma;
    compute(); updateNote(); render(true);
  }

  // ------------------------------------------------------------- playback
  function stop() {
    state.playing = false; clearTimeout(state.timer); state.timer = null;
    play.textContent = "Play"; play.setAttribute("aria-pressed", "false");
  }
  function tick() {
    if (!state.playing) return;
    if (!state.visible || document.hidden) { stop(); render(true); return; }
    if (state.t >= L.N_STEPS - 1) { stop(); render(true); return; }
    state.t += 1; render(false);
    state.timer = setTimeout(tick, STEP_MS);
  }
  function start() {
    if (state.t >= L.N_STEPS - 1) state.t = 0;
    state.playing = true; play.textContent = "Pause"; play.setAttribute("aria-pressed", "true");
    render(false); state.timer = setTimeout(tick, STEP_MS);
  }
  play.addEventListener("click", function () { if (state.playing) { stop(); render(true); } else start(); });
  back.addEventListener("click", function () { stop(); state.t = Math.max(0, state.t - 1); render(true); });
  fwd.addEventListener("click", function () { stop(); state.t = Math.min(L.N_STEPS - 1, state.t + 1); render(true); });
  reset.addEventListener("click", function () { loadPreset(state.preset); });
  scrub.addEventListener("input", function () { stop(); state.t = Number(scrub.value); render(true); });
  presetSel.addEventListener("change", function () { loadPreset(presetSel.value); });
  amb.addEventListener("input", function () { state.amb = Number(amb.value); stop(); compute(); updateNote(); render(true); });
  sig.addEventListener("input", function () { state.sigma = Number(sig.value); stop(); compute(); render(true); });
  document.addEventListener("visibilitychange", function () { if (document.hidden && state.playing) { stop(); render(true); } });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { state.visible = e.isIntersecting; if (!e.isIntersecting && state.playing) { stop(); render(true); } });
    }, { threshold: 0.05 }).observe(section);
  }
  document.addEventListener("p2-theme", function () { render(true); });
  window.addEventListener("resize", function () { clearTimeout(state.rz); state.rz = setTimeout(function () { render(true); }, 120); });

  // ------------------------------------------------------------- drawing
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function setup(c) {
    var dpr = Math.max(1, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return { g: g, w: w, h: h };
  }
  function font(px, w) { return (w || "500") + " " + px + "px " + css("--sans"); }

  /* Windows where the generator actually injected a competing band (weight > 0), as contiguous runs [t0, t1]. */
  function injectedRuns() {
    var inj = state.seq ? state.seq.injected : [], runs = [], start = null;
    for (var t = 0; t < L.N_STEPS; t++) {
      var on = inj[t] > 0;
      if (on && start === null) start = t;
      if (!on && start !== null) { runs.push([start, t - 1]); start = null; }
    }
    if (start !== null) runs.push([start, L.N_STEPS - 1]);
    return runs;
  }
  function hasCompWindows() { var P = L.PRESETS[state.preset]; for (var t = 0; t < L.N_STEPS; t++) if (P.comp(t) !== null) return true; return false; }
  /* Preset text plus a sentence that matches the current toy weight (no claim about which band is larger). */
  function updateNote() {
    var P = L.PRESETS[state.preset], txt = P.note, w = Number(state.amb).toFixed(2);
    if (hasCompWindows()) {
      if (!injectedRuns().length) txt += " The toy competing-band weight is 0, so no competing band is injected and nothing is shaded.";
      else {
        txt += state.preset === "persistent"
          ? " It is injected with unnormalised Gaussian weight " + w + " times a per-window factor between 0.75 and 1.25 (capped at 0.9); the main band gets the remainder."
          : " It is injected with unnormalised Gaussian weight " + w + "; the main band gets 1 − " + w + ".";
        txt += " Both readouts are the ±5-bin probability-weighted mean around the most probable bin, so the direct readout moves to the competing band only in windows where that band holds the most probable bin." + INJECT_NOTE;
      }
    }
    note.textContent = txt;
  }
  var INJECT_NOTE = " The shaded windows are a deliberate synthetic disturbance: they show the arithmetic of the update and do not explain real participant errors.";

  function drawTrace() {
    var o = setup(cTrace), g = o.g, w = o.w, h = o.h, R = state.run, n = R.length;
    var L0 = 46, R0 = 12, T0 = 24, B0 = 36, ymin = 60, ymax = 170, LABY = 14;
    var all = R.map(function (r) { return [r.truth, r.direct, r.recursive]; }).reduce(function (a, b) { return a.concat(b); }, []);
    ymin = Math.min(ymin, Math.floor(Math.min.apply(null, all) / 10) * 10 - 5); ymax = Math.max(ymax, Math.ceil(Math.max.apply(null, all) / 10) * 10 + 5);
    function X(t) { return L0 + t / (n - 1) * (w - L0 - R0); }
    function Y(v) { return T0 + (ymax - v) / (ymax - ymin) * (h - T0 - B0); }
    // injected competing-peak windows (derived from the preset's comp(); display only)
    injectedRuns().forEach(function (run) {
      var xa = Math.max(L0, X(run[0] - 0.5)), xb = Math.min(w - R0, X(run[1] + 0.5));
      g.fillStyle = css("--inject"); g.fillRect(xa, T0, xb - xa, h - T0 - B0);
      g.strokeStyle = css("--inject-edge"); g.lineWidth = 1; g.strokeRect(xa + 0.5, T0 + 0.5, xb - xa - 1, h - T0 - B0 - 1);
      g.font = font(12.5, "700"); g.fillStyle = css("--ink-2");
      var lab = "Injected competing peak", tw = g.measureText(lab).width, cx = (xa + xb) / 2;
      g.textAlign = "left"; g.fillText(lab, Math.max(L0, Math.min(w - R0 - tw, cx - tw / 2)), LABY);
    });
    g.font = font(13); g.fillStyle = css("--ink-3"); g.strokeStyle = css("--line-2"); g.lineWidth = 1;
    for (var v = Math.ceil(ymin / 20) * 20; v <= ymax; v += 20) { g.beginPath(); g.moveTo(L0, Y(v)); g.lineTo(w - R0, Y(v)); g.stroke(); g.textAlign = "right"; g.fillText(String(v), L0 - 6, Y(v) + 4); }
    g.textAlign = "center";
    for (var s = 0, ds = w < 360 ? 40 : 20; s <= 120; s += ds) { var tt = s / 2; if (tt > n - 1) break; g.fillText(s + " s", X(tt), h - 14); }
    g.save(); g.translate(12, (T0 + h - B0) / 2); g.rotate(-Math.PI / 2); g.fillText("toy bpm", 0, 0); g.restore();
    // resets
    R.forEach(function (r, i) {
      if (r.reset && i > 0) {
        g.strokeStyle = css("--synth"); g.setLineDash([5, 4]); g.lineWidth = 1.6; g.beginPath(); g.moveTo(X(i), T0); g.lineTo(X(i), h - B0); g.stroke(); g.setLineDash([]);
        g.fillStyle = css("--synth"); g.font = font(12.5, "700"); var lab = "gap: state reset", tw = g.measureText(lab).width, right = X(i) + 5 + tw > w - R0; g.textAlign = right ? "right" : "left"; g.fillText(lab, right ? X(i) - 5 : X(i) + 5, LABY);
      }
    });
    // truth
    g.strokeStyle = css("--truth"); g.lineWidth = 6; g.lineCap = "round"; g.globalAlpha = 0.9; g.beginPath();
    R.forEach(function (r, i) { if (i === 0) g.moveTo(X(i), Y(r.truth)); else g.lineTo(X(i), Y(r.truth)); }); g.stroke(); g.globalAlpha = 1;
    // recursive line up to t (segments break at resets)
    g.strokeStyle = css("--rec"); g.lineWidth = 2.2; g.beginPath();
    for (var i = 0; i <= state.t; i++) { var r = R[i]; if (i === 0 || r.reset) g.moveTo(X(i), Y(r.recursive)); else g.lineTo(X(i), Y(r.recursive)); }
    g.stroke();
    // direct dots up to t
    g.lineWidth = 1.6; g.strokeStyle = css("--dir"); g.fillStyle = css("--surface");
    for (i = 0; i <= state.t; i++) { g.beginPath(); g.arc(X(i), Y(R[i].direct), 3.6, 0, 2 * Math.PI); g.fill(); g.stroke(); }
    // cursor
    g.strokeStyle = css("--synth"); g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(state.t), T0); g.lineTo(X(state.t), h - B0); g.stroke();
  }

  function drawDist() {
    var o = setup(cDist), g = o.g, w = o.w, h = o.h, r = state.run[state.t];
    var L0 = 14, R0 = 12, T0 = 16, B0 = 34;
    var mx = 0; [r.p, r.prior, r.s].forEach(function (a) { for (var k = 0; k < a.length; k++) if (a[k] > mx) mx = a[k]; });
    mx = Math.max(mx * 1.3, 0.02);
    function X(b) { return L0 + (b - 30) / 190 * (w - L0 - R0); }
    function Y(v) { return T0 + (1 - v / mx) * (h - T0 - B0); }
    g.font = font(13); g.fillStyle = css("--ink-3"); g.strokeStyle = css("--line-2"); g.textAlign = "center";
    for (var b = 40; b <= 220; b += 30) { g.beginPath(); g.moveTo(X(b), T0); g.lineTo(X(b), h - B0); g.stroke(); g.fillText(String(b), X(b), h - 16); }
    g.fillText("toy bpm bin", (L0 + w - R0) / 2, h - 2);
    function area(arr, fill, alpha) {
      g.globalAlpha = alpha; g.fillStyle = fill; g.beginPath(); g.moveTo(X(30), Y(0));
      for (var k = 0; k < arr.length; k++) g.lineTo(X(30 + k), Y(arr[k])); g.lineTo(X(220), Y(0)); g.closePath(); g.fill(); g.globalAlpha = 1;
    }
    function line(arr, stroke, wdt, dash) {
      g.strokeStyle = stroke; g.lineWidth = wdt; g.setLineDash(dash || []); g.beginPath();
      for (var k = 0; k < arr.length; k++) { if (k === 0) g.moveTo(X(30), Y(arr[0])); else g.lineTo(X(30 + k), Y(arr[k])); } g.stroke(); g.setLineDash([]);
    }
    area(r.p, css("--dir"), 0.28); line(r.p, css("--dir"), 1.2);
    line(r.prior, css("--synth"), 2, [6, 4]);
    line(r.s, css("--rec"), 2.4);
    // readout markers on the axis
    function tickAt(v, lx, col, lab, ly) {
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(X(v), h - B0); g.lineTo(X(v), h - B0 - 10); g.stroke();
      g.font = font(12.5, "700"); g.textAlign = "center"; g.fillText(lab, Math.min(w - 60, Math.max(60, lx)), ly);
    }
    var xd = X(r.direct), xr = X(r.recursive), sep = 120, ld = xd, lr = xr;
    if (Math.abs(xd - xr) < sep) { var mid = (xd + xr) / 2, sgn = xd <= xr ? -1 : 1; ld = mid + sgn * sep / 2; lr = mid - sgn * sep / 2; }
    tickAt(r.direct, ld, css("--dir"), "direct " + r.direct.toFixed(1), T0 + 10);
    tickAt(r.recursive, lr, css("--rec"), "recursive " + r.recursive.toFixed(1), T0 + 26);
  }

  function legend() {
    var lg = $("#lab-legend"); if (lg.childNodes.length) return;
    var items = [["truth", "Synthetic target (toy)"], ["dir", "Direct readout of p[t]"], ["rec", "Readout of recursive state s[t]"], ["p", "Toy output p[t]"], ["prior", "Prior T × s[t−1] (normalised)"], ["reset", "Gap: state reset to uniform"], ["inject", "Injected competing peak (toy disturbance)"]];
    items.forEach(function (it) {
      var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 28 14"); s.setAttribute("aria-hidden", "true");
      var k = it[0], m;
      function mk(tag, a) { var e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (var q in a) e.setAttribute(q, a[q]); s.appendChild(e); }
      if (k === "truth") mk("line", { x1: 2, y1: 7, x2: 26, y2: 7, style: "stroke:var(--truth);stroke-width:6;stroke-linecap:round" });
      if (k === "dir") mk("circle", { cx: 14, cy: 7, r: 4, style: "fill:var(--surface);stroke:var(--dir);stroke-width:1.6" });
      if (k === "rec") mk("line", { x1: 2, y1: 7, x2: 26, y2: 7, style: "stroke:var(--rec);stroke-width:2.4" });
      if (k === "p") mk("rect", { x: 2, y: 3, width: 24, height: 8, style: "fill:var(--dir);opacity:.35" });
      if (k === "prior") mk("line", { x1: 2, y1: 7, x2: 26, y2: 7, style: "stroke:var(--synth);stroke-width:2;stroke-dasharray:6 4" });
      if (k === "inject") mk("rect", { x: 2, y: 1, width: 24, height: 12, style: "fill:var(--inject);stroke:var(--inject-edge);stroke-width:1" });
      if (k === "reset") mk("line", { x1: 14, y1: 0, x2: 14, y2: 14, style: "stroke:var(--synth);stroke-width:1.6;stroke-dasharray:4 3" });
      var sp = document.createElement("span"); sp.appendChild(s); sp.appendChild(document.createTextNode(it[1])); lg.appendChild(sp);
      void m;
    });
  }

  function writeSummary() {
    var r = state.run[state.t];
    var items = [["Window", (state.t + 1) + " of " + L.N_STEPS + " (" + r.time_s + " s)"], ["Synthetic target", r.truth.toFixed(1) + " toy bpm"],
      ["Direct readout", r.direct.toFixed(1) + " toy bpm"], ["Recursive readout", r.recursive.toFixed(1) + " toy bpm"],
      ["State before update", r.reset ? (state.t === 0 ? "Uniform (start)" : "Reset to uniform (gap)") : "Carried from previous window"]];
    summary.textContent = "";
    items.forEach(function (it, i) {
      var d = document.createElement("div"); if (i === 4 && r.reset) d.className = "reset-flag";
      var k = document.createElement("span"); k.className = "k"; k.textContent = it[0];
      var v = document.createElement("span"); v.className = "v"; v.textContent = it[1];
      d.appendChild(k); d.appendChild(v); summary.appendChild(d);
    });
  }

  function render(announce) {
    scrub.value = state.t;
    tlabel.textContent = (state.t + 1) + " / " + L.N_STEPS;
    ambOut.textContent = Number(state.amb).toFixed(2);
    sigOut.textContent = Number(state.sigma).toFixed(3);
    back.disabled = state.t === 0; fwd.disabled = state.t === L.N_STEPS - 1;
    drawTrace(); drawDist(); legend();
    // Live region updates only when not playing (avoid flooding assistive tech).
    summary.setAttribute("aria-live", state.playing ? "off" : "polite");
    writeSummary();
    void announce;
  }

  loadPreset("transient");
  window.P2LabUI = { state: state, loadPreset: loadPreset, start: start, stop: stop, injectedRuns: injectedRuns };
})();
