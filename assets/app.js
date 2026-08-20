// CISSP Question Bank — runtime. Zero dependencies, ES modules, relative paths.
// The sealed key blob (item.k) is decoded ONLY inside grading and reveal paths,
// never at load time.

const STORE_KEY = 'cissp-bank/v1';

// ---------- Progress store (localStorage with in-memory fallback) ----------

let progress = (() => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // file:// or private browsing — keep progress in memory only
  }
})();

function saveProgress() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  } catch {
    /* in-memory only */
  }
}

function clearProgress() {
  progress = {};
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

// ---------- Deterministic option order: FNV-1a -> mulberry32 -> Fisher–Yates ----------

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function next() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// order[displayedPos] = authoredIndex
function shuffledOrder(id) {
  const rand = mulberry32(fnv1a(id));
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// Decoded only in grade/reveal paths. UTF-8-safe base64.
function decodeKey(item) {
  const bin = atob(item.k);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---------- State ----------

let manifest = null;
const domainCache = new Map(); // n -> runtime items
const filter = { domain: 0, unansweredOnly: false }; // 0 = all domains
let queue = [];
let queuePos = 0;
// view = state of the currently rendered question
let view = null; // { item, order, lis, buttons, selected, resolved }

const $card = document.getElementById('card');
const $railDomains = document.getElementById('rail-domains');
const $toggleUnanswered = document.getElementById('toggle-unanswered');
const $clearZone = document.getElementById('clear-zone');

// ---------- Small DOM helpers (textContent only — no HTML injection) ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- Rail ----------

function domainInfo(n) {
  return manifest.domains.find((d) => d.n === n);
}

function renderRail() {
  $railDomains.replaceChildren();
  const maxWeight = Math.max(...manifest.domains.map((d) => d.weight));

  const all = el('button', 'rail-row');
  all.type = 'button';
  all.dataset.domain = '0';
  all.setAttribute('aria-pressed', String(filter.domain === 0));
  const allHead = el('span', 'rail-head');
  allHead.append(el('span', 'rail-num', 'ALL'), el('span', 'rail-name', 'All domains'));
  const allMeta = el('span', 'rail-meta');
  allMeta.append(el('span', '', '100%'), el('span', '', `${manifest.total} / 5000`));
  all.append(allHead, allMeta);
  all.addEventListener('click', () => setDomainFilter(0));
  $railDomains.append(all);

  for (const d of manifest.domains) {
    const row = el('button', 'rail-row');
    row.type = 'button';
    row.dataset.domain = String(d.n);
    row.setAttribute('aria-pressed', String(filter.domain === d.n));

    const head = el('span', 'rail-head');
    head.append(el('span', 'rail-num', `D${d.n}`), el('span', 'rail-name', d.name));

    // Bar width is proportional to the real exam weight — the structure is data.
    const bar = el('span', 'rail-bar');
    const fill = el('span', 'rail-bar-fill');
    fill.style.width = `${(d.weight / maxWeight) * 100}%`;
    bar.append(fill);

    const meta = el('span', 'rail-meta');
    meta.append(el('span', '', `${d.weight}%`), el('span', '', `${d.count} / ${d.target}`));

    row.append(head, bar, meta);
    row.addEventListener('click', () => setDomainFilter(d.n));
    $railDomains.append(row);
  }
}

function updateRailPressed() {
  for (const row of $railDomains.querySelectorAll('.rail-row')) {
    row.setAttribute('aria-pressed', String(Number(row.dataset.domain) === filter.domain));
  }
}

// ---------- Scoreboard ----------

function updateScoreboard() {
  let answered = 0;
  let first = 0;
  let second = 0;
  let missed = 0;
  for (const rec of Object.values(progress)) {
    if (!rec || !rec.resolved) continue;
    answered++;
    if (rec.correctOn === 1) first++;
    else if (rec.correctOn === 2) second++;
    else missed++;
  }
  document.getElementById('stat-answered').textContent = String(answered);
  document.getElementById('stat-first').textContent = String(first);
  document.getElementById('stat-second').textContent = String(second);
  document.getElementById('stat-missed').textContent = String(missed);
}

// ---------- Queue ----------

async function loadDomain(n) {
  if (domainCache.has(n)) return domainCache.get(n);
  const d = domainInfo(n);
  const res = await fetch(`data/${d.file}`);
  if (!res.ok) throw new Error(`Failed to fetch data/${d.file}`);
  const items = await res.json();
  domainCache.set(n, items);
  return items;
}

async function buildQueue() {
  // Lazy: fetch only the domains the current filter needs.
  const wanted = filter.domain === 0
    ? manifest.domains.map((d) => d.n)
    : [filter.domain];
  const lists = await Promise.all(wanted.map(loadDomain));
  let items = lists.flat();
  if (filter.unansweredOnly) {
    items = items.filter((it) => !progress[it.id]?.resolved);
  }
  // Queue order is intentionally non-deterministic (unlike option order).
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  queue = items;
  queuePos = 0;
  renderCurrent();
}

function setDomainFilter(n) {
  filter.domain = n;
  updateRailPressed();
  buildQueue().catch(renderFailure);
}

function nextQuestion() {
  if (queue.length === 0) return;
  queuePos++;
  renderCurrent();
}

// ---------- Card rendering ----------

function renderCurrent() {
  view = null;
  if (queue.length === 0) {
    renderMessage(
      filter.unansweredOnly
        ? 'No unanswered questions match this filter. Toggle "Unanswered only" off to review resolved ones.'
        : 'No questions in this domain yet. Pick another domain from the rail.',
    );
    return;
  }
  if (queuePos >= queue.length) {
    renderEndOfQueue();
    return;
  }
  renderQuestion(queue[queuePos]);
}

function renderMessage(text) {
  $card.replaceChildren(el('p', 'card-msg', text));
}

function renderEndOfQueue() {
  $card.replaceChildren();
  $card.append(el('p', 'card-msg', `End of this queue — ${queue.length} question(s) seen.`));
  const btn = el('button', 'btn primary', 'Reshuffle and continue');
  btn.type = 'button';
  btn.addEventListener('click', () => buildQueue().catch(renderFailure));
  const actions = el('div', 'actions');
  actions.append(btn);
  $card.append(actions);
  btn.focus();
}

function renderFailure(err) {
  $card.replaceChildren();
  const p1 = el('p', 'card-msg',
    'Could not load the question data. This app fetches JSON files, so it must be served over HTTP — opening index.html directly from disk will not work.');
  const p2 = el('p', 'card-msg');
  p2.append('From the repository folder, run ');
  p2.append(el('code', '', 'python3 -m http.server 8000'));
  p2.append(' and open ');
  p2.append(el('code', '', 'http://localhost:8000/'));
  p2.append('.');
  $card.append(p1, p2);
  if (err) console.error(err);
}

function renderQuestion(item) {
  $card.replaceChildren();
  const rec = progress[item.id];
  const order = shuffledOrder(item.id);
  const d = domainInfo(item.d);

  const meta = el('p', 'q-meta');
  const idSpan = el('span', 'q-id', item.id);
  const diffSpan = el('span', `q-diff diff-${item.x}`, item.x);
  const attemptsSpan = el('span', 'q-attempts', ` · attempts ${rec ? rec.tries.length : 0}/2`);
  meta.append(idSpan, ` · Obj ${item.o} · `, diffSpan, ` · ${d.name}`, attemptsSpan);

  const stem = el('p', 'q-stem', item.q);

  const list = el('ol', 'options');
  const lis = [];
  const buttons = [];
  order.forEach((authoredIdx, pos) => {
    const li = el('li', 'opt-li');
    const btn = el('button', 'option');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');
    btn.append(el('span', 'opt-key', String(pos + 1)), el('span', 'opt-text', item.c[authoredIdx]));
    btn.addEventListener('click', () => selectOption(pos));
    li.append(btn);
    list.append(li);
    lis.push(li);
    buttons.push(btn);
  });

  const feedback = el('div', 'feedback');
  feedback.setAttribute('role', 'status');

  const actions = el('div', 'actions');
  const checkBtn = el('button', 'btn primary', 'Check answer');
  checkBtn.type = 'button';
  checkBtn.disabled = true;
  checkBtn.addEventListener('click', checkAnswer);
  const nextBtn = el('button', 'btn', 'Next question');
  nextBtn.type = 'button';
  nextBtn.addEventListener('click', nextQuestion);
  actions.append(checkBtn, nextBtn);

  $card.append(meta, stem, list, feedback, actions);

  view = { item, order, lis, buttons, feedback, checkBtn, attemptsSpan, selected: null, resolved: false };

  if (rec && !rec.resolved && rec.tries.length === 1) {
    // Restore intermediate state: one wrong attempt already spent.
    applyStruck(rec.tries[0]);
    setFeedback('is-warn', 'Not correct. One attempt left — that option is now ruled out.');
  } else if (rec && rec.resolved) {
    // Already resolved: decoding here is allowed.
    reveal(decodeKey(item), rec);
  }
}

function setFeedback(kind, text) {
  view.feedback.className = `feedback ${kind}`;
  view.feedback.textContent = text;
}

function applyStruck(authoredIdx) {
  const pos = view.order.indexOf(authoredIdx);
  view.lis[pos].classList.add('is-struck');
  view.buttons[pos].disabled = true;
}

function selectOption(pos) {
  if (!view || view.resolved) return;
  if (view.buttons[pos].disabled) return;
  view.selected = pos;
  view.buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === pos)));
  view.checkBtn.disabled = false;
}

