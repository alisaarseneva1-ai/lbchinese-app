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
  function pad(canvas, onChange) {
    var ctx = canvas.getContext("2d"), strokes = [], cur = null, dpr = window.devicePixelRatio || 1;
    function size() {
      var r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
    }
    function grid() {
      var w = canvas.width / dpr, h = canvas.height / dpr;
      ctx.save(); ctx.strokeStyle = "rgba(120,120,140,.22)"; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.moveTo(0, 0); ctx.lineTo(w, h); ctx.moveTo(w, 0); ctx.lineTo(0, h); ctx.stroke(); ctx.restore();
    }
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height); grid();
      ctx.lineCap = ctx.lineJoin = "round"; ctx.lineWidth = Math.max(6, canvas.width / dpr / 28); ctx.strokeStyle = getComputedStyle(canvas).color || "#1B2541";
      strokes.concat(cur ? [cur] : []).forEach(function (s) { ctx.beginPath(); s.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); if (s.length === 1) ctx.lineTo(s[0][0] + .1, s[0][1]); ctx.stroke(); });
    }
    function pt(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); canvas.setPointerCapture(e.pointerId); cur = [pt(e)]; draw(); });
    canvas.addEventListener("pointermove", function (e) { if (!cur) return; var p = pt(e), l = cur[cur.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 2) { cur.push(p); draw(); } });
    function up() { if (!cur) return; strokes.push(cur); cur = null; draw(); onChange(strokes.slice()); }
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    size(); addEventListener("resize", size);
    return {
      clear: function () { strokes = []; cur = null; draw(); onChange([]); },
      undo: function () { strokes.pop(); draw(); onChange(strokes.slice()); },
      strokes: function () { return strokes.slice(); }
    };
  }

  root.Handwrite = { load: load, match: match, pad: pad, _normalize: normalize, _db: function () { return DB; } };
})(window);
