'use strict';

const LEGACY_KEY = 'todo-uygulama.tasks';
const LOCAL_KEY = 'bugunun-plani.data';
const SVGNS = 'http://www.w3.org/2000/svg';
const WD_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const SPORT_PRESETS = ['Koşu', 'Yürüyüş', 'Fitness', 'Yüzme', 'Bisiklet', 'Yoga', 'Futbol', 'Basketbol'];
const DEFAULT_TIMER = { mode: 'pomodoro', running: false, startedAt: null, elapsed: 0, label: '', cycles: 0, cyclesDate: '', sessionId: null };
const DEFAULT_FOCUS_SETTINGS = { work: 25, short: 5, long: 15, goalHours: 4 };

/* ---------- Yardımcılar ---------- */

const $ = (id) => document.getElementById(id);
const uid = () => crypto.randomUUID();
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => toKey(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfWeek = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const fmt = (d, opts) => d.toLocaleDateString('tr-TR', opts);
const cap = (s) => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);
const lower = (s) => s.toLocaleLowerCase('tr');

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 864e5 + 1) / 7);
}

function relLabel(key) {
  const diff = Math.round((fromKey(key) - fromKey(todayKey())) / 864e5);
  return { 0: 'Bugün', '-1': 'Dün', 1: 'Yarın' }[diff] || '';
}

function fmtMin(min) {
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

function countBy(list, key) {
  const map = new Map();
  for (const item of list) map.set(item[key], (map.get(item[key]) || 0) + 1);
  return map;
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function icon(id, cls) {
  const svg = document.createElementNS(SVGNS, 'svg');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function checkbox(checked, label, onChange) {
  const input = h('input', { type: 'checkbox', 'aria-label': label, onchange: (e) => onChange(e.target.checked) });
  input.checked = checked;
  return h('label', { class: 'check', onclick: (e) => e.stopPropagation() }, input, h('span', { class: 'box' }, icon('i-check')));
}

function deleteButton(title, onClick) {
  return h('button', {
    class: 'icon-btn sm delete',
    title,
    'aria-label': title,
    onclick: (e) => { e.stopPropagation(); onClick(); },
  }, icon('i-trash'));
}

/* ---------- Veri ---------- */

function loadData() {
  let raw = null;
  try {
    raw = window.store ? window.store.load() : JSON.parse(localStorage.getItem(LOCAL_KEY));
  } catch {}
  const src = raw && typeof raw === 'object' ? raw : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const out = {
    ...src, // bilinmeyen alanları koru (başka sürümle açılırsa veri silinmesin)
    version: 2,
    tasks: arr(src.tasks),
    ideas: arr(src.ideas),
    sports: arr(src.sports),
    focus: arr(src.focus),
    timer: { ...DEFAULT_TIMER, ...obj(src.timer) },
    focusSettings: { ...DEFAULT_FOCUS_SETTINGS, ...obj(src.focusSettings) },
    // Bilgiler: projeler ve altındaki başlıklar (düz metin notlar)
    projects: arr(src.projects),
    pages: arr(src.pages),
    // room: eski "alan kodu" (giriş yapılınca hesaba taşınır), roomId: son açık ortak alan
    shared: { name: '', room: '', roomId: '', shareFocus: true, ...obj(src.shared) },
  };

  // İlk sürümdeki görevleri (tarihsiz) oluşturuldukları güne taşı.
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch {}
  if (Array.isArray(legacy) && legacy.length) {
    const known = new Set(out.tasks.map((t) => t.id));
    for (const t of legacy) {
      if (!t || !t.text || known.has(t.id)) continue;
      const createdAt = t.createdAt || Date.now();
      out.tasks.push({
        id: t.id || uid(), date: toKey(new Date(createdAt)), title: t.text,
        desc: '', start: '', end: '', done: !!t.done, createdAt,
      });
    }
    if (writeData(out)) localStorage.removeItem(LEGACY_KEY);
  }
  return out;
}

function writeData(d) {
  try {
    if (window.store) return window.store.save(d) === true;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

const data = loadData();

const state = {
  view: 'tasks',
  today: todayKey(),
  selected: todayKey(),
  calMonth: monthStart(new Date()),
  editTask: null,
  editIdea: null,
  editSport: null,
  ideaQuery: '',
  ideaScope: 'personal',
  justAdded: null,
};

// Ortak fikirler modülü (shared.bundle.js). Yüklenemezse özellik kapalı görünür.
const sharedApi = window.sharedIdeas || new Proxy({
  configured: false,
  uid: null,
  subscribe(fn) { fn({ status: 'unconfigured', authReady: true, user: null, ideas: [], notes: [], members: [] }); },
}, { get: (target, key) => (key in target ? target[key] : () => {}) });
let shared = { status: 'idle', authReady: false, user: null, activeRoomId: null, room: null, ideas: [], notes: [], members: [], myRooms: [], invites: [] };

function commit() {
  if (!writeData(data)) showToast('Değişiklikler kaydedilemedi!');
  render();
}

/* ---------- Bildirim + geri al ---------- */

let toastTimer = null;
let undoFn = null;

function showToast(text, undo) {
  $('toast-text').textContent = text;
  $('toast-undo').hidden = !undo;
  undoFn = undo || null;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; undoFn = null; }, 5000);
}

$('toast-undo').addEventListener('click', () => {
  if (undoFn) undoFn();
  undoFn = null;
  $('toast').hidden = true;
});

const formResetters = {
  tasks: () => state.editTask && setTaskForm(null),
  ideas: () => state.editIdea && setIdeaForm(null),
  sports: () => state.editSport && setSportForm(null),
  focus: () => {},
  pages: () => {},
};

function removeWithUndo(listName, id, label) {
  const list = data[listName];
  const index = list.findIndex((x) => x.id === id);
  if (index < 0) return;
  const [item] = list.splice(index, 1);
  formResetters[listName]();
  commit();
  showToast(label, () => {
    data[listName].splice(Math.min(index, data[listName].length), 0, item);
    commit();
  });
}

/* ---------- Görünümler ---------- */

function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  for (const v of ['tasks', 'focus', 'ideas', 'sport', 'info']) $(`view-${v}`).hidden = v !== view;
  document.querySelector('.content').scrollTop = 0;
}

function selectDate(key) {
  if (state.editTask) setTaskForm(null);
  state.selected = key;
  state.calMonth = monthStart(fromKey(key));
  render();
}

function render() {
  const ctx = {
    taskCount: countBy(data.tasks, 'date'),
    sportCount: countBy(data.sports, 'date'),
  };
  renderNav();
  renderTasks(ctx);
  renderCalendar(ctx);
  renderIdeas();
  renderSport();
  renderFocus();
  renderInfo();
  state.justAdded = null;
}

function renderNav() {
  const today = state.today;
  const todays = data.tasks.filter((t) => t.date === today);
  const done = todays.filter((t) => t.done).length;
  const weekStart = toKey(startOfWeek(fromKey(today)));
  const weekEnd = toKey(addDays(fromKey(weekStart), 6));
  const weekSports = data.sports.filter((s) => s.date >= weekStart && s.date <= weekEnd).length;

  $('nav-tasks').textContent = `Bugün ${todays.length} görev`;
  $('nav-ideas').textContent = shared.activeRoomId && shared.status === 'connected'
    ? `${data.ideas.length} fikir · ${shared.ideas.length} ortak`
    : `${data.ideas.length} fikir`;
  $('nav-sport').textContent = `Bu hafta ${weekSports} antrenman`;
  $('nav-info').textContent = `${data.projects.length} proje · ${data.pages.length} başlık`;

  $('side-bar').style.width = todays.length ? `${(done / todays.length) * 100}%` : '0';
  $('side-progress-text').textContent = todays.length
    ? `${done} / ${todays.length} görev tamamlandı`
    : 'Bugün için görev yok';
}

/* ---------- Görevler ---------- */

const byTime = (a, b) => (a.start || '99:99').localeCompare(b.start || '99:99') || a.createdAt - b.createdAt;

function renderTasks(ctx) {
  const sel = fromKey(state.selected);
  const list = data.tasks.filter((t) => t.date === state.selected).sort(byTime);
  const done = list.filter((t) => t.done).length;

  $('hero-title').textContent = relLabel(state.selected) || cap(fmt(sel, { weekday: 'long' }));
  $('hero-date').textContent = fmt(sel, { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  const focusSec = focusSecondsOn(state.selected);
  $('hero-sub').textContent = (list.length ? `${list.length} görev · ${done} tamamlandı` : 'Bu gün için görev yok')
    + (focusSec >= 60 ? ` · ${fmtDur(focusSec)} çalışma` : '');
  $('go-today').hidden = state.selected === state.today;

  // Hafta şeridi
  const start = startOfWeek(sel);
  $('week-days').replaceChildren(...Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const key = toKey(d);
    const cls = ['day-chip', key === state.selected && 'selected', key === state.today && 'today'].filter(Boolean).join(' ');
    return h('button', { class: cls, onclick: () => selectDate(key), title: fmt(d, { day: 'numeric', month: 'long', weekday: 'long' }) },
      h('strong', { text: d.getDate() }),
      h('span', { text: WD_SHORT[i] }),
      dots(key, ctx));
  }));

  // Liste
  const nowHM = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  $('task-list').replaceChildren(...list.map((t) => {
    const isNow = state.selected === state.today && !t.done && t.start && t.end && nowHM >= t.start && nowHM < t.end;
    const cls = ['task', t.done && 'done', isNow && 'now', t.id === state.justAdded && 'new'].filter(Boolean).join(' ');
    const time = t.start ? (t.end ? `${t.start} – ${t.end}` : t.start) : 'Gün içi';
    return h('li', { class: cls },
      h('div', { class: t.start ? 'task-time' : 'task-time none', text: time }),
      h('button', { class: 'task-body', title: 'Düzenlemek için tıkla', onclick: () => setTaskForm(t) },
        h('strong', { text: t.title }),
        t.desc && h('span', { text: t.desc })),
      deleteButton('Görevi sil', () => removeWithUndo('tasks', t.id, 'Görev silindi')),
      checkbox(t.done, t.title, (checked) => { t.done = checked; commit(); }));
  }));

  $('task-empty').hidden = list.length > 0;
  $('task-empty').textContent = state.selected === state.today
    ? 'Bugün için henüz görev yok. Sağdaki formdan ekleyebilirsin.'
    : 'Bu gün için görev yok.';

  // O günün spor kayıtları
  const sports = data.sports.filter((s) => s.date === state.selected);
  $('day-sport').hidden = sports.length === 0;
  $('day-sport-list').replaceChildren(...sports.map((s) =>
    h('li', { text: `${s.type} · ${fmtMin(s.duration)}` })));

  $('task-form-date').textContent = fmt(sel, { day: 'numeric', month: 'long', weekday: 'short' });
}

function dots(key, ctx) {
  return h('span', { class: 'dots' },
    ctx.taskCount.has(key) && h('i', { class: 'dot dot-task' }),
    ctx.sportCount.has(key) && h('i', { class: 'dot dot-sport' }));
}

function renderCalendar(ctx) {
  const month = state.calMonth;
  $('cal-month').textContent = cap(fmt(month, { month: 'long', year: 'numeric' }));

  const cells = [h('span')];
  WD_SHORT.forEach((w, i) => cells.push(h('span', { class: i >= 5 ? 'cal-wd weekend' : 'cal-wd', text: w })));

  let day = startOfWeek(month);
  for (let row = 0; row < 6; row++) {
    cells.push(h('span', { class: 'cal-wk', text: isoWeek(day) }));
    for (let i = 0; i < 7; i++) {
      const key = toKey(day);
      const cls = ['cal-day',
        day.getMonth() !== month.getMonth() && 'other',
        i >= 5 && 'weekend',
        key === state.today && 'today',
        key === state.selected && 'selected'].filter(Boolean).join(' ');
      cells.push(h('button', { class: cls, onclick: () => selectDate(key), title: fmt(day, { day: 'numeric', month: 'long', weekday: 'long' }) },
        h('span', { text: day.getDate() }),
        dots(key, ctx)));
      day = addDays(day, 1);
    }
  }
  $('cal-grid').replaceChildren(...cells);
}

function setTaskForm(task) {
  state.editTask = task ? task.id : null;
  $('task-title').value = task ? task.title : '';
  $('task-desc').value = task ? task.desc : '';
  $('task-start').value = task ? task.start : '';
  $('task-end').value = task ? task.end : '';
  $('task-end').setCustomValidity('');
  $('task-form-title').textContent = task ? 'Görevi Düzenle' : 'Görev Oluştur';
  $('task-submit').textContent = task ? 'Kaydet' : 'Görev Oluştur';
  $('task-cancel').hidden = !task;
  $('task-form').classList.toggle('editing', !!task);
  if (task) $('task-title').focus();
}

$('task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('task-title').value.trim();
  if (!title) return;
  const start = $('task-start').value;
  const end = $('task-end').value;
  if (start && end && end <= start) {
    $('task-end').setCustomValidity('Bitiş saati başlangıçtan sonra olmalı');
    $('task-end').reportValidity();
    return;
  }
  const fields = { title, desc: $('task-desc').value.trim(), start, end };
  const editing = data.tasks.find((t) => t.id === state.editTask);
  if (editing) {
    Object.assign(editing, fields);
  } else {
    const id = uid();
    data.tasks.push({ id, date: state.selected, done: false, createdAt: Date.now(), ...fields });
    state.justAdded = id;
  }
  setTaskForm(null);
  commit();
  $('task-title').focus();
});

$('task-start').addEventListener('input', () => $('task-end').setCustomValidity(''));
$('task-end').addEventListener('input', () => $('task-end').setCustomValidity(''));
$('task-cancel').addEventListener('click', () => setTaskForm(null));

$('week-prev').addEventListener('click', () => selectDate(toKey(addDays(fromKey(state.selected), -7))));
$('week-next').addEventListener('click', () => selectDate(toKey(addDays(fromKey(state.selected), 7))));
$('go-today').addEventListener('click', () => selectDate(state.today));
$('cal-prev').addEventListener('click', () => {
  state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1);
  render();
});
$('cal-next').addEventListener('click', () => {
  state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1);
  render();
});

