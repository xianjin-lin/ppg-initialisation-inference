/* Paper 2 project page — real-evidence views. Reads stored aggregate values only; never recomputes endpoints. */
(function () {
  "use strict";
  var P2 = window.P2 || {};
  var E = P2.evidence, D = P2.duration, PV = P2.provenance, FG = P2.figures || [], CFG = P2.config || {};
  var BUILD = P2.build || { mode: "aggregate" };
  var PT = P2.participants || null;
  var SVGNS = "http://www.w3.org/2000/svg";
  var MINUS = "−";

  // ------------------------------------------------------------------ helpers
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function sv(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  /* Display rounding: 3 decimals, explicit sign, U+2212 minus; values that round to zero print as 0.000. */
  function fmt(v, dp) {
    dp = dp == null ? 3 : dp;
    var r = Number(v).toFixed(dp);
    if (Number(r) === 0) return Number(0).toFixed(dp);
    return (v > 0 ? "+" : MINUS) + Math.abs(v).toFixed(dp);
  }
  function fmtAbs(v, dp) { return Number(v).toFixed(dp == null ? 3 : dp); }
  function fmtInt(lo, hi) { return "[" + fmt(lo) + ", " + fmt(hi) + "]"; }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function niceStep(span, target) {
    var raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * mag;
  }
  function ticks(lo, hi, target) {
    var st = niceStep(hi - lo, target), out = [], v = Math.ceil(lo / st - 1e-9) * st;
    for (; v <= hi + 1e-9; v += st) out.push(Math.abs(v) < st / 1e6 ? 0 : v);
    return { ticks: out, step: st };
  }
  function tickLabel(v, step) {
    var dp = 0; // enough decimals to represent the tick step exactly (e.g. 0.25 -> 2)
    while (dp < 6 && Math.abs(Math.round(step * Math.pow(10, dp)) - step * Math.pow(10, dp)) > 1e-6) dp++;
    if (Math.abs(v) < 1e-12) return "0";
    return (v < 0 ? MINUS : "") + Math.abs(v).toFixed(dp);
  }
  function domain(vals, pad) {
    var lo = Math.min.apply(null, vals.concat([0])), hi = Math.max.apply(null, vals.concat([0]));
    var p = (hi - lo) * (pad == null ? 0.06 : pad);
    return [lo - p, hi + p];
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function copyText(text, statusEl, okMsg) {
    function done(ok) {
      statusEl.textContent = ok ? (okMsg || "Copied.") : "Copy failed: select the text and copy it manually.";
      setTimeout(function () { statusEl.textContent = ""; }, 4000);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = el("textarea", { style: "position:fixed;left:-9999px;top:0", readonly: "" });
      ta.value = text; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    }
  }

  // ------------------------------------------------------------------ metadata
  var NETS = ["HRNet", "TEMPONet-191"], DSS = ["DaLiA", "WESAD"], MS = ["MAE", "F5", "E20", "C20"];
  var CS = ["UB_dir", "UB_rec", "RD_B", "RD_U", "INT"];
  var EP = {
    MAE: { name: "MAE", long: "mean absolute error", unit: "bpm", absUnit: "bpm" },
    F5: { name: "F5", long: "windows with error above 5 bpm", unit: "pp", absUnit: "%" },
    E20: { name: "E20", long: "mean excess above 20 bpm", unit: "bpm", absUnit: "bpm" },
    C20: { name: "C20", long: "contribution of errors above 20 bpm to MAE", unit: "bpm", absUnit: "bpm" }
  };
  var CT = {
    UB_dir: { short: "U " + MINUS + " B, direct", long: "U minus B under direct readout", mark: "circle-open", color: "var(--dir)",
      def: "Initialisation difference when each window is read out on its own.",
      sign: "Negative values mean lower values under U.", cells: ["B_direct", "U_direct"] },
    UB_rec: { short: "U " + MINUS + " B, recursive", long: "U minus B under the fixed recursion", mark: "circle", color: "var(--rec)",
      def: "Initialisation difference when both B and U receive the same fixed causal recursion.",
      sign: "Negative values mean lower values under U.", cells: ["B_recursive", "U_recursive"] },
    RD_B: { short: "Recursive " + MINUS + " direct, B", long: "recursive minus direct readout under B", mark: "circle", color: "var(--B)", stroke: "var(--B-stroke)",
      def: "Effect of the fixed recursion for randomly initialised networks.",
      sign: "Negative values mean lower values under recursion.", cells: ["B_direct", "B_recursive"] },
    RD_U: { short: "Recursive " + MINUS + " direct, U", long: "recursive minus direct readout under U", mark: "diamond", color: "var(--U)",
      def: "Effect of the fixed recursion for clinical-source initialised networks.",
      sign: "Negative values mean lower values under recursion.", cells: ["U_direct", "U_recursive"] },
    INT: { short: "Interaction", long: "interaction (U rec " + MINUS + " U direct) " + MINUS + " (B rec " + MINUS + " B direct)", mark: "square", color: "var(--int)",
      def: "Difference between the recursion effects under U and under B, with its own stored paired interval.",
      sign: "Positive values mean the recursive-minus-direct change was more positive under U than under B (a smaller reduction or a larger increase under U); this alone does not say whether either effect is an improvement.",
      cells: ["B_direct", "B_recursive", "U_direct", "U_recursive"] }
  };
  var COND_LABEL = { B_direct: "B, direct", B_recursive: "B, recursive", U_direct: "U, direct", U_recursive: "U, recursive" };

  var settings = E.settings;
  function sid(net, ds) { return settings.filter(function (s) { return s.network === net && s.dataset === ds; })[0].id; }
  function sById(id) { return settings.filter(function (s) { return s.id === id; })[0]; }
  var CELL = {}, COUNT = {}, ABS = {};
  E.cells.forEach(function (c) { CELL[c.s + "|" + c.c + "|" + c.m] = c; });
  E.counts.forEach(function (c) { COUNT[c.s + "|" + c.c + "|" + c.m] = c; });
  E.absolute.forEach(function (a) { ABS[a.s + "|" + a.cond + "|" + a.m] = a; });
  // Freeze source arrays so no view can mutate them.
  [E.cells, E.counts, E.absolute].forEach(function (arr) { arr.forEach(Object.freeze); Object.freeze(arr); });
  function cell(s, c, m) { return CELL[s + "|" + c + "|" + m]; }
  function status(c) { return c.lo > 0 ? "Interval above zero" : c.hi < 0 ? "Interval below zero" : "Interval includes zero"; }
  function srcInfo(id) { return (PV.sources || []).filter(function (x) { return x.id === id; })[0] || { id: id, label: id, sha256: "" }; }
  function figRef(s, c, m) {
    var r = [s.table];
    if (c === "UB_dir" || c === "UB_rec") { if (m === "MAE") r.push("Fig. 6a"); }
    else if (c === "RD_B" || c === "RD_U") {
      var p = { MAE: "Fig. 6b", F5: "Fig. 6c", C20: "Fig. 6d" }[m]; if (p) r.push(p);
      if (s.dataset === "WESAD" && (m === "MAE" || m === "F5")) r.push("Fig. 7 (All row)");
    } else if (c === "INT") { var q = { MAE: "Fig. 6e", F5: "Fig. 6f" }[m]; if (q) r.push(q); }
    return r.join("; ");
  }

  // ------------------------------------------------------------------ shared state
  var DEFAULT = { net: "HRNet", ds: "DaLiA", m: "MAE", c: "UB_dir" };
  var st = { net: DEFAULT.net, ds: DEFAULT.ds, m: DEFAULT.m, c: DEFAULT.c };
  var pst = { net: "HRNet", ds: "DaLiA", m: "MAE" };
  var listeners = [];
  function setState(patch) { for (var k in patch) st[k] = patch[k]; listeners.forEach(function (f) { f(); }); }
  function onState(f) { listeners.push(f); }

  // URL fragment state (allowlisted)
  var KEYMAP = { net: { hrnet: "HRNet", temponet: "TEMPONet-191" }, ds: { dalia: "DaLiA", wesad: "WESAD" },
                 m: { mae: "MAE", f5: "F5", e20: "E20", c20: "C20" }, c: { ubdir: "UB_dir", ubrec: "UB_rec", rdb: "RD_B", rdu: "RD_U", int: "INT" } };
  function encodeState() {
    var parts = [];
    ["net", "ds", "m", "c"].forEach(function (k) {
      var map = KEYMAP[k]; for (var key in map) if (map[key] === st[k]) parts.push(k + "-" + key);
    });
    return "#view=" + parts.join(".");
  }
  function parseState(hash) {
    if (!hash || hash.indexOf("#view=") !== 0) return null;
    var out = {}, body = hash.slice(6);
    if (body.length > 80 || !/^[a-z0-9.\-]*$/.test(body)) return null;
    body.split(".").forEach(function (p) {
      var i = p.indexOf("-"); if (i < 0) return;
      var k = p.slice(0, i), v = p.slice(i + 1);
      if (KEYMAP[k] && Object.prototype.hasOwnProperty.call(KEYMAP[k], v)) out[k] = KEYMAP[k][v];
    });
    return Object.keys(out).length ? out : null;
  }

  // ------------------------------------------------------------------ segmented controls
  function makeSeg(container, key, options, getter, setter, labels) {
    clear(container);
    var btns = options.map(function (o) {
      return el("button", { type: "button", role: "radio", "data-v": o, text: (labels && labels[o]) || o,
        onclick: function () { setter(o); } });
    });
    btns.forEach(function (b) { container.appendChild(b); });
    container.addEventListener("keydown", function (ev) {
      var i = options.indexOf(getter()), n = options.length, j = i;
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown") j = (i + 1) % n;
      else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") j = (i - 1 + n) % n;
      else return;
      ev.preventDefault(); setter(options[j]); btns[j].focus();
    });
    function sync() {
      var v = getter();
      btns.forEach(function (b) { var on = b.getAttribute("data-v") === v; b.setAttribute("aria-checked", on ? "true" : "false"); b.tabIndex = on ? 0 : -1; });
    }
    sync();
    return sync;
  }

  // ================================================================== NAV / THEME / CONFIG
  function initChrome() {
    // status + links from config
    $$('[data-config="status"]').forEach(function (n) { n.textContent = CFG.status || "Manuscript in preparation"; });
    var row = $("#link-row"), labels = { paper: "Paper", preprint: "Preprint", code: "Code", data: "Data" }, any = false;
    Object.keys(labels).forEach(function (k) {
      var u = CFG.links && CFG.links[k];
      if (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u)) {
        row.appendChild(el("a", { class: "btn", href: u, rel: "noopener", text: labels[k] })); any = true;
      }
    });
    row.hidden = !any;
    // nav
    var nav = $(".nav"), tog = $(".nav-toggle");
    tog.addEventListener("click", function () { var o = !nav.classList.contains("open"); nav.classList.toggle("open", o); tog.setAttribute("aria-expanded", o); });
    $$("#nav-list a").forEach(function (a) { a.addEventListener("click", function () { nav.classList.remove("open"); tog.setAttribute("aria-expanded", "false"); }); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("open")) { nav.classList.remove("open"); tog.setAttribute("aria-expanded", "false"); tog.focus(); } });
    document.addEventListener("click", function (e) { if (nav.classList.contains("open") && !nav.contains(e.target)) { nav.classList.remove("open"); tog.setAttribute("aria-expanded", "false"); } });
    if ("IntersectionObserver" in window) {
      var links = {}; $$("#nav-list a").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
      var io = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) { if (en.isIntersecting && links[en.target.id]) { $$("#nav-list a").forEach(function (a) { a.removeAttribute("aria-current"); }); links[en.target.id].setAttribute("aria-current", "true"); } });
      }, { rootMargin: "-45% 0px -50% 0px" });
      Object.keys(links).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
    }
    // theme
    var modes = ["auto", "light", "dark"], btn = $("#theme-btn"), lab = $(".theme-label", btn);
    function cur() { var t = document.documentElement.getAttribute("data-theme"); return t === "light" || t === "dark" ? t : "auto"; }
    function show() { var m = cur(); lab.textContent = m === "auto" ? "Auto" : m === "light" ? "Light" : "Dark"; btn.setAttribute("aria-label", "Colour theme: " + (m === "auto" ? "automatic" : m) + ". Activate to change."); }
    btn.addEventListener("click", function () {
      var next = modes[(modes.indexOf(cur()) + 1) % 3];
      if (next === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", next);
      try { if (next === "auto") localStorage.removeItem("p2-theme"); else localStorage.setItem("p2-theme", next); } catch (e) { /* storage unavailable */ }
      show(); document.dispatchEvent(new CustomEvent("p2-theme"));
    });
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var h = function () { document.dispatchEvent(new CustomEvent("p2-theme")); };
      if (mq.addEventListener) mq.addEventListener("change", h); else if (mq.addListener) mq.addListener(h);
    }
    show();
    // print: open disclosures for a static view, then restore
    var opened = [];
    window.addEventListener("beforeprint", function () { opened = $$("details:not([open])"); opened.forEach(function (d) { d.open = true; }); });
    window.addEventListener("afterprint", function () { opened.forEach(function (d) { d.open = false; }); opened = []; });
    $("#build-note").textContent = BUILD.mode === "full-local"
      ? "LOCAL FULL PREVIEW — includes release-gated participant summaries and figures. Not for publication."
      : "Public-candidate build: aggregate results only. Participant-level summaries and case figures are held pending release approval.";
  }

  // ================================================================== P0-A DESIGN MATRIX
  function initDesign() {
    var chips = $("#design-chips"), def = $("#matrix-def"), arrows = $("#mx-arrows"), matrix = $("#matrix");
    var btns = CS.map(function (c) {
      return el("button", { type: "button", class: "chip", role: "radio", "data-c": c, text: CT[c].short,
        onclick: function () { setState({ c: c }); } });
    });
    btns.forEach(function (b) { chips.appendChild(b); });
    chips.addEventListener("keydown", function (ev) {
      var i = CS.indexOf(st.c), j;
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown") j = (i + 1) % CS.length;
      else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") j = (i - 1 + CS.length) % CS.length;
      else return;
      ev.preventDefault(); setState({ c: CS[j] }); btns[j].focus();
    });
    $("#matrix-go").addEventListener("click", function () { /* state already shared; anchor scrolls */ });
    function center(name, side) {
      var n = $('[data-cell="' + name + '"]', matrix), r = n.getBoundingClientRect(), m = matrix.getBoundingClientRect();
      var x = r.left - m.left, y = r.top - m.top;
      if (side === "bottom") return [x + r.width / 2, y + r.height];
      if (side === "top") return [x + r.width / 2, y];
      if (side === "right") return [x + r.width, y + r.height / 2];
      if (side === "left") return [x, y + r.height / 2];
      return [x + r.width / 2, y + r.height / 2];
    }
    function arrow(a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L;
      var g = sv("g");
      var tip = [b[0] - ux * 2, b[1] - uy * 2], base = [tip[0] - ux * 10, tip[1] - uy * 10];
      g.appendChild(sv("path", { d: "M" + a[0] + "," + a[1] + " L" + base[0] + "," + base[1] }));
      g.appendChild(sv("path", { class: "head", d: "M" + tip[0] + "," + tip[1] + " L" + (base[0] - uy * 6) + "," + (base[1] + ux * 6) + " L" + (base[0] + uy * 6) + "," + (base[1] - ux * 6) + "Z" }));
      return g;
    }
    function draw() {
      var c = st.c, on = CT[c].cells;
      btns.forEach(function (b) { var s = b.getAttribute("data-c") === c; b.setAttribute("aria-checked", s); b.tabIndex = s ? 0 : -1; });
      $$(".mx-cell", matrix).forEach(function (n) {
        var name = n.getAttribute("data-cell"), act = on.indexOf(name) >= 0;
        n.classList.toggle("on", act); n.classList.toggle("dim", !act);
        n.classList.remove("plus", "minus");
        if (c === "INT" && act) n.classList.add(name === "U_recursive" || name === "B_direct" ? "plus" : "minus");
      });
      $("#mx-col-dir").classList.toggle("on", c === "UB_dir"); $("#mx-col-rec").classList.toggle("on", c === "UB_rec");
      $("#mx-row-B").classList.toggle("on", c === "RD_B"); $("#mx-row-U").classList.toggle("on", c === "RD_U");
      clear(arrows);
      var pad = 6;
      if (c === "UB_dir" || c === "UB_rec") {
        var col = c === "UB_dir" ? "direct" : "recursive";
        var a = center("B_" + col, "bottom"), b = center("U_" + col, "top"); a[1] -= 14; b[1] += 14;
        arrows.appendChild(arrow(a, b));
      } else {
        (c === "INT" ? ["B", "U"] : [c === "RD_B" ? "B" : "U"]).forEach(function (r) {
          var a2 = center(r + "_direct", "right"), b2 = center(r + "_recursive", "left"); a2[0] -= 18; b2[0] += 18 - pad;
          arrows.appendChild(arrow(a2, b2));
        });
      }
      def.textContent = CT[c].def + " " + (c === "INT" ? "Signs in the cells show how the four condition means enter the difference of differences." : "The arrow points from the subtracted condition to the other one.");
    }
    onState(draw);
    window.addEventListener("resize", debounce(draw, 120));
    draw();
  }

  // ================================================================== P0-B EVIDENCE EXPLORER
  var evDraw;
  function initEvidence() {
    var syncNet = makeSeg($('#ev-controls [data-key="net"]'), "net", NETS, function () { return st.net; }, function (v) { setState({ net: v }); });
    var syncDs = makeSeg($('#ev-controls [data-key="ds"]'), "ds", DSS, function () { return st.ds; }, function (v) { setState({ ds: v }); });
    var syncM = makeSeg($('#ev-controls [data-key="m"]'), "m", MS, function () { return st.m; }, function (v) { setState({ m: v }); });
    var sel = $("#ev-contrast");
    CS.forEach(function (c) { sel.appendChild(el("option", { value: c, text: CT[c].short })); });
    sel.addEventListener("change", function () { setState({ c: sel.value }); });

    var PRE = {
      "wesad-int": { net: "TEMPONet-191", ds: "WESAD", m: "MAE", c: "INT" },
      "wesad-f5": { net: "HRNet", ds: "WESAD", m: "F5", c: "RD_U" },
      "dalia-ub": { net: "HRNet", ds: "DaLiA", m: "MAE", c: "UB_dir" },
      "reset": DEFAULT
    };
    $$(".presets [data-preset]").forEach(function (b) {
      b.addEventListener("click", function () { setState(Object.assign({}, PRE[b.getAttribute("data-preset")])); });
    });
    $("#ev-copylink").addEventListener("click", function () {
      var url = location.href.split("#")[0] + encodeState();
      copyText(url, $("#ev-copystatus"), "Link copied (" + encodeState() + ").");
    });

    var svg = $("#forest"), tip = $("#ev-tip"), card = $("#ev-figure");
    var rows = [];

    function marker(c, x, y, size) {
      var m = CT[c].mark, col = CT[c].color, stroke = CT[c].stroke || col, s = size || 5.5;
      if (m === "diamond") return sv("path", { d: "M" + x + "," + (y - s * 1.25) + " L" + (x + s * 1.25) + "," + y + " L" + x + "," + (y + s * 1.25) + " L" + (x - s * 1.25) + "," + y + "Z", style: "fill:" + col + ";stroke:" + col, "stroke-width": 1 });
      if (m === "square") return sv("rect", { x: x - s, y: y - s, width: 2 * s, height: 2 * s, style: "fill:" + col });
      if (m === "circle-open") return sv("circle", { cx: x, cy: y, r: s, style: "fill:var(--surface);stroke:" + col, "stroke-width": 1.8 });
      return sv("circle", { cx: x, cy: y, r: s, style: "fill:" + col + ";stroke:" + stroke, "stroke-width": 1.2 });
    }
    // legend
    var lg = $("#ev-legend");
    CS.forEach(function (c) {
      var s = sv("svg", { viewBox: "0 0 26 14", "aria-hidden": "true" });
      s.appendChild(sv("line", { x1: 1, y1: 7, x2: 25, y2: 7, style: "stroke:" + CT[c].color, "stroke-width": 2 }));
      s.appendChild(marker(c, 13, 7, 4.5));
      lg.appendChild(el("span", null, [s, CT[c].short]));
    });

    function showTip(c, x, y) {
      var s = sById(c.s), u = EP[c.m].unit;
      tip.textContent = "";
      tip.appendChild(el("b", { text: s.network + " · " + s.dataset }));
      tip.appendChild(document.createElement("br"));
      tip.appendChild(document.createTextNode(CT[c.c].short + ", " + c.m + ": " + fmt(c.mean) + " " + u));
      tip.appendChild(document.createElement("br"));
      tip.appendChild(document.createTextNode("95% interval " + fmtInt(c.lo, c.hi)));
      tip.hidden = false;
      var cw = card.clientWidth, tw = tip.offsetWidth;
      tip.style.left = Math.max(6, Math.min(cw - tw - 6, x - tw / 2)) + "px";
      tip.style.top = (y - tip.offsetHeight - 12) + "px";
    }
    function hideTip() { tip.hidden = true; }

    var expandAll = false;
    $("#ev-expand").addEventListener("click", function () { expandAll = !expandAll; drawForest(); $("#ev-expand").focus(); });
    function drawForest() {
      var W = Math.max(280, svg.parentNode.clientWidth), narrow = W < 560;
      var labW = narrow ? 104 : 170, right = 18, top = 6, grpH = 28, rowH = narrow ? 30 : 27, axisH = 48;
      // Phones: by default only the selected contrast's four settings; the axis stays shared with all 20 rows.
      var groups = narrow && !expandAll ? [st.c] : CS, tg = $("#ev-expand");
      tg.hidden = !narrow; tg.setAttribute("aria-expanded", expandAll ? "true" : "false");
      tg.textContent = expandAll ? "Show only the selected contrast" : "Show all five contrasts";
      var H = top + groups.length * (grpH + 4 * rowH) + axisH;
      clear(svg); svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", W); svg.setAttribute("height", H);
      var all = []; settings.forEach(function (s) { CS.forEach(function (c) { var x = cell(s.id, c, st.m); all.push(x.lo, x.hi); }); });
      var dom = domain(all, 0.06), x0 = labW, x1 = W - right;
      function X(v) { return x0 + (v - dom[0]) / (dom[1] - dom[0]) * (x1 - x0); }
      var tk = ticks(dom[0], dom[1], narrow ? 4 : 6), bottom = H - axisH;
      tk.ticks.forEach(function (t) {
        svg.appendChild(sv("line", { class: "grid", x1: X(t), x2: X(t), y1: top, y2: bottom }));
        svg.appendChild(sv("text", { class: "tick-label", x: X(t), y: bottom + 18, "text-anchor": "middle", text: tickLabel(t, tk.step) }));
      });
      svg.appendChild(sv("line", { class: "axis", x1: x0, x2: x1, y1: bottom, y2: bottom }));
      svg.appendChild(sv("line", { class: "zero", x1: X(0), x2: X(0), y1: top, y2: bottom }));
      svg.appendChild(sv("text", { class: "axis-title", x: (x0 + x1) / 2, y: bottom + 40, "text-anchor": "middle",
        text: "Paired difference in " + st.m + " (" + EP[st.m].unit + ")" }));
      rows = [];
      var y = top, curSid = sid(st.net, st.ds);
      groups.forEach(function (c, gi) {
        var isSelGrp = c === st.c;
        if (gi > 0) svg.appendChild(sv("line", { class: "grp-sep", x1: 0, x2: W, y1: y + 2, y2: y + 2 }));
        svg.appendChild(sv("text", { class: "grp-label" + (isSelGrp ? "" : " dimmed"), x: 0, y: y + 19, text: CT[c].short }));
        y += grpH;
        settings.forEach(function (s) {
          var d = cell(s.id, c, st.m), cy = y + rowH / 2, isSel = isSelGrp && s.id === curSid;
          var g = sv("g", { class: "row" + (isSel ? " sel" : "") + (isSelGrp ? "" : " dim") + (s.id === curSid ? " setting-match" : ""),
            tabindex: isSel ? "0" : "-1", role: "button", "data-s": s.id, "data-c": c,
            "aria-pressed": isSel ? "true" : "false",
            "aria-label": s.network + ", " + s.dataset + ". " + CT[c].short + ", " + st.m + ": " + fmt(d.mean) + " " + EP[st.m].unit + ", 95% interval " + fmtInt(d.lo, d.hi) + ". " + status(d) + "." });
          g.appendChild(sv("rect", { class: "row-hit", x: 0, y: y, width: W, height: rowH, rx: 6 }));
          var lab = narrow ? (s.network === "HRNet" ? "HRNet" : "TEMPONet") + " · " + s.dataset : s.network + " · " + s.dataset;
          g.appendChild(sv("text", { class: "row-label", x: 10, y: cy + 4.5, text: lab }));
          g.appendChild(sv("line", { x1: X(d.lo), x2: X(d.hi), y1: cy, y2: cy, style: "stroke:" + CT[c].color, "stroke-width": isSel ? 3 : 2, "stroke-linecap": "butt" }));
          g.appendChild(marker(c, X(d.mean), cy, isSel ? 6.5 : 5.5));
          g.addEventListener("click", function () { setState({ c: c, net: s.network, ds: s.dataset }); focusSel(); });
          g.addEventListener("mouseenter", function () { showTip(d, X(d.mean) + 14, y + 16); });
          g.addEventListener("mouseleave", hideTip);
          g.addEventListener("focus", function () { showTip(d, X(d.mean) + 14, y + 16); });
          g.addEventListener("blur", hideTip);
          g.addEventListener("keydown", function (ev) {
            var i = rows.indexOf(g);
            if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
              ev.preventDefault(); var j = Math.max(0, Math.min(rows.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)));
              rows[i].setAttribute("tabindex", "-1"); rows[j].setAttribute("tabindex", "0"); rows[j].focus();
            } else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setState({ c: c, net: s.network, ds: s.dataset }); focusSel(); }
            else if (ev.key === "Escape") hideTip();
          });
          svg.appendChild(g); rows.push(g);
          y += rowH;
        });
      });
      $("#ev-cap").textContent = st.m + " (" + EP[st.m].long + "): " + (groups.length === 1 ? "selected contrast in all four settings (axis shared with all five contrasts)." : "all five contrasts in all four settings.") + " Selected: " + CT[st.c].short + ", " + st.net + " · " + st.ds + ". Axis fixed per endpoint; zero line in grey.";
    }
    function focusSel() { var g = $(".row.sel", svg); if (g) g.focus(); }

    function drawReadout() {
      var s = sById(sid(st.net, st.ds)), d = cell(s.id, st.c, st.m), k = COUNT[s.id + "|" + st.c + "|" + st.m], u = EP[st.m].unit, src = srcInfo(d.src);
      var ro = $("#ev-readout"); clear(ro);
      ro.appendChild(el("p", { class: "ro-kicker", text: s.network + " · " + s.dataset + " · n = 15 participants" }));
      ro.appendChild(el("p", { class: "ro-title", text: CT[st.c].short + " · " + st.m }));
      ro.appendChild(el("p", { class: "ro-value" }, [fmt(d.mean), el("span", { class: "ro-unit", text: u })]));
      ro.appendChild(el("p", { class: "ro-int", text: "Descriptive 95% interval " + fmtInt(d.lo, d.hi) + " " + u }));
      ro.appendChild(el("span", { class: "ro-status", text: status(d) }));
      ro.appendChild(el("p", { class: "ro-def", text: CT[st.c].def + " " + CT[st.c].sign }));
      ro.appendChild(el("p", { class: "ro-meta", text: "Participant directions: higher in " + k.higher + ", lower in " + k.lower + ", ties " + k.tie + " (of " + k.n + ")." }));
      var conds = CT[st.c].cells.map(function (cn) { return COND_LABEL[cn] + " " + fmtAbs(ABS[s.id + "|" + cn + "|" + st.m].value) + " " + EP[st.m].absUnit; });
      ro.appendChild(el("p", { class: "ro-meta", text: "Stored condition means: " + conds.join(" · ") + "." }));
      var det = el("details", { class: "ro-src" }, [el("summary", { text: "Source details for this cell" })]);
      var dl = el("dl");
      [["Source ID", src.id + " — " + src.label], ["SHA-256", src.sha256], ["Field", d.field], ["Aggregation", s.agg],
       ["Interval", "Stored descriptive 95% participant-bootstrap interval (10,000 resamples), read as stored"],
       ["Manuscript", figRef(s, st.c, st.m) + " (v3 review candidate)"]].forEach(function (p) {
        dl.appendChild(el("dt", { text: p[0] })); dl.appendChild(el("dd", { class: p[0] === "SHA-256" || p[0] === "Field" ? "code" : null, text: p[1] }));
      });
      det.appendChild(dl); ro.appendChild(det);
    }

    function drawTable() {
      var s = sById(sid(st.net, st.ds)), t = $("#ev-table"); clear(t);
      $("#ev-table-sub").textContent = s.network + " · " + s.dataset + ": mean and descriptive 95% interval. F5 in percentage points, others in bpm. Select a cell to inspect it.";
      var narrowT = t.parentNode.clientWidth < 520, cols = narrowT ? [st.m] : MS;
      if (narrowT) $("#ev-table-sub").textContent = s.network + " · " + s.dataset + ", " + st.m + " (" + EP[st.m].unit + "): mean and descriptive 95% interval. Change the endpoint above for other columns; all 80 cells are listed below.";
      var thead = el("thead"), tr = el("tr", null, [el("th", { scope: "col", text: "Contrast" })]);
      cols.forEach(function (m) { tr.appendChild(el("th", { scope: "col", text: m + " (" + EP[m].unit + ")" })); });
      thead.appendChild(tr); t.appendChild(thead);
      var tb = el("tbody");
      CS.forEach(function (c) {
        var r = el("tr", null, [el("th", { scope: "row", text: CT[c].short })]);
        cols.forEach(function (m) {
          var d = cell(s.id, c, m), isSel = c === st.c && m === st.m;
          var b = el("button", { type: "button", class: "cellbtn" + (isSel ? " sel" : ""), "aria-pressed": isSel ? "true" : "false",
            "aria-label": CT[c].short + ", " + m + ": " + fmt(d.mean) + ", interval " + fmtInt(d.lo, d.hi),
            onclick: function () { setState({ c: c, m: m }); } }, [fmt(d.mean), el("span", { class: "ci", text: fmtInt(d.lo, d.hi) })]);
          r.appendChild(el("td", null, [b]));
        });
        tb.appendChild(r);
      });
      t.appendChild(tb);
    }
    function drawAll() {
      var t = $("#ev-table-all"); clear(t);
      var tr = el("tr", null, [el("th", { scope: "col", text: "Setting" }), el("th", { scope: "col", text: "Contrast" })]);
      MS.forEach(function (m) { tr.appendChild(el("th", { scope: "col", text: m + " (" + EP[m].unit + ")" })); });
      t.appendChild(el("thead", null, [tr]));
      var tb = el("tbody");
      settings.forEach(function (s) {
        CS.forEach(function (c) {
          var r = el("tr", null, [el("th", { scope: "row", text: s.network + " · " + s.dataset }), el("td", { text: CT[c].short })]);
          MS.forEach(function (m) { var d = cell(s.id, c, m); r.appendChild(el("td", null, [fmt(d.mean), el("span", { class: "ci", text: fmtInt(d.lo, d.hi) })])); });
          tb.appendChild(r);
        });
      });
      t.appendChild(tb);
    }
    evDraw = function () {
      syncNet(); syncDs(); syncM(); sel.value = st.c;
      $$(".presets [data-preset]").forEach(function (b) {
        var p = PRE[b.getAttribute("data-preset")];
        b.setAttribute("aria-pressed", b.getAttribute("data-preset") !== "reset" && p.net === st.net && p.ds === st.ds && p.m === st.m && p.c === st.c ? "true" : "false");
      });
      hideTip(); drawForest(); drawReadout(); drawTable();
      tableW = $("#ev-table").parentNode.clientWidth;
    };
    onState(evDraw);
    drawAll();
    var tableW = 0;
    if ("ResizeObserver" in window) { var w0 = 0; new ResizeObserver(debounce(function () { var w = svg.parentNode.clientWidth; if (w !== w0) { w0 = w; drawForest(); } var tw = $("#ev-table").parentNode.clientWidth; if ((tw < 520) !== (tableW < 520)) { tableW = tw; drawTable(); } }, 80)).observe(document.getElementById("evidence")); }
    else window.addEventListener("resize", debounce(drawForest, 120));
    evDraw();
  }

  // ================================================================== P0-D INTERACTION EXPLAINER
  function initInteraction() {
    var step = 0, N = 3, svg = $("#int-svg");
    var stepText = [
      "B: recursive minus direct (stored mean and interval).",
      "U: recursive minus direct (stored mean and interval).",
      "Interaction: the difference between the two effects, with its own stored paired interval."
    ];
    var ol = $("#int-steps"); stepText.forEach(function (t) { ol.appendChild(el("li", { text: t })); });
    $("#int-prev").addEventListener("click", function () { if (step > 0) { step--; draw(); } });
    $("#int-next").addEventListener("click", function () { if (step < N - 1) { step++; draw(); } else { step = 0; draw(); } });
    function draw() {
      var s = sById(sid(st.net, st.ds)), m = st.m, u = EP[m].unit;
      var b = cell(s.id, "RD_B", m), uu = cell(s.id, "RD_U", m), it = cell(s.id, "INT", m);
      $$("li", ol).forEach(function (li, i) { li.className = i === step ? "cur" : i < step ? "done" : ""; });
      $("#int-count").textContent = "Step " + (step + 1) + " of " + N;
      $("#int-prev").disabled = step === 0;
      $("#int-next").textContent = step === N - 1 ? "Start again" : "Next";
      $("#int-cap").textContent = s.network + " · " + s.dataset + " · " + m + " (" + u + ")";
      var W = Math.max(280, svg.parentNode.clientWidth), narrow = W < 520, labW = narrow ? 92 : 150, right = 16;
      var rowsY = [34, 84, 158], H = 214;
      clear(svg); svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", W); svg.setAttribute("height", H);
      var dom = domain([b.lo, b.hi, uu.lo, uu.hi, it.lo, it.hi], 0.08), x0 = labW, x1 = W - right;
      function X(v) { return x0 + (v - dom[0]) / (dom[1] - dom[0]) * (x1 - x0); }
      var tk = ticks(dom[0], dom[1], narrow ? 4 : 6);
      tk.ticks.forEach(function (t) {
        svg.appendChild(sv("line", { x1: X(t), x2: X(t), y1: 12, y2: H - 30, style: "stroke:var(--line-2)" }));
        svg.appendChild(sv("text", { x: X(t), y: H - 12, "text-anchor": "middle", text: tickLabel(t, tk.step) }));
      });
      svg.appendChild(sv("line", { x1: X(0), x2: X(0), y1: 12, y2: H - 30, style: "stroke:var(--zero)", "stroke-width": 1.2 }));
      svg.appendChild(sv("line", { x1: x0, x2: x1, y1: 122, y2: 122, style: "stroke:var(--line)", "stroke-dasharray": "3 4" }));
      function row(d, y, c, label, show) {
        var g = sv("g", { class: "reveal" + (show ? "" : " fade") });
        g.appendChild(sv("text", { x: 0, y: y + 4.5, class: show ? "lab-strong" : null, text: label }));
        g.appendChild(sv("line", { x1: X(d.lo), x2: X(d.hi), y1: y, y2: y, style: "stroke:" + CT[c].color, "stroke-width": 2.4 }));
        var mk = CT[c].mark, x = X(d.mean), col = CT[c].color;
        if (mk === "diamond") g.appendChild(sv("path", { d: "M" + x + "," + (y - 8) + " L" + (x + 8) + "," + y + " L" + x + "," + (y + 8) + " L" + (x - 8) + "," + y + "Z", style: "fill:" + col }));
        else if (mk === "square") g.appendChild(sv("rect", { x: x - 6.5, y: y - 6.5, width: 13, height: 13, style: "fill:" + col }));
        else g.appendChild(sv("circle", { cx: x, cy: y, r: 6.5, style: "fill:" + col + ";stroke:" + (CT[c].stroke || col), "stroke-width": 1.2 }));
        if (show) g.appendChild(sv("text", { x: x, y: y - 13, "text-anchor": "middle", class: "lab-strong", text: fmt(d.mean) }));
        svg.appendChild(g);
      }
      row(b, rowsY[0], "RD_B", narrow ? "B rec−dir" : "B: rec − direct", step >= 0);
      row(uu, rowsY[1], "RD_U", narrow ? "U rec−dir" : "U: rec − direct", step >= 1);
      if (step >= 2) {
        // bracket between the two stored means (visual guide only)
        var xa = X(b.mean), xb = X(uu.mean), yb = rowsY[1] + 20;
        svg.appendChild(sv("path", { d: "M" + xa + "," + (rowsY[0] + 10) + " L" + xa + "," + yb + " M" + xb + "," + (rowsY[1] + 10) + " L" + xb + "," + yb + " M" + xa + "," + yb + " L" + xb + "," + yb,
          style: "fill:none;stroke:var(--ink-3)", "stroke-width": 1.2, "stroke-dasharray": "4 3" }));
      }
      row(it, rowsY[2], "INT", narrow ? "Interaction" : "Interaction", step >= 2);
      var desc;
      if (step === 0) desc = "Under B, recursion changed " + m + " by " + fmt(b.mean) + " " + u + " " + fmtInt(b.lo, b.hi) + ".";
      else if (step === 1) desc = "Under U, recursion changed " + m + " by " + fmt(uu.mean) + " " + u + " " + fmtInt(uu.lo, uu.hi) + ". Compare its position with B’s.";
      else {
        desc = "Stored interaction " + fmt(it.mean) + " " + u + ", paired interval " + fmtInt(it.lo, it.hi) + ". The dashed bracket spans the two stored means; the interval comes from the paired resamples, not from the two intervals above. ";
        if (it.lo > 0) desc += "Recursion’s change was more positive under U than under B in this setting (a smaller reduction or a larger increase under U).";
        else if (it.hi < 0) desc += "Recursion’s change was more negative under U than under B in this setting.";
        else desc += "The interval includes zero; this is not evidence that the two effects are equal, additive or independent.";
      }
      $("#int-desc").textContent = desc;
    }
    onState(draw);
    if ("ResizeObserver" in window) new ResizeObserver(debounce(draw, 80)).observe(svg.parentNode);
    draw();
  }

  // ================================================================== P0-C PARTICIPANTS
  function initParticipants() {
    var ctr = $("#pt-controls"), body = $("#pt-body"), summary = $("#pt-summary");
    var setP = function (k) { return function (v) { pst[k] = v; render(); }; };
    var s1 = makeSeg($('[data-key="net"]', ctr), "net", NETS, function () { return pst.net; }, setP("net"));
    var s2 = makeSeg($('[data-key="ds"]', ctr), "ds", DSS, function () { return pst.ds; }, setP("ds"));
    var s3 = makeSeg($('[data-key="m"]', ctr), "m", ["MAE", "F5"], function () { return pst.m; }, setP("m"));
    var pinned = null;

    // global x domain per endpoint (fixed across settings, B and U; no autozoom on click)
    var XD = {};
    if (PT) ["MAE", "F5"].forEach(function (m) {
      var v = [];
      settings.forEach(function (s) {
        ["RD_B", "RD_U"].forEach(function (c) {
          var o = PT.settings[s.id][c][m]; for (var p in o) v.push(o[p]);
          var d = cell(s.id, c, m); v.push(d.lo, d.hi);
        });
      });
      XD[m] = domain(v, 0.05);
    });

    function statCard(arm, s, m) {
      var c = arm === "B" ? "RD_B" : "RD_U", d = cell(s.id, c, m), k = COUNT[s.id + "|" + c + "|" + m];
      return el("div", { class: "pt-stat" }, [
        el("span", { class: "k" }, [el("span", { class: "mk mk-" + arm, "aria-hidden": "true" }), arm + ": recursive " + MINUS + " direct, " + m]),
        el("div", { class: "v", text: fmt(d.mean) + " " + EP[m].unit + " " + fmtInt(d.lo, d.hi) }),
        el("div", { class: "v muted", text: "Increase in " + k.higher + ", decrease in " + k.lower + ", ties " + k.tie + " of " + k.n })
      ]);
    }

    function render() {
      s1(); s2(); s3();
      var s = sById(sid(pst.net, pst.ds)), m = pst.m;
      clear(summary);
      summary.appendChild(statCard("B", s, m)); summary.appendChild(statCard("U", s, m));
      clear(body);
      if (!PT) {
        body.appendChild(el("div", { class: "gated" }, [
          el("p", null, [el("span", { class: "badge badge-gated", text: "Release-gated" })]),
          el("h3", { text: "Participant-level rows are held pending release approval" }),
          el("p", { text: "This public-candidate build contains only stored group means, stored intervals and counts of increases and decreases. The 15 per-participant rows (as in Figs. 4 and 7 of the manuscript) will appear here only after the authors approve releasing individual summaries." })
        ]));
        return;
      }
      var rec = PT.settings[s.id], ids = rec.ids;
      var card = el("div", { class: "pt-card" });
      var svg = sv("svg", { class: "pt-svg", role: "group", "aria-label": s.network + " " + s.dataset + ", recursive minus direct " + m + " per participant, B and U" });
      card.appendChild(svg); body.appendChild(card);
      var W = Math.max(280, body.clientWidth - 26), narrow = W < 640;
      var labW = 54, gap = 26, top = 34, rowH = narrow ? 24 : 22, allGap = 14, axisH = 46;
      var nR = ids.length, H = top + nR * rowH + allGap + rowH + axisH;
      svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", W); svg.setAttribute("height", H);
      var panels = narrow ? [{ arms: ["B", "U"], x0: labW, x1: W - 10 }]
        : [{ arms: ["B"], x0: labW, x1: labW + (W - labW - gap - 10) / 2 }, { arms: ["U"], x0: labW + (W - labW - gap - 10) / 2 + gap, x1: W - 10 }];
      var dom = XD[m], tk = ticks(dom[0], dom[1], narrow ? 4 : 5), bottom = top + nR * rowH + allGap + rowH;
      var rowEls = {};
      panels.forEach(function (P) {
        function X(v) { return P.x0 + (v - dom[0]) / (dom[1] - dom[0]) * (P.x1 - P.x0); }
        P.X = X;
        svg.appendChild(sv("text", { class: "panel-title", x: P.arms.length === 2 ? 6 : P.x0, y: 16, text: P.arms.length === 2 ? "Recursive " + MINUS + " direct, B and U" : P.arms[0] + ": recursive " + MINUS + " direct" }));
        tk.ticks.forEach(function (t) {
          svg.appendChild(sv("line", { class: "grid", x1: X(t), x2: X(t), y1: top - 6, y2: bottom }));
          svg.appendChild(sv("text", { x: X(t), y: bottom + 17, "text-anchor": "middle", text: tickLabel(t, tk.step) }));
        });
        svg.appendChild(sv("line", { class: "zero", x1: X(0), x2: X(0), y1: top - 6, y2: bottom }));
        svg.appendChild(sv("text", { class: "axis-title", x: (P.x0 + P.x1) / 2, y: bottom + 38, "text-anchor": "middle", text: m + " change (" + EP[m].unit + ")" }));
      });
      ids.forEach(function (pid, i) {
        var y = top + i * rowH, cy = y + rowH / 2;
        var g = sv("g", { class: "prow" + (pinned === pid ? " hl" : ""), tabindex: i === 0 ? "0" : "-1", role: "button", "data-pid": pid,
          "aria-pressed": pinned === pid ? "true" : "false",
          "aria-label": s.dataset + " " + pid + ": B " + fmt(rec.RD_B[m][pid]) + ", U " + fmt(rec.RD_U[m][pid]) + " " + EP[m].unit });
        g.appendChild(sv("rect", { class: "hit", x: 0, y: y, width: W, height: rowH, rx: 5 }));
        g.appendChild(sv("text", { class: "rl", x: 6, y: cy + 4.5, text: pid }));
        panels.forEach(function (P) {
          P.arms.forEach(function (arm) {
            var v = rec[arm === "B" ? "RD_B" : "RD_U"][m][pid], off = P.arms.length === 2 ? (arm === "B" ? -4.5 : 4.5) : 0, yy = cy + off;
            var col = arm === "B" ? "var(--B)" : "var(--U)", stroke = arm === "B" ? "var(--B-stroke)" : "var(--U)";
            g.appendChild(sv("line", { class: "stem", x1: P.X(0), x2: P.X(v), y1: yy, y2: yy, style: "stroke:" + stroke + ";opacity:.55" }));
            if (arm === "B") g.appendChild(sv("circle", { cx: P.X(v), cy: yy, r: 5, style: "fill:" + col + ";stroke:" + stroke, "stroke-width": 1.2 }));
            else g.appendChild(sv("path", { d: "M" + P.X(v) + "," + (yy - 6) + " l6,6 l-6,6 l-6,-6Z", style: "fill:" + col }));
          });
        });
        function hl(on) { $$('.prow[data-pid="' + pid + '"]', svg).forEach(function (n) { n.classList.toggle("hl", on || pinned === pid); }); }
        g.addEventListener("mouseenter", function () { hl(true); });
        g.addEventListener("mouseleave", function () { hl(false); });
        g.addEventListener("focus", function () { hl(true); });
        g.addEventListener("blur", function () { hl(false); });
        g.addEventListener("click", function () { pinned = pinned === pid ? null : pid; render(); var n = $('.prow[data-pid="' + pid + '"]', $("#pt-body svg")); if (n) n.focus(); });
        g.addEventListener("keydown", function (ev) {
          var list = $$(".prow", svg), j = list.indexOf(g);
          if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
            ev.preventDefault(); var k = Math.max(0, Math.min(list.length - 1, j + (ev.key === "ArrowDown" ? 1 : -1)));
            list[j].setAttribute("tabindex", "-1"); list[k].setAttribute("tabindex", "0"); list[k].focus();
          } else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); g.dispatchEvent(new Event("click")); }
        });
        svg.appendChild(g); rowEls[pid] = g;
      });
      // All row: stored group mean + stored interval
      var ya = top + nR * rowH + allGap, cya = ya + rowH / 2;
      svg.appendChild(sv("line", { x1: 0, x2: W, y1: ya - allGap / 2, y2: ya - allGap / 2, style: "stroke:var(--line)" }));
      var ga = sv("g", { class: "allrow" });
      ga.appendChild(sv("text", { x: 6, y: cya + 4.5, text: "All" }));
      panels.forEach(function (P) {
        P.arms.forEach(function (arm) {
          var d = cell(s.id, arm === "B" ? "RD_B" : "RD_U", m), off = P.arms.length === 2 ? (arm === "B" ? -4.5 : 4.5) : 0, yy = cya + off;
          var col = arm === "B" ? "var(--B)" : "var(--U)", stroke = arm === "B" ? "var(--B-stroke)" : "var(--U)";
          ga.appendChild(sv("line", { x1: P.X(d.lo), x2: P.X(d.hi), y1: yy, y2: yy, style: "stroke:" + stroke, "stroke-width": 2.4 }));
          if (arm === "B") ga.appendChild(sv("circle", { cx: P.X(d.mean), cy: yy, r: 6, style: "fill:" + col + ";stroke:" + stroke, "stroke-width": 1.4 }));
          else ga.appendChild(sv("path", { d: "M" + P.X(d.mean) + "," + (yy - 7) + " l7,7 l-7,7 l-7,-7Z", style: "fill:" + col }));
        });
      });
      svg.appendChild(ga);
      card.appendChild(el("p", { class: "fineprint", text: "Rows: stored per-participant recursive " + MINUS + " direct summaries, fixed " + s.dataset + " identifier order. All: stored participant-equal mean with its stored descriptive 95% interval; no participant-level intervals exist or are drawn. Values right of zero are increases under recursion." }));
      // table alternative
      var det = el("details", { class: "disclosure pt-table-wrap" }, [el("summary", { text: "Show these values as a table" })]);
      var tw = el("div", { class: "disc-body" }), sc = el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Participant values" });
      var t = el("table", { class: "vtable" });
      t.appendChild(el("thead", null, [el("tr", null, [el("th", { scope: "col", text: s.dataset + " ID" }), el("th", { scope: "col", text: "B (" + EP[m].unit + ")" }), el("th", { scope: "col", text: "U (" + EP[m].unit + ")" })])]));
      var tb = el("tbody");
      ids.forEach(function (pid) { tb.appendChild(el("tr", null, [el("th", { scope: "row", text: pid }), el("td", { text: fmt(rec.RD_B[m][pid]) }), el("td", { text: fmt(rec.RD_U[m][pid]) })])); });
      var dB = cell(s.id, "RD_B", m), dU = cell(s.id, "RD_U", m);
      tb.appendChild(el("tr", null, [el("th", { scope: "row", text: "All (stored)" }), el("td", { text: fmt(dB.mean) + " " + fmtInt(dB.lo, dB.hi) }), el("td", { text: fmt(dU.mean) + " " + fmtInt(dU.lo, dU.hi) })]));
      t.appendChild(tb); sc.appendChild(t); tw.appendChild(sc); det.appendChild(tw); body.appendChild(det);
    }
    if ("ResizeObserver" in window) { var w0 = 0; new ResizeObserver(debounce(function () { var w = body.clientWidth; if (w !== w0) { w0 = w; render(); } }, 100)).observe(body); }
    render();
  }

  // ================================================================== P0-E DURATION
  function initDuration() {
    var COLS = { isolated: "var(--d-iso)", intermediate: "var(--d-int)", sustained: "var(--d-sus)" };
    var NAMES = { isolated: "Isolated (1–3 windows)", intermediate: "Intermediate (4–14)", sustained: "Sustained (≥15)" };
    var lg = $("#dur-legend");
    D.classes.slice().reverse().forEach(function (c) { lg.appendChild(el("span", null, [el("span", { class: "sw", style: "background:" + COLS[c] }), NAMES[c]])); });
    lg.appendChild(el("span", { class: "muted", text: "D = direct, R = recursive" }));
    var comp = {}, tot = {}, del = {}, rule = {};
    D.components.forEach(function (r) { comp[r.s + "|" + r.arm + "|" + r.readout + "|" + r.cls] = r.value; });
    D.totals.forEach(function (r) { tot[r.s + "|" + r.arm + "|" + r.readout] = r.c20; });
    D.deltas.forEach(function (r) { del[r.s + "|" + r.arm + "|" + r.cls] = r; });
    D.rules.forEach(function (r) { rule[r.s] = r; });
    var ymax = Math.max.apply(null, D.totals.map(function (t) { return t.c20; }));
    var yt = ticks(0, ymax * 1.08, 4), YM = yt.ticks[yt.ticks.length - 1] < ymax * 1.08 ? yt.ticks[yt.ticks.length - 1] + yt.step : yt.ticks[yt.ticks.length - 1];
    var grid = $("#dur-grid");
    var bars = [["B", "direct", "B·D"], ["B", "recursive", "B·R"], ["U", "direct", "U·D"], ["U", "recursive", "U·R"]];
    var cards = [];
    function build() {
      clear(grid); cards = []; var draws = [];
      settings.forEach(function (s) {
        var card = el("article", { class: "dur-card", "aria-labelledby": "dur-h-" + s.id });
        card.appendChild(el("h3", { id: "dur-h-" + s.id, text: s.network + " · " + s.dataset }));
        card.appendChild(el("p", { class: "dur-tag", text: s.plan === "frozen plan" ? "Frozen decomposition plan · exploratory" : "Additional analysis · exploratory" }));
        var svg = sv("svg", { class: "dur-svg", role: "group", "aria-label": "C20 by duration class for " + s.network + " " + s.dataset });
        card.appendChild(svg);
        var read = el("p", { class: "dur-read", "aria-live": "polite" });
        card.appendChild(read);
        grid.appendChild(card); cards.push(card);
        draws.push(function () {
        var W = Math.max(220, card.clientWidth - 24), H = 236, left = 34, bottom = H - 34, top = 30;
        svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", W); svg.setAttribute("height", H);
        function Y(v) { return bottom - v / YM * (bottom - top); }
        for (var t = 0; t <= YM + 1e-9; t += yt.step) {
          svg.appendChild(sv("line", { class: "grid", x1: left, x2: W, y1: Y(t), y2: Y(t) }));
          svg.appendChild(sv("text", { x: left - 6, y: Y(t) + 4, "text-anchor": "end", text: tickLabel(t, yt.step) }));
        }
        svg.appendChild(sv("text", { x: left - 6, y: 11, "text-anchor": "end", text: "bpm" }));
        var plotW = W - left - 6, slot = plotW / 4.6, bw = Math.min(40, slot * 0.62);
        bars.forEach(function (b, i) {
          var cx = left + 6 + slot * (i + (i >= 2 ? 0.6 : 0)) + slot / 2, acc = 0;
          D.classes.forEach(function (cl) {
            var v = comp[s.id + "|" + b[0] + "|" + b[1] + "|" + cl], y0 = Y(acc), y1 = Y(acc + v);
            var r = sv("rect", { class: "seg-r", x: cx - bw / 2, y: y1, width: bw, height: Math.max(0, y0 - y1), style: "fill:" + COLS[cl], tabindex: "0", role: "img",
              "aria-label": b[0] + ", " + b[1] + ", " + NAMES[cl] + ": " + fmtAbs(v) + " bpm" });
            var say = function () { $$(".seg-r.on", grid).forEach(function (n) { n.classList.remove("on"); }); r.classList.add("on"); read.textContent = b[0] + ", " + b[1] + " readout · " + NAMES[cl] + ": " + fmtAbs(v) + " bpm of C20 " + fmtAbs(tot[s.id + "|" + b[0] + "|" + b[1]]) + " bpm"; };
            r.addEventListener("mouseenter", say); r.addEventListener("focus", say); r.addEventListener("click", say);
            svg.appendChild(r); acc += v;
          });
          var T = tot[s.id + "|" + b[0] + "|" + b[1]];
          svg.appendChild(sv("text", { class: "tot", x: cx, y: Y(T) - 6, "text-anchor": "middle", text: fmtAbs(T, 2) }));
          svg.appendChild(sv("text", { x: cx, y: bottom + 18, "text-anchor": "middle", text: b[2] }));
        });
        svg.appendChild(sv("line", { class: "base", x1: left, x2: W, y1: bottom, y2: bottom }));
        var lines = ["B", "U"].map(function (arm) {
          var di = del[s.id + "|" + arm + "|isolated"], ds = del[s.id + "|" + arm + "|sustained"];
          return el("span", { style: "display:block" }, [el("b", { text: arm }), ": isolated ", el("b", { text: fmt(di.mean) }), " (lower in " + di.n_lower + "/15), sustained ", el("b", { text: fmt(ds.mean) }), " (higher in " + ds.n_higher + "/15)"]);
        });
        card.appendChild(el("p", { class: "dur-delta" }, [el("span", { style: "display:block", class: "muted", text: "Recursive " + MINUS + " direct contribution, bpm:" })].concat(lines)));
        read.textContent = "Select a bar segment to read its value. Totals above bars are stored C20 (2 dp).";
        });
      });
      draws.forEach(function (f) { f(); }); // draw after all cards are in the grid, so widths are final
    }
    build();
    var notes = $("#dur-residual");
    notes.textContent = "Display check: each stack’s components sum to the separately stored C20 to within " + D.residual_max.toExponential(2) + " bpm. Three of 16 stacks differ by slightly more than 1×10⁻⁹ bpm because the two stored results were computed separately; the components are shown unaltered. Prespecified rule supported: " +
      settings.map(function (s) { return s.network + "/" + s.dataset + " " + (rule[s.id].rule_supported ? "yes" : "no"); }).join(", ") + ".";
    // full component table
    var det = $("#dur-notes .disc-body"), sc = el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "All 48 duration components" });
    var t = el("table", { class: "vtable vtable-all" });
    t.appendChild(el("thead", null, [el("tr", null, ["Setting", "Arm", "Readout", "Isolated", "Intermediate", "Sustained", "C20 (stored)"].map(function (h) { return el("th", { scope: "col", text: h }); }))]));
    var tb = el("tbody");
    settings.forEach(function (s) { bars.forEach(function (b) {
      tb.appendChild(el("tr", null, [el("th", { scope: "row", text: s.network + " · " + s.dataset }), el("td", { text: b[0] }), el("td", { text: b[1] })]
        .concat(D.classes.map(function (cl) { return el("td", { text: fmtAbs(comp[s.id + "|" + b[0] + "|" + b[1] + "|" + cl]) }); }))
        .concat([el("td", { text: fmtAbs(tot[s.id + "|" + b[0] + "|" + b[1]]) })])));
    }); });
    t.appendChild(tb); sc.appendChild(t);
    det.appendChild(el("p", { text: "All 48 stored components (bpm):" })); det.appendChild(sc);
    if ("ResizeObserver" in window) { var w0 = 0; new ResizeObserver(debounce(function () { var w = grid.clientWidth; if (w !== w0) { w0 = w; build(); } }, 120)).observe(grid); }
  }

  // ================================================================== P0-G GALLERY
  function initGallery() {
    var g = $("#gallery"), dlg = $("#lightbox"), img = $("#lb-img"), opener = null;
    var LABEL = { aggregate: ["badge-real", "Aggregate results"], schematic: ["badge-derived", "Design schematic"],
                  participant: ["badge-gated", "Participant-level summaries"], case: ["badge-gated", "Real case trajectories"] };
    FG.forEach(function (f) {
      var lab = LABEL[f.release_class] || ["badge-derived", f.release_class];
      var card = el("article", { class: "fig-card" });
      if (f.available) {
        var btn = el("button", { type: "button", class: "fig-thumb", "aria-label": "Open " + f.number + ": " + f.title }, [
          el("img", { src: "assets/figures/" + f.thumb, alt: f.number + ": " + f.title, loading: "lazy", decoding: "async", width: f.thumb_w, height: f.thumb_h })]);
        btn.addEventListener("click", function () {
          opener = btn; $("#lb-title").textContent = f.number + " · " + f.title;
          img.src = "assets/figures/" + f.web; img.alt = f.number + ": " + f.title; img.width = f.width; img.height = f.height;
          $("#lb-cap").textContent = f.summary + " " + f.reference + " (v3 review candidate).";
          if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
          $("#lb-close").focus();
        });
        card.appendChild(btn);
      }
      card.appendChild(el("div", { class: "fig-meta" }, [
        el("p", { class: "fig-num" }, [f.number, el("span", { class: "badge " + lab[0], text: lab[1] })]),
        el("p", { class: "fig-title", text: f.title }),
        el("p", { class: "fig-ref", text: f.reference })
      ]));
      g.appendChild(card);
    });
    function close() { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
    $("#lb-close").addEventListener("click", close);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener("close", function () { img.removeAttribute("src"); if (opener) opener.focus(); });
  }

  // ================================================================== PROVENANCE + CITATION
  function initProvenance() {
    var t = $("#prov-table");
    t.appendChild(el("thead", null, [el("tr", null, [el("th", { scope: "col", text: "Source ID" }), el("th", { scope: "col", text: "Content" }), el("th", { scope: "col", text: "SHA-256" })])]));
    var tb = el("tbody");
    (PV.sources || []).concat([PV.manuscript]).forEach(function (s) {
      tb.appendChild(el("tr", null, [el("th", { scope: "row", text: s.id }), el("td", { text: s.label }), el("td", null, [el("span", { class: "hash", text: s.sha256 })])]));
    });
    t.appendChild(tb);
    var cite = "Lin X, Yu L, Luo Z, Tian R, Ding W. " + $("#ms-title").textContent.trim() + ". " + (CFG.status || "Manuscript in preparation") + ".";
    $("#cite-text").textContent = cite;
    $("#cite-copy").addEventListener("click", function () { copyText(cite, $("#cite-status"), "Citation copied."); });
  }

  // ================================================================== boot
  function boot() {
    initChrome();
    var fromHash = parseState(location.hash);
    if (fromHash) for (var k in fromHash) st[k] = fromHash[k];
    initDesign(); initEvidence(); initInteraction(); initParticipants(); initDuration(); initGallery(); initProvenance();
    if (fromHash) { var ev = document.getElementById("evidence"); if (ev) ev.scrollIntoView(); }
    window.addEventListener("hashchange", function () {
      var h = parseState(location.hash);
      if (h) { setState(h); var e2 = document.getElementById("evidence"); if (e2) e2.scrollIntoView(); }
    });
    window.P2App = { state: st, setState: setState, fmt: fmt, cell: cell, encodeState: encodeState, parseState: parseState };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
