'use strict';
/* CronoLeitura v2 — PWA de cronometragem e estimativa de leitura.
 *
 * Convenção de páginas: a "página atual" é a página em que você ESTÁ. Ao tocar em
 * "Cheguei na página N+1", o tempo gasto na página N é registrado (você não precisa
 * ter concluído a página N+1, basta chegar nela). Progresso = páginas já concluídas.
 */

/* ======================= utilitários ======================= */
const KEY = 'cronoleitura_v2';
const OLD_KEY = 'cronoleitura_pwa_state_v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const pad = (n) => String(n).padStart(2, '0');
const nfmt = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const dateKey = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');

function fmtDur(sec, short) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return sec + ' s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return m + ' min' + (!short && s ? ' ' + pad(s) + ' s' : '');
  return Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min';
}
function fmtClock(ms) {
  const t = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
}
const fmtDate = (d) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A7.96 7.96 0 0 1 12.5 10c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 10.67 17.19 8 12.5 8z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l8-1.5V19L3 20.5zM13 4.5L21 6v14.5L13 19z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
  paste: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3h-4.2A3 3 0 0 0 12 1a3 3 0 0 0-2.8 2H5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm7 17H5V5h2v3h10V5h2z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>'
};

/* ======================= estado ======================= */
function idleTimer() {
  return { status: 'idle', bookId: null, sessionId: null, runStart: null, activeMs: 0, lastLapMs: 0, carryMs: 0, flushedMs: 0, startPage: 1, pomoStartMs: 0, pomoDone: false };
}
function defaults() {
  return { v: 2, activeBookId: null, settings: { paceBasis: 'all', keepAwake: true, pomoMin: 25, name: 'Professor Robert', fx: true, amazonApi: '', goal: { period: 'week', unit: 'min', value: 210 } }, books: [], daily: {}, log: [], timer: idleTimer() };
}
function newBook(o) {
  const total = Math.max(1, Math.round(+o.totalPages) || 1);
  return {
    id: uid('b'),
    title: (o.title || 'Sem título').trim(),
    author: (o.author || '').trim(),
    totalPages: total,
    currentPage: clamp(Math.round(+o.currentPage) || 1, 1, total),
    finished: false,
    dailyGoalMin: clamp(Math.round(+o.dailyGoalMin) || 30, 1, 720),
    cover: safeUrl(o.cover),
    isbn: o.isbn || '',
    publisher: (o.publisher || '').trim(),
    edition: (o.edition || '').trim(),
    year: o.year ? String(o.year) : '',
    source: o.source || 'manual',
    addedAt: Date.now(),
    segments: [],
    daily: {},
    timeSec: 0,
    carrySec: 0
  };
}
function normalize(p) {
  const d = defaults();
  const s = Object.assign(d, p);
  s.settings = Object.assign(defaults().settings, p.settings || {});
  s.timer = Object.assign(idleTimer(), p.timer || {});
  s.daily = p.daily || {};
  s.log = Array.isArray(p.log) ? p.log : [];
  if (!s.settings.goal || !s.settings.goal.period) s.settings.goal = defaults().settings.goal;
  s.books = (p.books || []).map((b) => Object.assign(newBook(b), b, { segments: b.segments || [], daily: b.daily || {}, timeSec: b.timeSec || 0 }));
  if (!s.books.some((b) => b.id === s.activeBookId)) s.activeBookId = s.books[0] ? s.books[0].id : null;
  if (s.timer.status !== 'idle' && !s.books.some((b) => b.id === s.timer.bookId)) s.timer = idleTimer();
  return s;
}
function migrateV1(s) {
  const raw = localStorage.getItem(OLD_KEY);
  if (!raw) return;
  const o = JSON.parse(raw);
  if (!o || !Array.isArray(o.books)) return;
  o.books.forEach((ob) => {
    const sess = Array.isArray(ob.sessions) ? ob.sessions : [];
    if (!sess.length && /Livro Exemplo/.test(ob.title || '')) return;
    const total = Math.max(1, Math.round(ob.totalPages) || 1);
    const b = newBook({ title: ob.title, totalPages: total, currentPage: Math.floor(+ob.currentPage || 0) + 1, dailyGoalMin: ob.dailyGoalMinutes || 30 });
    sess.slice().reverse().forEach((x) => {
      if (x.durationSec > 0 && x.pagesRead > 0) {
        b.segments.push({ id: uid('g'), ts: Date.parse(x.timestamp) || Date.now(), pages: x.pagesRead, sec: x.durationSec, sessionId: x.id || uid('s'), page: 0 });
      }
    });
    b.timeSec = b.segments.reduce((a, g) => a + g.sec, 0);
    s.books.push(b);
  });
  if (s.books.length) s.activeBookId = s.books[0].id;
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.v === 2 && Array.isArray(p.books)) return normalize(p);
    }
  } catch (e) { /* segue para o estado padrão */ }
  const s = defaults();
  try { migrateV1(s); } catch (e) { /* ignora dados antigos corrompidos */ }
  return s;
}
let S = load();
let saveWarned = false;
function save() {
  try {
    S.timer.hb = Date.now();
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) {
    if (!saveWarned) { saveWarned = true; toast('Não foi possível salvar os dados neste navegador.'); }
  }
}
const bookById = (id) => S.books.find((b) => b.id === id) || null;
const activeBook = () => bookById(S.activeBookId);

/* ======================= cronômetro ======================= */
const activeNow = () => S.timer.activeMs + (S.timer.status === 'running' ? Date.now() - S.timer.runStart : 0);
const pageElapsedMs = () => Math.max(0, activeNow() - S.timer.lastLapMs) + S.timer.carryMs;
const unflushedSec = () => (S.timer.status === 'idle' ? 0 : Math.max(0, (activeNow() - S.timer.flushedMs) / 1000));
function sessionMine(b) { return !!b && S.timer.status !== 'idle' && S.timer.bookId === b.id; }
function pageElapsedSec(b) { return sessionMine(b) ? pageElapsedMs() / 1000 : (b && b.carrySec) || 0; }
function bookTodaySec(b) { return (b.daily[dateKey()] || 0) + (sessionMine(b) ? unflushedSec() : 0); }

/* grava o tempo ativo ainda não contabilizado (total do livro e do dia) */
function flush() {
  const t = S.timer;
  if (t.status === 'idle') return;
  const now = activeNow();
  const delta = (now - t.flushedMs) / 1000;
  if (delta <= 0) return;
  const b = bookById(t.bookId);
  const d = dateKey();
  if (b) { b.timeSec = (b.timeSec || 0) + delta; b.daily[d] = (b.daily[d] || 0) + delta; }
  S.daily[d] = (S.daily[d] || 0) + delta;
  t.flushedMs = now;
}

let wake = null;
async function acquireWake() {
  if (!S.settings.keepAwake || !('wakeLock' in navigator) || wake) return;
  try {
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => { wake = null; });
  } catch (e) { wake = null; }
}
function releaseWake() {
  try { if (wake) wake.release(); } catch (e) { /* nada */ }
  wake = null;
}

function startReading() {
  const b = activeBook();
  if (!b || b.finished) return;
  const t = S.timer;
  if (t.status === 'running') return;
  unlockAudio();
  if (t.status === 'paused' && t.bookId === b.id) {
    if (t.pomoDone) { t.pomoStartMs = t.activeMs; t.pomoDone = false; } // novo ciclo
    t.status = 'running';
    t.runStart = Date.now();
  } else if (t.status !== 'idle') {
    toast('Encerre a leitura em andamento antes de começar outra.');
    return;
  } else {
    S.timer = Object.assign(idleTimer(), {
      status: 'running', bookId: b.id, sessionId: uid('s'), runStart: Date.now(), startedAt: Date.now(),
      carryMs: (b.carrySec || 0) * 1000, startPage: b.currentPage
    });
  }
  acquireWake();
  save();
  renderRead();
}
function pauseReading() {
  const t = S.timer;
  if (t.status !== 'running') return;
  t.activeMs += Date.now() - t.runStart;
  t.runStart = null;
  t.status = 'paused';
  flush();
  releaseWake();
  save();
  renderRead();
}
/* encerra a sessão guardando o que sobrou da página atual para a próxima vez */
function endSession(finishedBook) {
  const t = S.timer;
  const b = bookById(t.bookId);
  const carry = pageElapsedMs() / 1000; // calcular ANTES de fechar o intervalo em andamento
  if (t.status === 'running') { t.activeMs += Date.now() - t.runStart; t.runStart = null; t.status = 'paused'; }
  const totalSec = t.activeMs / 1000;
  const pages = b ? b.segments.filter((g) => g.sessionId === t.sessionId).reduce((a, g) => a + g.pages, 0) : 0;
  flush();
  if (b) b.carrySec = finishedBook ? 0 : Math.round(carry * 10) / 10;
  if (b && totalSec >= 5) {
    // registro da sessão para o monitor de hábitos (início, fim, tempo ativo, páginas, livro)
    S.log.push({ id: t.sessionId, bookId: b.id, start: t.startedAt || Date.now() - totalSec * 1000, end: Date.now(), sec: Math.round(totalSec), pages });
    if (S.log.length > 6000) S.log.splice(0, S.log.length - 6000);
  }
  S.timer = idleTimer();
  releaseWake();
  save();
  return { pages, totalSec };
}
function stopReading() {
  if (S.timer.status === 'idle') return;
  const r = endSession(false);
  renderRead();
  toast(r.pages > 0 ? 'Sessão encerrada: ' + nfmt(r.pages) + (r.pages === 1 ? ' página' : ' páginas') + ' em ' + fmtDur(r.totalSec) + '.' : 'Sessão encerrada.');
}

let lastLapAt = 0;
function lap() {
  const t = S.timer;
  const b = bookById(t.bookId);
  if (!b || t.status !== 'running') return;
  if (Date.now() - lastLapAt < 700) return; // evita toque duplo acidental
  lastLapAt = Date.now();
  const before = bookPace(b);
  const nowActive = activeNow();
  const sec = Math.max(0, nowActive - t.lastLapMs + t.carryMs) / 1000;
  flush();
  const seg = { id: uid('g'), ts: Date.now(), pages: 1, sec: Math.round(sec * 100) / 100, sessionId: t.sessionId, page: b.currentPage };
  b.segments.push(seg);
  t.lastLapMs = nowActive;
  t.carryMs = 0;
  b.carrySec = 0;
  if (b.currentPage >= b.totalPages) {
    b.finished = true;
    b.finishedAt = Date.now();
    endSession(true);
    renderRead();
    toast('Livro concluído! Tempo total: ' + fmtDur(b.timeSec) + '.');
    return;
  }
  b.currentPage += 1;
  save();
  renderRead();
  if (before && before.src === 'book' && before.pages >= 5 && sec > Math.max(180, before.spp * 5)) {
    toast('Essa página levou ' + fmtDur(sec) + '. Esqueceu de pausar?', {
      label: 'Não contar no ritmo',
      fn: () => { seg.excluded = true; save(); renderRead(); }
    });
  }
}
function undoLap() {
  const t = S.timer;
  const b = bookById(t.bookId);
  if (!b || t.status === 'idle') return;
  const last = b.segments[b.segments.length - 1];
  if (!last || last.sessionId !== t.sessionId) { toast('Nada para desfazer nesta sessão.'); return; }
  b.segments.pop();
  b.currentPage = last.page > 0 ? last.page : Math.max(1, b.currentPage - last.pages);
  t.carryMs = last.sec * 1000; // o tempo da página volta a contar de onde estava
  save();
  renderRead();
  toast('Voltou para a página ' + b.currentPage + '.');
}
function jumpTo(q) {
  const b = activeBook();
  if (!b || !sessionMine(b)) return;
  q = clamp(Math.round(q) || 0, 1, b.totalPages);
  const t = S.timer;
  if (q === b.currentPage) return;
  if (q < b.currentPage) {
    b.currentPage = q;
    t.lastLapMs = activeNow();
    t.carryMs = 0;
    save(); renderRead();
    toast('Página ajustada para ' + q + ' (sem registrar tempo).');
    return;
  }
  const pages = q - b.currentPage;
  const nowActive = activeNow();
  const sec = Math.max(0, nowActive - t.lastLapMs + t.carryMs) / 1000;
  flush();
  b.segments.push({ id: uid('g'), ts: Date.now(), pages, sec: Math.round(sec * 100) / 100, sessionId: t.sessionId, page: b.currentPage });
  t.lastLapMs = nowActive;
  t.carryMs = 0;
  b.carrySec = 0;
  b.currentPage = q;
  save(); renderRead();
}

/* ======================= ritmo e estimativas ======================= */
const allSegs = (b) => b.segments.filter((g) => !g.excluded && g.pages > 0 && g.sec > 0);
function paceOf(list, basis) {
  if (!list.length) return null;
  let p = 0;
  let s = 0;
  if (basis === 'recent') {
    for (let i = list.length - 1; i >= 0 && p < 30; i--) { p += list[i].pages; s += list[i].sec; }
  } else {
    list.forEach((g) => { p += g.pages; s += g.sec; });
  }
  return p > 0 ? { spp: s / p, pages: p } : null;
}
function bookPace(b) {
  const own = paceOf(allSegs(b), S.settings.paceBasis);
  if (own) return Object.assign({ src: 'book' }, own);
  const all = S.books.flatMap(allSegs).sort((a, c) => a.ts - c.ts);
  const g = paceOf(all, S.settings.paceBasis);
  return g ? Object.assign({ src: 'global' }, g) : null;
}
/* tempo restante = (páginas restantes − a atual) × ritmo + o que falta da página atual */
function estimate(b, pace, pageSec) {
  if (!pace || b.finished) return null;
  const rem = b.totalPages - b.currentPage + 1;
  const remSec = Math.max(0, (rem - 1) * pace.spp + Math.max(0, pace.spp - pageSec));
  const goal = b.dailyGoalMin * 60;
  const left = Math.max(0, goal - bookTodaySec(b));
  const daysAfter = remSec > left ? Math.ceil((remSec - left) / goal) : 0;
  const date = new Date();
  date.setDate(date.getDate() + daysAfter);
  return { rem, remSec, daysAfter, date, readDays: Math.max(1, Math.ceil(remSec / goal)) };
}
let ctx = { pace: null };