/* ---------- Fikirler ---------- */

function shortDate(ts) {
  const key = toKey(new Date(ts));
  return relLabel(key) || fmt(new Date(ts), { day: 'numeric', month: 'short', year: 'numeric' });
}

const AVATAR_COLORS = ['#9a63e6', '#2ea36c', '#e0793a', '#3a8be0', '#d9468f', '#14a3a3', '#b8860b'];

function avatarColor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function avatarEl(name) {
  const avatar = h('i', { class: 'avatar', text: (name || '?').charAt(0).toLocaleUpperCase('tr') });
  avatar.style.background = avatarColor(name || '?');
  return avatar;
}

function authorChip(name, authorUid) {
  const mine = authorUid && authorUid === sharedApi.uid;
  return h('span', { class: 'author' }, avatarEl(name), mine ? 'Sen' : name);
}

const isRoomOwner = () => !!(shared.room && shared.room.ownerUid === sharedApi.uid);
const canEditIdea = (idea) => !!idea.authorUid && idea.authorUid === sharedApi.uid;
const canDeleteIdea = (idea) => canEditIdea(idea) || isRoomOwner();
const canDeleteNote = (note) => note.authorUid === sharedApi.uid || isRoomOwner();

function syncText() {
  if (shared.status === 'connecting') return ['connecting', 'Bağlanıyor…'];
  if (shared.status === 'error') return ['error', shared.error];
  if (shared.status === 'connected') {
    if (shared.fromCache) return ['offline', 'Çevrimdışı · değişiklikler bağlantı gelince gönderilecek'];
    if (shared.pending) return ['connecting', 'Gönderiliyor…'];
    return ['connected', 'Senkronize ✓'];
  }
  return ['', ''];
}

// Ortak sekmesi hangi aşamada: giriş → e-posta doğrulama → alan seçimi → alan.
function sharedPhase() {
  if (!sharedApi.configured) return 'unconfigured';
  if (!shared.authReady) return 'loading';
  if (!shared.user || shared.user.anonymous) return 'auth';
  if (!shared.user.verified) return 'verify';
  if (!shared.activeRoomId) return 'lobby';
  return 'room';
}

function renderIdeas() {
  const isShared = state.ideaScope === 'shared';
  const phase = isShared ? sharedPhase() : 'personal';
  const inRoom = phase === 'room';
  const showList = phase === 'personal' || inRoom;

  document.querySelectorAll('#idea-scope button').forEach((b) => b.classList.toggle('active', b.dataset.scope === state.ideaScope));
  const [syncCls, syncMsg] = syncText();
  $('sync-dot').className = `sync-dot ${shared.activeRoomId ? syncCls : ''}`;

  $('unconfigured-card').hidden = phase !== 'unconfigured';
  $('auth-card').hidden = phase !== 'auth';
  $('verify-card').hidden = phase !== 'verify';
  $('lobby-card').hidden = phase !== 'lobby';
  $('shared-bar').hidden = !inRoom;
  $('idea-search-box').hidden = !showList;
  $('idea-side').hidden = !showList;
  $('idea-grid').hidden = !showList;

  if (phase === 'auth' && !$('auth-name').value && data.shared.name) $('auth-name').value = data.shared.name;
  if (phase === 'verify') $('verify-email').textContent = shared.user.email;
  if (phase === 'lobby') renderLobby();
  if (inRoom) {
    $('room-name').textContent = shared.room ? shared.room.name : 'Ortak alan';
    $('room-owner-badge').hidden = !isRoomOwner();
    $('room-leave').hidden = !shared.room || isRoomOwner(); // alan sahibi alandan çıkamaz
    $('sync-status').textContent = syncMsg;
    $('sync-status').className = syncCls === 'error' ? 'sync-status error' : 'sync-status';
  }
  renderPeople(inRoom);
  renderIdeaDetail(inRoom);

  if (!state.editIdea) {
    $('idea-form-title').textContent = isShared ? 'Ortak Fikir Ekle' : 'Fikir Ekle';
    $('idea-submit').textContent = isShared ? 'Ortak Alana Ekle' : 'Fikir Ekle';
  }

  const source = isShared ? (inRoom ? shared.ideas : []) : data.ideas;
  const q = lower(state.ideaQuery.trim());
  const ideas = [...source]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((i) => !q || lower(i.title).includes(q) || lower(i.desc || '').includes(q));

  $('ideas-sub').textContent = isShared
    ? (inRoom ? `${shared.ideas.length} ortak fikir` : 'Arkadaşlarınla ortak alanlar')
    : `${data.ideas.length} fikir`;

  const noteCounts = countBy(shared.notes || [], 'ideaId');
  $('idea-grid').replaceChildren(...ideas.map((idea) => {
    if (!isShared) {
      return h('article', {
        class: idea.id === state.justAdded ? 'idea new' : 'idea',
        title: 'Düzenlemek için tıkla',
        onclick: () => setIdeaForm(idea),
      },
      h('h4', { text: idea.title }),
      idea.desc && h('p', { text: idea.desc }),
      h('div', { class: 'idea-foot' },
        h('span', { text: shortDate(idea.createdAt) }),
        deleteButton('Fikri sil', () => deleteIdea(idea))));
    }
    const notes = noteCounts.get(idea.id) || 0;
    const card = h('article', {
      class: ['idea', 'shared', idea.id === state.justAdded && 'new', idea.id === state.selectedIdea && 'selected'].filter(Boolean).join(' '),
      title: 'Ayrıntılar ve notlar için tıkla',
      onclick: () => selectIdea(idea.id),
    },
    h('h4', { text: idea.title }),
    idea.desc && h('p', { text: idea.desc }),
    h('div', { class: 'idea-foot' },
      h('span', { class: 'idea-meta' },
        authorChip(idea.author, idea.authorUid),
        h('span', { text: shortDate(idea.createdAt) }),
        notes > 0 && h('span', { class: 'note-count', title: `${notes} not` }, icon('i-note'), String(notes))),
      canDeleteIdea(idea) && deleteButton('Fikri sil', () => deleteIdea(idea))));
    card.style.setProperty('--author-color', avatarColor(idea.author));
    return card;
  }));

  const loading = (isShared && shared.status === 'connecting' && !shared.ideas.length) || phase === 'loading';
  $('idea-empty').hidden = !(phase === 'loading' || (showList && ideas.length === 0 && !loading));
  $('idea-empty').textContent = phase === 'loading'
    ? 'Hesap bilgileri yükleniyor…'
    : source.length
      ? 'Aramana uyan fikir bulunamadı.'
      : isShared
        ? 'Bu alanda henüz fikir yok. İlk ortak fikri sen ekle!'
        : 'Henüz fikir yok. İlk fikrini sağdaki formdan ekle!';
}

