// Control Panel logic. All match data lives in `state` and is mirrored to localStorage
// on every change, so the TV and a refreshed Control Panel always see the same thing.

let state = loadState();
const $ = id => document.getElementById(id);
const SIDES = ['home', 'away'];

// ---------- persistence + render ----------

function commit() {
  saveState(state);
  render();
}

// ---------- game clock ----------
// The clock is driven by wall time (tickRef), not by counting interval calls, so it
// stays exact even if the browser throttles timers or the page is refreshed mid-game.

// The part of a second already run when Stop is pressed is kept (fracMs) and used on the
// next Start, so stoppages don't add time to the match.
function start() {
  if (state.running || state.clock >= MAX_CLOCK) return;
  clearTimeoutState();                   // play resumes: a running timeout ends early
  state.running = true;
  state.tickRef = Date.now() - (state.fracMs || 0);
  state.fracMs = 0;
  commit();
}

function stop() {
  if (!state.running) return;
  pump();
  if (!state.running) return; // pump hit an automatic stop exactly now
  state.running = false;
  state.fracMs = Math.max(0, Math.min(999, Date.now() - state.tickRef));
  commit();
}

function pump() {
  if (!state.running) return;
  const now = Date.now();
  let changed = false;
  while (state.running && now - state.tickRef >= 1000) {
    state.tickRef += 1000;
    if (tick()) buzz(state.tickRef);     // half time / full time
    changed = true;
  }
  if (changed) commit();
}

// One second of game time: advance the clock, count down every active suspension,
// then stop automatically on half time / full time / 99:59.
// Returns true when it stopped on half time or full time (the buzzer moments).
function tick() {
  state.clock = Math.min(MAX_CLOCK, state.clock + 1);
  for (const side of SIDES) {
    state.susp[side] = state.susp[side].map(r => (r > 0 ? r - 1 : 0));
  }
  clearEndedNumbers();
  const t = MATCH_TYPES[state.matchType];
  if (state.clock === t.half || state.clock === t.full) {
    state.running = false;
    return true;
  }
  if (state.clock >= MAX_CLOCK) state.running = false;
  return false;
}

// ---------- buzzer + team timeouts ----------
// The buzzer itself plays on the TV page; here we only publish "buzz now" in the state.

function buzz(at) {
  state.buzzSeq += 1;
  state.buzzAt = at || Date.now();
}

function buzzNow() {
  buzz();
  commit();
}

function clearTimeoutState() {
  state.timeoutSide = '';
  state.timeoutEnd = 0;
  state.timeoutLeft = 0;
}

// Team timeout: every timer stops, the buzzer sounds, and a 1:00 countdown starts.
function callTimeout(side) {
  if (state.timeoutSide) return;
  if (state.running) {
    pump();
    state.running = false;
    state.fracMs = Math.max(0, Math.min(999, Date.now() - state.tickRef));
  }
  state.timeoutSide = side;
  state.timeoutEnd = Date.now() + TIMEOUT_SECONDS * 1000;
  state.timeoutLeft = TIMEOUT_SECONDS;
  buzz();
  commit();
}

function cancelTimeout() {
  if (!state.timeoutSide) return;
  clearTimeoutState();
  commit();
}

// Runs with the clock pump. The timeout counts in real time (game clock is stopped);
// at 0:00 it ends quietly (the buzzer only sounds when it starts) and the clock waits for Start.
function pumpTimeout() {
  if (!state.timeoutSide) return;
  const left = Math.max(0, Math.ceil((state.timeoutEnd - Date.now()) / 1000));
  if (left === 0) {
    clearTimeoutState();
    commit();
  } else if (left !== state.timeoutLeft) {
    state.timeoutLeft = left;
    commit();
  }
}

// Manual adjustments never trigger the automatic stops.
// Suspensions that have already started counting move with the clock (clock +1s → suspension −1s),
// capped at 02:00; one that reaches 00:00 ends. Armed ones still at 02:00 are left alone.
function adjust(delta) {
  let c = state.clock;
  if (delta === -1 && c === 0) return;
  c = Math.max(0, Math.min(MAX_CLOCK, c + delta));
  const applied = c - state.clock; // may be smaller than delta at the 00:00 / 99:59 limits
  for (const side of SIDES) {
    state.susp[side] = state.susp[side].map(r =>
      (r > 0 && r < SUSP_SECONDS) ? Math.max(0, Math.min(SUSP_SECONDS, r - applied)) : r);
  }
  clearEndedNumbers();
  state.clock = c;
  if (c >= MAX_CLOCK) state.running = false;
  commit();
}

// ---------- score ----------

function changeScore(side, delta) {
  const key = side + 'Score';
  state[key] = Math.max(0, state[key] + delta);
  commit();
}

// ---------- suspensions ----------

// `number` is the jersey number typed in that row ('' = none, the TV then shows 2′).
function armSuspension(side, i, number) {
  if (state.susp[side][i] > 0) return; // already active: don't restart
  state.susp[side][i] = SUSP_SECONDS;
  state.suspNo[side][i] = cleanJersey(number);
  commit();
}