/* ======================= navegação ======================= */
let curTab = 'read';
function showTab(name) {
  curTab = name;
  ['read', 'books', 'habits', 'stats'].forEach((t) => $('#view-' + t).classList.toggle('hidden', t !== name));
  $$('.tabbar button').forEach((b) => (b.dataset.tab === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  renderCurrent();
  window.scrollTo(0, 0);
}
function renderCurrent() {
  if (curTab === 'read') renderRead();
  else if (curTab === 'books') renderBooks();
  else if (curTab === 'habits') renderHabits();
  else renderStats();
}
function setActive(id) {
  if (S.timer.status !== 'idle' && S.timer.bookId !== id) { toast('Encerre a leitura em andamento para trocar de livro.'); return false; }
  S.activeBookId = id;
  save();
  return true;
}

/* ======================= tela: Ler ======================= */
const edLine = (b) => [b.publisher, b.edition, b.year].filter(Boolean).join(' · ');
function coverHtml(url, cls) {
  const u = /^blob:/.test(String(url || '')) ? url : safeUrl(url);
  return '<div class="cover ' + (cls || '') + '">' +
    (u ? '<img class="cover-img" src="' + esc(u) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : ICON.book) + '</div>';
}
function renderRead() {
  const el = $('#view-read');
  const b = activeBook();
  if (!b) {
    el.innerHTML = greetingHtml() + '<div class="card empty"><h2>Nenhum livro ainda</h2>' +
      '<p>Busque um livro na internet para preencher título e número de páginas automaticamente.</p>' +
      '<button class="btn primary" type="button" data-act="tab" data-tab="books">' + ICON.search + ' Buscar meu primeiro livro</button></div>';
    return;
  }
  ctx.pace = bookPace(b);
  const t = S.timer;
  const mine = sessionMine(b);
  const state = mine ? t.status : 'idle';
  const done = b.finished ? b.totalPages : b.currentPage - 1;
  const pct = clamp((done / b.totalPages) * 100, 0, 100);
  const rem = b.finished ? 0 : b.totalPages - b.currentPage + 1;
  const lastPage = b.currentPage >= b.totalPages;

  let actions = '';
  if (b.finished) {
    actions = '<div class="finished-banner">Livro concluído! Tempo total de leitura: ' + esc(fmtDur(b.timeSec)) + '</div>';
  } else if (state === 'idle') {
    actions = pomoButton('start', ICON.play + ' Começar a ler (página ' + b.currentPage + ')', 'xl');
  } else if (state === 'running') {
    actions =
      pomoButton('lap', lastPage ? ICON.check + ' Terminei o livro' : 'Cheguei na página ' + (b.currentPage + 1), 'xxl') +
      '<div class="btn-row"><button class="btn" type="button" data-act="pause">' + ICON.pause + ' Pausar</button>' +
      '<button class="btn" type="button" data-act="stop">' + ICON.stop + ' Encerrar</button></div>' +
      '<div class="btn-row"><button class="btn ghost sm" type="button" data-act="undo">' + ICON.undo + ' Desfazer</button>' +
      '<button class="btn ghost sm" type="button" data-act="jump">Ir para a página…</button></div>';
  } else {
    actions =
      pomoButton('start', ICON.play + ' Continuar a leitura', 'xl') +
      '<div class="btn-row"><button class="btn" type="button" data-act="stop">' + ICON.stop + ' Encerrar</button>' +
      '<button class="btn ghost" type="button" data-act="undo">' + ICON.undo + ' Desfazer</button></div>';
  }

  const label = b.finished ? 'Leitura concluída'
    : state === 'running' ? 'Lendo a página ' + b.currentPage
    : state === 'paused' ? 'Pausado na página ' + b.currentPage
    : 'Pronto para começar na página ' + b.currentPage;

  const select = S.books.length > 1
    ? '<div class="switch"><label for="bookSwitch">Livro</label><select id="bookSwitch" data-change="switch"' + (t.status !== 'idle' ? ' disabled' : '') + '>' +
      S.books.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === b.id ? ' selected' : '') + '>' + esc(x.title) + '</option>').join('') + '</select></div>'
    : '';

  el.innerHTML = greetingHtml() +
    '<div class="card">' +
      '<div class="book-hero">' + coverHtml(coverSrc(b)) +
        '<div class="hero-info"><h2>' + esc(b.title) + '</h2><p class="muted">' + esc(b.author || 'Autor não informado') + '</p>' +
        (edLine(b) ? '<p class="muted ed-line">' + esc(edLine(b)) + '</p>' : '') +
        '<div class="pageline">Página <strong>' + b.currentPage + '</strong> de ' + b.totalPages + '</div></div></div>' +
      '<div class="progress" role="progressbar" aria-label="Progresso do livro" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><div style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '<div class="progress-meta"><span>' + pct.toFixed(1).replace('.', ',') + '% concluído</span><span>Faltam ' + rem + (rem === 1 ? ' página' : ' páginas') + '</span></div>' +
      select +
    '</div>' +
    '<div class="card timer-card" data-state="' + state + '">' +
      '<div class="timer-label">' + esc(label) + '</div>' +
      '<div class="timer-clock" id="tClock" aria-live="off">00:00</div>' +
      (mine ? '<div class="timer-sub"><span>Sessão <b id="tSession">00:00</b></span><span>Páginas <b id="tPages">0</b></span></div>' : '<div class="timer-sub">tempo na página atual</div>') +
      '<div class="timer-actions">' + actions + '</div>' +
      (b.finished ? '' : pomoSelectHtml()) +
    '</div>' +
    '<div class="card">' +
      '<div class="metrics">' +
        '<div class="metric hl"><span class="m-label">Falta para terminar</span><strong id="mRem">—</strong><span class="m-sub" id="mRemSub"></span></div>' +
        '<div class="metric"><span class="m-label">Previsão de término</span><strong id="mDate">—</strong><span class="m-sub" id="mDateSub"></span></div>' +
        '<div class="metric"><span class="m-label">Seu ritmo</span><strong id="mPace">—</strong><span class="m-sub" id="mPaceSub"></span></div>' +
        '<div class="metric" style="grid-column:1/-1"><span class="m-label">Hoje neste livro</span><strong id="mToday">0 / ' + b.dailyGoalMin + ' min</strong><div class="today-bar"><div id="mTodayBar"></div></div></div>' +
      '</div>' +
      '<div class="goal-row"><label for="dailyMin">Quanto tempo vou ler por dia (minutos)</label>' +
        '<div class="stepper"><button class="btn" type="button" data-act="goalDec" aria-label="Diminuir 5 minutos">−</button>' +
        '<input id="dailyMin" type="number" inputmode="numeric" min="1" max="720" value="' + b.dailyGoalMin + '" data-change="goal">' +
        '<button class="btn" type="button" data-act="goalInc" aria-label="Aumentar 5 minutos">+</button></div></div>' +
      '<p class="note" id="mNote"></p>' +
    '</div>';
  updateClock();
  fillMetrics();
}
function setText(sel, txt) { const e = $(sel); if (e && e.textContent !== txt) e.textContent = txt; } // só toca no DOM se mudou
function updateClock() {
  const b = activeBook();
  if (!b || !$('#tClock')) return;
  setText('#tClock', fmtClock(pageElapsedSec(b) * 1000));
  if (sessionMine(b)) {
    setText('#tSession', fmtClock(activeNow()));
    setText('#tPages', nfmt(b.currentPage - S.timer.startPage));
  }
}
function fillMetrics() {
  const b = activeBook();
  if (!b || !$('#mRem')) return;
  const pace = ctx.pace;
  const est = estimate(b, pace, pageElapsedSec(b));
  const todaySec = bookTodaySec(b);
  const goal = b.dailyGoalMin * 60;
  setText('#mToday', Math.floor(todaySec / 60) + ' / ' + b.dailyGoalMin + ' min');
  const bar = $('#mTodayBar');
  const w = clamp((todaySec / goal) * 100, 0, 100).toFixed(1) + '%';
  if (bar && bar.style.width !== w) bar.style.width = w;
  if (b.finished) {
    setText('#mRem', 'Concluído'); setText('#mRemSub', 'Tempo total: ' + fmtDur(b.timeSec));
    setText('#mDate', '—'); setText('#mDateSub', '');
  } else if (!est) {
    setText('#mRem', '—'); setText('#mRemSub', 'Cronometre algumas páginas para calcular');
    setText('#mDate', '—'); setText('#mDateSub', '');
  } else {
    setText('#mRem', fmtDur(est.remSec, true));
    setText('#mRemSub', est.rem + (est.rem === 1 ? ' página restante' : ' páginas restantes'));
    setText('#mDate', est.daysAfter === 0 ? 'Hoje' : fmtDate(est.date));
    setText('#mDateSub', '≈ ' + est.readDays + (est.readDays === 1 ? ' dia' : ' dias') + ' de leitura · ' + b.dailyGoalMin + ' min/dia');
  }
  if (pace) {
    setText('#mPace', fmtDur(pace.spp) + '/pág');
    setText('#mPaceSub', nfmt(3600 / pace.spp) + ' págs/h');
    const basis = S.settings.paceBasis === 'recent' ? ' recentes' : '';
    setText('#mNote', 'Baseado em ' + nfmt(pace.pages) + ' págs.' + basis + ' medidas ' +
      (pace.src === 'book' ? 'neste livro.' : 'em outros livros — fica mais preciso conforme você lê este.') +
      ' A estimativa se atualiza a cada página e supõe leitura todos os dias.');
  } else {
    setText('#mPace', '—'); setText('#mPaceSub', '');
    setText('#mNote', 'Toque em “Começar a ler” e marque “Cheguei na página…” a cada virada de página. O cálculo aparece a partir da primeira página medida.');
  }
}
function tick() {
  if (S.timer.status !== 'running') return;
  checkPomo();
  if (curTab === 'read' && document.visibilityState === 'visible' && !document.hidden) {
    updateClock(); fillMetrics(); updatePomo();
    setText('#helloToday', Math.floor(((S.daily[dateKey()] || 0) + unflushedSec()) / 60) + ' min');
  }
  if (Date.now() - tick.last > 15000) { flush(); save(); tick.last = Date.now(); }
}
tick.last = Date.now();

/* ======================= pomodoro e saudação =======================
 * O pomodoro conta só o tempo ATIVO de leitura (pausa congela). Fica vermelho enquanto
 * corre e verde ao terminar; ao continuar depois de uma pausa, começa um novo ciclo.
 */
const pomoTotalMs = () => (+S.settings.pomoMin || 0) * 60000;
function pomoInfo() {
  const tot = pomoTotalMs();
  if (!tot || S.timer.status === 'idle') return null;
  const el = Math.max(0, activeNow() - S.timer.pomoStartMs);
  return { tot, el, rem: Math.max(0, tot - el), p: clamp(el / tot, 0, 1), done: S.timer.pomoDone || el >= tot };
}
function pomoButton(act, label, size) {
  const tot = pomoTotalMs();
  if (!tot) return '<button class="btn primary ' + size + '" type="button" data-act="' + act + '">' + label + '</button>';
  const info = pomoInfo();
  const state = !info ? 'ready' : info.done ? 'done' : 'run';
  const time = state === 'done' ? ICON.check + ' Pomodoro concluído'
    : '<span class="tomato" aria-hidden="true"></span>' + fmtClock(info ? info.rem : tot);
  return '<button class="btn pomo ' + size + '" type="button" data-act="' + act + '" data-pomo="' + state + '" style="--p:' + (info ? info.p : 0).toFixed(4) + '">' +
    '<span class="pomo-fill" aria-hidden="true"></span><span class="pomo-label">' + label + '</span>' +
    '<span class="pomo-time" id="pomoTime" aria-label="Pomodoro">' + time + '</span></button>';
}
function pomoSelectHtml() {
  const cur = +S.settings.pomoMin || 0;
  const opts = [0, 10, 15, 20, 25, 30, 45, 50, 60, 90];
  if (!opts.includes(cur)) opts.push(cur);
  return '<div class="pomo-row"><label for="pomoMin">Pomodoro</label><select id="pomoMin" data-change="pomo">' +
    opts.sort((a, b) => a - b).map((m) => '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + (m ? m + ' min' : 'Desligado') + '</option>').join('') +
    '</select></div>';
}
function updatePomo() {
  const btn = $('[data-pomo]');
  const info = pomoInfo();
  if (!btn || !info) return;
  const pv = info.p.toFixed(3);
  if (btn.style.getPropertyValue('--p') !== pv) btn.style.setProperty('--p', pv);
  const t = $('#pomoTime');
  const txt = fmtClock(info.rem);
  if (t && !info.done && t.lastChild.textContent !== txt) t.lastChild.textContent = txt;
}
function checkPomo() {
  const info = pomoInfo();
  if (!info || S.timer.pomoDone || info.el < info.tot) return;
  S.timer.pomoDone = true;
  save();
  if (curTab === 'read') renderRead();
  pomoAlarm();
  toast('Pomodoro concluído! Que tal uma pausa de 5 minutos?', { label: 'Pausar', fn: pauseReading });
}
let audioCtx = null;
function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { audioCtx = null; }
}
function pomoAlarm() {
  try { if (navigator.vibrate) navigator.vibrate([220, 120, 220, 120, 480]); } catch (e) { /* opcional */ }
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    [0, 0.28, 0.56].forEach((d, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.24);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.26);
    });
  } catch (e) { /* sem som */ }
}
function greetingHtml() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const name = String(S.settings.name || '').trim();
  const todayMin = Math.floor(((S.daily[dateKey()] || 0) + unflushedSec()) / 60);
  return '<div class="hello"><h1 class="hello-title"><span class="led-text">Olá' + (name ? ', ' + esc(name) : '') + '</span></h1>' +
    '<p>' + part + ' · hoje você já leu <b id="helloToday">' + todayMin + ' min</b></p>' + goalLineHtml() + '</div>';
}

/* ======================= busca online =======================
 * Fontes: Google Livros (3 consultas: português por relevância, português mais recentes,
 * todos os idiomas), Open Library (prefere a edição em português) e BrasilAPI/ISBN
 * (base brasileira: CBL, Mercado Editorial) para ISBN digitado e para completar páginas.
 * Ordenação: edição em português > ISBN brasileiro (978-85 / 978-65) > tem nº de páginas
 * > mais recente. Edições da mesma obra ficam agrupadas.
 */
