// Arena TV: display only. Redraws whenever the Control Panel writes new data.
// Double-click anywhere toggles full screen. The buzzer plays from this page.

const $ = id => document.getElementById(id);
let lastRaw = null;
let lastNames = '';
const shownLogos = { home: null, away: null };
let lastBuzzSeq = null; // null until the first read, so opening the page never buzzes

// ---------- buzzer ----------
// Browsers keep sound blocked until someone clicks the page once, so a banner asks for
// that click. (Chrome started with --autoplay-policy=no-user-gesture-required skips it.)

let audio = null;

function audioCtx() {
  if (!audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audio = new Ctx();
  }
  return audio;
}

// Arena horn: a few detuned square/saw tones through a low-pass filter and a compressor.
function playHorn(ms) {
  const ctx = audioCtx();
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const t1 = t0 + ms / 1000;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(0.9, t0 + 0.03);
  out.gain.setValueAtTime(0.9, Math.max(t0 + 0.03, t1 - 0.08));
  out.gain.linearRampToValueAtTime(0, t1);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const comp = ctx.createDynamicsCompressor();
  lp.connect(out);
  out.connect(comp);
  comp.connect(ctx.destination);
  for (const [freq, type, level] of [[233, 'square', .35], [236, 'sawtooth', .2], [311, 'sawtooth', .3], [466, 'square', .15]]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = level;
    osc.connect(g);
    g.connect(lp);
    osc.start(t0);
    osc.stop(t1 + 0.05);
  }
}

// buzzer.mp3 from the project folder. A plain <audio> element is used because it also
// plays when the page is opened straight from disk (file://). If the file is missing or
// can't be played, the generated horn above is used instead.
// The file starts with ~0.19 s of silence, so playback starts there for an instant buzz.
const BUZZER_START = 0.19;
const buzzerFile = new Audio('buzzer.mp3');
buzzerFile.preload = 'auto';
let buzzerFileOk = false;
let buzzerTimers = [];
buzzerFile.addEventListener('canplaythrough', () => { buzzerFileOk = true; });
buzzerFile.addEventListener('error', () => { buzzerFileOk = false; });
buzzerFile.addEventListener('loadedmetadata', () => { buzzerFile.currentTime = BUZZER_START; });
buzzerFile.addEventListener('ended', () => { buzzerFile.currentTime = BUZZER_START; });

// Plays the file for `ms`, then fades it out over 150 ms (in case the file is longer).
// Between buzzes the element is kept parked at BUZZER_START, so play() starts without a seek.
function playBuzzerFile(ms) {
  buzzerTimers.forEach(clearTimeout);
  buzzerTimers = [];
  buzzerFile.volume = 1;
  if (!buzzerFile.paused) buzzerFile.pause();
  if (Math.abs(buzzerFile.currentTime - BUZZER_START) > 0.01) buzzerFile.currentTime = BUZZER_START;
  buzzerFile.play().catch(() => playHorn(ms));
  const fadeStart = Math.max(0, ms - 150);
  for (let i = 1; i <= 5; i++) {
    buzzerTimers.push(setTimeout(() => {
      buzzerFile.volume = Math.max(0, 1 - i / 5);
      if (i === 5) { buzzerFile.pause(); buzzerFile.currentTime = BUZZER_START; }
    }, fadeStart + i * 30));
  }
}

function playBuzzer(ms) {
  if (buzzerFileOk) playBuzzerFile(ms);
  else playHorn(ms);
}

function updateSoundGate() {
  const ctx = audioCtx();
  $('soundGate').hidden = !ctx || ctx.state === 'running';
}

function unlockSound() {
  const ctx = audioCtx();
  if (ctx && ctx.state !== 'running') ctx.resume().then(updateSoundGate, updateSoundGate);
}

// Plays only buzzes that are new and still due (not ones from before the page opened).
function checkBuzz(s) {
  if (lastBuzzSeq === null) { lastBuzzSeq = s.buzzSeq; return; }
  if (s.buzzSeq === lastBuzzSeq) return;
  lastBuzzSeq = s.buzzSeq;
  const late = Date.now() - s.buzzAt;
  if (s.buzzAt && late < BUZZ_MS - 300) playBuzzer(BUZZ_MS - Math.max(0, late));
}

// Long names may wrap to a second line; shrink only as much as needed to fit the bar.
function fitName(el, maxPx) {
  const box = el.parentNode;
  let size = maxPx;
  el.style.fontSize = size + 'px';
  while (size > 10 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > box.clientHeight)) {
    size -= 1;
    el.style.fontSize = size + 'px';
  }
}

// The tag shows the player's jersey number, or 2′ when none was entered.
function renderSusp(boxId, arr, numbers) {
  const html = arr.map((r, i) => [r, numbers[i]]).filter(([r]) => r > 0).map(([r, no]) =>
    `<div class="pill${r <= 10 ? ' ending' : ''}"><span class="tag${no ? ' no' : ''}">${no || '2′'}</span><span class="t">${fmtSusp(r)}</span></div>`
  ).join('');
  const box = $(boxId);
  if (box.innerHTML !== html) box.innerHTML = html;
}

function renderLogos() {
  for (const side of ['home', 'away']) {
    const data = loadLogo(side);
    if (data === shownLogos[side]) continue;
    shownLogos[side] = data;
    const el = $(side + 'Logo');
    el.classList.toggle('has-logo', !!data);
    el.querySelector('img').src = data || '';
    lastNames = ''; // name width changes when a logo appears/disappears
  }
}

function refresh(force) {
  renderLogos();

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!force && raw === lastRaw && lastNames) return;
  lastRaw = raw;
  const s = loadState();

  $('homeScore').textContent = s.homeScore;
  $('awayScore').textContent = s.awayScore;
  $('clock').textContent = fmtClock(s.clock);
  // team timeout: amber strip with the countdown, and the calling team's panel marked
  const period = $('period');
  period.textContent = s.timeoutSide ? 'ТАЈМ-АУТ ' + fmtSusp(s.timeoutLeft) : periodLabel(s);
  period.classList.toggle('timeout', !!s.timeoutSide);
  document.querySelector('.home').classList.toggle('on-timeout', s.timeoutSide === 'home');
  document.querySelector('.away').classList.toggle('on-timeout', s.timeoutSide === 'away');
  checkBuzz(s);

  // full TV name, falling back to the short overlay name
  const home = s.homeTv || s.homeShort;
  const away = s.awayTv || s.awayShort;
  const names = home + '|' + away + '|' + window.innerWidth + 'x' + window.innerHeight;
  if (force || names !== lastNames) {
    lastNames = names;
    $('homeName').textContent = home;
    $('awayName').textContent = away;
    // same unit as --u in Televizor.css: the board is always 16:9 and fits the screen
    const u = Math.min(window.innerWidth / 100, window.innerHeight * 16 / 9 / 100);
    const max = Math.round(u * 3.8);
    fitName($('homeName'), max);
    fitName($('awayName'), max);
  }

  renderSusp('homeSusp', s.susp.home, s.suspNo.home);
  renderSusp('awaySusp', s.susp.away, s.suspNo.away);
}

window.addEventListener('storage', () => refresh());
window.addEventListener('resize', () => refresh(true));
setInterval(refresh, 100); // fallback in case storage events are not delivered (e.g. file://)

document.addEventListener('pointerdown', unlockSound);
document.addEventListener('keydown', unlockSound);

document.addEventListener('dblclick', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

refresh(true);
updateSoundGate();