/* ---------- Lobi: hesap, davetler, alanlar ---------- */

function renderLobby() {
  const user = shared.user;
  $('account-chip').replaceChildren(avatarEl(user.name), user.name);
  $('account-email').textContent = user.email;

  const invites = shared.invites || [];
  $('invite-section').hidden = invites.length === 0;
  $('invite-list').replaceChildren(...invites.map((inv) =>
    h('li', { class: 'lobby-item invite' },
      h('span', { class: 'log-icon' }, icon('i-mail')),
      h('div', { class: 'lobby-text' },
        h('strong', { text: inv.roomName }),
        h('span', { text: `${inv.invitedBy} seni bu alana davet etti` })),
      h('button', { class: 'btn-ghost', text: 'Reddet', onclick: () => declineInvite(inv) }),
      h('button', { class: 'btn-primary', text: 'Katıl', onclick: () => acceptInvite(inv) }))));

  const rooms = shared.myRooms || [];
  $('room-empty').hidden = rooms.length > 0 || shared.roomsLoading;
  $('room-list').replaceChildren(...rooms.map((room) =>
    h('li', { class: 'lobby-item room', onclick: () => openRoom(room.id) },
      h('span', { class: 'log-icon' }, icon('i-users')),
      h('div', { class: 'lobby-text' },
        h('strong', { text: room.name }),
        h('span', { text: room.ownerUid === sharedApi.uid ? 'Sahibi sensin' : 'Üyesin' })),
      icon('i-right', 'chev-static'))));
}

function openRoom(id) {
  state.selectedIdea = null;
  setIdeaForm(null);
  data.shared.roomId = id;
  commit();
  sharedApi.connect(id);
}

function backToLobby() {
  state.selectedIdea = null;
  setIdeaForm(null);
  sharedApi.disconnect();
  data.shared.roomId = '';
  commit();
  sharedApi.loadMyRooms();
}

async function acceptInvite(inv) {
  try {
    const id = await sharedApi.acceptInvite(inv);
    openRoom(id);
    showToast(`"${inv.roomName}" alanına katıldın.`);
  } catch (err) {
    showToast(err.message);
  }
}

async function declineInvite(inv) {
  try {
    await sharedApi.declineInvite(inv);
  } catch (err) {
    showToast(err.message);
  }
}

$('create-room-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('create-room-name').value.trim();
  if (!name) return;
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    const id = await sharedApi.createRoom(name);
    $('create-room-name').value = '';
    openRoom(id);
    showToast(`"${name}" alanı oluşturuldu. Sağdaki karttan arkadaşlarını davet edebilirsin.`);
  } catch (err) {
    showToast(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('room-switch').addEventListener('click', backToLobby);

$('room-leave').addEventListener('click', () => {
  const name = shared.room ? shared.room.name : 'bu alan';
  if (!confirm(`"${name}" alanından çıkmak istiyor musun? Tekrar katılmak için yeniden davet gerekir.`)) return;
  state.selectedIdea = null;
  setIdeaForm(null);
  sharedApi.leaveRoom();
  data.shared.roomId = '';
  commit();
  showToast('Alandan çıktın. Yazdığın fikirler alanda kalmaya devam eder.');
});

async function logoutShared() {
  state.selectedIdea = null;
  setIdeaForm(null);
  data.shared.roomId = '';
  commit();
  await sharedApi.logout();
}

$('logout-btn').addEventListener('click', logoutShared);
$('verify-logout').addEventListener('click', logoutShared);

/* ---------- Giriş / kayıt / doğrulama ---------- */

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === 'register';
  document.querySelectorAll('#auth-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.auth === mode));
  $('auth-name-row').hidden = !register;
  $('auth-name').required = register;
  $('auth-password').autocomplete = register ? 'new-password' : 'current-password';
  $('auth-submit').textContent = register ? 'Hesap oluştur' : 'Giriş yap';
  $('auth-forgot').hidden = register;
  $('auth-error').hidden = true;
}

function showAuthError(message) {
  $('auth-error').textContent = message;
  $('auth-error').hidden = false;
}

document.querySelectorAll('#auth-tabs button').forEach((btn) =>
  btn.addEventListener('click', () => setAuthMode(btn.dataset.auth)));

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const name = $('auth-name').value.trim();
  $('auth-error').hidden = true;
  $('auth-submit').disabled = true;
  try {
    if (state.authMode === 'register') {
      await sharedApi.register(name, email, password);
      data.shared.name = name;
      commit();
    } else {
      await sharedApi.login(email, password);
    }
    $('auth-password').value = '';
  } catch (err) {
    showAuthError(err.message);
  } finally {
    $('auth-submit').disabled = false;
  }
});

$('auth-forgot').addEventListener('click', async () => {
  const email = $('auth-email').value.trim();
  if (!email) {
    showAuthError('Önce e-posta adresini yaz, sonra "Şifremi unuttum"a bas.');
    return;
  }
  try {
    await sharedApi.resetPassword(email);
    $('auth-error').hidden = true;
    showToast(`Şifre sıfırlama bağlantısı ${email} adresine gönderildi.`);
  } catch (err) {
    showAuthError(err.message);
  }
});

$('verify-check').addEventListener('click', async () => {
  const ok = await sharedApi.checkVerified();
  if (!ok) showToast('Henüz doğrulanmamış görünüyor. E-postadaki bağlantıya tıkladığından emin ol.');
});

$('verify-resend').addEventListener('click', async () => {
  try {
    await sharedApi.resendVerification();
    showToast('Doğrulama e-postası tekrar gönderildi.');
  } catch (err) {
    showToast(err.message);
  }
});

/* ---------- Fikir ayrıntısı ve notlar ---------- */

function selectIdea(id) {
  state.selectedIdea = state.selectedIdea === id ? null : id;
  if (state.editIdea && state.editIdea !== id) setIdeaForm(null);
  renderIdeas();
}

function renderIdeaDetail(inRoom) {
  const idea = inRoom && shared.ideas.find((i) => i.id === state.selectedIdea);
  if (!idea) {
    $('idea-detail').hidden = true;
    // Fikir silindiyse seçimi bırak (alan yüklenirken değil).
    if (inRoom && shared.status === 'connected') state.selectedIdea = null;
    return;
  }
  $('idea-detail').hidden = false;
  $('detail-meta').replaceChildren(authorChip(idea.author, idea.authorUid), h('span', { text: `· ${shortDate(idea.createdAt)}` }));
  $('detail-title').textContent = idea.title;
  $('detail-desc').textContent = idea.desc;
  $('detail-desc').hidden = !idea.desc;
  $('detail-edit').hidden = !canEditIdea(idea);
  $('detail-delete').hidden = !canDeleteIdea(idea);
  $('detail-readonly').hidden = canEditIdea(idea);

  const notes = (shared.notes || []).filter((n) => n.ideaId === idea.id);
  $('notes-count').textContent = notes.length ? `(${notes.length})` : '';
  $('notes-list').replaceChildren(...(notes.length
    ? notes.map((n) => h('li', { class: 'note' },
      h('div', { class: 'note-head' }, authorChip(n.author, n.authorUid), h('span', { text: `· ${agoText(n.createdAt)}` })),
      h('p', { text: n.text }),
      canDeleteNote(n) && deleteButton('Notu sil', () => {
        sharedApi.removeNote(n.id);
        showToast('Not silindi', () => sharedApi.restoreNote(n));
      })))
    : [h('li', { class: 'notes-empty', text: 'Henüz not yok. İlk notu sen ekle.' })]));
}

$('detail-close').addEventListener('click', () => { state.selectedIdea = null; renderIdeas(); });