async function fetchJSON(url, ms) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms || 7000);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) {
      let data = null;
      try { data = await r.json(); } catch (e) { /* sem corpo */ }
      const err = new Error((data && data.error) || 'HTTP ' + r.status);
      err.status = r.status; err.data = data;
      throw err;
    }
    return await r.json();
  } finally { clearTimeout(timer); }
}
const isbnOf = (q) => { const c = q.replace(/[\s-]/g, ''); return /^(\d{9}[\dXx]|\d{13})$/.test(c) ? c.toUpperCase() : ''; };
const cleanIsbn = (i) => String(i || '').replace(/[^0-9X]/gi, '').toUpperCase();
const isBrIsbn = (i) => /^978(85|65)/.test(cleanIsbn(i));
const isPt = (l) => /^(pt|por)/i.test(String(l || ''));
const yearOf = (s) => { const m = String(s || '').match(/\d{4}/); return m ? +m[0] : 0; };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'um', 'uma', 'no', 'na', 'para', 'por', 'com', 'the', 'of', 'and', 'to', 'in', 'livro', 'vol']);
/* reconhece o que foi colado/compartilhado: ISBN, link da Amazon (/dp/ISBN-10), link do Google Livros */
function isbn10to13(i10) {
  const core = '978' + i10.slice(0, 9);
  let sum = 0;
  for (let k = 0; k < 12; k++) sum += (+core[k]) * (k % 2 ? 3 : 1);
  return core + ((10 - (sum % 10)) % 10);
}
function parseBookRef(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const direct = isbnOf(t);
  if (direct) return { isbn: direct.length === 10 ? isbn10to13(direct) : direct };
  const amz = t.match(/amazon\.[a-z.]+\/(?:[^\s?#]*\/)?(?:dp|gp\/product|gp\/aw\/d|o\/ASIN|exec\/obidos\/ASIN)\/([0-9]{9}[0-9Xx])\b/i);
  if (amz) return { isbn: isbn10to13(amz[1].toUpperCase()), from: 'Amazon' };
  const gb = t.match(/books\.google\.[a-z.]+\/books[^\s]*[?&]id=([\w-]{10,14})/i) || t.match(/google\.[a-z.]+\/books\/edition\/[^\/\s]*\/([\w-]{10,14})/i);
  if (gb) return { gid: gb[1], from: 'Google Livros' };
  const any13 = t.replace(/[\s-]/g, '').match(/97[89]\d{10}/);
  if (any13) return { isbn: any13[0] };
  return null;
}
/* texto compartilhado por outro app ("Confira este produto: Título ... https://...") vira termo de busca */
function cleanShared(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*(confira|veja|olha|check out|look at)[^:]*:\s*/i, '')
    .split(/\s[|–—]\s|\s-\sAmazon|:\s/)[0]
    .replace(/\s+/g, ' ').trim().slice(0, 120);
}
const fullTitle = (r) => (r.title || '') + (r.subtitle ? ': ' + r.subtitle : '');

function gMap(it) {
  const v = it.volumeInfo || {};
  const ids = v.industryIdentifiers || [];
  const i13 = ids.find((x) => x.type === 'ISBN_13');
  const i10 = ids.find((x) => x.type === 'ISBN_10');
  const img = v.imageLinks || {};
  return {
    src: 'Google Livros', title: v.title || '', subtitle: v.subtitle || '', author: (v.authors || []).join(', '),
    publisher: v.publisher || '', year: yearOf(v.publishedDate), pages: +v.pageCount || 0, lang: v.language || '',
    cover: safeUrl((img.thumbnail || img.smallThumbnail || '').replace(/^http:/, 'https:')),
    isbn: i13 ? i13.identifier : i10 ? i10.identifier : ''
  };
}
const G_FIELDS = 'title,subtitle,authors,publisher,publishedDate,pageCount,language,imageLinks(thumbnail,smallThumbnail),industryIdentifiers';
/* Google Livros: sem chave, a cota é dividida com o mundo todo e esgota (erro 429).
   Com a chave gratuita do usuário (Preferências) são ~1000 buscas/dia só dele. */
let gPausedUntil = 0;
const gKey = () => { const k = String(S.settings.gbKey || '').trim(); return /^[\w-]{20,60}$/.test(k) ? '&key=' + encodeURIComponent(k) : ''; };
function gFetch(url) {
  if (Date.now() < gPausedUntil) { const e = new Error('limite'); e.status = 429; return Promise.reject(e); }
  return fetchJSON(url + gKey()).catch((e) => {
    if (e.status === 429) gPausedUntil = Date.now() + 10 * 60000; // espera 10 min antes de tentar de novo
    throw e;
  });
}
function googleJobs(q) {
  const isbn = isbnOf(q);
  const base = 'https://www.googleapis.com/books/v1/volumes?printType=books&country=BR&fields=items(volumeInfo(' + G_FIELDS + '))&q=';
  const urls = isbn
    ? [base + encodeURIComponent('isbn:' + isbn)]
    : [base + encodeURIComponent(q) + '&langRestrict=pt&maxResults=40', base + encodeURIComponent('intitle:' + q) + '&maxResults=20'];
  return urls.map((u) => gFetch(u).then((j) => (j.items || []).map(gMap)));
}
async function googleById(id) {
  const j = await gFetch('https://www.googleapis.com/books/v1/volumes/' + encodeURIComponent(id) + '?fields=volumeInfo(' + G_FIELDS + ')');
  return gMap(j);
}
async function searchOpenLib(q) {
  const isbn = isbnOf(q);
  const url = 'https://openlibrary.org/search.json?q=' + encodeURIComponent(isbn ? 'isbn:' + isbn : q) +
    '&lang=pt&limit=15&fields=key,title,subtitle,author_name,first_publish_year,cover_i,isbn,language,' +
    'editions,editions.key,editions.title,editions.subtitle,editions.publish_date,editions.publisher,editions.isbn,editions.language,editions.cover_i,editions.number_of_pages_median';
  const j = await fetchJSON(url);
  return (j.docs || []).map((d) => {
    const e = d.editions && d.editions.docs && d.editions.docs[0];
    const pt = !!e && (e.language || []).some(isPt);
    const isbns = (pt ? e.isbn : d.isbn) || [];
    const isbnPick = isbns.find(isBrIsbn) || isbns.find((x) => x.length === 13) || isbns[0] || '';
    const cover = (pt && e.cover_i) || d.cover_i;
    return {
      src: 'Open Library', title: (pt ? e.title : d.title) || '', subtitle: (pt ? e.subtitle : d.subtitle) || '',
      author: (d.author_name || []).slice(0, 3).join(', '),
      publisher: pt && e.publisher ? e.publisher[0] : '',
      year: pt ? yearOf(e.publish_date && e.publish_date[0]) : d.first_publish_year || 0,
      // só usa páginas da própria edição em português (a mediana de outras edições engana)
      pages: pt ? +e.number_of_pages_median || 0 : 0,
      lang: pt ? 'pt' : (d.language || [])[0] || '',
      cover: cover ? 'https://covers.openlibrary.org/b/id/' + cover + '-M.jpg' : '',
      isbn: isbnPick
    };
  });
}
async function brasilIsbn(isbn) {
  const j = await fetchJSON('https://brasilapi.com.br/api/isbn/v1/' + cleanIsbn(isbn), 8000);
  return {
    src: 'ISBN Brasil', title: j.title || '', subtitle: j.subtitle || '', author: (j.authors || []).join(', '),
    publisher: j.publisher || '', year: +j.year || 0, pages: +j.page_count || 0, lang: 'pt',
    cover: safeUrl(j.cover_url || ''), isbn: j.isbn || cleanIsbn(isbn)
  };
}

const queryTokens = (q) => norm(q).split(' ').filter((t) => t.length > 1 && !STOP.has(t));
const lastName = (a) => norm(String(a || '').split(',')[0]).split(' ').pop() || '';
function scoreItem(r, toks, nq) {
  const hay = ' ' + norm([r.title, r.subtitle, r.author, r.publisher].join(' ')) + ' ';
  const hit = toks.filter((t) => hay.includes(' ' + t)).length;
  r.match = toks.length ? hit / toks.length : 1;
  r.br = isBrIsbn(r.isbn);
  r.pt = isPt(r.lang) || r.br;
  r.qs = r.match * 40 + (nq && norm(r.title).startsWith(nq) ? 12 : 0);
  r.score = rankScore(r);
  return r;
}
function rankScore(r) {
  let s = r.qs || 0;
  if (r.pt) s += 35;
  if (r.br) s += 20;
  if (r.pages > 0) s += 12;
  if (r.cover) s += 4;
  if (r.year) s += clamp((r.year - 1980) / 2, 0, 23);
  return s;
}
function resort(st) {
  st.items.forEach((r) => { r.score = rankScore(r); });
  [st.pt, st.other].forEach((gs) => {
    gs.forEach((g) => { g.eds.sort((a, b) => b.score - a.score); g.best = g.eds[0]; });
    gs.sort((a, b) => b.best.score - a.best.score);
  });
}
/* remove repetidos (mesmo ISBN), completa dados entre fontes e agrupa edições da mesma obra */
function organize(list, q, exact) {
  const isbnQ = !!exact || !!isbnOf(q);
  const toks = queryTokens(q);
  const nq = norm(q);
  const byKey = new Map();
  const items = [];
  list.forEach((r) => {
    if (!r || !r.title) return;
    const k = r.isbn ? 'i' + cleanIsbn(r.isbn) : 't' + norm(r.title) + '|' + norm(r.author) + '|' + r.year + '|' + r.pages;
    const prev = byKey.get(k);
    if (prev) {
      ['pages', 'cover', 'publisher', 'year', 'subtitle'].forEach((f) => { if (!prev[f] && r[f]) prev[f] = r[f]; });
      if (!prev.lang && r.lang) prev.lang = r.lang;
      return;
    }
    byKey.set(k, r);
    items.push(r);
  });
  let kept = items.filter((r) => { scoreItem(r, toks, nq); return isbnQ || !toks.length || r.match >= 0.5; });
  let loose = false;
  if (!kept.length && items.length) { kept = items.slice(); loose = true; } // ex.: Open Library achou pelo título original
  const groups = new Map();
  kept.forEach((r) => {
    const gk = norm(r.title.split(/[:(–—]| - /)[0]) + '|' + lastName(r.author) + '|' + (r.pt ? 'pt' : 'x');
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(r);
  });
  const all = Array.from(groups.values()).map((eds) => {
    eds.sort((a, b) => b.score - a.score);
    return { best: eds[0], eds };
  }).sort((a, b) => b.best.score - a.best.score);
  kept.forEach((r, i) => { r.i = i; });
  return { items: kept, pt: all.filter((g) => g.best.pt), other: all.filter((g) => !g.best.pt), loose };
}
function errText(e) {
  if (!e) return 'erro';
  if (e.name === 'AbortError') return 'demorou demais';
  if (e.status === 429) return 'limite atingido — cadastre sua chave grátis em Histórico › Google Livros';
  if (e.status === 404) return 'não encontrado';
  if (e.status) return 'erro ' + e.status;
  return 'sem acesso (rede ou bloqueio do navegador)';
}
function diagHtml(st) {
  if (!st.diag) return '';
  const parts = Object.keys(st.diag).map((n) => {
    const d = st.diag[n];
    return '<b>' + esc(n) + '</b>: ' + (d.ok ? d.found + (d.found === 1 ? ' resultado' : ' resultados') : esc(d.err || '…'));
  });
  return '<p class="diag">' + parts.join(' · ') + '</p>';
}
/* consulta as fontes e entrega resultados aos poucos: onPartial é chamado a cada fonte que responde */
function doSearch(q, onPartial) {
  const empty = (status) => ({ status, items: [], pt: [], other: [] });
  if (!navigator.onLine) return Promise.resolve(empty('offline'));
  const ref = parseBookRef(q);
  const effQ = ref && ref.isbn ? ref.isbn : q;
  let jobs;
  let names;
  if (ref && ref.gid) {
    jobs = [googleById(ref.gid).then(async (r) => {
      const out = [r];
      if (r.isbn) { try { out.push(await brasilIsbn(r.isbn)); } catch (e) { /* opcional */ } }
      return out;
    })];
    names = ['Google Livros'];
  } else {
    jobs = googleJobs(effQ);
    names = jobs.map(() => 'Google Livros');
    jobs.push(searchOpenLib(effQ)); names.push('Open Library');
    if (ref && ref.isbn) { jobs.push(brasilIsbn(ref.isbn).then((r) => [r])); names.push('ISBN Brasil'); }
  }
  const list = [];
  const diag = {};
  names.forEach((n) => { diag[n] = diag[n] || { found: 0, ok: 0, err: '' }; });
  let ok = 0;
  let pending = jobs.length;
  return new Promise((resolve) => {
    jobs.forEach((job, k) => {
      const d = diag[names[k]];
      job.then((v) => { ok++; d.ok++; d.found += v.length; list.push(...v); }, (e) => { d.err = d.err || errText(e); }).finally(() => {
        pending--;
        const out = organize(list.slice(), effQ, !!ref);
        out.ref = ref;
        out.diag = diag;
        if (pending === 0) {
          out.status = ok ? (out.items.length ? 'done' : 'empty') : 'error';
          resolve(out);
        } else if (out.items.length && onPartial) {
          out.status = 'partial';
          onPartial(out);
        }
      });
    });
  });
}
/* completa o nº de páginas de edições brasileiras pela BrasilAPI (em segundo plano) */
async function enrichPages(st, rerender) {
  const seq = st.seq;
  const todo = st.items.filter((r) => r.br && !(r.pages > 0)).slice(0, 6);
  if (!todo.length) return;
  const res = await Promise.allSettled(todo.map((r) => brasilIsbn(r.isbn)));
  if (seq !== st.seq) return;
  let changed = false;
  res.forEach((x, k) => {
    if (x.status !== 'fulfilled') return;
    const r = todo[k];
    if (x.value.pages > 0) { r.pages = x.value.pages; r.pagesSrc = 'ISBN Brasil'; changed = true; }
    if (!r.cover && x.value.cover) { r.cover = x.value.cover; changed = true; }
    if (!r.publisher && x.value.publisher) r.publisher = x.value.publisher;
  });
  if (changed) { resort(st); rerender(); }
}
const search = { q: '', status: 'idle', items: [], pt: [], other: [], seq: 0 };
const dlgSearch = { status: 'idle', items: [], pt: [], other: [], seq: 0 };

function edMeta(r) {
  return [r.publisher, r.year || '', r.pt ? 'Português' : r.lang ? r.lang.toUpperCase() : ''].filter(Boolean).map(esc).join(' · ');
}
function pagesHtml(r) {
  return r.pages > 0 ? '<span class="pg">' + r.pages + ' páginas</span>' : '<span class="muted">páginas não informadas</span>';
}
function resultCard(r, act) {
  return '<article class="result">' + coverHtml(r.cover, 'sm') +
    '<div class="bi-info"><h3>' + esc(fullTitle(r)) + '</h3><p>' + esc(r.author || 'Autor não informado') + '</p>' +
    '<p class="ed-meta">' + edMeta(r) + '</p>' +
    '<p>' + pagesHtml(r) + (r.br ? '<span class="tag br">Edição brasileira</span>' : '') + '<span class="src-tag">' + esc(r.pagesSrc || r.src) + '</span></p></div>' +
    '<div class="bi-actions"><button class="btn sm primary" type="button" data-act="' + act + '" data-i="' + r.i + '">' + (act === 'pick' ? 'Adicionar' : 'Usar') + '</button></div></article>';
}
function edRow(r, act) {
  return '<div class="ed-row"><div class="bi-info"><p class="ed-title">' + esc(fullTitle(r)) + '</p><p class="ed-meta">' + edMeta(r) + ' · ' + pagesHtml(r) + '</p></div>' +
    '<button class="btn sm" type="button" data-act="' + act + '" data-i="' + r.i + '">' + (act === 'pick' ? 'Adicionar' : 'Usar') + '</button></div>';
}
function groupHtml(g, act) {
  const more = g.eds.length - 1;
  return '<div class="group">' + resultCard(g.best, act) +
    (more > 0 ? '<details class="eds"><summary>Outras edições (' + more + ')</summary>' + g.eds.slice(1).map((r) => edRow(r, act)).join('') + '</details>' : '') + '</div>';
}
function resultsHtml(st, act) {
  if (st.status === 'loading') return '<div class="status-line"><div class="spinner"></div>Buscando edições em português…</div>';
  if (st.status === 'offline') return '<div class="status-line">Você está offline. A busca precisa de internet — use “Adicionar manualmente”.</div>';
  if (st.status === 'error') return '<div class="status-line">Não foi possível consultar os catálogos agora.</div>' + diagHtml(st);
  if (st.status === 'empty') return '<div class="status-line">Nenhum resultado. Tente o ISBN (verso do livro), o sobrenome do autor ou adicione manualmente.</div>' + diagHtml(st);
  if (st.status !== 'done' && st.status !== 'partial') return '';
  const more = st.status === 'partial' ? '<div class="status-line"><div class="spinner"></div>Buscando mais edições…</div>' : '';
  const pt = st.pt.slice(0, 12).map((g) => groupHtml(g, act)).join('');
  const other = st.other.slice(0, 10).map((g) => groupHtml(g, act)).join('');
  const looseNote = st.loose ? '<div class="status-line">Nenhum título com essas palavras; abaixo está o que as fontes encontraram (pode estar com o título original, em outro idioma).</div>' : '';
  return looseNote + (st.ref && st.ref.from ? '<div class="status-line ok-line">' + ICON.check + ' Edição identificada pelo link (' + esc(st.ref.from) + ').</div>' : '') +
    (pt || (st.status === 'done' ? '<div class="status-line">Nenhuma edição em português encontrada para esta busca.</div>' : '')) + more +
    (other ? '<details class="other"' + (pt ? '' : ' open') + '><summary>Edições em outros idiomas (' + st.other.length + ')</summary>' + other + '</details>' : '') + (st.status === 'done' ? diagHtml(st) : '');
}
async function runSearch(q) {
  q = q.trim();
  if (!q) return;
  if (amzApi()) { const ref = parseBookRef(q); runAmazon(ref && ref.isbn ? ref.isbn : q); }
  const seq = ++search.seq;
  Object.assign(search, { q, status: 'loading', items: [], pt: [], other: [] });
  const paint = () => { const box = $('#results'); if (box) box.innerHTML = resultsHtml(search, 'pick'); setText('#catCount', countTxt(search)); };
  paint();
  const res = await doSearch(q, (part) => { if (seq === search.seq) { Object.assign(search, part); paint(); } });
  if (seq !== search.seq) return;
  Object.assign(search, res);
  paint();
  enrichPages(search, paint);
}

/* texto/link vindo da área de transferência ou de "Compartilhar": link/ISBN busca a edição exata; senão, busca pelo título */
function useSharedText(text) {
  const link = (String(text).match(/https?:\/\/(?:www\.)?(?:amazon\.com(?:\.br)?|a\.co|amzn\.to|amzn\.com)\/\S+/i) || [''])[0];
  if (link && amzApi()) {
    if (curTab !== 'books') showTab('books');
    importAmazon(null, { url: link });
    return;
  }
  const ref = parseBookRef(text);
  const q = ref ? (ref.isbn || String(text).trim()) : cleanShared(text);
  if (!q) { toast('Não reconheci um livro nesse texto.'); return; }
  if (curTab !== 'books') showTab('books');
  const inp = $('#q');
  const shown = ref && ref.isbn ? ref.isbn : q;
  if (inp) inp.value = shown;
  runSearch(ref ? String(text).trim() : q); // o link original guarda a origem (Amazon/Google)
  search.q = shown;
}

/* ======================= Amazon (via seu servidor Cloudflare) =======================
 * O navegador não deixa um app ler páginas da Amazon diretamente; o servidor (servidor-amazon/worker.js)
 * lê e devolve os dados. Sem servidor configurado, o app usa só Google Livros, Open Library e BrasilAPI.
 */
const amz = { status: 'idle', items: [], error: '', blocked: false, seq: 0 };
let srcTab = String(S.settings.amazonApi || '').trim() ? 'amazon' : 'cat';
function amzApi() {
  const u = String(S.settings.amazonApi || '').trim().replace(/\/+$/, '');
  return /^https:\/\//i.test(u) ? u : '';
}
const countTxt = (st) => (st.status === 'done' || st.status === 'partial') && st.items.length ? '(' + st.items.length + ')' : '';
async function runAmazon(q) {
  const seq = ++amz.seq;
  Object.assign(amz, { status: 'loading', items: [], error: '', blocked: false });
  paintAmz();
  try {
    const j = await fetchJSON(amzApi() + '/search?q=' + encodeURIComponent(q), 15000);
    if (seq !== amz.seq) return;
    amz.items = (j.results || []).filter((r) => r && r.title && r.asin);
    amz.status = amz.items.length ? 'done' : 'empty';
  } catch (e) {
    if (seq !== amz.seq) return;
    amz.status = 'error';
    amz.blocked = !!(e.data && e.data.blocked);
    amz.error = e.message || '';
  }
  paintAmz();
}
function paintAmz() {
  const box = $('#amzResults');
  if (box) box.innerHTML = amzHtml();
  setText('#amzCount', countTxt(amz));
}
function amzHtml() {
  if (!amzApi()) {
    return '<div class="amz-setup"><p><b>Conecte a Amazon</b> para ver as capas dos livros da Amazon aqui e importar tudo com um toque.</p>' +
      '<button class="btn primary block" type="button" data-act="amzSetup">Configurar servidor Amazon</button></div>';
  }
  if (amz.status === 'loading') return '<div class="status-line"><div class="spinner"></div>Buscando na Amazon…</div>';
  if (amz.status === 'error') {
    return '<div class="status-line">' + (amz.blocked
      ? 'A Amazon pediu verificação agora (bloqueio temporário). Tente em alguns minutos ou use a aba “Google Livros e outros”.'
      : 'Não consegui falar com o servidor Amazon (' + esc(amz.error) + '). Confira o endereço em Histórico › Amazon.') + '</div>';
  }
  if (amz.status === 'empty') return '<div class="status-line">A Amazon não encontrou livros com esse termo.</div>';
  if (amz.status !== 'done') return '<div class="status-line muted">Digite o título ou autor e toque em Buscar.</div>';
  return '<p class="hint amz-tip">Toque na capa para importar capa, autor, editora, edição e páginas.</p><div class="amz-grid">' +
    amz.items.map((r, i) =>
      '<button class="amz-card" type="button" data-act="amzPick" data-i="' + i + '" aria-label="Importar ' + esc(r.title) + '">' +
        '<span class="amz-cover">' + (safeUrl(r.cover) ? '<img class="cover-img" src="' + esc(safeUrl(r.cover)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : ICON.book) +
        '<span class="amz-busy" aria-hidden="true"><span class="spinner"></span></span></span>' +
        '<span class="amz-title">' + esc(r.title) + '</span>' +
        '<span class="amz-meta">' + esc([r.author, r.year].filter(Boolean).join(' · ')) + '</span>' +
        (r.format ? '<span class="amz-fmt' + (/kindle|audio/i.test(r.format) ? ' digital' : '') + '">' + esc(r.format) + '</span>' : '') +
      '</button>').join('') + '</div>';
}
/* toque na capa (ou link colado/compartilhado): lê a página do produto e abre o cadastro preenchido */
let amzImporting = false;
async function importAmazon(base, ref, cardEl) {
  if (amzImporting) return;
  amzImporting = true;
  if (cardEl) cardEl.classList.add('busy');
  if (!cardEl) toast('Importando da Amazon…');
  let item = null;
  let err = null;
  try { item = await fetchJSON(amzApi() + '/item?' + (ref.asin ? 'asin=' + encodeURIComponent(ref.asin) : 'url=' + encodeURIComponent(ref.url)), 15000); }
  catch (e) { err = e; }
  const pre = Object.assign({}, base || {});
  if (item) Object.keys(item).forEach((k) => { if (item[k]) pre[k] = item[k]; });
  if (!(pre.pages > 0) && pre.isbn) {
    try { const b = await brasilIsbn(pre.isbn); if (b.pages > 0) { pre.pages = b.pages; pre.pagesSrc = 'ISBN Brasil'; } if (!pre.publisher && b.publisher) pre.publisher = b.publisher; } catch (e) { /* opcional */ }
  }
  amzImporting = false;
  if (cardEl) cardEl.classList.remove('busy');
  if (!pre.title) {
    toast(err && err.data && err.data.blocked ? 'A Amazon bloqueou a leitura agora. Tente em alguns minutos.' : 'Não consegui ler esse livro na Amazon.');
    return;
  }
  pre.src = 'Amazon';
  pre.source = 'amazon';
  openBookDialog(pre);
  if (!item) toast('Não consegui abrir a página do livro na Amazon; confira o número de páginas.');
}
function openAmzSetup() {
  openDialog('<div class="dlg-body"><h2 id="dlgTitle">Conectar a Amazon</h2>' +
    '<p class="muted">1. Crie uma conta grátis em <b>dash.cloudflare.com</b>.<br>2. Workers &amp; Pages › Create › Worker › nome <b>cronoleitura-amazon</b> › Deploy.<br>3. Edit code › apague tudo › cole o arquivo <b>servidor-amazon/worker.js</b> do zip › Deploy.<br>4. Copie o endereço <b>…workers.dev</b> e cole abaixo.</p>' +
    '<div class="field" style="margin-top:12px"><label for="dlgAmz">Endereço do servidor</label><input id="dlgAmz" type="url" inputmode="url" placeholder="https://cronoleitura-amazon.SEU-NOME.workers.dev" value="' + esc(S.settings.amazonApi || '') + '"></div>' +
    '<p class="note" id="dlgAmzStatus"></p>' +
    '<div class="dlg-actions"><button type="button" class="btn" data-act="closeDlg">Cancelar</button><button type="button" class="btn primary" data-act="amzSave">Testar e salvar</button></div></div>');
}
async function saveAmzApi() {
  const inp = $('#dlgAmz') || $('#prefAmz');
  const status = $('#dlgAmzStatus') || $('#amzStatus');
  let u = String((inp && inp.value) || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (!u) {
    S.settings.amazonApi = ''; save();
    if (status) status.textContent = 'Amazon desconectada.';
    return;
  }
  if (!/^https:\/\//i.test(u)) { if (status) status.textContent = 'O endereço precisa começar com https://'; return; }
  if (status) status.textContent = 'Testando…';
  try {
    const j = await fetchJSON(u + '/', 10000);
    if (!j || !j.ok) throw new Error('resposta inesperada');
    S.settings.amazonApi = u;
    save();
    srcTab = 'amazon';
    if (status) status.textContent = 'Conectado: ' + u;
    toast('Amazon conectada!');
    if ($('#dlgAmz')) { closeDialog(); renderCurrent(); }
  } catch (e) {
    if (status) status.textContent = 'Não consegui conectar (' + (e.message || 'erro') + '). Confira o endereço e se o worker foi publicado (Deploy).';
  }
}

/* ======================= capas: busca e armazenamento no celular =======================
 * A capa escolhida é reduzida (≈360 px, JPEG) e guardada no próprio aparelho (IndexedDB):
 * aparece offline e vai junto no backup. Se o site da imagem não permitir copiá-la, o app
 * guarda o link (e o service worker mantém uma cópia em cache para uso offline).
 */
const coverUrls = {};
let pendingCover = null; // capa escolhida no diálogo, aplicada ao salvar: { blob, url } ou { url }
const coverSrc = (b) => (b && b.coverLocal && coverUrls[b.id]) || (b && b.cover) || '';
const IDB = {};
function idbOpen() {
  if (IDB.p) return IDB.p;
  IDB.p = new Promise((res, rej) => {
    if (!('indexedDB' in window)) { rej(new Error('sem IndexedDB')); return; }
    const r = indexedDB.open('cronoleitura', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('covers');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return IDB.p;
}
async function idbReq(mode, fn) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('covers', mode);
    const rq = fn(tx.objectStore('covers'));
    tx.oncomplete = () => res(rq && rq.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
const idbPut = (k, v) => idbReq('readwrite', (st) => st.put(v, k));
const idbGet = (k) => idbReq('readonly', (st) => st.get(k));
const idbDel = (k) => idbReq('readwrite', (st) => st.delete(k));
const idbClear = () => idbReq('readwrite', (st) => st.clear());
async function loadCovers() {
  for (const b of S.books) {
    if (!b.coverLocal || coverUrls[b.id]) continue;
    try { const blob = await idbGet(b.id); if (blob) coverUrls[b.id] = URL.createObjectURL(blob); else b.coverLocal = false; } catch (e) { /* usa o link */ }
  }
}
function dropLocalCover(id) {
  if (coverUrls[id]) { URL.revokeObjectURL(coverUrls[id]); delete coverUrls[id]; }
  idbDel(id).catch(() => {});
}
function setLocalCover(b, blob) {
  if (coverUrls[b.id]) URL.revokeObjectURL(coverUrls[b.id]);
  coverUrls[b.id] = URL.createObjectURL(blob);
  b.coverLocal = true;
  idbPut(b.id, blob).catch(() => { b.coverLocal = false; save(); toast('Não consegui guardar a capa no aparelho; ficou só o link.'); });
}
function applyPendingCover(b) {
  const pc = pendingCover;
  pendingCover = null;
  if (pc) {
    if (pc.url) b.cover = safeUrl(pc.url);
    if (pc.blob) setLocalCover(b, pc.blob);
    else { if (b.coverLocal) dropLocalCover(b.id); b.coverLocal = false; }
    save();
    return;
  }
  // capa que veio de uma busca: tenta guardar uma cópia no aparelho em segundo plano
  if (b.cover && !b.coverLocal) {
    grabImage(b.cover).then((blob) => { if (blob && bookById(b.id)) { setLocalCover(b, blob); save(); } });
  }
}
function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
async function restoreCovers(map) {
  for (const id of Object.keys(map || {})) {
    const b = bookById(id);
    if (!b || !/^data:image\//.test(map[id])) continue;
    try { const blob = await (await fetch(map[id])).blob(); setLocalCover(b, blob); } catch (e) { /* ignora */ }
  }
  save();
}
/* reduz a imagem e devolve JPEG; null se o site não permitir copiar (CORS) */
function imageToJpeg(img) {
  const W = 360;
  const scale = Math.min(1, W / (img.naturalWidth || img.width || W));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => { try { c.toBlob((b) => res(b), 'image/jpeg', 0.85); } catch (e) { res(null); } });
}
function grabImage(url) {
  return new Promise((res) => {
    const u = safeUrl(url);
    if (!u) { res(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const t = setTimeout(() => res(null), 12000);
    img.onload = () => { clearTimeout(t); if (img.naturalWidth < 40) { res(null); return; } imageToJpeg(img).then(res, () => res(null)); };
    img.onerror = () => { clearTimeout(t); res(null); };
    img.src = u;
  });
}
function fileToJpeg(file) {
  return new Promise((res) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { imageToJpeg(img).then((b) => { URL.revokeObjectURL(url); res(b); }); };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}
function coverNote(b, v) {
  if (b && b.coverLocal) return 'Capa salva no celular.';
  if ((b && b.cover) || (v && v.cover)) return 'Capa da internet' + (v && v.src ? ' (' + esc(v.src) + ')' : '') + '. Ao salvar, o app guarda uma cópia no celular.';
  return 'Sem capa ainda.';
}
function isbn13to10(i13) {
  const c = cleanIsbn(i13);
  if (c.length === 10) return c;
  if (c.length !== 13 || !c.startsWith('978')) return '';
  const core = c.slice(3, 12);
  let sum = 0;
  for (let k = 0; k < 9; k++) sum += (10 - k) * (+core[k]);
  const chk = (11 - (sum % 11)) % 11;
  return core + (chk === 10 ? 'X' : String(chk));
}
const amazonCoverByIsbn = (i) => { const i10 = isbn13to10(i); return i10 ? 'https://images-na.ssl-images-amazon.com/images/P/' + i10 + '.01.LZZZZZZZ.jpg' : ''; };
/* junta capas de várias fontes para o título/autor (e ISBN, se houver) */
async function coverCandidates(title, author, isbn) {
  const out = [];
  const add = (u, src) => { u = safeUrl(u); if (u && !out.some((x) => x.url === u)) out.push({ url: u, src }); };
  if (isbn) {
    add(amazonCoverByIsbn(isbn), 'Amazon');
    add('https://covers.openlibrary.org/b/isbn/' + cleanIsbn(isbn) + '-L.jpg?default=false', 'Open Library');
  }
  const qParts = [title ? 'intitle:' + title : '', author ? 'inauthor:' + author.split(',')[0] : ''].filter(Boolean).join(' ');
  const gBase = 'https://www.googleapis.com/books/v1/volumes?printType=books&maxResults=30&fields=items(volumeInfo(imageLinks(thumbnail,smallThumbnail),industryIdentifiers,language))&q=' + encodeURIComponent(qParts || title);
  const jobs = [
    gFetch(gBase + '&langRestrict=pt').catch(() => ({})),
    Promise.resolve({}),
    fetchJSON('https://openlibrary.org/search.json?lang=pt&limit=12&fields=cover_i,editions,editions.cover_i,editions.isbn&q=' + encodeURIComponent([title, author].filter(Boolean).join(' '))).catch(() => ({}))
  ];
  const [gPt, gAll, ol] = await Promise.all(jobs);
  [gPt, gAll].forEach((j) => (j.items || []).forEach((it) => {
    const v = it.volumeInfo || {};
    const ids = v.industryIdentifiers || [];
    const i13 = (ids.find((x) => x.type === 'ISBN_13') || ids.find((x) => x.type === 'ISBN_10') || {}).identifier;
    if (i13) add(amazonCoverByIsbn(i13), 'Amazon'); // capa da Amazon pela edição encontrada
    const img = v.imageLinks || {};
    const g = (img.thumbnail || img.smallThumbnail || '').replace(/^http:/, 'https:').replace(/&edge=curl/, '');
    add(g, 'Google Livros');
  }));
  (ol.docs || []).forEach((d) => {
    const e = d.editions && d.editions.docs && d.editions.docs[0];
    if (e && e.cover_i) add('https://covers.openlibrary.org/b/id/' + e.cover_i + '-L.jpg', 'Open Library');
    if (d.cover_i) add('https://covers.openlibrary.org/b/id/' + d.cover_i + '-L.jpg', 'Open Library');
  });
  return out.slice(0, 36);
}
async function openCoverSearch() {
  const grid = $('#coverGrid');
  if (!grid) return;
  const title = (($('#f-title') || {}).value || '').trim();
  const author = (($('#f-author') || {}).value || '').trim();
  const isbn = (($('input[name="isbn"]') || {}).value || '').trim();
  if (!title && !isbn) { toast('Digite o título primeiro.'); return; }
  if (!navigator.onLine) { toast('Sem internet: use "Foto / galeria".'); return; }
  grid.hidden = false;
  grid.innerHTML = '<div class="status-line"><div class="spinner"></div>Procurando capas…</div>';
  const list = await coverCandidates(title, author, isbn);
  if (!$('#coverGrid')) return;
  grid.innerHTML = list.length
    ? '<p class="hint">Toque na capa certa para salvar no celular.</p><div class="cover-opts">' +
      list.map((c) => '<button type="button" class="cover-opt" data-act="coverPick" data-url="' + esc(c.url) + '" title="' + esc(c.src) + '">' +
        '<img class="opt-img" src="' + esc(c.url) + '" alt="Capa (' + esc(c.src) + ')" loading="lazy" referrerpolicy="no-referrer"><span>' + esc(c.src) + '</span></button>').join('') + '</div>'
    : '<div class="status-line">Nenhuma capa encontrada. Use "Foto / galeria" (pode ser um print da capa).</div>';
}
function showPendingPreview(src, note) {
  const box = $('#dlgCoverImg');
  if (box) box.innerHTML = coverHtml(src);
  const n = $('#dlgCoverNote');
  if (n) n.textContent = note;
}
async function pickCover(url) {
  const grid = $('#coverGrid');
  if (grid) grid.querySelectorAll('.cover-opt').forEach((b) => b.classList.toggle('sel', b.dataset.url === url));
  showPendingPreview(url, 'Salvando capa…');
  const blob = await grabImage(url);
  if (blob) {
    pendingCover = { blob, url };
    showPendingPreview(URL.createObjectURL(blob), 'Capa pronta: fica salva no celular ao tocar em Salvar.');
  } else {
    pendingCover = { url };
    showPendingPreview(url, 'Este site não deixa copiar a imagem: será salvo o link (o app guarda em cache para ver offline).');
  }
  const c = $('input[name="cover"]'); if (c) c.value = url;
}
function pickCoverFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const blob = await fileToJpeg(f);
    if (!blob) { toast('Não consegui abrir essa imagem.'); return; }
    pendingCover = { blob, url: '' };
    showPendingPreview(URL.createObjectURL(blob), 'Foto pronta: fica salva no celular ao tocar em Salvar.');
  };
  inp.click();
}

/* ======================= tela: Livros ======================= */
function renderBooks() {
  const el = $('#view-books');
  const items = S.books.map((b) => {
    const done = b.finished ? b.totalPages : b.currentPage - 1;
    const pct = clamp((done / b.totalPages) * 100, 0, 100);
    return '<article class="book-item' + (b.id === S.activeBookId ? ' active' : '') + '">' + coverHtml(coverSrc(b), 'sm') +
      '<div class="bi-info"><h3>' + esc(b.title) + '</h3><p>' + esc(b.author || 'Autor não informado') + '</p>' +
      '<p><span class="pg">' + (b.finished ? 'Concluído' : 'Pág. ' + b.currentPage + ' de ' + b.totalPages) + '</span> · ' + pct.toFixed(0) + '%</p>' +
      '<div class="progress sm"><div style="width:' + pct.toFixed(1) + '%"></div></div></div>' +
      '<div class="bi-actions"><button class="btn sm primary" type="button" data-act="read" data-id="' + esc(b.id) + '">Ler</button>' +
      '<button class="btn sm" type="button" data-act="edit" data-id="' + esc(b.id) + '">Editar</button></div></article>';
  }).join('');
  el.innerHTML =
    '<div class="card"><h2>Buscar livro na internet</h2>' +
      '<form class="searchbar" data-form="search"><input id="q" name="q" type="search" placeholder="Título, autor ou ISBN" autocomplete="off" enterkeyhint="search" value="' + esc(search.q) + '" aria-label="Buscar livro">' +
      '<button class="btn primary" type="submit">' + ICON.search + ' Buscar</button></form>' +
      '<button class="btn sm block paste-btn" type="button" data-act="paste">' + ICON.paste + ' Colar link da Amazon ou ISBN</button>' +
      '<div class="seg" role="tablist" aria-label="Fonte">' +
        '<button type="button" role="tab" data-act="srcTab" data-src="amazon" aria-selected="' + (srcTab === 'amazon') + '">Amazon <span id="amzCount">' + countTxt(amz) + '</span></button>' +
        '<button type="button" role="tab" data-act="srcTab" data-src="cat" aria-selected="' + (srcTab === 'cat') + '">Google Livros e outros <span id="catCount">' + countTxt(search) + '</span></button>' +
      '</div>' +
      '<div id="amzResults"' + (srcTab === 'amazon' ? '' : ' hidden') + '>' + amzHtml() + '</div>' +
      '<div id="results" class="results"' + (srcTab === 'cat' ? '' : ' hidden') + '>' + resultsHtml(search, 'pick') + '</div>' +
      '<button class="btn ghost block" type="button" data-act="manual">Adicionar manualmente</button></div>' +
    '<div class="section-title">Minha biblioteca (' + S.books.length + ')</div>' +
    (items ? '<div class="stack">' + items + '</div>' : '<div class="card empty"><p>Sua biblioteca está vazia.</p></div>');
}
function openBookDialog(prefill, editId) {
  const b = editId ? bookById(editId) : null;
  pendingCover = null;
  const v = b || prefill || {};
  const lastGoal = S.books.length ? S.books[S.books.length - 1].dailyGoalMin : 30;
  const goal = v.dailyGoalMin || lastGoal;
  let pageNote = '';
  if (!b && prefill && prefill.src) {
    pageNote = prefill.pages > 0
      ? '<p class="hint">Páginas segundo ' + esc(prefill.pagesSrc || prefill.src) + '. Confira no seu exemplar — varia por edição.</p>'
      : '<p class="hint">Este resultado não informa páginas. Digite o total do seu exemplar.</p>';
  }
  openDialog(
    '<div class="dlg-body"><h2 id="dlgTitle">' + (b ? 'Editar livro' : 'Adicionar livro') + '</h2>' +
    '<form data-form="book" data-id="' + (b ? esc(b.id) : '') + '" novalidate>' +
      '<input type="hidden" name="cover" value="' + esc(v.cover || '') + '"><input type="hidden" name="isbn" value="' + esc(v.isbn || '') + '"><input type="hidden" name="source" value="' + esc(v.src || v.source || 'manual') + '">' +
      '<div class="field"><label for="f-title">Título</label><input id="f-title" name="title" required value="' + esc(v.title || '') + '"></div>' +
      '<div class="field"><label for="f-author">Autor</label><input id="f-author" name="author" value="' + esc(v.author || '') + '"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="f-pub">Editora</label><input id="f-pub" name="publisher" value="' + esc(v.publisher || '') + '"></div>' +
        '<div class="field"><label for="f-ed">Edição</label><input id="f-ed" name="edition" placeholder="ex.: 1ª edição" value="' + esc(v.edition || '') + '"></div>' +
      '</div>' +
      '<input type="hidden" name="year" value="' + esc(v.year || '') + '">' +
      '<div class="dlg-cover"><div id="dlgCoverImg">' + coverHtml(b ? coverSrc(b) : v.cover) + '</div>' +
        '<div class="dlg-cover-side"><span class="muted" id="dlgCoverNote">' + coverNote(b, v) + '</span>' +
        '<div class="dlg-cover-btns"><button type="button" class="btn sm" data-act="coverSearch">' + ICON.search + ' Buscar capa</button>' +
        '<button type="button" class="btn sm ghost" data-act="coverPhoto">' + ICON.camera + ' Foto / galeria</button></div></div></div>' +
      '<div id="coverGrid" class="cover-grid" hidden></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="f-total">Total de páginas</label><input id="f-total" name="totalPages" type="number" inputmode="numeric" min="1" step="1" required value="' + (v.totalPages || v.pages || '') + '"></div>' +
        '<div class="field"><label for="f-cur">Página em que estou</label><input id="f-cur" name="currentPage" type="number" inputmode="numeric" min="1" step="1" value="' + (b ? b.currentPage : 1) + '"></div>' +
      '</div>' + pageNote +
      '<div class="field"><label for="f-goal">Tempo de leitura por dia (min)</label><input id="f-goal" name="dailyGoalMin" type="number" inputmode="numeric" min="1" max="720" value="' + goal + '"></div>' +
      (b ? '<div class="check field"><input type="checkbox" id="f-fin" name="finished"' + (b.finished ? ' checked' : '') + '><label for="f-fin">Livro concluído</label></div>' +
           '<button type="button" class="btn ghost block" data-act="dlgSearch">' + ICON.search + ' Atualizar páginas pela internet</button><div id="dlgResults" class="results"></div>' : '') +
      '<div class="dlg-actions">' + (b ? '<button type="button" class="btn danger" data-act="delBook" data-id="' + esc(b.id) + '">Excluir</button>' : '') +
        '<button type="button" class="btn" data-act="closeDlg">Cancelar</button><button type="submit" class="btn primary">Salvar</button></div>' +
    '</form></div>');
}
function submitBook(f) {
  const fd = new FormData(f);
  const title = String(fd.get('title') || '').trim();
  const total = parseInt(fd.get('totalPages'), 10);
  if (!title) { toast('Informe o título.'); return; }
  if (!(total >= 1)) { toast('Informe o total de páginas.'); return; }
  const cur = clamp(parseInt(fd.get('currentPage'), 10) || 1, 1, total);
  const goal = clamp(parseInt(fd.get('dailyGoalMin'), 10) || 30, 1, 720);
  const id = f.dataset.id;
  if (id) {
    const b = bookById(id);
    if (!b) return;
    const finished = fd.get('finished') === 'on';
    if (finished && sessionMine(b)) endSession(true);
    b.title = title; b.author = String(fd.get('author') || '').trim();
    b.publisher = String(fd.get('publisher') || '').trim(); b.edition = String(fd.get('edition') || '').trim();
    if (fd.get('year')) b.year = String(fd.get('year'));
    b.totalPages = total; b.dailyGoalMin = goal;
    b.cover = safeUrl(String(fd.get('cover') || '')) || b.cover;
    applyPendingCover(b);
    if (cur !== b.currentPage) {
      b.currentPage = cur; b.carrySec = 0;
      if (sessionMine(b)) { S.timer.lastLapMs = activeNow(); S.timer.carryMs = 0; }
    }
    b.currentPage = Math.min(b.currentPage, total);
    if (finished) { b.finished = true; b.currentPage = total; b.carrySec = 0; } else { b.finished = false; }
    save(); closeDialog(); renderCurrent(); toast('Livro atualizado.');
    return;
  }
  const nb = newBook({
    title, author: fd.get('author'), totalPages: total, currentPage: cur, dailyGoalMin: goal,
    cover: fd.get('cover'), isbn: fd.get('isbn'), source: fd.get('source'),
    publisher: fd.get('publisher'), edition: fd.get('edition'), year: fd.get('year')
  });
  S.books.push(nb);
  applyPendingCover(nb);
  closeDialog();
  if (S.timer.status === 'idle') {
    S.activeBookId = nb.id; save(); showTab('read'); toast('Livro adicionado. Bom proveito!');
  } else {
    save(); renderCurrent(); toast('Livro adicionado à biblioteca. Encerre a leitura atual para abri-lo.');
  }
}
function deleteBook(id) {
  const b = bookById(id);
  if (!b || !confirm('Excluir "' + b.title + '" e todo o histórico dele?')) return;
  if (S.timer.bookId === id) { S.timer = idleTimer(); releaseWake(); }
  S.books = S.books.filter((x) => x.id !== id);
  dropLocalCover(id);
  if (S.activeBookId === id) S.activeBookId = S.books[0] ? S.books[0].id : null;
  save(); closeDialog(); renderCurrent(); toast('Livro excluído.');
}

/* ======================= monitor de hábitos =======================
 * Sessões: registro novo (S.log, com início e fim) + sessões antigas reconstruídas a partir
 * das páginas cronometradas + a sessão em andamento. Tempo por dia vem de S.daily (inclui
 * leitura sem virar página). Meta: diária, semanal, mensal ou anual, em minutos, páginas ou livros.
 */
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const startOfWeek = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtMin = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + pad(m % 60) : m + ' min'; };
const hhmm = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const daySec = (k) => (S.daily[k] || 0) + (k === dateKey() ? unflushedSec() : 0);
const hab = { range: '30', month: null, day: null };

function allSessions() {
  const out = [];
  const seen = new Set();
  (S.log || []).forEach((l) => { seen.add(l.id); out.push(Object.assign({}, l)); });
  S.books.forEach((b) => {
    const m = new Map();
    b.segments.forEach((g) => {
      if (seen.has(g.sessionId)) return;
      let x = m.get(g.sessionId);
      if (!x) { x = { id: g.sessionId, bookId: b.id, start: Infinity, end: 0, sec: 0, pages: 0 }; m.set(g.sessionId, x); }
      x.start = Math.min(x.start, g.ts - g.sec * 1000);
      x.end = Math.max(x.end, g.ts);
      x.sec += g.sec;
      x.pages += g.pages;
    });
    m.forEach((x) => out.push(x));
  });
  const t = S.timer;
  if (t.status !== 'idle') {
    const i = out.findIndex((x) => x.id === t.sessionId);
    if (i >= 0) out.splice(i, 1);
    const b = bookById(t.bookId);
    const secNow = activeNow() / 1000;
    out.push({ id: t.sessionId, bookId: t.bookId, start: t.startedAt || Date.now() - secNow * 1000, end: Date.now(), sec: secNow,
      pages: b ? b.segments.filter((g) => g.sessionId === t.sessionId).reduce((a, g) => a + g.pages, 0) : 0, live: true });
  }
  return out.filter((x) => x.sec > 0 && isFinite(x.start)).sort((a, b) => a.start - b.start);
}
function pagesBetween(a, b) {
  return allSessions().reduce((p, x) => p + (x.start >= +a && x.start < +b ? x.pages : 0), 0);
}
function secBetween(a, b) {
  let s2 = 0;
  for (let d = startOfDay(a); d < b; d = addDays(d, 1)) s2 += daySec(dateKey(d));
  return s2;
}
function periodRange(period, now) {
  now = now || new Date();
  let a;
  let b;
  if (period === 'day') { a = startOfDay(now); b = addDays(a, 1); }
  else if (period === 'week') { a = startOfWeek(now); b = addDays(a, 7); }
  else if (period === 'month') { a = new Date(now.getFullYear(), now.getMonth(), 1); b = new Date(now.getFullYear(), now.getMonth() + 1, 1); }
  else { a = new Date(now.getFullYear(), 0, 1); b = new Date(now.getFullYear() + 1, 0, 1); }
  return [a, b];
}
const GOAL_P = { day: 'Diária', week: 'Semanal', month: 'Mensal', year: 'Anual' };
const GOAL_P_NOUN = { day: 'hoje', week: 'nesta semana', month: 'neste mês', year: 'neste ano' };
const GOAL_U = { min: 'minutos', pages: 'páginas', books: 'livros' };
function defaultGoal(period, unit) {
  const t = { min: { day: 30, week: 210, month: 900, year: 10000 }, pages: { day: 20, week: 140, month: 600, year: 7000 }, books: { day: 1, week: 1, month: 2, year: 24 } };
  return t[unit][period];
}
function goalProgress() {
  const g = S.settings.goal;
  const [a, b] = periodRange(g.period);
  let done;
  if (g.unit === 'min') done = secBetween(a, b) / 60;
  else if (g.unit === 'pages') done = pagesBetween(a, b);
  else done = S.books.filter((bk) => bk.finished && bk.finishedAt >= +a && bk.finishedAt < +b).length;
  return { g, done, pct: clamp(done / Math.max(1, g.value), 0, 1) };
}
function goalLineHtml() {
  const { g, done, pct } = goalProgress();
  return '<p class="goal-line">Meta ' + GOAL_P[g.period].toLowerCase() + ': <b>' + nfmt(Math.floor(done)) + ' / ' + nfmt(g.value) + ' ' + GOAL_U[g.unit] + '</b>' +
    (pct >= 1 ? ' · <span class="ok-text">cumprida!</span>' : '') + '</p>';
}
function streaks() {
  const keys = Object.keys(S.daily).filter((k) => daySec(k) >= 60).sort();
  const set = new Set(keys);
  if (daySec(dateKey()) >= 60) set.add(dateKey());
  let cur = 0;
  let d = new Date();
  if (!set.has(dateKey(d))) d = addDays(d, -1);
  while (set.has(dateKey(d))) { cur++; d = addDays(d, -1); }
  let best = 0;
  let run = 0;
  let prev = null;
  Array.from(set).sort().forEach((k) => {
    const dt = new Date(k + 'T12:00:00');
    run = prev && Math.round((dt - prev) / DAYMS) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = dt;
  });
  return { cur, best };
}
const DAYMS = 86400000;
function rangeStart() {
  if (hab.range === 'all') return new Date(0);
  return startOfDay(addDays(new Date(), -(+hab.range - 1)));
}

/* ---------- gráficos (barras em HTML; tendência em SVG) ---------- */
function barsHtml(items, opts) {
  const max = Math.max(opts.min || 1, ...items.map((x) => x.v));
  return '<div class="hbars' + (opts.cls ? ' ' + opts.cls : '') + '" role="img" aria-label="' + esc(opts.label) + '">' +
    items.map((x) => {
      const h = x.v > 0 ? Math.max(4, Math.round((x.v / max) * 100)) : 0;
      return '<div class="hcol' + (x.hl ? ' hl' : '') + '" data-tip="' + esc(x.tip) + '" tabindex="0">' +
        (opts.values && x.v > 0 ? '<span class="hval">' + esc(x.vl) + '</span>' : '') +
        '<div class="hbar' + (x.v > 0 ? '' : ' zero') + '" style="height:' + (x.v > 0 ? h + '%' : '3px') + '"></div>' +
        '<span class="hlab">' + esc(x.l) + '</span></div>';
    }).join('') + (opts.goal ? '<div class="hgoal" style="bottom:calc(' + clamp((opts.goal / max) * 100, 0, 100) + '% * var(--plot) + var(--lab))" data-tip="Meta ' + esc(opts.goalTip || '') + '"></div>' : '') + '</div>';
}
function trendSvg(vals, labels) {
  const W = 320;
  const H = 120;
  const P = 6;
  const n = vals.length;
  const max = Math.max(1, ...vals);
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, n - 1);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const mx = (n - 1) / 2;
  const my = vals.reduce((a, v) => a + v, 0) / n;
  let num = 0;
  let den = 0;
  vals.forEach((v, i) => { num += (i - mx) * (v - my); den += (i - mx) * (i - mx); });
  const slope = den ? num / den : 0;
  const a0 = my - slope * mx;
  const pts = vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const area = 'M' + x(0) + ',' + (H - P) + ' L' + pts.split(' ').join(' L') + ' L' + x(n - 1) + ',' + (H - P) + ' Z';
  const dots = vals.map((v, i) => '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="4" class="tdot"><title>' + esc(labels[i] + ': ' + Math.round(v) + ' min') + '</title></circle>' +
    '<rect x="' + (x(i) - (W / n) / 2).toFixed(1) + '" y="0" width="' + (W / n).toFixed(1) + '" height="' + H + '" fill="transparent" data-tip="' + esc(labels[i] + ': ' + Math.round(v) + ' min') + '"></rect>').join('');
  return {
    slope,
    svg: '<svg class="trend" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Minutos por semana nas últimas ' + n + ' semanas">' +
      '<line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" class="taxis"/>' +
      '<path d="' + area + '" class="tarea"/>' +
      '<polyline points="' + pts + '" class="tline"/>' +
      '<line x1="' + x(0) + '" y1="' + y(Math.max(0, a0)).toFixed(1) + '" x2="' + x(n - 1) + '" y2="' + y(Math.max(0, a0 + slope * (n - 1))).toFixed(1) + '" class="tfit"/>' +
      dots + '</svg>'
  };
}

function renderHabits() {
  const el = $('#view-habits');
  const now = new Date();
  const sessions = allSessions();
  const { g, done, pct } = goalProgress();
  const st = streaks();

  // ---- meta
  const seg = (act, cur, opts) => '<div class="seg seg-sm">' + Object.keys(opts).map((k) =>
    '<button type="button" data-act="' + act + '" data-v="' + k + '" aria-selected="' + (k === cur) + '">' + esc(opts[k]) + '</button>').join('') + '</div>';
  const goalCard = '<div class="card"><h2>Meta de leitura</h2>' +
    '<div class="goal-hero"><div class="goal-num"><strong>' + nfmt(Math.floor(done)) + '</strong><span>de ' + nfmt(g.value) + ' ' + GOAL_U[g.unit] + ' ' + GOAL_P_NOUN[g.period] + '</span></div>' +
    '<div class="goal-pct' + (pct >= 1 ? ' done' : '') + '">' + Math.round(pct * 100) + '%</div></div>' +
    '<div class="progress goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct * 100) + '"><div style="width:' + (pct * 100).toFixed(1) + '%"></div></div>' +
    '<p class="note">' + (pct >= 1 ? 'Meta cumprida! 🎉' : 'Faltam ' + nfmt(Math.ceil(g.value - done)) + ' ' + GOAL_U[g.unit] + '.') + '</p>' +
    '<div class="streaks"><div class="metric"><span class="m-label">Sequência atual</span><strong>' + st.cur + (st.cur === 1 ? ' dia' : ' dias') + '</strong></div>' +
    '<div class="metric"><span class="m-label">Melhor sequência</span><strong>' + st.best + (st.best === 1 ? ' dia' : ' dias') + '</strong></div></div>' +
    '<details class="goal-edit"><summary>Alterar meta</summary>' +
      '<label>Período</label>' + seg('goalPeriod', g.period, GOAL_P) +
      '<label>Medida</label>' + seg('goalUnit', g.unit, { min: 'Minutos', pages: 'Páginas', books: 'Livros' }) +
      '<label for="goalVal">Quantidade</label><div class="stepper"><button class="btn" type="button" data-act="goalStep" data-v="-1" aria-label="Diminuir">−</button>' +
      '<input id="goalVal" type="number" inputmode="numeric" min="1" value="' + g.value + '" data-change="goalValue"><button class="btn" type="button" data-act="goalStep" data-v="1" aria-label="Aumentar">+</button></div>' +
    '</details></div>';

  // ---- semana atual
  const w0 = startOfWeek(now);
  const weekItems = [];
  let daysRead = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(w0, i);
    const k = dateKey(d);
    const sec = daySec(k);
    if (sec >= 60) daysRead++;
    const nS = sessions.filter((x) => dateKey(new Date(x.start)) === k).length;
    weekItems.push({ v: sec / 60, vl: Math.round(sec / 60) + '', l: WD[i], hl: k === dateKey(),
      tip: WD[i] + ' ' + d.getDate() + '/' + (d.getMonth() + 1) + ': ' + fmtMin(sec) + ' · ' + nS + (nS === 1 ? ' sessão' : ' sessões') });
  }
  const lastWeekSec = secBetween(addDays(w0, -7), w0);
  const thisWeekSec = secBetween(w0, addDays(w0, 7));
  const dailyGoalMin = g.unit === 'min' && g.period === 'day' ? g.value : 0;
  const weekCard = '<div class="card"><h2>Esta semana</h2>' +
    '<div class="week-head"><div><strong class="big">' + daysRead + '</strong> de 7 dias com leitura</div>' +
    '<div class="muted">' + fmtMin(thisWeekSec) + ' · semana passada ' + fmtMin(lastWeekSec) + '</div></div>' +
    barsHtml(weekItems, { label: 'Minutos lidos por dia nesta semana', values: true, min: 10, goal: dailyGoalMin, goalTip: dailyGoalMin + ' min/dia' }) +
    '<p class="note">Toque numa barra para ver o tempo e quantas vezes leu no dia. Valores em minutos.</p></div>';

  // ---- calendário
  if (!hab.month) hab.month = new Date(now.getFullYear(), now.getMonth(), 1);
  const m0 = hab.month;
  const first = m0.getDay();
  const nDays = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
  let cells = WD.map((w) => '<span class="cal-wd">' + w.charAt(0).toUpperCase() + '</span>').join('');
  for (let i = 0; i < first; i++) cells += '<span class="cal-blank"></span>';
  let monthSec = 0;
  let monthDays = 0;
  for (let dn = 1; dn <= nDays; dn++) {
    const d = new Date(m0.getFullYear(), m0.getMonth(), dn);
    const k = dateKey(d);
    const sec = daySec(k);
    monthSec += sec;
    if (sec >= 60) monthDays++;
    const min = sec / 60;
    const lvl = min < 1 ? 0 : min < 10 ? 1 : min < 30 ? 2 : min < 60 ? 3 : 4;
    cells += '<button type="button" class="cal-day l' + lvl + (k === dateKey() ? ' today' : '') + (hab.day === k ? ' sel' : '') + '" data-act="calDay" data-k="' + k + '" aria-label="' + dn + ' de ' + MONTHS[d.getMonth()] + ': ' + fmtMin(sec) + '">' + dn + '</button>';
  }
  let detail = '';
  if (hab.day) {
    const ds = sessions.filter((x) => dateKey(new Date(x.start)) === hab.day);
    const dd = new Date(hab.day + 'T12:00:00');
    detail = '<div class="day-detail"><h3>' + esc(fmtDate(dd)) + '</h3><p class="muted">' + fmtMin(daySec(hab.day)) + ' de leitura · ' + ds.length + (ds.length === 1 ? ' sessão' : ' sessões') +
      ' · ' + nfmt(ds.reduce((a, x) => a + x.pages, 0)) + ' págs.</p>' +
      (ds.length ? ds.map((x) => { const b = bookById(x.bookId); return '<div class="session"><div class="s-main"><div class="s-title">' + esc(b ? b.title : 'Livro removido') + '</div>' +
        '<div class="s-sub">' + hhmm(x.start) + '–' + hhmm(x.end) + (x.live ? ' (agora)' : '') + ' · ' + fmtMin(x.sec) + ' · ' + nfmt(x.pages) + ' págs.</div></div></div>'; }).join('')
        : '<p class="note">Sem sessões registradas neste dia.</p>') + '</div>';
  }
  const calCard = '<div class="card"><div class="cal-head"><button class="btn sm ghost" type="button" data-act="calNav" data-v="-1" aria-label="Mês anterior">‹</button>' +
    '<h2>' + MONTHS[m0.getMonth()].replace(/^./, (c) => c.toUpperCase()) + ' ' + m0.getFullYear() + '</h2>' +
    '<button class="btn sm ghost" type="button" data-act="calNav" data-v="1" aria-label="Próximo mês">›</button></div>' +
    '<p class="muted cal-sum">' + monthDays + ' dias com leitura · ' + fmtMin(monthSec) + '</p>' +
    '<div class="cal">' + cells + '</div>' +
    '<div class="cal-legend"><span>menos</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>mais</span><span class="muted">(1 · 10 · 30 · 60+ min)</span></div>' +
    detail + '</div>';

  // ---- período (filtro) + resumo + horários + livros
  const r0 = rangeStart();
  const rs = sessions.filter((x) => x.start >= +r0);
  const rSec = secBetween(r0 < new Date(2000, 0, 1) ? (Object.keys(S.daily).sort()[0] ? new Date(Object.keys(S.daily).sort()[0] + 'T00:00:00') : now) : r0, addDays(startOfDay(now), 1));
  const rPages = pagesBetween(r0, Date.now() + 1);
  const rDays = new Set(Object.keys(S.daily).filter((k) => new Date(k + 'T12:00:00') >= r0 && daySec(k) >= 60)).size;
  const filter = '<div class="seg range-seg" role="tablist" aria-label="Período">' + [['7', '7 dias'], ['30', '30 dias'], ['365', '12 meses'], ['all', 'Tudo']].map(([k, l]) =>
    '<button type="button" data-act="habRange" data-v="' + k + '" aria-selected="' + (hab.range === k) + '">' + l + '</button>').join('') + '</div>';
  const summary = '<div class="card"><h2>Resumo do período</h2><div class="metrics">' +
    '<div class="metric"><span class="m-label">Tempo lendo</span><strong>' + fmtMin(rSec) + '</strong></div>' +
    '<div class="metric"><span class="m-label">Páginas</span><strong>' + nfmt(rPages) + '</strong></div>' +
    '<div class="metric"><span class="m-label">Dias com leitura</span><strong>' + rDays + '</strong></div>' +
    '<div class="metric"><span class="m-label">Sessões</span><strong>' + rs.length + '</strong><span class="m-sub">' + (rs.length ? 'média ' + fmtMin(rs.reduce((a, x) => a + x.sec, 0) / rs.length) : '') + '</span></div>' +
    '</div></div>';

  const hours = new Array(24).fill(0);
  rs.forEach((x) => {
    let t0 = x.start;
    let left = x.sec * 1000;
    while (left > 0) {
      const d = new Date(t0);
      const toNext = 3600000 - ((d.getMinutes() * 60 + d.getSeconds()) * 1000 + d.getMilliseconds());
      const part = Math.min(left, toNext);
      hours[d.getHours()] += part / 60000;
      left -= part;
      t0 += part;
    }
  });
  const peak = hours.indexOf(Math.max(...hours));
  const hourItems = hours.map((v, h) => ({ v, vl: '', l: h % 3 === 0 ? h + 'h' : '', hl: v > 0 && h === peak, tip: h + 'h–' + (h + 1) + 'h: ' + Math.round(v) + ' min' }));
  const partOfDay = (h) => (h < 6 ? 'de madrugada' : h < 12 ? 'de manhã' : h < 18 ? 'à tarde' : 'à noite');
  const hourCard = '<div class="card"><h2>Quando você lê</h2>' +
    (rs.length ? '<p class="muted">Você lê mais <b class="hl-text">' + partOfDay(peak) + '</b>, principalmente entre <b class="hl-text">' + peak + 'h e ' + (peak + 1) + 'h</b>.</p>' : '<p class="muted">Ainda sem sessões neste período.</p>') +
    barsHtml(hourItems, { label: 'Minutos lidos por hora do dia', cls: 'hours', min: 1 }) +
    '<p class="note">Minutos lidos em cada hora do dia, somando o período escolhido.</p></div>';

  const byBook = new Map();
  rs.forEach((x) => { const o = byBook.get(x.bookId) || { sec: 0, pages: 0, n: 0 }; o.sec += x.sec; o.pages += x.pages; o.n++; byBook.set(x.bookId, o); });
  const books = Array.from(byBook.entries()).sort((a, b) => b[1].sec - a[1].sec);
  const bmax = books.length ? books[0][1].sec : 1;
  const bookCard = '<div class="card"><h2>Livros no período</h2>' + (books.length ? books.map(([id, o]) => {
    const b = bookById(id);
    return '<div class="brow" data-tip="' + esc((b ? b.title : 'Livro removido') + ': ' + fmtMin(o.sec) + ', ' + o.pages + ' págs., ' + o.n + ' sessões') + '">' +
      coverHtml(b ? coverSrc(b) : '', 'xs') +
      '<div class="brow-main"><div class="brow-title">' + esc(b ? b.title : 'Livro removido') + '</div>' +
      '<div class="brow-track"><div style="width:' + Math.max(3, (o.sec / bmax) * 100).toFixed(1) + '%"></div></div>' +
      '<div class="brow-sub">' + fmtMin(o.sec) + ' · ' + nfmt(o.pages) + ' págs. · ' + o.n + (o.n === 1 ? ' sessão' : ' sessões') + '</div></div></div>';
  }).join('') : '<p class="muted">Nenhum livro lido neste período.</p>') + '</div>';

  // ---- tendência (12 semanas)
  const weeks = [];
  const wlabels = [];
  for (let i = 11; i >= 0; i--) {
    const a = addDays(w0, -7 * i);
    weeks.push(secBetween(a, addDays(a, 7)) / 60);
    wlabels.push('semana de ' + a.getDate() + '/' + (a.getMonth() + 1));
  }
  const tr = trendSvg(weeks, wlabels);
  const trendTxt = Math.abs(tr.slope) < 1 ? 'estável' : (tr.slope > 0 ? 'subindo ' : 'caindo ') + Math.abs(Math.round(tr.slope)) + ' min por semana';
  const trendCard = '<div class="card"><h2>Tendência</h2><p class="muted">Minutos por semana nas últimas 12 semanas · tendência: <b class="' + (tr.slope >= 1 ? 'ok-text' : tr.slope <= -1 ? 'warn-text' : 'hl-text') + '">' + trendTxt + '</b></p>' +
    tr.svg + '<div class="trend-x"><span>' + esc(wlabels[0].replace('semana de ', '')) + '</span><span>esta semana</span></div>' +
    '<div class="legend"><span><i class="lg-line"></i>minutos na semana</span><span><i class="lg-fit"></i>tendência (reta média)</span></div></div>';

  el.innerHTML = goalCard + weekCard + calCard + '<div class="section-title">Período</div>' + filter + summary + hourCard + bookCard + trendCard;
}

/* dica (tooltip) para barras e pontos: passar o mouse ou tocar */
const tipBox = document.createElement('div');
tipBox.className = 'tip hidden';
tipBox.setAttribute('role', 'tooltip');
document.body.appendChild(tipBox);
function showTip(el) {
  tipBox.textContent = el.getAttribute('data-tip');
  tipBox.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  const tw = tipBox.offsetWidth;
  tipBox.style.left = clamp(r.left + r.width / 2 - tw / 2, 8, window.innerWidth - tw - 8) + 'px';
  tipBox.style.top = Math.max(8, r.top - tipBox.offsetHeight - 8) + 'px';
}
function keepGoalOpen() { const d = $('.goal-edit'); if (d) d.open = true; }
const hideTip = () => tipBox.classList.add('hidden');
document.addEventListener('pointerover', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && e.pointerType === 'mouse') showTip(el); else if (e.pointerType === 'mouse') hideTip(); });
document.addEventListener('click', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); else hideTip(); }, true);
document.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('[data-tip]')) showTip(e.target); });
window.addEventListener('scroll', hideTip, { passive: true });

/* ======================= tela: Histórico ======================= */
function last7() {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dateKey(d);
    out.push({ d, sec: (S.daily[k] || 0) + (i === 0 ? unflushedSec() : 0) });
  }
  return out;
}
function sessionsList() {
  const map = new Map();
  S.books.forEach((b) => b.segments.forEach((g) => {
    const k = b.id + '|' + g.sessionId;
    let s = map.get(k);
    if (!s) { s = { key: k, bookId: b.id, sessionId: g.sessionId, title: b.title, ts: g.ts, pages: 0, sec: 0 }; map.set(k, s); }
    s.pages += g.pages; s.sec += g.sec; s.ts = Math.min(s.ts, g.ts);
  }));
  return Array.from(map.values()).sort((a, c) => c.ts - a.ts);
}
function renderStats() {
  const el = $('#view-stats');
  const pages = S.books.reduce((a, b) => a + b.segments.reduce((x, g) => x + g.pages, 0), 0);
  const totalSec = S.books.reduce((a, b) => a + (b.timeSec || 0), 0) + unflushedSec();
  const pace = paceOf(S.books.flatMap(allSegs).sort((a, c) => a.ts - c.ts), 'all');
  const finished = S.books.filter((b) => b.finished).length;
  const days = last7();
  const max = Math.max(60, ...days.map((x) => x.sec));
  const chart = days.map((x) => {
    const h = Math.round((x.sec / max) * 100);
    return '<div class="col"><span class="val">' + (x.sec >= 30 ? Math.round(x.sec / 60) : '') + '</span><div class="bar' + (x.sec < 1 ? ' zero' : '') + '" style="height:' + Math.max(3, h) + 'px"></div>' +
      '<span class="day">' + esc(x.d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')) + '</span></div>';
  }).join('');
  const sess = sessionsList().slice(0, 30).map((s) =>
    '<div class="session"><div class="s-main"><div class="s-title">' + esc(s.title) + '</div>' +
    '<div class="s-sub">' + esc(new Date(s.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) +
    ' · ' + nfmt(s.pages) + ' págs. · ' + fmtDur(s.sec) + (s.pages > 0 ? ' · ' + fmtDur(s.sec / s.pages) + '/pág' : '') + '</div></div>' +
    '<button class="link-btn" type="button" data-act="delSession" data-key="' + esc(s.key) + '">Remover</button></div>'
  ).join('');
  el.innerHTML =
    '<div class="card"><div class="metrics">' +
      '<div class="metric"><span class="m-label">Tempo total lendo</span><strong>' + fmtDur(totalSec, true) + '</strong></div>' +
      '<div class="metric"><span class="m-label">Páginas medidas</span><strong>' + nfmt(pages) + '</strong></div>' +
      '<div class="metric"><span class="m-label">Ritmo geral</span><strong>' + (pace ? fmtDur(pace.spp) + '/pág' : '—') + '</strong><span class="m-sub">' + (pace ? nfmt(3600 / pace.spp) + ' págs/h' : '') + '</span></div>' +
      '<div class="metric"><span class="m-label">Livros concluídos</span><strong>' + finished + ' de ' + S.books.length + '</strong></div>' +
    '</div></div>' +
    '<div class="card"><h2>Últimos 7 dias (minutos)</h2><div class="chart">' + chart + '</div></div>' +
    '<div class="card"><h2>Sessões recentes</h2>' + (sess || '<p class="muted">Nenhuma sessão registrada ainda.</p>') +
      (sess ? '<p class="note">“Remover” tira a sessão do cálculo de ritmo; não altera a página atual do livro.</p>' : '') + '</div>' +
    '<div class="card"><h2>Amazon</h2>' +
      '<p class="hint">Endereço do seu servidor Amazon (Cloudflare). Com ele, a busca mostra as capas da Amazon e um toque importa capa, autor, editora, edição e páginas.</p>' +
      '<div class="field"><label for="prefAmz">Endereço do servidor</label><input id="prefAmz" type="url" inputmode="url" placeholder="https://cronoleitura-amazon.SEU-NOME.workers.dev" value="' + esc(S.settings.amazonApi || '') + '"></div>' +
      '<button class="btn block" type="button" data-act="amzSave">Testar e salvar</button>' +
      '<p class="note" id="amzStatus">' + (amzApi() ? 'Conectado: ' + esc(amzApi()) : 'Ainda não configurado — veja o GUIA-AMAZON.txt que veio no zip.') + '</p></div>' +
    '<div class="card"><h2>Google Livros</h2>' +
      '<p class="hint">Sem chave, o Google divide um limite de buscas com o mundo todo e às vezes responde “limite atingido”. Com a sua chave gratuita são ~1000 buscas por dia só suas. Passo a passo no LEIAME.txt.</p>' +
      '<div class="field"><label for="prefGb">Chave da API do Google Livros (opcional)</label><input id="prefGb" data-change="gbkey" autocomplete="off" spellcheck="false" placeholder="AIza…" value="' + esc(S.settings.gbKey || '') + '"></div></div>' +
    '<div class="card"><h2>Preferências</h2>' +
      '<div class="field"><label for="prefName">Nome na saudação</label><input id="prefName" data-change="name" maxlength="40" value="' + esc(S.settings.name || '') + '" placeholder="Professor Robert"></div>' +
      '<div class="field"><label for="paceBasis">Como calcular o ritmo</label><select id="paceBasis" data-change="basis">' +
        '<option value="all"' + (S.settings.paceBasis === 'all' ? ' selected' : '') + '>Todo o histórico do livro</option>' +
        '<option value="recent"' + (S.settings.paceBasis === 'recent' ? ' selected' : '') + '>Últimas ~30 páginas (ritmo recente)</option></select></div>' +
      '<div class="check field"><input type="checkbox" id="fxOn" data-change="fx"' + (S.settings.fx !== false ? ' checked' : '') + '><label for="fxOn">Efeitos de luz (LED em movimento). Desligue se o celular travar</label></div>' +
      '<div class="check field"><input type="checkbox" id="keepAwake" data-change="awake"' + (S.settings.keepAwake ? ' checked' : '') + '><label for="keepAwake">Manter a tela acesa durante a leitura</label></div></div>' +
    '<div class="card"><h2>Seus dados</h2><p class="hint">Tudo fica salvo só neste aparelho. Faça backup de vez em quando.</p><div class="stack">' +
      '<button class="btn block" type="button" data-act="exportJson">Baixar backup (JSON)</button>' +
      '<button class="btn block" type="button" data-act="importJson">Restaurar backup</button>' +
      '<button class="btn block" type="button" data-act="exportCsv">Baixar histórico por página (CSV)</button>' +
      '<button class="btn danger block" type="button" data-act="clearAll">Apagar todos os dados</button></div></div>';
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function exportCsv() {
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const rows = [['id', 'data_hora_iso', 'livro', 'pagina_inicial', 'paginas', 'segundos', 'seg_por_pagina', 'excluido_do_ritmo', 'sessao'].join(',')];
  S.books.forEach((b) => b.segments.forEach((g) =>
    rows.push([q(g.id), q(new Date(g.ts).toISOString()), q(b.title), g.page || '', g.pages, g.sec, (g.sec / g.pages).toFixed(2), g.excluded ? 1 : 0, q(g.sessionId)].join(','))));
  if (rows.length === 1) { toast('Ainda não há páginas cronometradas.'); return; }
  download('cronoleitura-historico-' + dateKey() + '.csv', '﻿' + rows.join('\n'), 'text/csv;charset=utf-8');
}
async function exportJson() {
  const copy = JSON.parse(JSON.stringify(S));
  copy.timer = idleTimer();
  copy.covers = {};
  for (const b of S.books) {
    if (!b.coverLocal) continue;
    try { const blob = await idbGet(b.id); if (blob) copy.covers[b.id] = await blobToDataUrl(blob); } catch (e) { /* segue sem essa capa */ }
  }
  download('cronoleitura-backup-' + dateKey() + '.json', JSON.stringify(copy, null, 1), 'application/json');
}
function importJson() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const p = JSON.parse(rd.result);
        if (!p || p.v !== 2 || !Array.isArray(p.books)) throw new Error('formato');
        if (!confirm('Restaurar este backup? Os dados atuais deste aparelho serão substituídos.')) return;
        releaseWake();
        const covers = p.covers || {};
        delete p.covers;
        S = normalize(p); S.timer = idleTimer();
        save();
        restoreCovers(covers).then(() => { renderCurrent(); toast('Backup restaurado.'); });
      } catch (e) { toast('Arquivo de backup inválido.'); }
    };
    rd.readAsText(f);
  };
  inp.click();
}

