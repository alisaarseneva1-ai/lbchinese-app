/* Рукописный ввод иероглифов: пишешь пальцем — получаешь варианты.
   Своё распознавание по форме и порядку черт (данные: Make Me a Hanzi, Arphic Public License — см. hanzi_strokes.LICENSE.txt).
   Работает в браузере, без интернета после загрузки данных. */
(function (root) {
  "use strict";
  var A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", N = 8;
  var DB = null, loading = null;

  function load(url) {
    if (DB) return Promise.resolve(DB);
    if (loading) return loading;
    loading = fetch(url).then(function (r) { if (!r.ok) throw new Error("data"); return r.json(); }).then(function (j) {
      var idx = {}; for (var i = 0; i < A.length; i++) idx[A[i]] = i / 63;
      DB = Object.keys(j.d).map(function (c) {
        var row = j.d[c];
        var strokes = row[1].split(",").map(function (s) { var pts = []; for (var k = 0; k < s.length; k += 2) pts.push([idx[s[k]], idx[s[k + 1]]]); return pts; });
        return { c: c, lv: row[0], s: strokes };
      });
      return DB;
    });
    loading.catch(function () { loading = null; });
    return loading;
  }

  function resample(pts, n) {
    if (pts.length === 1) pts = [pts[0], pts[0]];
    var d = [0];
    for (var i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    var L = d[d.length - 1] || 1e-9, out = [], j = 1;
    for (var k = 0; k < n; k++) {
      var t = L * k / (n - 1);
      while (j < d.length - 1 && d[j] < t) j++;
      var a = pts[j - 1], b = pts[j], seg = d[j] - d[j - 1], f = seg ? (t - d[j - 1]) / seg : 0;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    return out;
  }

  // штрихи пользователя (в пикселях, y вниз — как и в данных) → квадрат 0..1 с центром 0.5
  function normalize(strokes) {
    var xs = [], ys = [];
    strokes.forEach(function (s) { s.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
    var w = Math.max.apply(null, xs) - x0, h = Math.max.apply(null, ys) - y0, sc = Math.max(w, h) || 1;
    var cx = w / sc / 2, cy = h / sc / 2;
    return strokes.map(function (s) {
      return resample(s.map(function (p) { return [(p[0] - x0) / sc - cx + 0.5, (p[1] - y0) / sc - cy + 0.5]; }), N);
    });
  }

  function strokeCost(a, b) {
    var f = 0, r = 0;
    for (var i = 0; i < N; i++) {
      f += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
      r += Math.hypot(a[i][0] - b[N - 1 - i][0], a[i][1] - b[N - 1 - i][1]);
    }
    return Math.min(f, r + 0.6) / N;   // черта в обратную сторону — небольшой штраф
  }

  // выравнивание черт по порядку: пропуск или лишняя черта стоят SKIP
  var SKIP = 0.35;
  function charCost(u, t) {
    var n = u.length, m = t.length, D = [];
    for (var i = 0; i <= n; i++) { D.push(new Array(m + 1)); D[i][0] = i * SKIP; }
    for (var j = 0; j <= m; j++) D[0][j] = j * SKIP;
    for (i = 1; i <= n; i++) for (j = 1; j <= m; j++)
      D[i][j] = Math.min(D[i - 1][j - 1] + strokeCost(u[i - 1], t[j - 1]), D[i - 1][j] + SKIP, D[i][j - 1] + SKIP);
    return D[n][m] / Math.max(n, m);
  }

  function match(strokes, limit) {
    if (!DB || !strokes.length) return [];
    var u = normalize(strokes), n = u.length, res = [];
    for (var i = 0; i < DB.length; i++) {
      var t = DB[i].s;
      if (Math.abs(t.length - n) > Math.max(2, Math.round(n * 0.25))) continue;
      res.push([charCost(u, t) + DB[i].lv * 0.002, DB[i].c]);
    }
    res.sort(function (a, b) { return a[0] - b[0]; });
    return res.slice(0, limit || 10).map(function (x) { return x[1]; });
  }

  // ---------- поле для письма ----------
  // Поле для письма: чёткое на любом экране, линия как кистью — тоньше на быстрых участках, сглажена кривыми.
  // Для распознавания сохраняются исходные точки черт.
  function pad(canvas, onChange) {
    var ctx = canvas.getContext("2d"), strokes = [], cur = null, dpr = 1, W = 0, H = 0, ink = null, inkCtx = null;
    function size() {
      var r = canvas.getBoundingClientRect(); if (!r.width) return;
      dpr = Math.min(3, window.devicePixelRatio || 1); W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ink = document.createElement("canvas"); ink.width = canvas.width; ink.height = canvas.height;
      inkCtx = ink.getContext("2d"); inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      strokes.forEach(function (s) { paint(inkCtx, s); }); draw();
    }
    function grid() {            // 米字格, как в тетради для иероглифов
      var css = getComputedStyle(canvas), line = css.getPropertyValue("--hw-grid").trim() || "rgba(214,98,86,.42)";
      ctx.save(); ctx.strokeStyle = line; ctx.lineWidth = 1;
      ctx.setLineDash([]); ctx.strokeRect(.5, .5, W - 1, H - 1);
      ctx.setLineDash([5, 5]); ctx.beginPath();
      ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
      ctx.stroke(); ctx.globalAlpha = .55; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, H); ctx.moveTo(W, 0); ctx.lineTo(0, H); ctx.stroke();
      ctx.restore();
    }
    function color() { return getComputedStyle(canvas).color || "#1B2541"; }
    // Черта рисуется как залитый контур: сглаженная осевая линия (Чайкин), ширина плавно зависит от скорости,
    // концы скруглены — получается ровная линия как от кисти-ручки, без «бусин» на стыках.
    function smooth(s) {
      var p = s.map(function (q) { return [q[0], q[1], q[2]]; });
      for (var it = 0; it < 2 && p.length > 2; it++) {
        var o = [p[0]];
        for (var i = 0; i < p.length - 1; i++) {
          var a = p[i], b = p[i + 1];
          o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25, a[2] * .75 + b[2] * .25]);
          o.push([a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75, a[2] * .25 + b[2] * .75]);
        }
        o.push(p[p.length - 1]); p = o;
      }
      return p;
    }
    function base() { return Math.max(4.5, W / 30); }
    function widths(p) {
      var B = base(), out = [], prev = B, n = p.length;
      for (var i = 0; i < n; i++) {
        var j = Math.max(0, i - 3), d = 0;
        for (var k = j + 1; k <= i; k++) d += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
        var dt = i > j ? Math.max(4, p[i][2] - p[j][2]) : 16, v = d / dt;
        var w = B * Math.max(.62, Math.min(1.12, 1.12 - v * .28));
        prev = i ? prev * .85 + w * .15 : w; out.push(prev);
      }
      var tail = Math.min(10, Math.floor(n / 4));          // лёгкое сужение в конце черты
      for (var t = 0; t < tail; t++) out[n - 1 - t] *= .6 + .4 * (t / tail);
      return out;
    }
    function paint(c, s) {
      c.fillStyle = color();
      var B = base();
      if (s.length < 2 || Math.hypot(s[s.length - 1][0] - s[0][0], s[s.length - 1][1] - s[0][1]) < 2) {
        c.beginPath(); c.arc(s[0][0], s[0][1], B * .55, 0, 7); c.fill(); return;
      }
      var p = smooth(s), w = widths(p), n = p.length, L = [], R = [];
      for (var i = 0; i < n; i++) {
        var a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
        var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, h = w[i] / 2;
        L.push([p[i][0] + nx * h, p[i][1] + ny * h]); R.push([p[i][0] - nx * h, p[i][1] - ny * h]);
      }
      c.beginPath(); c.moveTo(L[0][0], L[0][1]);
      for (i = 1; i < n; i++) c.lineTo(L[i][0], L[i][1]);
      var e = p[n - 1], ang = Math.atan2(L[n - 1][1] - e[1], L[n - 1][0] - e[0]);
      c.arc(e[0], e[1], w[n - 1] / 2, ang, ang - Math.PI, true);
      for (i = n - 1; i >= 0; i--) c.lineTo(R[i][0], R[i][1]);
      var st = p[0], ang0 = Math.atan2(R[0][1] - st[1], R[0][0] - st[0]);
      c.arc(st[0], st[1], w[0] / 2, ang0, ang0 - Math.PI, true);
      c.closePath(); c.fill();
    }
    var raf = 0;
    function draw() {
      raf = 0; ctx.clearRect(0, 0, W, H); grid();
      if (ink) ctx.drawImage(ink, 0, 0, W, H);
      if (cur) paint(ctx, cur);
    }
    function later() { if (!raf) raf = requestAnimationFrame(draw); }
    function pt(e) { var r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height, e.timeStamp || Date.now()]; }
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); if (!W) size(); try { canvas.setPointerCapture(e.pointerId); } catch (x) {} cur = [pt(e)]; later(); });
    canvas.addEventListener("pointermove", function (e) {
      if (!cur) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; if (!evs.length) evs = [e];
      evs.forEach(function (ev) { var p = pt(ev), l = cur[cur.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 1.2) cur.push(p); });
      later();
    });
    function up() { if (!cur) return; strokes.push(cur); if (inkCtx) paint(inkCtx, cur); cur = null; draw(); onChange(strokes.map(plain)); }
    function plain(s) { return s.map(function (p) { return [p[0], p[1]]; }); }
    function redrawInk() { if (!inkCtx) return; inkCtx.clearRect(0, 0, W, H); strokes.forEach(function (s) { paint(inkCtx, s); }); draw(); }
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    size();
    if (window.ResizeObserver) new ResizeObserver(function () { var r = canvas.getBoundingClientRect(); if (Math.abs(r.width - W) > .5 || Math.abs(r.height - H) > .5) size(); }).observe(canvas);
    else addEventListener("resize", size);
    return {
      clear: function () { strokes = []; cur = null; redrawInk(); onChange([]); },
      undo: function () { strokes.pop(); redrawInk(); onChange(strokes.map(plain)); },
      strokes: function () { return strokes.map(plain); }
    };
  }

  root.Handwrite = { load: load, match: match, pad: pad, _normalize: normalize, _db: function () { return DB; } };
})(window);