$('detail-edit').addEventListener('click', () => {
  const idea = shared.ideas.find((i) => i.id === state.selectedIdea);
  if (idea && canEditIdea(idea)) setIdeaForm(idea);
});

$('detail-delete').addEventListener('click', () => {
  const idea = shared.ideas.find((i) => i.id === state.selectedIdea);
  if (idea) deleteIdea(idea);
});

$('note-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('note-text').value.trim();
  if (!text || !state.selectedIdea) return;
  sharedApi.addNote(state.selectedIdea, text);
  $('note-text').value = '';
});

// Enter: notu gönder, Shift+Enter: yeni satır.
$('note-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('note-form').requestSubmit();
  }
});

/* ---------- Alandakiler: çevrimiçi durumu ve odak süreleri ---------- */

// Son 2,5 dakikada "buradayım" sinyali gönderen çevrimiçi sayılır (sinyal her dakika gider).
const ONLINE_MS = 150 * 1000;

function agoText(ms) {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'dün';
  if (days < 7) return `${days} gün önce`;
  return fmt(new Date(ms), { day: 'numeric', month: 'short' });
}

function focusInfo(p) {
  if (!p.focusShared) return h('div', { class: 'person-focus hidden', title: 'Odak süresini paylaşmıyor' }, h('strong', { text: 'gizli' }), h('span', { text: 'odak' }));
  const weekStart = toKey(startOfWeek(fromKey(state.today)));
  // Kendi süreni yerel kayıttan canlı göster; diğerleri son sinyaldeki değer.
  const today = p.me ? focusSecondsOn(state.today) : (p.focusDate === state.today ? p.focusToday : 0);
  const live = p.me ? data.timer.running && MODES[data.timer.mode].work : p.focusRunning && p.online && p.focusDate === state.today;
  const week = p.focusWeekStart === weekStart ? p.focusWeek : 0;
  return h('div', { class: live ? 'person-focus live' : 'person-focus', title: `Bu hafta: ${fmtDur(week)}` },
    h('strong', { text: fmtDur(today) }),
    h('span', { text: live ? 'şu an odakta' : 'bugün odak' }));
}

function renderPeople(inRoom) {
  $('people-card').hidden = !inRoom;
  if (!inRoom) return;

  const now = Date.now();
  const ownerUid = shared.room && shared.room.ownerUid;
  const people = (shared.members || []).map((m) => ({
    ...m,
    me: m.uid === sharedApi.uid,
    online: m.uid === sharedApi.uid || now - m.lastSeen < ONLINE_MS,
  })).sort((a, b) => b.me - a.me || b.online - a.online || b.lastSeen - a.lastSeen);
  const onlineCount = people.filter((p) => p.online).length;

  $('people-note').hidden = !shared.membersError;
  $('people-note').textContent = shared.membersError || '';
  $('people-count').hidden = !people.length;
  $('people-count').textContent = `${onlineCount} çevrimiçi`;
  $('people-count').classList.toggle('none', onlineCount <= 1);
  $('people-list').replaceChildren(...people.map((p) =>
    h('li', { class: p.online ? 'person online' : 'person', title: p.online ? 'Uygulama şu an açık' : `Son görülme: ${new Date(p.lastSeen).toLocaleString('tr-TR')}` },
      h('span', { class: 'person-avatar' }, avatarEl(p.name)),
      h('div', { class: 'person-text' },
        h('strong', {}, p.me ? `${p.name} (sen)` : p.name, p.uid === ownerUid && h('span', { class: 'person-tag', text: 'sahip' })),
        h('span', { text: p.online ? 'Çevrimiçi' : `Son görülme: ${agoText(p.lastSeen)}` })),
      focusInfo(p),
      isRoomOwner() && !p.me && h('button', {
        class: 'icon-btn sm person-remove',
        title: 'Alandan çıkar',
        'aria-label': `${p.name} adlı kişiyi alandan çıkar`,
        onclick: () => {
          if (confirm(`${p.name} alandan çıkarılsın mı? Yazdığı fikirler alanda kalır.`)) sharedApi.removeMember(p.uid);
        },
      }, icon('i-x')))));

  if (document.activeElement !== $('share-focus')) $('share-focus').checked = data.shared.shareFocus !== false;
}

$('share-focus').addEventListener('change', (e) => {
  data.shared.shareFocus = e.target.checked;
  commit();
});

/* ---------- Davet penceresi ---------- */
// Davet asıl olarak Firebase'e kaydedilir (davetli giriş yapınca görür). E-posta ise kullanıcının
// kendi hesabından gider: Gmail'de, e-posta programında ya da kopyalanıp başka yerden.

let inviteDraft = null;

const isHttpsUrl = (s) => /^https:\/\/\S+\.\S+/.test(s);

function inviteText(email) {
  const roomName = shared.room ? shared.room.name : 'ortak alan';
  const from = shared.user ? shared.user.name : '';
  const link = isHttpsUrl(data.shared.downloadUrl || '') ? data.shared.downloadUrl : '';
  const subject = `${from} seni FocusLine'da "${roomName}" alanına davet etti`;
  const body = [
    'Merhaba,',
    '',
    `Seni FocusLine uygulamasındaki "${roomName}" ortak alanına davet ettim. Orada fikirlerimizi birlikte yazıp birbirimizin fikirlerine not ekleyebiliriz.`,
    '',
    'Katılmak için:',
    link
      ? `1. FocusLine'ı bu bağlantıdan indirip kur: ${link}`
      : '1. FocusLine uygulamasını kur (kurulum dosyasını benden isteyebilirsin).',
    '   Windows "bilgisayarınızı korudu" uyarısı verirse "Ek bilgi" → "Yine de çalıştır" de.',
    `2. Fikirler → Ortak bölümünde bu e-posta adresiyle (${email}) hesap oluştur ve e-postanı doğrula.`,
    '3. "Davetler" bölümünde "Katıl"a bas.',
    '',
    from,
  ].join('\n');
  return { subject, body };
}

function refreshInviteMessage() {
  if (!inviteDraft) return;
  Object.assign(inviteDraft, inviteText(inviteDraft.email));
  $('invite-message').value = `Konu: ${inviteDraft.subject}\n\n${inviteDraft.body}`;
}

function setInviteStatus(status, message) {
  const dialog = $('invite-dialog');
  dialog.classList.toggle('ok', status === 'ok');
  dialog.classList.toggle('error', status === 'error');
  const email = inviteDraft ? inviteDraft.email : '';
  $('invite-dialog-title').textContent = {
    pending: 'Davet kaydediliyor…',
    ok: 'Davet kaydedildi ✓',
    error: 'Davet kaydedilemedi',
  }[status];
  $('invite-dialog-status').textContent = status === 'error'
    ? message
    : `${email} FocusLine'da bu adresle giriş yaptığında daveti "Davetler" bölümünde görecek. Haberi olması için aşağıdaki mesajı da gönder.`;
}

function openExternalUrl(url) {
  if (window.store && window.store.openExternal) window.store.openExternal(url);
  else window.open(url);
}

$('invite-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = $('invite-email').value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    $('invite-email').reportValidity();
    return;
  }
  if ((shared.members || []).some((m) => m.email === email)) {
    showToast(`${email} zaten bu alanda.`);
    return;
  }
  inviteDraft = { email };
  $('download-url').value = data.shared.downloadUrl || '';
  $('invite-copy').textContent = 'Metni kopyala';
  setInviteStatus('pending');
  refreshInviteMessage();
  $('invite-dialog').showModal();
  sharedApi.invite(email)
    .then(() => { if (inviteDraft && inviteDraft.email === email) setInviteStatus('ok'); })
    .catch((err) => { if (inviteDraft && inviteDraft.email === email) setInviteStatus('error', err.message); });
  $('invite-email').value = '';
});

