// Shared state + helpers for the Control Panel (index.html) and the arena TV (Televizor.html).
// Both pages must run in the same browser, from the same folder, so they share localStorage.

const STORAGE_KEY = 'hb_scoreboard_v2';
const SUSP_SECONDS = 120;   // 2-minute suspension
const MAX_CLOCK = 99 * 60 + 59;
const MATCH_TYPES = {
  seniors:  { label: 'Сениори', half: 30 * 60, full: 60 * 60 },
  pioneers: { label: 'Пионери', half: 20 * 60, full: 40 * 60 },
};

function defaultState(matchType) {
  return {
    v: 2,
    homeShort: '???',   // broadcast overlay name
    awayShort: '???',
    homeTv: '',         // arena TV full name
    awayTv: '',
    homeScore: 0,
    awayScore: 0,
    clock: 0,           // game time in whole seconds
    running: false,
    tickRef: 0,         // wall-clock ms of the last counted second (while running)
    fracMs: 0,          // part of the current second already run when the clock was stopped
    matchType: MATCH_TYPES[matchType] ? matchType : 'seniors',
    // remaining seconds per slot; 0 = idle (no suspension)
    susp: { home: [0, 0, 0], away: [0, 0, 0] },
  };
}

function loadState() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { raw = null; }
  const s = defaultState(raw && raw.matchType);
  if (!raw || typeof raw !== 'object') return s;
  for (const k of Object.keys(s)) {
    if (k === 'susp') continue;
    if (typeof raw[k] === typeof s[k]) s[k] = raw[k];
  }
  if (raw.susp) {
    for (const side of ['home', 'away']) {
      const arr = raw.susp[side];
      if (Array.isArray(arr)) s.susp[side] = [0, 1, 2].map(i => clampInt(arr[i], 0, SUSP_SECONDS));
    }
  }
  s.clock = clampInt(s.clock, 0, MAX_CLOCK);
  s.fracMs = clampInt(s.fracMs, 0, 999);
  return s;
}

function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* storage full or blocked */ }
}

function clampInt(n, min, max) {
  n = Math.floor(Number(n) || 0);
  return Math.max(min, Math.min(max, n));
}

// Team logos are kept under their own keys (data URLs), so the main state that is
// rewritten every second stays small.
const LOGO_KEYS = { home: 'hb_logo_home', away: 'hb_logo_away' };

function loadLogo(side) {
  try { return localStorage.getItem(LOGO_KEYS[side]) || ''; } catch (e) { return ''; }
}

// Returns false if the browser refused to store it (storage full).
function saveLogo(side, dataUrl) {
  try {
    if (dataUrl) localStorage.setItem(LOGO_KEYS[side], dataUrl);
    else localStorage.removeItem(LOGO_KEYS[side]);
    return true;
  } catch (e) {
    return false;
  }
}

// Period text derived from the clock and match type.
function periodLabel(s) {
  const t = MATCH_TYPES[s.matchType];
  if (s.clock < t.half) return '1. ПОЛУВРЕМЕ';
  if (s.clock === t.half && !s.running) return 'ПАУЗА';
  if (s.clock < t.full) return '2. ПОЛУВРЕМЕ';
  if (s.clock === t.full && !s.running) return 'КРАЈ';
  return 'ПРОДОЛЖЕНИЕ';
}

function pad2(n) { return String(n).padStart(2, '0'); }

// 754 -> "12:34"
function fmtClock(sec) { return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60); }

// 119 -> "1:59" (suspension badges)
function fmtSusp(sec) { return Math.floor(sec / 60) + ':' + pad2(sec % 60); }

// Shrinks an element's font until its text fits on one line.
function fitText(el, maxPx, minPx) {
  el.style.fontSize = maxPx + 'px';
  let size = maxPx;
  while (size > minPx && el.scrollWidth > el.clientWidth + 1) {
    size -= 1;
    el.style.fontSize = size + 'px';
  }
}