function checkAnswer() {
  if (!view || view.resolved || view.selected === null) return;
  const { item, order } = view;
  const authoredChoice = order[view.selected];
  // The sealed blob is decoded here, at grading time, and nowhere earlier.
  const key = decodeKey(item);

  const rec = progress[item.id] ?? { tries: [], resolved: false, correctOn: null };
  rec.tries.push(authoredChoice);

  if (authoredChoice === key.a) {
    rec.resolved = true;
    rec.correctOn = rec.tries.length; // 1 or 2
  } else if (rec.tries.length >= 2) {
    rec.resolved = true;
    rec.correctOn = null;
  }

  progress[item.id] = rec;
  saveProgress();
  updateScoreboard();
  view.attemptsSpan.textContent = ` · attempts ${rec.tries.length}/2`;

  if (rec.resolved) {
    reveal(key, rec);
  } else {
    applyStruck(authoredChoice);
    view.selected = null;
    view.buttons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    view.checkBtn.disabled = true;
    setFeedback('is-warn', 'Not correct. One attempt left — that option is now ruled out.');
  }
}

function reveal(key, rec) {
  const { item, order, lis, buttons } = view;
  view.resolved = true;

  order.forEach((authoredIdx, pos) => {
    const li = lis[pos];
    const btn = buttons[pos];
    btn.disabled = true;
    btn.setAttribute('aria-pressed', 'false');
    li.classList.remove('is-struck');
    const isCorrect = authoredIdx === key.a;
    li.classList.add(isCorrect ? 'is-correct' : 'is-incorrect');
    if (rec.tries.includes(authoredIdx)) li.classList.add('was-chosen');
    btn.append(el('span', 'opt-verdict', isCorrect ? '✓ correct' : '✗'));
    li.append(el('div', 'opt-expl', key.e[authoredIdx]));
  });

  if (rec.correctOn === 1) setFeedback('is-good', 'Correct — first try.');
  else if (rec.correctOn === 2) setFeedback('is-good', 'Correct — second attempt.');
  else setFeedback('is-bad', 'Not correct. Both attempts used — review the explanations below.');

  const refs = el('p', 'q-ref');
  if (key.r) refs.append(`Reference: ${key.r} · `);
  refs.append('Study: ');
  const link = el('a', '', `ISC2 CISSP exam outline — Domain ${item.d}`);
  link.href = 'https://www.isc2.org/certifications/cissp/cissp-certification-exam-outline';
  link.target = '_blank';
  link.rel = 'noopener';
  refs.append(link);
  view.feedback.after(refs);

  view.checkBtn.disabled = true;
}

