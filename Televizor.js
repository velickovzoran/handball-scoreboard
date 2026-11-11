// Arena TV: display only. Redraws whenever the Control Panel writes new data.
// Double-click anywhere toggles full screen.

const $ = id => document.getElementById(id);
let lastRaw = null;
let lastNames = '';
const shownLogos = { home: null, away: null };

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

function renderSusp(boxId, arr) {
  const html = arr.filter(r => r > 0).map(r =>
    `<div class="pill${r <= 10 ? ' ending' : ''}"><span class="tag">2′</span><span class="t">${fmtSusp(r)}</span></div>`
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
  $('period').textContent = periodLabel(s);

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

  renderSusp('homeSusp', s.susp.home);
  renderSusp('awaySusp', s.susp.away);
}

window.addEventListener('storage', () => refresh());
window.addEventListener('resize', () => refresh(true));
setInterval(refresh, 100); // fallback in case storage events are not delivered (e.g. file://)

document.addEventListener('dblclick', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

refresh(true);