function cancelSuspension(side, i) {
  state.susp[side][i] = 0;
  state.suspNo[side][i] = '';
  commit();
}

// A slot that is no longer active forgets its jersey number.
function clearEndedNumbers() {
  for (const side of SIDES) {
    state.suspNo[side] = state.suspNo[side].map((n, i) => (state.susp[side][i] > 0 ? n : ''));
  }
}

// ---------- names ----------

function setName(key, inputId) {
  const v = $(inputId).value.trim();
  if (key.endsWith('Short')) state[key] = v || '???';
  else state[key] = v;
  commit();
}

// ---------- team logos ----------
// The picked image is scaled down to fit 200×200 and kept as PNG (transparency survives),
// so it stays small enough for localStorage.

function readLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 200 / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(); };
    img.src = url;
  });
}

async function setLogo(side, file) {
  let data = '';
  if (file) {
    try { data = await readLogo(file); } catch (e) { alert('Сликата не може да се отвори.'); return; }
  }
  if (!saveLogo(side, data)) { alert('Нема доволно место за логото. Пробајте помала слика.'); return; }
  renderLogos();
}

const shownLogos = { home: null, away: null };

function renderLogos() {
  for (const side of SIDES) {
    const data = loadLogo(side);
    if (data === shownLogos[side]) continue;
    shownLogos[side] = data;
    const cap = side === 'home' ? 'Home' : 'Away';
    const circle = $('ov' + cap + 'Logo');
    circle.classList.toggle('has-logo', !!data);
    circle.querySelector('img').src = data || '';
    const prev = $(side + 'LogoPrev');
    prev.classList.toggle('has-logo', !!data);
    prev.style.backgroundImage = data ? `url("${data}")` : '';
  }
}

// ---------- match type ----------

function setMatchType(type) {
  if (state.running || !MATCH_TYPES[type]) return;
  state.matchType = type;
  commit();
}

// ---------- full reset ----------

function resetAll() {
  if (!confirm('Дали сте сигурни дека сакате да ресетирате сè?')) return;
  state = defaultState(state.matchType);
  for (const id of ['homeShortInput', 'awayShortInput', 'homeTvInput', 'awayTvInput']) $(id).value = '';
  document.querySelectorAll('.susp-no').forEach(el => { el.value = ''; });
  saveLogo('home', '');
  saveLogo('away', '');
  renderLogos();
  commit();
}

// ---------- rendering ----------

function renderSuspList(side) {
  const list = $(side + 'SuspList');
  if (!list.children.length) {
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div');
      row.className = 'susp-row';
      row.innerHTML =
        `<span class="susp-idx">${i + 1}</span>` +
        `<input class="susp-no" id="${side}SuspNo${i}" type="text" inputmode="numeric" maxlength="2" placeholder="#" autocomplete="off" aria-label="Број на играч, исклучување ${i + 1}">` +
        `<span class="susp-time">02:00</span>` +
        `<button class="btn btn-arm">02:00</button>` +
        `<button class="btn btn-ghost btn-sm">Reset</button>`;
      const no = row.querySelector('.susp-no');
      const arm = () => armSuspension(side, i, no.value);
      no.addEventListener('input', () => { no.value = cleanJersey(no.value); });
      no.addEventListener('keydown', e => { if (e.key === 'Enter') arm(); });
      row.querySelector('.btn-arm').addEventListener('click', arm);
      row.querySelector('.btn-sm').addEventListener('click', () => cancelSuspension(side, i));
      list.appendChild(row);
    }
  }
  state.susp[side].forEach((r, i) => {
    const row = list.children[i];
    const active = r > 0;
    row.classList.toggle('active', active);
    row.classList.toggle('counting', active && state.running);
    row.querySelector('.susp-time').textContent = active ? fmtClock(r) : '02:00';
    row.querySelector('.btn-arm').disabled = active;
    // while active the box shows the stored number (locked); when the slot ends it is emptied once
    const no = row.querySelector('.susp-no');
    if (active) no.value = state.suspNo[side][i];
    else if (row.dataset.wasActive === '1') no.value = '';
    no.disabled = active;
    row.dataset.wasActive = active ? '1' : '0';
  });
}

function renderOverlayBadges(side) {
  const box = $(side === 'home' ? 'ovHomeSusp' : 'ovAwaySusp');
  const html = state.susp[side].filter(r => r > 0).map(r => `<span>${fmtClock(r)}</span>`).join('');
  if (box.innerHTML !== html) box.innerHTML = html;
}

let lastNames = '';