// ---------- Rail tools ----------

$toggleUnanswered.addEventListener('click', () => {
  filter.unansweredOnly = !filter.unansweredOnly;
  $toggleUnanswered.setAttribute('aria-pressed', String(filter.unansweredOnly));
  buildQueue().catch(renderFailure);
});

function renderClearButton() {
  $clearZone.replaceChildren();
  const btn = el('button', 'danger-link', 'Clear my progress');
  btn.type = 'button';
  btn.id = 'clear-progress';
  btn.addEventListener('click', renderClearConfirm);
  $clearZone.append(btn);
}

function renderClearConfirm() {
  $clearZone.replaceChildren();
  const wrap = el('div', 'clear-confirm');
  wrap.append(el('span', '', 'Erase all recorded answers?'));
  const yes = el('button', 'btn', 'Yes, clear');
  yes.type = 'button';
  yes.addEventListener('click', () => {
    clearProgress();
    updateScoreboard();
    renderClearButton();
    buildQueue().catch(renderFailure);
  });
  const no = el('button', 'btn', 'Cancel');
  no.type = 'button';
  no.addEventListener('click', renderClearButton);
  wrap.append(yes, no);
  $clearZone.append(wrap);
  yes.focus();
}

document.getElementById('clear-progress').addEventListener('click', renderClearConfirm);

// ---------- Keyboard ----------

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLElement) {
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
  }
  if (e.key >= '1' && e.key <= '4') {
    e.preventDefault();
    selectOption(Number(e.key) - 1);
  } else if (e.key === 'Enter') {
    // Let focused non-option buttons keep their native Enter activation.
    if (t instanceof HTMLElement && t.tagName === 'BUTTON' && !t.classList.contains('option')) return;
    e.preventDefault();
    if (view?.resolved) nextQuestion();
    else if (view && view.selected !== null) checkAnswer();
  } else if (e.key === 'n' || e.key === 'N') {
    nextQuestion();
  }
});

// ---------- Init ----------

async function init() {
  let res;
  try {
    res = await fetch('data/manifest.json');
    if (!res.ok) throw new Error(`manifest fetch: HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    renderFailure(err);
    return;
  }
  renderRail();
  updateScoreboard();
  await buildQueue().catch(renderFailure);
}

init();