$('download-url').addEventListener('input', (e) => {
  const value = e.target.value.trim();
  e.target.setCustomValidity(value && !isHttpsUrl(value) ? 'Bağlantı https:// ile başlamalı.' : '');
  if (!value || isHttpsUrl(value)) {
    data.shared.downloadUrl = value;
    refreshInviteMessage();
  }
});
$('download-url').addEventListener('change', () => commit());
$('download-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

$('invite-gmail').addEventListener('click', () => {
  const { email, subject, body } = inviteDraft;
  openExternalUrl(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
});

$('invite-mailapp').addEventListener('click', () => {
  const { email, subject, body } = inviteDraft;
  openExternalUrl(`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
});

$('invite-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(`${inviteDraft.subject}\n\n${inviteDraft.body}`);
    $('invite-copy').textContent = 'Kopyalandı ✓';
  } catch {
    $('invite-message').select();
    showToast('Kopyalanamadı; mesajı seçip Ctrl+C ile kopyala.');
  }
});

$('invite-dialog-close').addEventListener('click', () => $('invite-dialog').close());
$('invite-dialog').addEventListener('close', () => { inviteDraft = null; });

/* ---------- Fikir ekleme / düzenleme / silme ---------- */

function deleteIdea(idea) {
  if (state.ideaScope === 'shared') {
    if (!canDeleteIdea(idea)) return;
    if (state.editIdea === idea.id) setIdeaForm(null);
    if (state.selectedIdea === idea.id) state.selectedIdea = null;
    sharedApi.remove(idea.id);
    showToast('Ortak fikir silindi', () => sharedApi.restore(idea));
  } else {
    removeWithUndo('ideas', idea.id, 'Fikir silindi');
  }
}

function setIdeaForm(idea) {
  const isShared = state.ideaScope === 'shared';
  state.editIdea = idea ? idea.id : null;
  $('idea-title').value = idea ? idea.title : '';
  $('idea-desc').value = idea ? idea.desc : '';
  $('idea-form-title').textContent = idea ? 'Fikri Düzenle' : (isShared ? 'Ortak Fikir Ekle' : 'Fikir Ekle');
  $('idea-submit').textContent = idea ? 'Kaydet' : (isShared ? 'Ortak Alana Ekle' : 'Fikir Ekle');
  $('idea-cancel').hidden = !idea;
  $('idea-form').classList.toggle('editing', !!idea);
  if (idea) $('idea-title').focus();
}

$('idea-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('idea-title').value.trim();
  if (!title) return;
  const fields = { title, desc: $('idea-desc').value.trim() };

  if (state.ideaScope === 'shared') {
    const editing = shared.ideas.find((i) => i.id === state.editIdea);
    if (editing) {
      if (canEditIdea(editing)) sharedApi.update(editing.id, fields);
    } else {
      state.justAdded = sharedApi.add(fields);
    }
    setIdeaForm(null);
    $('idea-title').focus();
    return;
  }

  const editing = data.ideas.find((i) => i.id === state.editIdea);
  if (editing) {
    Object.assign(editing, fields, { updatedAt: Date.now() });
  } else {
    const id = uid();
    data.ideas.push({ id, createdAt: Date.now(), ...fields });
    state.justAdded = id;
  }
  setIdeaForm(null);
  commit();
  $('idea-title').focus();
});

$('idea-cancel').addEventListener('click', () => setIdeaForm(null));
$('idea-search').addEventListener('input', (e) => {
  state.ideaQuery = e.target.value;
  renderIdeas();
});

document.querySelectorAll('#idea-scope button').forEach((btn) =>
  btn.addEventListener('click', () => {
    if (state.ideaScope === btn.dataset.scope) return;
    setIdeaForm(null);
    state.selectedIdea = null;
    state.ideaScope = btn.dataset.scope;
    renderIdeas();
  }));

/* ---------- Ortak alan durumu ---------- */

let lastWriteErrorAt = 0;
let autoConnectTried = false;

// Giriş yapıldıktan sonra son açık alana yeniden bağlan.
function sharedEffects() {
  const user = shared.user;
  if (!user || user.anonymous || !user.verified) {
    autoConnectTried = false;
    return;
  }
  // Eski "alan kodu" sistemi kalktı: artık alanlara sadece e-posta davetiyle girilir.
  if (data.shared.room) {
    data.shared.room = '';
    commit();
    showToast('Ortak alanlar artık e-posta davetiyle çalışıyor. Katılmak istediğin alanın sahibinden davet iste.');
  }
  if (!autoConnectTried && data.shared.roomId && !shared.activeRoomId) {
    autoConnectTried = true;
    sharedApi.connect(data.shared.roomId);
  }
}

sharedApi.subscribe((s) => {
  shared = s;
  if (s.writeError && s.writeError.at !== lastWriteErrorAt) {
    lastWriteErrorAt = s.writeError.at;
    showToast(`Ortak alana kaydedilemedi: ${s.writeError.message}`);
  }
  sharedEffects();
  renderIdeas();
  renderNav();
  state.justAdded = null;
});

// İnternet geri gelince hatalı bağlantıyı yeniden dene.
window.addEventListener('online', () => {
  if (data.shared.roomId && shared.status === 'error') sharedApi.connect(data.shared.roomId);
});

/* ---------- Spor ---------- */

function renderSport() {
  const today = fromKey(state.today);
  const weekStart = startOfWeek(today);
  const weekKeys = Array.from({ length: 7 }, (_, i) => toKey(addDays(weekStart, i)));
  const monthPrefix = state.today.slice(0, 7);

  const minutesOn = new Map();
  for (const s of data.sports) minutesOn.set(s.date, (minutesOn.get(s.date) || 0) + s.duration);

  const weekEntries = data.sports.filter((s) => s.date >= weekKeys[0] && s.date <= weekKeys[6]);
  const weekMin = weekEntries.reduce((sum, s) => sum + s.duration, 0);

  $('sport-sub').textContent = `Bu hafta ${weekEntries.length} antrenman · ${fmtMin(weekMin)}`;
  $('stat-week-min').textContent = weekMin;
  $('stat-month').textContent = data.sports.filter((s) => s.date.startsWith(monthPrefix)).length;
  $('stat-total').textContent = data.sports.length;

  // Haftalık çubuklar
  const mins = weekKeys.map((k) => minutesOn.get(k) || 0);
  const max = Math.max(30, ...mins);
  $('week-bars').replaceChildren(...weekKeys.map((key, i) => {
    const fill = h('div', { class: mins[i] ? 'bar-fill has' : 'bar-fill' });
    fill.style.height = `calc((100% - 44px) * ${mins[i] / max})`;
    return h('div', { class: key === state.today ? 'bar-col today' : 'bar-col', title: `${WD_SHORT[i]}: ${fmtMin(mins[i])}` },
      h('span', { class: 'bar-val', text: mins[i] ? mins[i] : '' }),
      fill,
      h('span', { class: 'bar-label', text: WD_SHORT[i] }));
  }));

  // Geçmiş (tarihe göre gruplu)
  const sorted = [...data.sports].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const groups = [];
  for (const s of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.date === s.date) last.items.push(s);
    else groups.push({ date: s.date, items: [s] });
  }

  $('sport-log').replaceChildren(...groups.map((g) => {
    const d = fromKey(g.date);
    const label = relLabel(g.date)
      ? `${relLabel(g.date)} · ${fmt(d, { day: 'numeric', month: 'long' })}`
      : fmt(d, { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
    return h('section', { class: 'log-group' },
      h('div', { class: 'log-date' },
        h('span', { text: label }),
        h('span', { text: fmtMin(minutesOn.get(g.date)) })),
      h('ul', { class: 'log-list' }, g.items.map((s) =>
        h('li', {
          class: s.id === state.justAdded ? 'log-item new' : 'log-item',
          title: 'Düzenlemek için tıkla',
          onclick: () => setSportForm(s),
        },
        h('span', { class: 'log-icon' }, icon('i-dumbbell')),
        h('div', { class: 'log-main' },
          h('strong', { text: s.type }),
          s.note && h('span', { text: s.note })),
        h('span', { class: 'log-min', text: fmtMin(s.duration) }),
        deleteButton('Kaydı sil', () => removeWithUndo('sports', s.id, 'Antrenman silindi'))))));
  }));

  $('sport-empty').hidden = data.sports.length > 0;
  $('sport-empty').textContent = 'Henüz antrenman yok. Sağdaki formdan ilk kaydını ekle!';

  // Öneri listesi: hazır aktiviteler + daha önce yazdıkların
  const types = [...new Set([...SPORT_PRESETS, ...data.sports.map((s) => s.type)])];
  $('sport-types').replaceChildren(...types.map((t) => h('option', { value: t })));
}

function setSportForm(entry) {
  state.editSport = entry ? entry.id : null;
  $('sport-type').value = entry ? entry.type : '';
  $('sport-duration').value = entry ? entry.duration : '';
  $('sport-note').value = entry ? entry.note : '';
  if (entry) $('sport-date').value = entry.date;
  else if (!$('sport-date').value) $('sport-date').value = state.today;
  $('sport-form-title').textContent = entry ? 'Antrenmanı Düzenle' : 'Antrenman Ekle';
  $('sport-submit').textContent = entry ? 'Kaydet' : 'Antrenman Ekle';
  $('sport-cancel').hidden = !entry;
  $('sport-form').classList.toggle('editing', !!entry);
  if (entry) $('sport-type').focus();
}

$('sport-quick').replaceChildren(...SPORT_PRESETS.slice(0, 6).map((name) =>
  h('button', {
    type: 'button',
    text: name,
    onclick: () => { $('sport-type').value = name; $('sport-duration').focus(); },
  })));

$('sport-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const type = $('sport-type').value.trim();
  const duration = parseInt($('sport-duration').value, 10);
  const date = $('sport-date').value;
  if (!type || !(duration > 0) || !date) return;
  const fields = { type, duration, date, note: $('sport-note').value.trim() };
  const editing = data.sports.find((s) => s.id === state.editSport);
  if (editing) {
    Object.assign(editing, fields);
  } else {
    const id = uid();
    data.sports.push({ id, createdAt: Date.now(), ...fields });
    state.justAdded = id;
  }
  setSportForm(null);
  commit();
  $('sport-type').focus();
});

$('sport-cancel').addEventListener('click', () => setSportForm(null));

/* ---------- Odak (Pomodoro) ---------- */

const MODES = {
  pomodoro: { label: 'Odaklanma', work: true, countdown: true },
  short: { label: 'Kısa mola', work: false, countdown: true },
  long: { label: 'Uzun mola', work: false, countdown: true },
  free: { label: 'Serbest çalışma', work: true, countdown: false },
};
const RING_LEN = 2 * Math.PI * 100;

function fmtDur(sec) {
  sec = Math.floor(sec);
  if (sec < 60) return sec > 0 ? `${sec} sn` : '0 dk';
  return fmtMin(Math.floor(sec / 60));
}

function fmtClock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const fmtHours = (sec) => (sec / 3600).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
const fmtTime = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const modeDuration = (mode) => (data.focusSettings[{ pomodoro: 'work', short: 'short', long: 'long' }[mode]] || 0) * 60;

function timerElapsed(now = Date.now()) {
  const t = data.timer;
  return t.elapsed + (t.running ? Math.max(0, now - t.startedAt) / 1000 : 0);
}

// Kayıtlı oturumlar + şu an çalışan zamanlayıcının o güne düşen kısmı.
function focusSecondsOn(key, now = Date.now()) {
  let sec = 0;
  for (const f of data.focus) if (f.date === key) sec += f.seconds;
  const t = data.timer;
  if (t.running && MODES[t.mode].work) {
    const dayStart = fromKey(key).getTime();
    const dayEnd = addDays(fromKey(key), 1).getTime();
    const s = Math.max(t.startedAt, dayStart), e = Math.min(now, dayEnd);
    if (e > s) sec += (e - s) / 1000;
  }
  return sec;
}

const round1 = (n) => Math.round(n * 10) / 10;

// Çalışma aralığını oturumun kaydına ekle. Duraklat/devam et aynı kayıtta birikir;
// oturum bitince (endSession) sonraki başlatma yeni kayıt açar. Gece yarısını geçen kısım yeni güne yazılır.
function addFocusSegment(startTs, endTs, completed) {
  const t = data.timer;
  let s = startTs;
  while (s < endTs) {
    const d = new Date(s);
    const e = Math.min(endTs, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime());
    const seconds = (e - s) / 1000;
    let rec = data.focus.find((f) => f.id === t.sessionId);
    if (rec && rec.date === toKey(d)) {
      rec.seconds = round1(rec.seconds + seconds);
      rec.end = e;
      if (s === startTs) rec.pauses = (rec.pauses || 0) + 1; // devam etmeden önce bir ara verilmiş
      if (t.label) rec.label = t.label;
    } else if (seconds >= 1) {
      rec = { id: uid(), date: toKey(d), start: s, end: e, seconds: round1(seconds), label: t.label, mode: t.mode, completed: false, pauses: 0 };
      data.focus.push(rec);
      t.sessionId = rec.id;
    }
    if (rec && completed && e === endTs) rec.completed = true;
    s = e;
  }
}

function endSession() {
  data.timer.sessionId = null;
}

function pauseTimer(now = Date.now(), completed = false) {
  const t = data.timer;
  if (!t.running) return;
  if (MODES[t.mode].work) addFocusSegment(t.startedAt, now, completed);
  t.elapsed += Math.max(0, now - t.startedAt) / 1000;
  t.running = false;
  t.startedAt = null;
}

function switchMode(mode) {
  pauseTimer();
  endSession();
  data.timer.mode = mode;
  data.timer.elapsed = 0;
}

function toggleTimer() {
  const t = data.timer;
  if (t.running) {
    pauseTimer();
  } else {
    if (MODES[t.mode].countdown && t.elapsed >= modeDuration(t.mode)) {
      t.elapsed = 0;
      endSession();
    }
    if (t.cyclesDate !== state.today) { t.cycles = 0; t.cyclesDate = state.today; }
    t.running = true;
    t.startedAt = Date.now();
    unlockAudio();
  }
  commit();
}

// Serbest modda "Oturumu bitir", geri sayım modlarında "Sıfırla".
function finishSession() {
  pauseTimer();
  const rec = data.focus.find((f) => f.id === data.timer.sessionId);
  endSession();
  data.timer.elapsed = 0;
  commit();
  if (rec && rec.mode === 'free') showToast(`Oturum kaydedildi: ${fmtDur(rec.seconds)}`);
}

function skipPhase() {
  if (!MODES[data.timer.mode].countdown) return;
  switchMode(data.timer.mode === 'pomodoro' ? 'short' : 'pomodoro');
  commit();
}

// Geri sayım bitti: süreyi tam bitiş anına kadar kaydet, sıradaki aşamaya geç.
function completePhase() {
  const t = data.timer;
  const end = t.startedAt + (modeDuration(t.mode) - t.elapsed) * 1000;
  const wasWork = t.mode === 'pomodoro';
  pauseTimer(end, wasWork);
  if (wasWork) {
    t.cycles += 1;
    switchMode(t.cycles % 4 === 0 ? 'long' : 'short');
  } else {
    switchMode('pomodoro');
  }
  commit();
  if (wasWork) alertUser('Pomodoro tamamlandı! 🎉', `${MODES[t.mode].label} zamanı.`);
  else alertUser('Mola bitti.', 'Yeni bir pomodoroya hazır mısın?');
}

let audioCtx = null;

function unlockAudio() {
  try {
    audioCtx = audioCtx || new AudioContext();
    audioCtx.resume();
  } catch {}
}

function chime() {
  unlockAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([freq, at]) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.25, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.6);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.65);
  });
}

function alertUser(title, body) {
  chime();
  try {
    if ('Notification' in window && Notification.permission !== 'denied') new Notification(title, { body, silent: true });
  } catch {}
  if (window.store && window.store.attention) window.store.attention();
  showToast(`${title} ${body}`);
}

// Her saniye yalnızca zamanlayıcıyla ilgili alanları güncelle.
function renderTimer() {
  const t = data.timer;
  const mode = MODES[t.mode];
  const elapsed = timerElapsed();
  const dur = modeDuration(t.mode);
  const shown = mode.countdown ? Math.ceil(Math.max(0, dur - elapsed)) : Math.floor(elapsed);
  const clock = fmtClock(shown);
  const finished = mode.countdown && elapsed >= dur;

  $('timer-time').textContent = clock;
  $('timer-mode-label').textContent = mode.label;
  const progress = mode.countdown ? Math.min(1, elapsed / dur) : (elapsed % 3600) / 3600;
  $('ring-progress').style.strokeDasharray = RING_LEN;
  $('ring-progress').style.strokeDashoffset = RING_LEN * (1 - progress);
  $('timer-card').classList.toggle('break', !mode.work);
  document.querySelectorAll('#timer-modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === t.mode));

  $('timer-toggle-icon').firstElementChild.setAttribute('href', t.running ? '#i-pause' : '#i-play');
  $('timer-toggle-text').textContent = t.running ? 'Duraklat' : (elapsed >= 1 && !finished ? 'Devam et' : 'Başlat');
  $('timer-skip').disabled = !mode.countdown;
  $('timer-reset').disabled = !t.running && elapsed < 1;
  const finishLabel = mode.countdown ? 'Sıfırla' : 'Oturumu bitir ve kaydet';
  $('timer-reset').title = finishLabel;
  $('timer-reset').setAttribute('aria-label', finishLabel);
  $('timer-reset').firstElementChild.firstElementChild.setAttribute('href', mode.countdown ? '#i-reset' : '#i-check');
  $('timer-reset').classList.toggle('finish', !mode.countdown);
  $('timer-hint').textContent = mode.countdown
    ? 'Boşluk tuşu: başlat / duraklat'
    : 'Duraklatıp devam ettiğinde süre aynı oturuma eklenir · ✓ ile oturumu bitir';

  const filled = t.mode === 'long' && t.cycles > 0 ? 4 : t.cycles % 4;
  $('cycle-dots').replaceChildren(...Array.from({ length: 4 }, (_, i) => h('i', { class: i < filled ? 'on' : '' })));
  $('cycle-dots').hidden = t.mode === 'free';

  const today = focusSecondsOn(state.today);
  const goal = data.focusSettings.goalHours * 3600;
  $('focus-today').textContent = fmtDur(today);
  $('focus-goal-bar').style.width = `${Math.min(1, today / goal) * 100}%`;
  $('focus-goal-text').textContent = today >= goal
    ? 'Günlük hedefine ulaştın! 🎉'
    : `Hedef ${data.focusSettings.goalHours.toLocaleString('tr-TR')} saat · ${fmtDur(goal - today)} kaldı`;
  const pomos = data.focus.filter((f) => f.date === state.today && f.completed).length;
  $('focus-pomos').textContent = pomos ? `Bugün ${pomos} pomodoro tamamlandı` : '';
  $('focus-sub').textContent = `Bugün ${fmtDur(today)} çalıştın`;

  $('nav-focus').textContent = t.running ? `${clock} · ${mode.label}` : `Bugün ${fmtDur(today)}`;
  $('nav-focus-item').classList.toggle('running', t.running);
  document.title = t.running ? `${clock} · ${mode.label}` : 'FocusLine';

  // Ortak alandakilere bugünkü/haftalık odak süresini bildir (dakikada bir gönderilir).
  if (shared.activeRoomId) {
    const weekStart = startOfWeek(fromKey(state.today));
    let week = 0;
    for (let i = 0; i < 7; i++) week += focusSecondsOn(toKey(addDays(weekStart, i)));
    sharedApi.setFocusStats({
      date: state.today,
      weekStart: toKey(weekStart),
      today,
      week,
      running: t.running && mode.work,
      shared: data.shared.shareFocus !== false,
    });
  }

  // Tepsi simgesinin üzerine gelince kalan süre görünsün.
  const trayText = t.running ? `${clock} · ${mode.label}` : `Bugün ${fmtDur(today)} çalıştın`;
  if (window.store && window.store.trayStatus && trayText !== lastTrayText) {
    lastTrayText = trayText;
    window.store.trayStatus(trayText, t.running);
  }
}

let lastTrayText = '';

const isCurrentSession = (f) => f.id === data.timer.sessionId;

// Açık oturum çalışıyorsa, henüz kaydedilmemiş (duraklatılmamış) kısmı da göster.
function liveExtra(f) {
  const t = data.timer;
  if (!isCurrentSession(f) || !t.running) return 0;
  return Math.max(0, Date.now() - Math.max(t.startedAt, fromKey(f.date).getTime())) / 1000;
}

function sessionDetail(f) {
  const end = isCurrentSession(f) && data.timer.running ? Date.now() : f.end;
  const parts = [`${fmtTime(f.start)} – ${fmtTime(end)}`];
  if (f.pauses) parts.push(`${f.pauses} ara`);
  if (f.completed) parts.push('pomodoro tamamlandı ✓');
  if (isCurrentSession(f)) parts.push(data.timer.running ? 'devam ediyor' : 'duraklatıldı');
  return parts.join(' · ');
}

function renderFocus() {
  const today = fromKey(state.today);
  const weekStart = startOfWeek(today);
  const weekKeys = Array.from({ length: 7 }, (_, i) => toKey(addDays(weekStart, i)));
  const weekSecs = weekKeys.map((k) => focusSecondsOn(k));
  const weekTotal = weekSecs.reduce((a, b) => a + b, 0);
  const daysSoFar = ((today.getDay() + 6) % 7) + 1;
  const allTotal = data.focus.reduce((a, f) => a + f.seconds, 0)
    + (focusSecondsOn(state.today) - data.focus.filter((f) => f.date === state.today).reduce((a, f) => a + f.seconds, 0));

  $('focus-week').textContent = fmtHours(weekTotal);
  $('focus-avg').textContent = fmtHours(weekTotal / daysSoFar);
  $('focus-total').textContent = fmtHours(allTotal);

  // Haftalık çubuklar (saat)
  const max = Math.max(3600, data.focusSettings.goalHours * 3600, ...weekSecs);
  $('focus-bars').replaceChildren(...weekKeys.map((key, i) => {
    const sec = weekSecs[i];
    const fill = h('div', { class: sec >= 60 ? 'bar-fill has' : 'bar-fill' });
    fill.style.height = `calc((100% - 44px) * ${sec / max})`;
    return h('div', { class: key === state.today ? 'bar-col today' : 'bar-col', title: `${WD_SHORT[i]}: ${fmtDur(sec)}` },
      h('span', { class: 'bar-val', text: sec >= 60 ? fmtHours(sec) : '' }),
      fill,
      h('span', { class: 'bar-label', text: WD_SHORT[i] }));
  }));

  // Son 30 günün geçmişi
  const cutoff = toKey(addDays(today, -29));
  const sessions = data.focus.filter((f) => f.date >= cutoff).sort((a, b) => b.start - a.start);
  const groups = [];
  for (const f of sessions) {
    const last = groups[groups.length - 1];
    if (last && last.date === f.date) last.items.push(f);
    else groups.push({ date: f.date, items: [f] });
  }

  $('focus-log').replaceChildren(...groups.map((g) => {
    const d = fromKey(g.date);
    const label = relLabel(g.date)
      ? `${relLabel(g.date)} · ${fmt(d, { day: 'numeric', month: 'long' })}`
      : fmt(d, { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
    const total = g.items.reduce((a, f) => a + f.seconds + liveExtra(f), 0);
    return h('section', { class: 'log-group' },
      h('div', { class: 'log-date' }, h('span', { text: label }), h('span', { text: fmtDur(total) })),
      h('ul', { class: 'log-list' }, g.items.map((f) =>
        h('li', { class: 'log-item' },
          h('span', { class: 'log-icon focus' }, icon('i-timer')),
          h('div', { class: 'log-main' },
            h('strong', { text: f.label || (f.mode === 'free' ? 'Serbest çalışma' : 'Pomodoro') }),
            h('span', { text: sessionDetail(f) })),
          h('span', { class: 'log-min', text: fmtDur(f.seconds + liveExtra(f)) }),
          deleteButton('Kaydı sil', () => removeWithUndo('focus', f.id, 'Çalışma kaydı silindi'))))));
  }));
  $('focus-empty').hidden = sessions.length > 0;

  // "Ne üzerinde çalışıyorsun?" önerileri: bugünün bitmemiş görevleri
  const titles = [...new Set(data.tasks.filter((t) => t.date === state.today && !t.done).map((t) => t.title))];
  $('timer-label-list').replaceChildren(...titles.map((t) => h('option', { value: t })));
  if (document.activeElement !== $('timer-label')) $('timer-label').value = data.timer.label;

  for (const [id, key] of [['set-work', 'work'], ['set-short', 'short'], ['set-long', 'long'], ['set-goal', 'goalHours']]) {
    if (document.activeElement !== $(id)) $(id).value = data.focusSettings[key];
  }

  renderTimer();
}

$('timer-toggle').addEventListener('click', toggleTimer);
if (window.store && window.store.onTimerToggle) window.store.onTimerToggle(toggleTimer);
$('timer-reset').addEventListener('click', finishSession);
$('timer-skip').addEventListener('click', skipPhase);

document.querySelectorAll('#timer-modes button').forEach((btn) =>
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === data.timer.mode) return;
    switchMode(btn.dataset.mode);
    commit();
  }));

$('timer-label').addEventListener('input', (e) => { data.timer.label = e.target.value.trim(); });
$('timer-label').addEventListener('change', () => writeData(data));

for (const [id, key, min, max] of [['set-work', 'work', 1, 180], ['set-short', 'short', 1, 60], ['set-long', 'long', 1, 90], ['set-goal', 'goalHours', 0.5, 16]]) {
  $(id).addEventListener('change', (e) => {
    const v = parseFloat(e.target.value);
    if (v > 0) {
      const rounded = key === 'goalHours' ? Math.round(v * 2) / 2 : Math.round(v);
      data.focusSettings[key] = Math.min(max, Math.max(min, rounded));
    }
    e.target.value = data.focusSettings[key];
    commit();
  });
}
$('focus-settings').addEventListener('submit', (e) => e.preventDefault());

setInterval(() => {
  const t = data.timer;
  if (t.running && MODES[t.mode].countdown && timerElapsed() >= modeDuration(t.mode)) completePhase();
  else renderTimer();
}, 1000);

// Uygulama kapanırken zamanlayıcıyı duraklat; o ana kadarki süre kaydedilir.
window.addEventListener('beforeunload', () => {
  if (data.timer.running) {
    pauseTimer();
    writeData(data);
  }
});

/* ---------- Bilgiler (proje → başlık → düz metin not) ---------- */
// Her şey sadece bu bilgisayarda: data.projects ve data.pages. Yazarken kendiliğinden kaydedilir.

const kb = {
  projectId: (data.kbLast && data.kbLast.projectId) || null,
  pageId: (data.kbLast && data.kbLast.pageId) || null,
  loadedPageId: null, // yazı alanına en son yüklenen başlık (yazarken alanı yeniden doldurmamak için)
  query: '',
  renaming: null,
  saveTimer: null,
  savedAt: 0,
};

const kbProject = () => data.projects.find((p) => p.id === kb.projectId) || null;
const kbPage = () => data.pages.find((p) => p.id === kb.pageId) || null;
const kbPagesOf = (projectId) => data.pages.filter((p) => p.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt);

function kbEnsureSelection() {
  if (!kbProject()) {
    const first = [...data.projects].sort((a, b) => a.createdAt - b.createdAt)[0];
    kb.projectId = first ? first.id : null;
  }
  const pages = kbPagesOf(kb.projectId);
  if (!pages.some((p) => p.id === kb.pageId)) kb.pageId = pages[0] ? pages[0].id : null;
}

function kbRemember() {
  data.kbLast = { projectId: kb.projectId, pageId: kb.pageId };
  writeData(data);
}

function kbPreview(body) {
  const line = (body || '').split('\n').map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, 80) : 'Boş';
}

function kbProjectItem(project, count) {
  if (kb.renaming === project.id) {
    const input = h('input', { class: 'kb-rename', value: project.name, maxlength: 60 });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name) project.name = name;
      kb.renaming = null;
      commit();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    setTimeout(() => { input.focus(); input.select(); });
    return h('li', { class: 'kb-item active' }, icon('i-folder'), input);
  }
  return h('li', {
    class: project.id === kb.projectId ? 'kb-item active' : 'kb-item',
    title: 'Yeniden adlandırmak için çift tıkla',
    onclick: () => kbSelectProject(project.id),
    ondblclick: () => kbStartRename(project.id),
  },
  icon('i-folder'),
  h('span', { class: 'kb-item-text' }, h('strong', { text: project.name })),
  h('span', { class: 'kb-count', text: count }),
  h('span', { class: 'kb-actions' },
    h('button', { class: 'icon-btn sm', title: 'Yeniden adlandır', 'aria-label': 'Projeyi yeniden adlandır', onclick: (e) => { e.stopPropagation(); kbStartRename(project.id); } }, icon('i-pencil')),
    h('button', { class: 'icon-btn sm', title: 'Projeyi sil', 'aria-label': 'Projeyi sil', onclick: (e) => { e.stopPropagation(); kbDeleteProject(project.id); } }, icon('i-trash'))));
}

function kbPageItem(page) {
  return h('li', {
    class: page.id === kb.pageId ? 'kb-item active' : 'kb-item',
    title: `Son düzenleme: ${new Date(page.updatedAt).toLocaleString('tr-TR')}`,
    onclick: () => kbSelectPage(page.id),
  },
  icon('i-page'),
  h('span', { class: 'kb-item-text' },
    h('strong', { text: page.title || 'Başlıksız' }),
    h('span', { text: `${agoText(page.updatedAt)} · ${kbPreview(page.body)}` })));
}

function kbCountsText(body) {
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  return `${words} kelime · ${body.length} karakter`;
}

function kbUpdateStatus() {
  const page = kbPage();
  if (!page) return;
  $('kb-save-status').textContent = kb.saveTimer
    ? 'Kaydediliyor…'
    : kb.savedAt ? `Kaydedildi · ${fmtTime(kb.savedAt)}` : `Son düzenleme: ${agoText(page.updatedAt)}`;
  $('kb-counts').textContent = kbCountsText(page.body);
}

function renderInfo() {
  kbEnsureSelection();
  const project = kbProject();
  const page = kbPage();
  $('info-sub').textContent = `${data.projects.length} proje · ${data.pages.length} başlık`;

  // Yeniden adlandırma kutusu açıkken listeyi yeniden çizme (yazılan ad kaybolmasın).
  if (!(kb.renaming && document.querySelector('#kb-projects .kb-rename'))) {
    const counts = countBy(data.pages, 'projectId');
    $('kb-projects').replaceChildren(...[...data.projects]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((p) => kbProjectItem(p, counts.get(p.id) || 0)));
  }

  $('kb-pages-title').textContent = project ? project.name : 'Başlıklar';
  $('kb-new-page').disabled = !project;
  $('info-new-page-hero').disabled = !project;
  $('kb-search').disabled = !project;

  const all = project ? kbPagesOf(project.id) : [];
  const q = lower(kb.query.trim());
  const pages = all.filter((p) => !q || lower(p.title).includes(q) || lower(p.body).includes(q));
  $('kb-pages').replaceChildren(...pages.map(kbPageItem));
  $('kb-pages-empty').hidden = pages.length > 0;
  $('kb-pages-empty').textContent = !project
    ? 'Önce soldan bir proje oluştur.'
    : all.length ? 'Aramana uyan başlık yok.' : 'Bu projede henüz başlık yok. Yukarıdaki + ile ekle.';

  $('kb-editor-body').hidden = !page;
  $('kb-editor-empty').hidden = !!page;
  $('kb-editor-empty-text').textContent = !data.projects.length
    ? 'Soldan ilk projeni oluştur, sonra altına başlıklar ekleyip öğrendiklerini yaz.'
    : 'Bir başlık seç ya da yeni bir başlık oluştur.';

  if (page && kb.loadedPageId !== page.id) {
    $('kb-page-title').value = page.title;
    $('kb-text').value = page.body;
    $('kb-text').scrollTop = 0;
    kb.loadedPageId = page.id;
    kb.savedAt = 0;
  }
  if (!page) kb.loadedPageId = null;
  kbUpdateStatus();
}

// Yazarken her tuşta değil, yazmaya ara verince kaydet.
function kbSaveSoon() {
  clearTimeout(kb.saveTimer);
  kb.saveTimer = setTimeout(kbSaveNow, 500);
  kbUpdateStatus();
}

function kbSaveNow() {
  clearTimeout(kb.saveTimer);
  kb.saveTimer = null;
  if (!writeData(data)) {
    showToast('Not kaydedilemedi!');
    return;
  }
  kb.savedAt = Date.now();
  renderInfo();
  renderNav();
}

function kbFlush() {
  if (kb.saveTimer) kbSaveNow();
}

function kbSelectProject(id) {
  kbFlush();
  kb.projectId = id;
  kb.pageId = null;
  kb.query = '';
  $('kb-search').value = '';
  kbEnsureSelection();
  kbRemember();
  renderInfo();
}

function kbSelectPage(id) {
  kbFlush();
  kb.pageId = id;
  kbRemember();
  renderInfo();
  $('kb-text').focus();
}

function kbNewPage() {
  const project = kbProject();
  if (!project) {
    $('kb-project-name').focus();
    return;
  }
  kbFlush();
  const now = Date.now();
  const page = { id: uid(), projectId: project.id, title: 'Yeni başlık', body: '', createdAt: now, updatedAt: now };
  data.pages.push(page);
  kb.pageId = page.id;
  kb.query = '';
  $('kb-search').value = '';
  data.kbLast = { projectId: kb.projectId, pageId: kb.pageId };
  commit();
  $('kb-page-title').focus();
  $('kb-page-title').select();
}

function kbStartRename(id) {
  kb.renaming = id;
  renderInfo();
}

function kbDeleteProject(id) {
  const project = data.projects.find((p) => p.id === id);
  if (!project) return;
  const pages = data.pages.filter((p) => p.projectId === id);
  const question = pages.length
    ? `"${project.name}" projesi ve içindeki ${pages.length} başlık silinsin mi?`
    : `"${project.name}" projesi silinsin mi?`;
  if (!confirm(question)) return;
  kbFlush();
  data.projects = data.projects.filter((p) => p.id !== id);
  data.pages = data.pages.filter((p) => p.projectId !== id);
  commit();
  showToast('Proje silindi', () => {
    data.projects.push(project);
    data.pages.push(...pages);
    kb.projectId = project.id;
    commit();
  });
}

$('kb-project-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('kb-project-name').value.trim();
  if (!name) return;
  kbFlush();
  const project = { id: uid(), name, createdAt: Date.now() };
  data.projects.push(project);
  kb.projectId = project.id;
  kb.pageId = null;
  $('kb-project-name').value = '';
  data.kbLast = { projectId: kb.projectId, pageId: null };
  commit();
});

$('kb-new-page').addEventListener('click', kbNewPage);
$('info-new-page-hero').addEventListener('click', kbNewPage);

$('kb-delete-page').addEventListener('click', () => {
  const page = kbPage();
  if (!page) return;
  clearTimeout(kb.saveTimer);
  kb.saveTimer = null;
  removeWithUndo('pages', page.id, `"${page.title || 'Başlıksız'}" silindi`);
});

$('kb-search').addEventListener('input', (e) => {
  kb.query = e.target.value;
  renderInfo();
});

$('kb-page-title').addEventListener('input', (e) => {
  const page = kbPage();
  if (!page) return;
  page.title = e.target.value;
  page.updatedAt = Date.now();
  kbSaveSoon();
});

$('kb-page-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('kb-text').focus();
  }
});

$('kb-text').addEventListener('input', (e) => {
  const page = kbPage();
  if (!page) return;
  page.body = e.target.value;
  page.updatedAt = Date.now();
  $('kb-counts').textContent = kbCountsText(page.body);
  kbSaveSoon();
});

// Tab tuşu, not defterindeki gibi girinti eklesin (Ctrl+Z ile geri alınabilir).
$('kb-text').addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    document.execCommand('insertText', false, '\t');
  }
});

// Uygulama kapanırken bekleyen notu kaydet.
window.addEventListener('beforeunload', kbFlush);

/* ---------- Tema (açık / karanlık) ---------- */
// Kullanıcı seçim yapana kadar Windows'un tema ayarı izlenir; seçim data.theme'e kaydedilir.

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => data.theme || (systemDark.matches ? 'dark' : 'light');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === 'dark' ? 'Aydınlık moda geç' : 'Karanlık moda geç';
  $('theme-toggle').title = label;
  $('theme-toggle').setAttribute('aria-label', label);
  if (window.store && window.store.setTheme) window.store.setTheme(theme, !!data.theme);
}

// Yeni tema, butonun olduğu köşeden daire şeklinde yayılarak gelir.
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  data.theme = next;
  writeData(data);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduceMotion) {
    applyTheme(next);
    return;
  }
  const rect = $('theme-toggle').getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = document.startViewTransition(() => applyTheme(next));
  transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 700, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  }).catch(() => {});
}

$('theme-toggle').addEventListener('click', toggleTheme);
systemDark.addEventListener('change', () => { if (!data.theme) applyTheme(currentTheme()); });
applyTheme(currentTheme());

/* ---------- Genel ---------- */

document.querySelectorAll('.nav-item').forEach((btn) =>
  btn.addEventListener('click', () => setView(btn.dataset.view)));

document.querySelectorAll('[data-focus]').forEach((btn) =>
  btn.addEventListener('click', () => {
    formResetters[{ tasks: 'tasks', ideas: 'ideas', sport: 'sports' }[state.view]]();
    $(btn.dataset.focus).focus();
  }));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.view === 'tasks' && state.editTask) setTaskForm(null);
    if (state.view === 'ideas' && state.editIdea) setIdeaForm(null);
    else if (state.view === 'ideas' && state.selectedIdea) { state.selectedIdea = null; renderIdeas(); }
    if (state.view === 'sport' && state.editSport) setSportForm(null);
  }
  if (e.ctrlKey && e.key.toLowerCase() === 's' && state.view === 'info') {
    e.preventDefault();
    kbSaveNow();
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'n' && state.view === 'info') {
    e.preventDefault();
    kbNewPage();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    $({ tasks: 'task-title', focus: 'timer-label', ideas: 'idea-title', sport: 'sport-type' }[state.view]).focus();
  }
  // Boşluk: odaktaki butona tıklamak yerine zamanlayıcıyı başlat/duraklat (yazı yazarken değil).
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (e.code === 'Space' && state.view === 'focus' && !typing) {
    e.preventDefault();
    if (!e.repeat) toggleTimer();
  }
});

// Gece yarısı geçince "bugün"ü ilerlet; ayrıca "şu an" vurgusunu güncel tut.
setInterval(() => {
  const now = todayKey();
  if (now !== state.today) {
    if (state.selected === state.today) state.selected = now;
    state.today = now;
    state.calMonth = monthStart(fromKey(state.selected));
  }
  render();
}, 30000);

setSportForm(null);
render();
$('task-title').focus();