/* ======================= diálogo e aviso ======================= */
const dlg = $('#dlg');
function openDialog(html) { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); }
function closeDialog() { if (dlg.open) dlg.close(); }
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(); });
dlg.addEventListener('close', () => { dlgSearch.seq++; Object.assign(dlgSearch, { status: 'idle', items: [], pt: [], other: [] }); });

let toastTimer = null;
function hideToast() { $('#toast').classList.add('hidden'); }
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button" id="toastBtn">' + esc(action.label) + '</button>' : '');
  el.classList.remove('hidden');
  if (action) $('#toastBtn').onclick = () => { action.fn(); hideToast(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 8000 : 3800);
}
function openJump() {
  const b = activeBook();
  if (!b || !sessionMine(b)) return;
  openDialog('<div class="dlg-body"><h2 id="dlgTitle">Ir para a página…</h2>' +
    '<form data-form="jump"><div class="field"><label for="f-jump">Cheguei na página</label>' +
    '<input id="f-jump" name="page" type="number" inputmode="numeric" min="1" max="' + b.totalPages + '" value="' + Math.min(b.totalPages, b.currentPage + 1) + '" required></div>' +
    '<p class="hint">Se você virou várias páginas sem tocar no botão, o tempo é dividido igualmente entre elas no cálculo do ritmo.</p>' +
    '<div class="dlg-actions"><button type="button" class="btn" data-act="closeDlg">Cancelar</button><button type="submit" class="btn primary">Confirmar</button></div></form></div>');
  setTimeout(() => { const i = $('#f-jump'); if (i) i.select(); }, 50);
}

