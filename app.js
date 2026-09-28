/* LinguaBridge — мини-приложение Telegram.
   Состояние ученика приходит от бота в ссылке (?s=...), результаты уходят боту через sendData. */
(function () {
  "use strict";
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined
    ? window.Telegram.WebApp : null;
  const $app = document.getElementById("app");
  const LEVELS = [1, 2, 3, 4, 5, 6];

  // ---------- иконки ----------
  const I = {
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z"/>',
    repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    cup: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M9 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    sound: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  };
  const icon = (n, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24">${I[n]}</svg>`;

  // ---------- состояние ----------
  function readState() {
    try {
      const raw = new URLSearchParams(location.search).get("s");
      if (!raw) return null;
      const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }
  const S = readState() || { n: "друг", l: 1, d: 1, s: 0, done: 0, k: {}, due: [], a: "", ok: 1, tl: 0, demo: 1 };
  let P = null, byLevel = {}, dictLevel = 0, dictQuery = "";

  // ---------- утилиты ----------
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };
  const haptic = t => { try { if (!tg || !tg.HapticFeedback) return; t ? tg.HapticFeedback.notificationOccurred(t) : tg.HapticFeedback.selectionChanged(); } catch (e) {} };
  const fmtDate = iso => iso ? new Date(iso + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "";
  function toast(text) { const t = document.createElement("div"); t.className = "toast"; t.textContent = text; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
  function send(payload) {
    const data = JSON.stringify(payload);
    if (tg && !S.demo) tg.sendData(data);
    else toast("Демо: откройте приложение из бота, чтобы сохранять прогресс");
  }
  function ask(text, yes) { if (tg && tg.showConfirm) tg.showConfirm(text, ok => ok && yes()); else if (confirm(text)) yes(); }
  const word = h => P.words.get(h);

  // дата по-китайски: 九月二十八日 · 周一
  function zhDate() {
    const d = new Date(), n = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    const num = x => x <= 10 ? n[x] : x < 20 ? "十" + n[x - 10] : n[Math.floor(x / 10)] + "十" + (x % 10 ? n[x % 10] : "");
    const wd = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    return `${num(d.getMonth() + 1)}月${num(d.getDate())}日 · 周${wd}`;
  }
  function greeting() { const h = new Date().getHours(); return h < 11 ? "早上好" : h < 18 ? "下午好" : "晚上好"; }

  // ---------- озвучка ----------
  let zhVoice = null;
  function pickVoice() { const vs = speechSynthesis.getVoices(); zhVoice = vs.find(v => /zh[-_]CN/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null; }
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!zhVoice) { toast("На этом устройстве нет китайского голоса — аудио есть в уроках в чате"); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.voice = zhVoice; u.lang = zhVoice.lang; u.rate = .8; speechSynthesis.speak(u);
  }

  // ---------- навигация ----------
  let depth = 0;
  function go(screen, sub = true) {
    depth = sub ? 1 : 0; window.scrollTo(0, 0);
    if (tg) depth ? tg.BackButton.show() : tg.BackButton.hide();
    screen();
  }
  const toHome = () => go(home, false);
  if (tg) tg.BackButton.onClick(toHome);

  // ---------- данные ----------
  async function load() {
    const raw = await (await fetch("program.json", { cache: "no-cache" })).json();
    const words = new Map(); byLevel = {};
    raw.words.forEach(w => { const o = { h: w[0], p: w[1], m: w[2], lv: w[3], day: w[4], hint: w[5], ex: w[6], ext: w[7] }; words.set(o.h, o); (byLevel[o.lv] = byLevel[o.lv] || []).push(o); });
    const lessons = {};
    Object.entries(raw.lessons).forEach(([lv, rows]) => rows.forEach(r => { lessons[lv + ":" + r[0]] = { lv: +lv, day: r[0], week: r[1], kind: r[2], topic: r[3], sounds: r[4], grammar: r[5] }; }));
    P = { words, lessons, sizes: raw.sizes };
  }
  const lesson = (lv, d) => P.lessons[lv + ":" + d];
  const lessonWords = (lv, d) => (byLevel[lv] || []).filter(w => w.day === d);
  const weekWords = (lv, wk) => (byLevel[lv] || []).filter(w => { const l = lesson(lv, w.day); return l && l.week === wk; });
  const known = lv => (S.k && S.k[lv]) || 0;
  const size = lv => (P.sizes && P.sizes[lv]) || 1;

  function makeQuestion(w, dir) {
    const pool = shuffle((byLevel[w.lv] || []).filter(x => x.h !== w.h)).slice(0, 30);
    const right = dir === 0 ? w.m : w.h, opts = [right];
    for (const x of pool) { const v = dir === 0 ? x.m : x.h; if (!opts.includes(v)) opts.push(v); if (opts.length === 4) break; }
    shuffle(opts);
    return { w, dir, opts, correct: opts.indexOf(right) };
  }

  // ---------- главная ----------
  function home() {
    const l = lesson(S.l, S.d);
    const ws = l ? lessonWords(S.l, S.d) : [];
    const due = (S.due || []).filter(h => word(h)).length;
    const pct = Math.min(100, Math.round(known(S.l) / size(S.l) * 100));
    const glyph = l && l.kind === "урок" && ws[0] ? ws[0].h[0] : l && l.kind === "тест" ? "考" : l ? "茶" : "学";

    let title = "", meta = "", cta = "";
    if (!l) { title = "Новые уроки готовятся"; meta = "Пока — повторение и разговор с Лао Ваном"; }
    else if (l.kind === "урок") {
      title = l.topic === "Новые слова" ? "Новые слова" : l.topic;
      meta = `${ws.length} ${plural(ws.length, "слово", "слова", "слов")}${l.grammar ? " и правило" : ""} · около ${Math.max(8, ws.length * 2)} мин`;
      cta = S.done ? "Следующий урок" : "Начать урок";
    } else if (l.kind === "тест") { title = "Тест недели"; meta = "10 вопросов по словам недели · 5 мин"; cta = "Пройти тест"; }
    else { title = "День отдыха"; meta = "Без новых слов — можно повторить или поговорить"; cta = "Отметить день"; }

    // последние 7 дней: заливаем столько, сколько длится серия
    const days = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"], today = new Date().getDay();
    const streakEnd = S.done ? 0 : 1;
    const week = Array.from({ length: 7 }, (_, i) => {
      const back = 6 - i, on = back >= streakEnd && back < streakEnd + S.s;
      return `<div class="${on ? "on" : ""} ${back === 0 ? "today" : ""}"><i></i>${days[(today - back + 7) % 7]}</div>`;
    }).join("");

    $app.innerHTML = `
      <div class="row">
        <div class="grow">
          <div class="date serif">${zhDate()}</div>
          <div class="greet"><span class="serif">${greeting()}</span>, ${esc(S.n)}</div>
        </div>
        <div class="seal" title="Дней подряд"><b>${S.s}</b><span>天</span></div>
      </div>
      <div class="week">${week}</div>

      ${S.ok ? "" : `<div class="notice"><b>Бесплатная неделя закончилась</b><p class="small" style="margin:4px 0 12px;color:var(--ink2)">Оформите подписку, чтобы продолжить уроки и разговоры с Лао Ваном.</p><button class="primary seal-btn" id="pay">Оформить подписку</button></div>`}

      <div class="today-card">
        <div class="today-top">
          <div class="glyph zh"><span>${esc(glyph)}</span></div>
          <div class="grow">
            <div class="eyebrow">Сегодня${l ? ` · HSK ${l.lv}, неделя ${l.week}` : ""}</div>
            <div class="today-title">${esc(title)}</div>
            <div class="today-meta">${esc(meta)}</div>
          </div>
        </div>
        ${S.done ? `<div class="done-note">${icon("check")}Урок на сегодня пройден</div>` : ""}
        ${l ? `<button class="primary" id="start">${cta}</button>` : ""}
      </div>

      <div class="list">
        <button class="item" id="rev">${icon("repeat")}<div class="grow"><div class="t">Повторение</div><div class="s">${due ? `${due} ${plural(due, "слово ждёт", "слова ждут", "слов ждут")}` : "На сегодня всё повторено"}</div></div>${due ? `<span class="count">${due}</span>` : icon("chev", "i chev")}</button>
        <button class="item" id="talk">${icon("cup")}<div class="grow"><div class="t">Лао Ван</div><div class="s">Разговор текстом и голосом · ${S.tl ? (S.tl >= 7 ? "HSK 7–9" : "HSK " + S.tl) : "HSK " + S.l}</div></div>${icon("chev", "i chev")}</button>
        <button class="item" id="dict">${icon("search")}<div class="grow"><div class="t">Словарь</div><div class="s">${P.words.size.toLocaleString("ru-RU")} слов HSK 1–6</div></div>${icon("chev", "i chev")}</button>
      </div>

      <div class="label">Уровень</div>
      <div class="list" style="margin-top:0;padding:4px 16px">
        ${LEVELS.map(lv => { const k = known(lv), sz = size(lv), p = Math.min(100, Math.round(k / sz * 100));
          return `<div class="level-row ${lv === S.l ? "cur" : ""}"><b>HSK ${lv}</b><div class="line"><i style="width:${p}%"></i></div><span class="n">${lv < S.l ? "пройден" : `${k} / ${sz}`}</span></div>`; }).join("")}
        <div class="level-row"><b>7–9</b><span class="small muted">разговор с Лао Ваном</span><span></span></div>
      </div>

      <div class="list">
        <button class="item" id="lvl">${icon("target")}<div class="grow"><div class="t">Проверить уровень</div><div class="s">Тест от HSK 1 до HSK 6, 5 минут</div></div>${icon("chev", "i chev")}</button>
        ${S.ok ? `<div class="item">${icon("card")}<div class="grow"><div class="t">Доступ</div><div class="s">${S.a ? "до " + fmtDate(S.a) : "активен"}</div></div></div>` : ""}
      </div>
      ${S.demo ? `<div class="foot">Демо-режим · откройте приложение кнопкой в боте</div>` : ""}
    `;
    const on = (id, fn) => { const el = document.getElementById(id); el && el.addEventListener("click", () => { haptic(); fn(); }); };
    const need = fn => () => S.ok ? fn() : toast("Нужна подписка");
    on("start", need(() => go(() => startLesson(S.l, S.d))));
    on("rev", need(() => due ? go(startReview) : toast("Новые слова появятся в повторении завтра")));
    on("talk", need(talkSheet));
    on("dict", () => go(dictionary));
    on("lvl", () => ask("Пройти тест на уровень в чате с ботом?", () => send({ t: "level" })));
    on("pay", () => send({ t: "pay" }));
  }

  // ---------- Лао Ван ----------
  function talkSheet() {
    let pick = S.tl || 0;
    const bg = document.createElement("div"); bg.className = "backdrop";
    const draw = () => {
      const b = (l, t, cls = "") => `<button data-l="${l}" class="${cls} ${pick === l ? "on" : ""}">${t}</button>`;
      bg.innerHTML = `<div class="sheet"><div class="grab"></div>
        <h2 style="font-size:22px">Лао Ван <span class="serif muted" style="font-weight:500">老王</span></h2>
        <p class="muted small" style="margin-top:4px">Хозяин чайной в Пекине. Понимает любую речь, а говорит на выбранном уровне. Можно писать или отправлять голосовые — ответит голосом.</p>
        <div class="label" style="margin:18px 0 0">Уровень разговора</div>
        <div class="seg">${b(0, "Как в программе", "wide")}${[1, 2, 3, 4, 5, 6].map(l => b(l, "HSK " + l)).join("")}${b(7, "HSK 7–9 · как носитель", "full")}</div>
        <button class="primary" id="go" style="margin-top:18px">Начать разговор</button>
        <p class="center muted small" style="margin-top:10px">Разговор продолжится в чате</p></div>`;
      bg.querySelectorAll("[data-l]").forEach(x => x.onclick = e => { e.stopPropagation(); pick = +x.dataset.l; haptic(); draw(); });
      bg.querySelector("#go").onclick = e => { e.stopPropagation(); send({ t: "talk", tl: pick }); };
    };
    draw(); bg.addEventListener("click", e => { if (e.target === bg) bg.remove(); }); document.body.appendChild(bg);
  }

  // ---------- урок и повторение ----------
  function startLesson(lv, d) {
    const l = lesson(lv, d);
    if (l.kind === "выходной") return restDay(l);
    const steps = []; let queue;
    if (l.kind === "тест") {
      queue = shuffle(weekWords(lv, l.week)).slice(0, 10);
    } else {
      const ws = lessonWords(lv, d);
      if (l.sounds) steps.push({ type: "note", eyebrow: "Перед началом", title: "Звуки и письмо", text: l.sounds });
      ws.forEach(w => steps.push({ type: "word", w }));
      if (l.grammar) steps.push({ type: "note", eyebrow: "Грамматика", title: l.topic, text: l.grammar, zh: true });
      queue = shuffle(ws.slice());
    }
    queue.forEach(w => steps.push({ type: "q", q: makeQuestion(w, Math.random() < .5 ? 0 : 1) }));
    run(steps, (sc, tot, m) => ({ t: "lesson", l: lv, d, sc, tot, m: m.slice(0, 40) }), l.kind === "тест" ? "Тест недели" : "Урок");
  }
  function restDay(l) {
    $app.innerHTML = `<div class="paper" style="margin-top:14vh"><div class="big zh">茶</div><div class="py">chá</div>
      <h2 style="margin-top:14px">День отдыха</h2><p class="muted" style="margin-top:6px">Без новых слов. Отметьте день, чтобы серия не прервалась.</p></div>
      <div class="actions"><button class="primary" id="ok">Отметить день</button></div>`;
    document.getElementById("ok").onclick = () => send({ t: "lesson", l: l.lv, d: l.day, sc: 0, tot: 0, m: [] });
  }
  function startReview() {
    const ws = shuffle((S.due || []).map(word).filter(Boolean));
    run(ws.map(w => ({ type: "q", q: makeQuestion(w, Math.random() < .5 ? 0 : 1) })), (sc, tot, m, r) => ({ t: "review", r }), "Повторение");
  }

  function run(steps, payload, label) {
    let i = 0, score = 0; const mistakes = [], results = [];
    const total = steps.filter(s => s.type === "q").length;
    const draw = () => {
      const s = steps[i]; if (!s) return finish();
      const head = `<div class="bar"><button class="x" id="x">${icon("close")}</button><div class="line"><i style="width:${Math.round(i / steps.length * 100)}%"></i></div><span class="step-count">${i + 1}/${steps.length}</span></div>`;
      if (s.type === "word") {
        const w = s.w;
        $app.innerHTML = head + `<div class="paper"><div class="eyebrow">Новое слово</div>
          <div class="big zh">${esc(w.h)}</div><div class="py">${esc(w.p)}</div><div class="ru">${esc(w.m)}</div>
          <button class="sound" id="say">${icon("sound")}Послушать</button>
          ${w.hint || w.ex ? `<div class="note">${w.hint ? esc(w.hint) : ""}${w.ex ? `<div style="margin-top:${w.hint ? 10 : 0}px"><span class="zh">${esc(w.ex)}</span><br><span class="small muted">${esc(w.ext)}</span></div>` : ""}</div>` : ""}
          </div><div class="actions"><button class="primary" id="next">Дальше</button></div>`;
        document.getElementById("say").onclick = () => speak(w.h);
      } else if (s.type === "note") {
        $app.innerHTML = head + `<div class="paper" style="text-align:left"><div class="eyebrow">${esc(s.eyebrow)}</div>
          <h2 style="margin:6px 0 14px;font-size:22px" class="${s.zh ? "zh" : ""}">${esc(s.title)}</h2><div class="grammar-text">${esc(s.text)}</div></div>
          <div class="actions"><button class="primary" id="next">${steps[i + 1] && steps[i + 1].type === "q" ? "К упражнениям" : "Дальше"}</button></div>`;
      } else {
        const q = s.q, w = q.w;
        $app.innerHTML = head + `<div class="paper">${q.dir === 0
            ? `<div class="q">Что значит</div><div class="q-hz zh">${esc(w.h)}</div><div class="py">${esc(w.p)}</div>`
            : `<div class="q">Как сказать по-китайски</div><div class="q-ru">${esc(w.m)}</div>`}</div>
          <div class="opts">${q.opts.map((o, k) => `<button class="opt ${q.dir ? "zh" : ""}" data-k="${k}"><span class="k">${"ABCD"[k]}</span><span>${esc(o)}</span></button>`).join("")}</div>
          <button class="skip" id="skip">Не знаю</button><div id="fb"></div>`;
        const answer = k => {
          const ok = k === q.correct;
          $app.querySelectorAll(".opt").forEach(x => { x.onclick = null; const kk = +x.dataset.k; x.classList.add(kk === q.correct ? "ok" : kk === k ? "bad" : "dim"); });
          document.getElementById("skip").remove();
          haptic(ok ? "success" : "error");
          if (ok) score++; else mistakes.push(w.h);
          results.push([w.h, ok ? 1 : 0]);
          document.getElementById("fb").innerHTML = `<div class="fb ${ok ? "ok" : "bad"}">${ok ? "Верно" : "Правильно"}: <span class="zh">${esc(w.h)}</span> · ${esc(w.p)} · ${esc(w.m)}</div>
            <div class="actions"><button class="primary" id="next">Дальше</button></div>`;
          document.getElementById("next").onclick = () => { i++; draw(); };
        };
        $app.querySelectorAll(".opt").forEach(b => b.onclick = () => answer(+b.dataset.k));
        document.getElementById("skip").onclick = () => answer(-1);
      }
      const nx = document.getElementById("next"); if (nx) nx.onclick = () => { haptic(); i++; draw(); };
      document.getElementById("x").onclick = () => ask("Выйти? Результат этого урока не сохранится.", toHome);
    };
    const finish = () => {
      const pct = total ? score / total : 1;
      const [ch, word_] = pct >= .9 ? ["优", "Отлично"] : pct >= .6 ? ["良", "Хорошо"] : ["练", "Нужно потренироваться"];
      $app.innerHTML = `<div class="paper" style="margin-top:9vh"><div class="stamp">${ch}</div>
        <div class="eyebrow">${esc(label)} завершён</div><h2 style="margin-top:6px">${word_}</h2>
        ${total ? `<div class="score"><b>${score} из ${total}</b>верных ответов</div>` : ""}
        ${mistakes.length ? `<div class="note">Вернутся в повторении: <span class="zh">${mistakes.map(esc).join("、")}</span></div>` : ""}</div>
        <div class="actions"><button class="primary" id="save">Сохранить результат</button></div>`;
      haptic("success");
      document.getElementById("save").onclick = () => send(payload(score, total, mistakes, results.slice(0, 60)));
    };
    draw();
  }

  // ---------- словарь ----------
  function dictionary() {
    $app.innerHTML = `${tg ? "" : `<button class="backlink" id="bk">${icon("back")}Назад</button>`}
      <h2 style="font-size:24px;margin-bottom:12px">Словарь</h2>
      <label class="search">${icon("search")}<input id="q" placeholder="Иероглиф, пиньинь или перевод" value="${esc(dictQuery)}" autocomplete="off"></label>
      <div class="tabs">${[0, ...LEVELS].map(l => `<button class="tab ${dictLevel === l ? "on" : ""}" data-l="${l}">${l ? "HSK " + l : "Все"}</button>`).join("")}</div>
      <div id="list"></div>`;
    const bk = document.getElementById("bk"); if (bk) bk.onclick = toHome;
    const input = document.getElementById("q");
    const plain = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s/g, "");
    const render = () => {
      const raw = dictQuery.trim(), q = plain(raw);
      let arr = dictLevel ? (byLevel[dictLevel] || []) : Array.from(P.words.values());
      if (raw) {
        // точные совпадения выше: иероглиф → пиньинь (с тонами, если их ввели) → перевод
        const low = raw.toLowerCase(), toned = /[\u0300-\u036f]/.test(raw.normalize("NFD"));
        const pyOf = w => toned ? w.p.toLowerCase().replace(/\s/g, "") : plain(w.p);
        const qq = toned ? low.replace(/\s/g, "") : q;
        const score = w => {
          const py = pyOf(w), variants = py.split("/");
          if (w.h === raw) return 0;
          if (variants.some(v => v === qq)) return 1;
          if (w.h.startsWith(raw)) return 2;
          if (variants.some(v => v.startsWith(qq))) return 3;
          if (w.m.toLowerCase().split(/[,;()\s]+/).includes(low)) return 4;
          if (w.h.includes(raw)) return 5;
          if (w.m.toLowerCase().includes(low)) return 6;
          if (qq.length >= 3 && py.includes(qq)) return 7;
          return 99;
        };
        arr = arr.map(w => [score(w), w]).filter(x => x[0] < 99).sort((a, b) => a[0] - b[0] || a[1].lv - b[1].lv).map(x => x[1]);
      }
      const shown = arr.slice(0, 120);
      document.getElementById("list").innerHTML = shown.map(w => `<button class="entry" data-h="${esc(w.h)}"><span class="h zh">${esc(w.h)}</span>
        <span><div class="p">${esc(w.p)}</div><div class="m">${esc(w.m)}</div></span><span class="lv">HSK ${w.lv}</span></button>`).join("")
        + (arr.length > shown.length ? `<p class="center muted small" style="padding:16px">Ещё ${arr.length - shown.length} — уточните поиск</p>` : "")
        + (!arr.length ? `<p class="center muted" style="padding:32px">Ничего не нашлось</p>` : "");
      document.querySelectorAll(".entry").forEach(el => el.onclick = () => wordSheet(word(el.dataset.h)));
    };
    input.oninput = () => { dictQuery = input.value; render(); };
    document.querySelectorAll(".tab").forEach(b => b.onclick = () => { dictLevel = +b.dataset.l; haptic(); dictionary(); });
    render();
  }
  function wordSheet(w) {
    const l = lesson(w.lv, w.day);
    const bg = document.createElement("div"); bg.className = "backdrop";
    bg.innerHTML = `<div class="sheet center"><div class="grab"></div><div class="big zh">${esc(w.h)}</div><div class="py">${esc(w.p)}</div>
      <div class="ru">${esc(w.m)}</div><button class="sound" id="say">${icon("sound")}Послушать</button>
      ${w.hint || w.ex ? `<div class="note">${esc(w.hint)}${w.ex ? `<div style="margin-top:8px"><span class="zh">${esc(w.ex)}</span><br><span class="small muted">${esc(w.ext)}</span></div>` : ""}</div>` : ""}
      <p class="muted small" style="margin-top:16px">HSK ${w.lv}${l ? ` · неделя ${l.week}, день ${l.day}` : ""}</p></div>`;
    bg.querySelector("#say").onclick = e => { e.stopPropagation(); speak(w.h); };
    bg.addEventListener("click", e => { if (e.target === bg) bg.remove(); }); document.body.appendChild(bg);
  }

  // ---------- старт ----------
  if (tg) {
    tg.ready(); tg.expand();
    document.documentElement.dataset.theme = tg.colorScheme === "dark" ? "dark" : "light";
    const bgc = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
    try { tg.setHeaderColor(bgc); tg.setBackgroundColor(bgc); } catch (e) {}
  }
  load().then(toHome).catch(e => { $app.innerHTML = `<div class="paper">Не удалось загрузить программу<p class="muted small">${esc(e.message)}</p></div>`; });
})();