function render() {
  // overlay
  $('ovHomeScore').textContent = state.homeScore;
  $('ovAwayScore').textContent = state.awayScore;
  $('ovClock').textContent = fmtClock(state.clock);
  // the stream shows only "ТАЈМ-АУТ" + team, without the countdown
  const tLabel = state.timeoutSide
    ? `ТАЈМ-АУТ ${state[state.timeoutSide + 'Short'] === '???' ? '' : state[state.timeoutSide + 'Short']}`.trim()
    : periodLabel(state);
  if ($('ovPeriod').textContent !== tLabel) {
    $('ovPeriod').textContent = tLabel;
    fitText($('ovPeriod'), 13, 8);
  }
  $('ovPeriod').classList.toggle('is-timeout', !!state.timeoutSide);
  const names = state.homeShort + '|' + state.awayShort;
  if (names !== lastNames) {
    lastNames = names;
    $('ovHomeName').textContent = state.homeShort;
    $('ovAwayName').textContent = state.awayShort;
    fitText($('ovHomeName'), 22, 9);
    fitText($('ovAwayName'), 22, 9);
  }
  SIDES.forEach(renderOverlayBadges);

  // controls
  $('homeScore').textContent = state.homeScore;
  $('awayScore').textContent = state.awayScore;
  $('clock').textContent = fmtClock(state.clock);
  $('clockState').textContent = state.running ? 'Тече' : 'Запрено';
  document.body.classList.toggle('is-running', state.running);
  $('startBtn').disabled = state.running || state.clock >= MAX_CLOCK;
  $('stopBtn').disabled = !state.running;
  SIDES.forEach(renderSuspList);

  const to = state.timeoutSide;
  $('timeoutBox').hidden = !to;
  if (to) {
    $('timeoutTeam').textContent = to === 'home' ? 'Домаќини' : 'Гости';
    $('timeoutLeft').textContent = fmtSusp(state.timeoutLeft);
  }
  document.querySelectorAll('[data-timeout]').forEach(b => { b.disabled = !!to; });

  const t = MATCH_TYPES[state.matchType];
  document.querySelectorAll('.type-switch .seg').forEach(b => {
    const on = b.dataset.type === state.matchType;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
    b.disabled = state.running;
  });
  $('typeHint').textContent = `Автоматски стоп: ${fmtClock(t.half)} и ${fmtClock(t.full)}`;
}

// ---------- wiring ----------

function init() {
  // prefill inputs with the saved names so a refresh doesn't look empty
  $('homeShortInput').value = state.homeShort === '???' ? '' : state.homeShort;
  $('awayShortInput').value = state.awayShort === '???' ? '' : state.awayShort;
  $('homeTvInput').value = state.homeTv;
  $('awayTvInput').value = state.awayTv;

  const nameBindings = [
    ['homeShortBtn', 'homeShortInput', 'homeShort'],
    ['awayShortBtn', 'awayShortInput', 'awayShort'],
    ['homeTvBtn', 'homeTvInput', 'homeTv'],
    ['awayTvBtn', 'awayTvInput', 'awayTv'],
  ];
  for (const [btn, input, key] of nameBindings) {
    $(btn).addEventListener('click', () => setName(key, input));
    $(input).addEventListener('keydown', e => { if (e.key === 'Enter') setName(key, input); });
  }

  for (const side of SIDES) {
    const input = $(side + 'LogoFile');
    input.addEventListener('change', () => {
      if (input.files[0]) setLogo(side, input.files[0]);
      input.value = '';
    });
    $(side + 'LogoClear').addEventListener('click', () => setLogo(side, null));
  }
  renderLogos();

  document.querySelectorAll('[data-score]').forEach(b =>
    b.addEventListener('click', () => changeScore(b.dataset.score, Number(b.dataset.delta))));
  document.querySelectorAll('[data-adj]').forEach(b =>
    b.addEventListener('click', () => adjust(Number(b.dataset.adj))));
  document.querySelectorAll('.type-switch .seg').forEach(b =>
    b.addEventListener('click', () => setMatchType(b.dataset.type)));

  $('startBtn').addEventListener('click', start);
  $('stopBtn').addEventListener('click', stop);
  $('resetBtn').addEventListener('click', resetAll);
  document.querySelectorAll('[data-timeout]').forEach(b =>
    b.addEventListener('click', () => callTimeout(b.dataset.timeout)));
  $('timeoutCancel').addEventListener('click', cancelTimeout);
  $('buzzBtn').addEventListener('click', buzzNow);
  $('openTv').addEventListener('click', () => window.open('Televizor.html', 'televizor'));

  // Buttons drop focus after a click so Space can't "press" them again.
  document.addEventListener('click', e => {
    if (e.target.closest('button')) document.activeElement.blur();
  });

  // Keyboard shortcuts use physical keys (e.code), so they work on the Macedonian layout too.
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea') || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    const actions = {
      Space: () => (state.running ? stop() : start()),
      KeyQ: () => changeScore('home', 1),
      KeyA: () => changeScore('home', -1),
      KeyP: () => changeScore('away', 1),
      KeyL: () => changeScore('away', -1),
    };
    if (actions[e.code]) { e.preventDefault(); actions[e.code](); }
  });

  commit();                 // publish current state (also normalises old/missing data)
  // checked every 20 ms so the half/full-time stop (and its buzzer) fire within 20 ms of the second;
  // also catches up at once after a refresh
  setInterval(() => { pump(); pumpTimeout(); }, 20);
  pump();
  pumpTimeout();
}

init();