/* ======================= eventos ======================= */
const handlers = {
  tab: (el) => showTab(el.dataset.tab),
  start: startReading,
  pause: pauseReading,
  stop: stopReading,
  lap,
  undo: undoLap,
  jump: openJump,
  closeDlg: closeDialog,
  goalInc: () => adjustGoal(5),
  goalDec: () => adjustGoal(-5),
  manual: () => openBookDialog({}),
  habRange: (el) => { hab.range = el.dataset.v; renderHabits(); },
  calNav: (el) => { const m = hab.month; hab.month = new Date(m.getFullYear(), m.getMonth() + (+el.dataset.v), 1); hab.day = null; renderHabits(); },
  calDay: (el) => { hab.day = hab.day === el.dataset.k ? null : el.dataset.k; renderHabits(); const d = $('.day-detail'); if (d) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
  goalPeriod: (el) => { const g = S.settings.goal; g.period = el.dataset.v; g.value = defaultGoal(g.period, g.unit); save(); renderHabits(); keepGoalOpen(); },
  goalUnit: (el) => { const g = S.settings.goal; g.unit = el.dataset.v; g.value = defaultGoal(g.period, g.unit); save(); renderHabits(); keepGoalOpen(); },
  goalStep: (el) => { const g = S.settings.goal; const step = g.unit === 'books' ? 1 : g.period === 'year' ? 100 : g.period === 'month' ? 30 : g.period === 'week' ? 15 : 5; g.value = Math.max(1, g.value + step * (+el.dataset.v)); save(); renderHabits(); keepGoalOpen(); },
  coverSearch: () => openCoverSearch(),
  coverPick: (el) => pickCover(el.dataset.url),
  coverPhoto: () => pickCoverFile(),
  srcTab: (el) => { srcTab = el.dataset.src === 'cat' ? 'cat' : 'amazon'; renderBooks(); },
  amzPick: (el) => { const r = amz.items[+el.dataset.i]; if (r) importAmazon(r, { asin: r.asin }, el); },
  amzSetup: () => openAmzSetup(),
  amzSave: () => saveAmzApi(),
  paste: async () => {
    let text = '';
    try { text = navigator.clipboard && navigator.clipboard.readText ? await navigator.clipboard.readText() : ''; } catch (e) { text = ''; }
    if (!text.trim()) { toast('Toque e segure no campo de busca e escolha “Colar”.'); const q = $('#q'); if (q) q.focus(); return; }
    useSharedText(text);
  },
  pick: (el) => { const r = search.items[+el.dataset.i]; if (r) openBookDialog(Object.assign({}, r, { title: fullTitle(r) })); },
  read: (el) => { if (setActive(el.dataset.id)) showTab('read'); },
  edit: (el) => openBookDialog(null, el.dataset.id),
  delBook: (el) => deleteBook(el.dataset.id),
  dlgSearch: async () => {
    const q = [$('#f-title') && $('#f-title').value, $('#f-author') && $('#f-author').value].filter(Boolean).join(' ').trim();
    if (!q) { toast('Digite o título primeiro.'); return; }
    const seq = ++dlgSearch.seq;
    Object.assign(dlgSearch, { status: 'loading', items: [], pt: [], other: [] });
    const paint = () => { const box = $('#dlgResults'); if (box) box.innerHTML = resultsHtml(dlgSearch, 'pickPages'); };
    paint();
    const res = await doSearch(q, (part) => { if (seq === dlgSearch.seq) { Object.assign(dlgSearch, part); paint(); } });
    if (seq !== dlgSearch.seq) return;
    Object.assign(dlgSearch, res);
    paint();
    enrichPages(dlgSearch, paint);
  },
  pickPages: (el) => {
    const r = dlgSearch.items[+el.dataset.i];
    if (!r) return;
    if (r.pages > 0) { const t = $('#f-total'); if (t) t.value = r.pages; toast('Total ajustado para ' + r.pages + ' páginas. Salve para confirmar.'); }
    else toast('Esta edição não informa páginas.');
    const c = $('input[name="cover"]'); if (c && !c.value && r.cover) c.value = r.cover;
  },
  delSession: (el) => {
    const [bid, sid] = String(el.dataset.key).split('|');
    const b = bookById(bid);
    if (!b || !confirm('Remover esta sessão do histórico e do cálculo de ritmo?')) return;
    b.segments = b.segments.filter((g) => g.sessionId !== sid);
    S.log = S.log.filter((l) => l.id !== sid);
    save(); renderStats();
  },
  exportCsv, exportJson, importJson,
  clearAll: () => {
    if (!confirm('Apagar TODOS os livros e históricos deste aparelho? Isso não pode ser desfeito.')) return;
    releaseWake(); S = defaults(); save();
    Object.keys(coverUrls).forEach(dropLocalCover); idbClear().catch(() => {});
    renderCurrent(); toast('Dados apagados.');
  },
  install: async () => {
    if (deferredInstall) {
      deferredInstall.prompt();
      await deferredInstall.userChoice.catch(() => null);
      deferredInstall = null; $('#btnInstall').classList.add('hidden');
    } else {
      openDialog('<div class="dlg-body"><h2 id="dlgTitle">Instalar no iPhone/iPad</h2><p class="muted">No Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</p><div class="dlg-actions"><button type="button" class="btn primary" data-act="closeDlg">Entendi</button></div></div>');
    }
  }
};
function adjustGoal(delta) {
  const b = activeBook();
  if (!b) return;
  b.dailyGoalMin = clamp(b.dailyGoalMin + delta, 1, 720);
  const i = $('#dailyMin'); if (i) i.value = b.dailyGoalMin;
  save(); fillMetrics();
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = handlers[el.dataset.act];
  if (fn) fn(el, e);
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const kind = f.dataset.form;
  if (kind === 'search') runSearch(new FormData(f).get('q') || '');
  else if (kind === 'book') submitBook(f);
  else if (kind === 'jump') { const q = parseInt(new FormData(f).get('page'), 10); closeDialog(); if (q) jumpTo(q); }
});
document.addEventListener('change', (e) => {
  const kind = e.target.dataset && e.target.dataset.change;
  if (!kind) return;
  if (kind === 'goal') {
    const b = activeBook();
    if (b) { b.dailyGoalMin = clamp(parseInt(e.target.value, 10) || 30, 1, 720); e.target.value = b.dailyGoalMin; save(); fillMetrics(); }
  } else if (kind === 'switch') {
    if (!setActive(e.target.value)) e.target.value = S.activeBookId;
    renderRead();
  } else if (kind === 'pomo') {
    S.settings.pomoMin = clamp(parseInt(e.target.value, 10) || 0, 0, 180);
    const info = pomoInfo();
    if (info && info.el < info.tot) S.timer.pomoDone = false;
    save(); renderRead();
  } else if (kind === 'goalValue') {
    S.settings.goal.value = Math.max(1, parseInt(e.target.value, 10) || 1); save(); renderHabits(); keepGoalOpen();
  } else if (kind === 'gbkey') {
    S.settings.gbKey = String(e.target.value || '').trim(); gPausedUntil = 0; save();
    toast(S.settings.gbKey ? 'Chave do Google salva.' : 'Chave do Google removida.');
  } else if (kind === 'fx') {
    S.settings.fx = !!e.target.checked; applyFx(); save();
  } else if (kind === 'name') {
    S.settings.name = String(e.target.value || '').trim().slice(0, 40); save();
  } else if (kind === 'basis') {
    S.settings.paceBasis = e.target.value === 'recent' ? 'recent' : 'all'; save(); renderStats();
  } else if (kind === 'awake') {
    S.settings.keepAwake = !!e.target.checked; save();
    if (!S.settings.keepAwake) releaseWake(); else if (S.timer.status === 'running') acquireWake();
  }
});
/* capa que falhou ao carregar (offline, link quebrado) vira ícone */
document.addEventListener('load', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.classList.contains('opt-img') && t.naturalWidth < 40) { const o = t.closest('.cover-opt'); if (o) o.remove(); }
}, true);
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.classList.contains('opt-img')) { const o = t.closest('.cover-opt'); if (o) o.remove(); return; }
  if (t && t.tagName === 'IMG' && t.classList.contains('cover-img') && t.parentElement) t.parentElement.innerHTML = ICON.book;
}, true);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.timer.status === 'running') acquireWake();
    updateClock(); fillMetrics();
  } else if (S.timer.status !== 'idle') { flush(); save(); }
});
window.addEventListener('pagehide', () => { if (S.timer.status !== 'idle') { flush(); save(); } });

/* ======================= PWA e inicialização ======================= */
let deferredInstall = null;
function setNet() {
  const n = $('#net');
  n.textContent = navigator.onLine ? 'Online' : 'Offline';
  n.className = 'net ' + (navigator.onLine ? 'online' : 'offline');
}
function setupPwa() {
  window.addEventListener('online', setNet);
  window.addEventListener('offline', setNet);
  setNet();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredInstall = e; $('#btnInstall').classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => { deferredInstall = null; $('#btnInstall').classList.add('hidden'); });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ios && !standalone) $('#btnInstall').classList.remove('hidden');
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* opcional */ }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('Nova versão instalada.', { label: 'Atualizar', fn: () => location.reload() });
            }
          });
        });
      }).catch(() => { /* sem SW (ex.: file://) o app continua funcionando online */ });
    });
  }
}
function applyFx() { document.body.classList.toggle('calm', S.settings.fx === false); }
applyFx();
setupPwa();
showTab('read');
loadCovers().then(() => { if (Object.keys(coverUrls).length) renderCurrent(); });
(function receiveShare() {
  const sp = new URLSearchParams(location.search);
  const shared = ['share_url', 'share_text', 'share_title'].map((k) => sp.get(k)).filter(Boolean).join(' ');
  if (!shared) return;
  history.replaceState(null, '', location.pathname);
  useSharedText(shared);
})();
setInterval(tick, 250);
if (S.timer.status === 'running') acquireWake();
