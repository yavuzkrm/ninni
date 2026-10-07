import * as A from './analysis.js';
import * as C from './charts.js';

const { esc } = C;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const root = $('#app');

const VIEWS = [
  { key: 'home', label: 'Bugün', icon: '🌙' },
  { key: 'log', label: 'Günlük', icon: '📓' },
  { key: 'stats', label: 'Analiz', icon: '📊' },
  { key: 'report', label: 'Yorum', icon: '🧠' },
  { key: 'tools', label: 'Araçlar', icon: '🧮' },
  { key: 'settings', label: 'Ayarlar', icon: '⚙️' },
];
const RANGES = [
  { days: 7, label: '7 gün' },
  { days: 30, label: '30 gün' },
  { days: 90, label: '90 gün' },
  { days: 0, label: 'Tümü' },
];
const FACES = ['', '😣', '😕', '😐', '🙂', '😊'];
const FACE_LABELS = ['', 'Berbat', 'Kötü', 'Orta', 'İyi', 'Harika'];

const ERRORS = {
  wrong_credentials: 'Kullanıcı adı ya da şifre yanlış.',
  username_taken: 'Bu kullanıcı adı alınmış.',
  invalid_username: 'Kullanıcı adı 3–24 karakter olmalı: küçük harf, rakam, nokta ya da alt çizgi.',
  weak_password: 'Şifre en az 6 karakter olmalı.',
  wrong_password: 'Şifre yanlış.',
  too_many_attempts: 'Çok fazla deneme yaptın. Birkaç dakika sonra tekrar dene.',
  overlap: 'Bu saatler başka bir kayıtla çakışıyor.',
  too_short: 'Uyku en az 10 dakika olmalı. Uyanma saati yatış saatinden sonra mı?',
  too_long: 'Bir uyku 20 saatten uzun olamaz. Tarihleri kontrol et.',
  invalid_bed_at: 'Uyuma tarihi ya da saati geçersiz.',
  invalid_wake_at: 'Uyanma tarihi ya da saati geçersiz.',
  invalid_import: 'Yedek dosyası okunamadı.',
  network: 'Sunucuya ulaşılamadı. Bağlantını kontrol et.',
};

const state = {
  user: null,
  sleeps: [],
  view: localGet('ninni-view') || 'home',
  range: Number(localGet('ninni-range') ?? 30),
  authMode: 'login',
};

function localGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    // private mode: not remembered, that's fine
  }
}

// ---------- api ----------

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'server_error'), { code: data.error || 'server_error', status: res.status });
  return data;
}
const errText = (e) => ERRORS[e.code] || 'Bir şeyler ters gitti. Tekrar dener misin?';

function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2800);
  setTimeout(() => el.remove(), 3300);
}

// ---------- derived data ----------

const today = () => A.nowLocal().slice(0, 10);

function derive(days = state.range) {
  const goal = state.user.goalMinutes;
  const nights = A.buildNights(state.sleeps);
  const scored = A.scoreNights(nights, goal);
  const s = A.summarize(nights, { goal, ageGroup: state.user.ageGroup, today: today(), days });
  const naps = A.inRange(A.buildNaps(state.sleeps), today(), days);
  return { nights, scored, s, naps, goal };
}

// ---------- boot & sync ----------

async function boot() {
  try {
    const { user } = await api('GET', '/api/me');
    state.user = user;
    await loadSleeps();
  } catch (e) {
    if (e.code === 'network') {
      root.innerHTML = `<div class="center-card"><div class="big-emoji">📡</div><h2>Bağlantı yok</h2><p>Ninni sunucusuna ulaşılamadı.</p><button class="btn primary" data-action="reload">Tekrar dene</button></div>`;
      return;
    }
    state.user = null;
  }
  render();
}

async function loadSleeps() {
  const { sleeps } = await api('GET', '/api/sleeps');
  state.sleeps = sleeps;
}

// Other devices may have logged a night or started a live sleep: refresh quietly.
async function refresh() {
  if (!state.user || document.hidden || $('.modal-backdrop')) return;
  try {
    const [{ user }, { sleeps }] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/sleeps')]);
    const changed = JSON.stringify(user) !== JSON.stringify(state.user) || JSON.stringify(sleeps) !== JSON.stringify(state.sleeps);
    state.user = user;
    state.sleeps = sleeps;
    if (changed && !$('.modal-backdrop') && !document.activeElement?.matches('input, textarea, select')) render();
  } catch (e) {
    if (e.status === 401) {
      state.user = null;
      render();
    }
  }
}
document.addEventListener('visibilitychange', () => !document.hidden && refresh());
setInterval(refresh, 45000);

// ---------- render ----------

function render() {
  hideTip();
  if (!state.user) return renderAuth();
  if (!VIEWS.some((v) => v.key === state.view)) state.view = 'home';
  const v = VIEWS.find((x) => x.key === state.view);
  const live = state.user.sleepingSince;
  root.innerHTML = `
    <div class="shell">
      <aside class="side">
        <div class="brand"><span class="brand-moon">🌙</span><span class="brand-name">Ninni</span></div>
        <nav class="side-nav">
          ${VIEWS.map((x) => `<button class="nav-btn ${x.key === state.view ? 'on' : ''}" data-view="${x.key}"><span class="nav-ic">${x.icon}</span>${x.label}</button>`).join('')}
        </nav>
        ${live ? `<button class="side-live" data-view="home"><span class="pulse"></span>Uyuyorsun · ${A.fmtClock(A.toMin(live) % A.DAY)}'den beri</button>` : ''}
        <div class="side-user">
          <div class="avatar">${esc(state.user.displayName.slice(0, 1).toUpperCase())}</div>
          <div><div class="su-name">${esc(state.user.displayName)}</div><div class="su-handle">@${esc(state.user.username)}</div></div>
        </div>
      </aside>
      <main class="main">
        <header class="top">
          <div class="top-brand"><span class="brand-moon">🌙</span><span class="brand-name">Ninni</span></div>
          <h1 class="top-title">${v.label}</h1>
          <div class="top-actions">
            <button class="btn primary sm" data-action="add">＋ <span class="hide-xs">Uyku ekle</span></button>
            <button class="icon-btn only-mobile ${state.view === 'settings' ? 'on' : ''}" data-view="settings" aria-label="Ayarlar">⚙️</button>
          </div>
        </header>
        <div class="view view-${state.view}" id="view">${VIEW_RENDER[state.view]()}</div>
      </main>
      <nav class="tabbar">
        ${VIEWS.filter((x) => x.key !== 'settings').map((x) => `<button class="tab ${x.key === state.view ? 'on' : ''}" data-view="${x.key}"><span class="tab-ic">${x.icon}</span><span>${x.label}</span></button>`).join('')}
      </nav>
    </div>`;
  drawCharts();
  if (state.view === 'settings') bindSettings();
  if (state.view === 'tools') fillCalculators();
  startTicker();
}

let ticker = null;
function startTicker() {
  clearInterval(ticker);
  if (state.user?.sleepingSince && state.view === 'home') {
    ticker = setInterval(() => {
      const el = $('#live-elapsed');
      if (el) el.textContent = A.fmtDur(A.toMin(A.nowLocal()) - A.toMin(state.user.sleepingSince));
    }, 20000);
  }
}

// ---------- auth ----------

function renderAuth() {
  const login = state.authMode === 'login';
  root.innerHTML = `
    <div class="auth">
      <div class="auth-hero">
        <div class="auth-moon" aria-hidden="true"></div>
        <h1 class="auth-title">Ninni</h1>
        <p class="auth-tag">Gecelerini kaydet, uykunu anla.</p>
        <ul class="auth-points">
          <li><span>🌙</span>Tek dokunuşla “uyuyorum”, sabah “uyandım”</li>
          <li><span>📊</span>Uyku penceresi, 24 saatlik kadran, ısı haritası</li>
          <li><span>🧠</span>Uyku skoru, kronotip, sosyal jet-lag, uyku borcu</li>
          <li><span>☕</span>Kahve, ekran, spor… hangisi uykunu nasıl etkiliyor?</li>
        </ul>
      </div>
      <form class="auth-card" id="auth-form" autocomplete="on">
        <div class="seg">
          <button type="button" class="${login ? 'on' : ''}" data-action="auth-mode" data-mode="login">Giriş yap</button>
          <button type="button" class="${!login ? 'on' : ''}" data-action="auth-mode" data-mode="register">Hesap oluştur</button>
        </div>
        ${login ? '' : `<label class="field"><span>Adın</span><input name="displayName" maxlength="40" autocomplete="nickname" placeholder="Seni nasıl çağıralım?"></label>`}
        <label class="field"><span>Kullanıcı adı</span><input name="username" required maxlength="24" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label class="field"><span>Şifre</span><input name="password" type="password" required minlength="6" autocomplete="${login ? 'current-password' : 'new-password'}"></label>
        ${login ? '' : `<label class="field"><span>Yaş grubun</span><select name="ageGroup">${Object.entries(A.AGE_GROUPS).map(([k, g]) => `<option value="${k}" ${k === '26-64' ? 'selected' : ''}>${g.label}</option>`).join('')}</select><small>Önerilen uyku süresi yaşa göre değişir.</small></label>`}
        <p class="form-error" id="auth-error" hidden></p>
        <button class="btn primary block" type="submit">${login ? 'Giriş yap' : 'Hesabımı oluştur'}</button>
        <p class="auth-foot">Telefonda ve bilgisayarda aynı hesapla giriş yap; gecelerin her yerde aynı.</p>
      </form>
    </div>`;
  $('#auth-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const body = Object.fromEntries(f.entries());
    const btn = ev.target.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const { user } = await api('POST', login ? '/api/auth/login' : '/api/auth/register', body);
      state.user = user;
      await loadSleeps();
      state.view = 'home';
      render();
      if (!login) toast(`Hoş geldin ${user.displayName}! İlk geceni ekleyerek başla.`, 'good');
    } catch (e) {
      const el = $('#auth-error');
      el.textContent = errText(e);
      el.hidden = false;
      btn.disabled = false;
    }
  });
}

// ---------- views ----------

const VIEW_RENDER = { home: viewHome, log: viewLog, stats: viewStats, report: viewReport, tools: viewTools, settings: viewSettings };

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Hâlâ uyanık mısın';
  if (h < 12) return 'Günaydın';
  if (h < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

function emptyState() {
  return `<div class="empty">
    <div class="big-emoji">🛌</div>
    <h2>Henüz hiç gece yok</h2>
    <p>Bu gece yatarken <b>Uyumaya gidiyorum</b>’a bas, sabah <b>Uyandım</b> de. Ya da dün geceni elle ekle.</p>
    <div class="row-btns">
      <button class="btn primary" data-action="add">＋ Dün geceyi ekle</button>
      <button class="btn ghost" data-action="sample">✨ Örnek verilerle dene</button>
    </div>
  </div>`;
}

function viewHome() {
  const { scored, s, goal } = derive(30);
  const live = state.user.sleepingSince;
  const name = esc(state.user.displayName);
  let hero;
  if (live) {
    const elapsed = A.toMin(A.nowLocal()) - A.toMin(live);
    hero = `<section class="hero live">
      <div class="moon-anim" aria-hidden="true"><span>z</span><span>z</span><span>z</span></div>
      <div class="hero-text">
        <div class="eyebrow">Şu an uyuyorsun</div>
        <div class="hero-num" id="live-elapsed">${A.fmtDur(elapsed)}</div>
        <p>${A.fmtClock(A.toMin(live) % A.DAY)}’de uyudun. Uyandığında aşağıdaki düğmeye bas; başka cihazdan da bitirebilirsin.</p>
        <div class="row-btns">
          <button class="btn sun big" data-action="wake">☀️ Uyandım</button>
          <button class="btn ghost" data-action="edit-live">Saati düzelt</button>
          <button class="btn ghost" data-action="cancel-live">Vazgeç</button>
        </div>
      </div>
    </section>`;
  } else {
    const plan = A.tonightPlan(s, today());
    hero = `<section class="hero">
      <div class="hero-text">
        <div class="eyebrow">${greeting()}, ${name}</div>
        ${plan
          ? `<h2 class="hero-title">Bu gece <b>${A.fmtOff(plan.bedOff)}</b>’te uykuda olmayı hedefle</h2>
             <p>${plan.free ? 'Yarın hafta sonu' : 'Yarın'} genelde <b>${A.fmtOff(plan.wakeOff)}</b>’te kalkıyorsun, hedefin ${A.fmtDur(goal)}${plan.extra >= 5 ? ` ve ${A.fmtDur(plan.extra)} da borç ödemesi var` : ''}. Kafeini <b>${A.fmtOff(plan.caffeineCutoff)}</b>’ten sonra bırak, ekranları <b>${A.fmtOff(plan.screensOff)}</b>’te kapat.</p>`
          : `<h2 class="hero-title">Uykunu tanımaya başlayalım</h2><p>Birkaç gece kaydettiğinde sana özel yatış saati önerileri, skor ve yorumlar burada belirecek.</p>`}
        <div class="row-btns">
          <button class="btn moon big" data-action="sleep-now">🌙 Uyumaya gidiyorum</button>
          <button class="btn ghost" data-action="add">＋ Elle ekle</button>
        </div>
      </div>
    </section>`;
  }
  if (!scored.length) return hero + emptyState();

  const last = scored[scored.length - 1];
  const band = A.scoreBand(last.score.total);
  const ins = A.insights(s).slice(0, 3);
  const debtPct = Math.min(100, ((s.debt || 0) / 600) * 100);
  const debtBand = s.debt >= 300 ? 'critical' : s.debt >= 120 ? 'warning' : 'good';
  return `${hero}
  <div class="cards home-grid">
    <section class="card last-night" data-night="${last.date}">
      <div class="card-head"><h3>Son gece</h3><span class="muted">${A.fmtNight(last.date, { long: true })}</span></div>
      <div class="ln-body">
        ${C.scoreRing(last.score.total, band)}
        <div class="ln-facts">
          <div class="ln-dur">${A.fmtDur(last.dur)}</div>
          <div class="ln-window">${A.fmtOff(last.bedOff)} <span class="arrow">→</span> ${A.fmtOff(last.wakeOff)}</div>
          <p class="ln-verdict">${esc(A.nightVerdict(last, goal))}</p>
          <div class="chips">${last.quality ? `<span class="chip">${FACES[Math.round(last.quality)]} ${FACE_LABELS[Math.round(last.quality)]}</span>` : ''}${last.tags.map((t) => `<span class="chip">${A.tagInfo(t).icon} ${esc(A.tagInfo(t).label)}</span>`).join('')}</div>
        </div>
      </div>
      ${scoreParts(last.score.parts)}
    </section>
    <section class="card">
      <div class="card-head"><h3>Son 7 gece</h3><span class="muted">hedef çizgisiyle</span></div>
      ${C.weekStrip(scored, { today: today(), goal })}
      <div class="mini-stats">
        <div><span>Ortalama</span><b>${A.fmtDur(A.mean(A.inRange(scored, today(), 7).map((n) => n.dur)))}</b></div>
        <div><span>Hedef serisi</span><b>${s.goalStreak} gece</b></div>
        <div><span>Düzen</span><b>${Number.isFinite(s.regularity) ? s.regularity + '/100' : '–'}</b></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Uyku borcu</h3><span class="muted">son 14 gece</span></div>
      <div class="debt-num">${A.fmtDur(s.debt || 0)}</div>
      <div class="meter st-${debtBand}" role="meter" aria-valuemin="0" aria-valuemax="600" aria-valuenow="${Math.round(s.debt || 0)}"><div class="meter-fill" style="width:${debtPct}%"></div></div>
      <div class="meter-scale"><span>0</span><span>5 sa</span><span>10 sa</span></div>
      <p class="muted small">${s.debt >= 120 ? `Bu hafta birkaç gece ${A.fmtDur(Math.min(60, Math.ceil(s.debt / 7 / 5) * 5))} erken yatmak borcu eritir.` : 'Borcun yok denecek kadar az. Böyle devam!'}</p>
    </section>
    <section class="card insights-card">
      <div class="card-head"><h3>Öne çıkanlar</h3><button class="link" data-view="report">Tüm yorum →</button></div>
      ${ins.map(insightRow).join('') || '<p class="muted">Birkaç gece daha kaydet, yorumlar gelsin.</p>'}
    </section>
  </div>`;
}

function scoreParts(p) {
  const rows = [
    ['Süre', p.dur, 40],
    ['Kalite', p.quality, 25],
    ['Saat düzeni', p.timing, 20],
    ['Bölünmeden', p.cont, 15],
  ];
  return `<div class="parts">${rows
    .map(([l, v, max]) => `<div class="part"><span>${l}</span><div class="part-bar"><div style="width:${(v / max) * 100}%"></div></div><b>${Math.round(v)}/${max}</b></div>`)
    .join('')}</div>`;
}

const STATUS_LABEL = { good: 'İyi', warning: 'Dikkat', serious: 'Önemli', critical: 'Acil', info: 'Bilgi' };
function insightRow(i) {
  return `<div class="insight st-${i.status}">
    <div class="ins-icon" aria-hidden="true">${i.icon}</div>
    <div><div class="ins-title">${esc(i.title)} <span class="badge st-${i.status}">${STATUS_LABEL[i.status]}</span></div><p>${esc(i.text)}</p></div>
  </div>`;
}

// ----- log -----

function viewLog() {
  if (!state.sleeps.length) return emptyState();
  const nights = A.scoreNights(A.buildNights(state.sleeps), state.user.goalMinutes);
  const nightById = new Map();
  for (const n of nights) for (const id of n.ids) nightById.set(id, n);
  const sorted = [...state.sleeps].sort((a, b) => (a.bedAt < b.bedAt ? 1 : -1));
  let html = '<div class="log">';
  let month = '';
  for (const sl of sorted) {
    const n = nightById.get(sl.id);
    const date = n ? n.date : sl.bedAt.slice(0, 10);
    const mk = date.slice(0, 7);
    if (mk !== month) {
      month = mk;
      const [y, m] = mk.split('-').map(Number);
      html += `<h3 class="log-month">${['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][m - 1]} ${y}</h3>`;
    }
    const bed = A.toMin(sl.bedAt);
    const wake = A.toMin(sl.wakeAt);
    const base = A.dayStart(date) + 18 * 60;
    // track: 18:00 → 14:00 next day (20 h)
    const left = Math.max(0, ((bed - base) / 1200) * 100);
    const width = Math.max(1.5, Math.min(100 - left, ((wake - bed) / 1200) * 100));
    const nap = sl.kind === 'nap';
    const band = n && !nap ? A.scoreBand(n.score.total) : null;
    html += `<button class="log-row ${nap ? 'nap' : ''}" data-action="edit" data-id="${sl.id}">
      <div class="lr-date"><b>${nap ? 'Şekerleme' : A.fmtNight(date)}</b><span>${A.fmtClock(bed % A.DAY)} → ${A.fmtClock(wake % A.DAY)}</span></div>
      <div class="lr-track" aria-hidden="true"><div class="lr-bar ${nap ? 'nap' : n?.free ? 'free' : ''}" style="left:${left}%;width:${width}%"></div><i style="left:30%"></i><i style="left:60%"></i></div>
      <div class="lr-dur">${A.fmtDur(wake - bed)}</div>
      <div class="lr-meta">${sl.quality ? `<span title="${FACE_LABELS[sl.quality]}">${FACES[sl.quality]}</span>` : ''}${sl.tags.slice(0, 4).map((t) => `<span title="${esc(A.tagInfo(t).label)}">${A.tagInfo(t).icon}</span>`).join('')}${sl.note ? '<span title="Not var">📝</span>' : ''}</div>
      ${band ? `<div class="score-pill st-${band.status}" title="${band.label}">${n.score.total}</div>` : '<div class="score-pill none">·</div>'}
    </button>`;
  }
  html += '</div><p class="muted small center">Çubuk 18:00’den ertesi gün 14:00’e kadarki zamanı gösterir; ince çizgiler gece yarısı ve 06:00.</p>';
  return html;
}

// ----- stats -----

function rangeChips() {
  return `<div class="filters" role="group" aria-label="Zaman aralığı">${RANGES.map((r) => `<button class="chip-btn ${state.range === r.days ? 'on' : ''}" data-action="range" data-days="${r.days}">${r.label}</button>`).join('')}</div>`;
}

function tile(label, value, sub = '') {
  return `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
}

const legend2 = `<div class="legend"><span><i class="sw s1"></i>Hafta içi gecesi</span><span><i class="sw s2"></i>Cuma ve cumartesi gecesi</span></div>`;

function viewStats() {
  if (!state.sleeps.length) return emptyState();
  const { s, naps } = derive();
  const sub = (x) => (Number.isFinite(x) ? `±${Math.round(x)} dk oynuyor` : '');
  return `${rangeChips()}
  ${s.count ? `<div class="tiles">
    ${tile('Ortalama uyku', A.fmtDur(s.avgDur), `${s.count} gece · önerilen ${A.fmtHours(s.age.min)}–${A.fmtHours(s.age.max)} sa`)}
    ${tile('Ortalama uyuma', A.fmtOff(s.avgBed), sub(s.sdBed))}
    ${tile('Ortalama uyanma', A.fmtOff(s.avgWake), sub(s.sdWake))}
    ${tile('Uyku skoru', `${Math.round(s.score)}<small>/100</small>`, `<span class="badge st-${s.band.status}">${s.band.icon} ${s.band.label}</span>`)}
    ${tile('Düzen skoru', Number.isFinite(s.regularity) ? `${s.regularity}<small>/100</small>` : '–', 'saatlerin ne kadar sabit')}
    ${tile('Ortalama kalite', Number.isFinite(s.avgQuality) ? `${FACES[Math.round(s.avgQuality)]} ${s.avgQuality.toFixed(1)}` : '–', `gecede ${s.avgAwakenings.toFixed(1)} uyanma`)}
    ${tile('Şekerleme', naps.length ? `${naps.length}×` : '–', naps.length ? `ortalama ${A.fmtDur(A.mean(naps.map((n) => n.dur)))}` : 'bu aralıkta yok')}
    ${tile('Hedefte geçen gece', `%${Math.round((s.nights.filter((n) => n.dur >= s.goal - 15).length / s.count) * 100)}`, `hedef ${A.fmtDur(s.goal)}`)}
  </div>` : '<div class="empty small"><p>Bu aralıkta kayıt yok. Daha geniş bir aralık seç.</p></div>'}
  <div class="cards charts">
    <section class="card wide">
      <div class="card-head"><h3>Gece gece uyku süresi</h3><span class="muted">gölgeli bant: yaşına göre önerilen aralık</span></div>
      <div class="chart-box" data-chart="duration"></div>
      <details class="table-view"><summary>Tablo olarak göster</summary>${nightsTable(s.nights)}</details>
    </section>
    <section class="card wide">
      <div class="card-head"><h3>Uyku penceresi</h3><span class="muted">her çubuk bir gece: üst ucu uyuma, alt ucu uyanma</span></div>
      ${legend2}
      <div class="chart-box" data-chart="window"></div>
    </section>
    <section class="card">
      <div class="card-head"><h3>24 saatlik kadran</h3><span class="muted">son 14 gece, en dıştaki en yeni</span></div>
      ${legend2}
      <div class="chart-box center" data-chart="clock"></div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Haftanın günleri</h3><span class="muted">hangi gece ne kadar uyuyorsun</span></div>
      ${legend2}
      <div class="chart-box" data-chart="weekday"></div>
    </section>
    <section class="card wide">
      <div class="card-head"><h3>Takvim</h3><span class="muted">son haftalar, ${document.documentElement.dataset.theme === 'light' || (!document.documentElement.dataset.theme && !matchMedia('(prefers-color-scheme: dark)').matches) ? 'koyu' : 'parlak'} = daha uzun uyku</span></div>
      <div class="chart-box" data-chart="heatmap"></div>
      <div class="legend scale">${C.HEAT_BINS.map((b, i) => `<span><i class="sw seq${i + 1}"></i>${b.label}</span>`).join('')}<span><i class="sw cell-empty"></i>kayıt yok</span></div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Süre ve his</h3><span class="muted">uzun uyuyunca daha mı iyi hissediyorsun?</span></div>
      <div class="chart-box" data-chart="scatter"></div>
      ${Number.isFinite(s.durQualityR) ? `<p class="muted small">Bağ gücü (korelasyon): <b>${s.durQualityR.toFixed(2)}</b> — ${Math.abs(s.durQualityR) >= 0.5 ? 'güçlü' : Math.abs(s.durQualityR) >= 0.3 ? 'orta' : 'zayıf'}</p>` : ''}
    </section>
    <section class="card">
      <div class="card-head"><h3>Etiketlerin etkisi</h3><span class="muted">etiketli geceler, etiketsizlere göre</span></div>
      <div class="legend"><span><i class="sw pos"></i>daha uzun uyku</span><span><i class="sw neg"></i>daha kısa uyku</span></div>
      <div class="chart-box" data-chart="tags"></div>
    </section>
  </div>`;
}

function nightsTable(nights) {
  if (!nights.length) return '';
  return `<div class="table-wrap"><table><thead><tr><th>Gece</th><th>Uyuma</th><th>Uyanma</th><th>Süre</th><th>Kalite</th><th>Skor</th></tr></thead><tbody>${[...nights]
    .reverse()
    .map((n) => `<tr><td>${A.fmtNight(n.date)}</td><td>${A.fmtOff(n.bedOff)}</td><td>${A.fmtOff(n.wakeOff)}</td><td>${A.fmtDur(n.dur)}</td><td>${n.quality ? n.quality.toFixed(0) + '/5' : '–'}</td><td>${n.score.total}</td></tr>`)
    .join('')}</tbody></table></div>`;
}

function drawCharts() {
  const boxes = $$('[data-chart]');
  if (!boxes.length) return;
  const { s, scored } = derive();
  const opt = { today: today(), days: state.range, goal: s.goal, age: s.age };
  for (const box of boxes) {
    const width = Math.max(260, Math.floor(box.clientWidth));
    const kind = box.dataset.chart;
    const nights = s.nights || [];
    if (kind === 'duration') box.innerHTML = C.durationChart(nights, { ...opt, width });
    if (kind === 'window') box.innerHTML = C.windowChart(nights, { ...opt, width, avgBed: s.avgBed, avgWake: s.avgWake });
    if (kind === 'clock') box.innerHTML = C.clockChart(scored, { size: Math.min(320, width) });
    if (kind === 'weekday') box.innerHTML = C.weekdayChart(s.byWeekday, { width, goal: s.goal });
    if (kind === 'heatmap') box.innerHTML = C.heatmap(scored, { width, today: today() });
    if (kind === 'scatter') box.innerHTML = C.scatterChart(nights, { width });
    if (kind === 'tags') box.innerHTML = C.tagChart(s.tagImpact, { width });
  }
}
let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.innerWidth !== lastWidth) {
      lastWidth = window.innerWidth;
      drawCharts();
    }
  }, 150);
});

// ----- report -----

function normBar(s) {
  // A 4–12 h scale with the recommended band and your average on it.
  const pos = (min) => Math.max(0, Math.min(100, ((min - 240) / 480) * 100));
  return `<div class="norm">
    <div class="norm-track">
      <div class="norm-band" style="left:${pos(s.age.min)}%;width:${pos(s.age.max) - pos(s.age.min)}%"></div>
      <div class="norm-goal" style="left:${pos(s.goal)}%" title="Hedefin"></div>
      <div class="norm-you" style="left:${pos(s.avgDur)}%"><span>Sen · ${A.fmtDur(s.avgDur)}</span></div>
    </div>
    <div class="norm-scale"><span>4 sa</span><span>6 sa</span><span>8 sa</span><span>10 sa</span><span>12 sa</span></div>
    <div class="legend"><span><i class="sw band"></i>önerilen (${esc(s.age.label)})</span><span><i class="sw goal"></i>hedefin ${A.fmtDur(s.goal)}</span></div>
  </div>`;
}

function viewReport() {
  if (!state.sleeps.length) return emptyState();
  const { s } = derive();
  if (!s.count) return rangeChips() + '<div class="empty small"><p>Bu aralıkta kayıt yok.</p></div>';
  const ins = A.insights(s);
  const plan = A.tonightPlan(s, today());
  const ch = s.chronotype;
  const label = RANGES.find((r) => r.days === state.range)?.label || '';
  return `${rangeChips()}
  <section class="card report-hero">
    ${C.scoreRing(s.score, s.band, { size: 168 })}
    <div>
      <div class="eyebrow">${state.range ? `Son ${label}` : 'Tüm kayıtlar'} · ${s.count} gece</div>
      <h2>${reportHeadline(s)}</h2>
      <p class="muted">Skor; süre (40), kalite (25), saat düzeni (20) ve bölünmeden uyuma (15) puanlarının toplamı. Her gece, kendi son 14 gecene göre değerlendirilir.</p>
    </div>
  </section>
  <div class="cards">
    <section class="card wide">
      <div class="card-head"><h3>Yaşına göre süren</h3></div>
      ${normBar(s)}
    </section>
    <section class="card">
      <div class="card-head"><h3>Kronotipin</h3><span class="muted">iç saatin hangi yöne çekiyor</span></div>
      ${ch ? `<div class="chrono"><div class="chrono-emoji">${ch.emoji}</div><div><div class="chrono-label">${ch.label}</div><p>${esc(ch.text)}</p><p class="muted small">Serbest günlerdeki uyku ortan (borç düzeltmeli): <b>${A.fmtOff(s.msfsc)}</b>. Münih Kronotip Anketi (MCTQ) yöntemine dayanır; kesin bir tanı değildir.</p></div></div>` : '<p class="muted">Kronotip için en az 5 gece (ya da hafta içi ve hafta sonu karışık birkaç gece) gerekiyor.</p>'}
    </section>
    <section class="card">
      <div class="card-head"><h3>Hafta içi ve hafta sonu</h3><span class="muted">sosyal jet-lag</span></div>
      ${Number.isFinite(s.socialJetlag) ? `<div class="vs">
        <div><span>Hafta içi</span><b>${A.fmtDur(s.workDur)}</b><small>uyku ortası ${A.fmtOff(s.workMid)}</small></div>
        <div class="vs-mid">${Math.abs(s.socialJetlag) >= 60 ? '✈️' : '🧭'}<small>${A.fmtDur(Math.abs(s.socialJetlag))} fark</small></div>
        <div><span>Hafta sonu</span><b>${A.fmtDur(s.freeDur)}</b><small>uyku ortası ${A.fmtOff(s.freeMid)}</small></div>
      </div><p class="muted small">Sosyal jet-lag, hafta sonu ve hafta içi uyku ortaları arasındaki farktır. 1 saatin üstü, her hafta saat dilimi değiştirmek gibi yorar.</p>` : '<p class="muted">Karşılaştırma için hem hafta içi hem cuma/cumartesi gecesi kaydı gerekiyor.</p>'}
    </section>
    <section class="card wide">
      <div class="card-head"><h3>Yorumlar</h3><span class="muted">${ins.length} not, önemliden iyiye</span></div>
      <div class="insight-list">${ins.map(insightRow).join('')}</div>
    </section>
    ${plan ? `<section class="card">
      <div class="card-head"><h3>Bu akşamın planı</h3></div>
      <ol class="plan">
        <li><span>${A.fmtOff(plan.caffeineCutoff)}</span>Son kahve / çay (kafeinin yarısı ~5–6 saatte atılır)</li>
        <li><span>${A.fmtOff(plan.bedOff - 120)}</span>Ağır yemek ve yoğun spor bitsin</li>
        <li><span>${A.fmtOff(plan.screensOff)}</span>Ekranlar kapansın, ışıklar loşlaşsın</li>
        <li><span>${A.fmtOff(plan.bedOff)}</span>Uykuda ol</li>
        <li><span>${A.fmtOff(plan.wakeOff)}</span>Kalk ve ilk 30 dakikada gün ışığı al</li>
      </ol>
    </section>` : ''}
    <section class="card">
      <div class="card-head"><h3>En iyi ve en zor gece</h3></div>
      ${nightMini('🏆', s.bestNight, s.goal)}
      ${nightMini('🥱', s.worstNight, s.goal)}
      <div class="mini-stats"><div><span>En uzun</span><b>${A.fmtDur(s.maxNight.dur)}</b></div><div><span>En kısa</span><b>${A.fmtDur(s.minNight.dur)}</b></div><div><span>Önerilen aralıkta</span><b>%${Math.round(s.inRecommended * 100)}</b></div></div>
    </section>
  </div>
  <p class="disclaimer">Ninni bir sağlık cihazı değildir. Yorumlar genel uyku bilimi bulgularına dayanır ve senin girdiğin yaklaşık saatlerle hesaplanır. Sürekli yorgunluk, horlama ya da nefes durması gibi şikâyetlerin varsa bir hekime danış.</p>`;
}

function reportHeadline(s) {
  const b = s.band.key;
  if (b === 'great') return 'Uykun çok iyi gidiyor. Bu düzen sana yakışıyor.';
  if (b === 'good') return 'Genel olarak iyi uyuyorsun; birkaç küçük ayar onu harika yapar.';
  if (b === 'ok') return 'İdare ediyor ama uykun senden daha fazlasını istiyor.';
  if (b === 'weak') return 'Uykun zorlanıyor. Aşağıdaki notlar nereden başlayacağını gösteriyor.';
  return 'Uykun ciddi şekilde yetersiz. Önce süreyi ve düzeni toparlayalım.';
}

function nightMini(icon, n, goal) {
  const b = A.scoreBand(n.score.total);
  return `<button class="night-mini" data-night="${n.date}"><span class="nm-icon">${icon}</span><span><b>${A.fmtNight(n.date, { long: true })}</b><small>${A.fmtDur(n.dur)} · ${A.fmtOff(n.bedOff)} → ${A.fmtOff(n.wakeOff)}</small></span><span class="score-pill st-${b.status}">${n.score.total}</span></button>`;
}

// ----- tools -----

function viewTools() {
  const { s } = derive(30);
  const wakeDefault = s.count ? A.fmtOff(A.median(s.nights.filter((n) => !n.free).map((n) => n.wakeOff).concat(s.nights.length ? [] : [780]))) : '07:00';
  return `<div class="cards">
    <section class="card">
      <div class="card-head"><h3>⏰ Kaçta yatmalıyım?</h3><span class="muted">kalkış saatine göre</span></div>
      <label class="field inline"><span>Kalkmam gereken saat</span><input type="time" id="calc-wake" value="${/^\d\d:\d\d$/.test(wakeDefault) ? wakeDefault : '07:00'}"></label>
      <div id="calc-bed-out" class="cycle-list"></div>
    </section>
    <section class="card">
      <div class="card-head"><h3>🛏️ Şimdi yatarsam?</h3><span class="muted">ya da seçtiğin saatte</span></div>
      <label class="field inline"><span>Uyumaya gideceğim saat</span><input type="time" id="calc-bed" value="${A.nowLocal().slice(11)}"></label>
      <div id="calc-wake-out" class="cycle-list"></div>
    </section>
    <section class="card wide">
      <div class="card-head"><h3>🌀 Uyku döngüsü nedir?</h3></div>
      <p>Uyku, her biri yaklaşık <b>90 dakika</b> süren döngülerle ilerler: hafif uyku, derin uyku ve rüyaların görüldüğü REM. Bir döngünün ortasında, özellikle derin uykudayken uyanırsan sersem hissedersin (uyku ataleti). Hesaplayıcı, uykuya dalmak için ortalama <b>15 dakika</b> ekler. Döngü süresi kişiden kişiye 70–120 dakika arasında değişir; bunu kesin bir kural değil, iyi bir başlangıç noktası olarak düşün.</p>
    </section>
    <section class="card wide">
      <div class="card-head"><h3>💡 Uyku hijyeni: işe yarayan 8 alışkanlık</h3></div>
      <ul class="tips">
        <li><b>Kalkış saatini sabitle.</b> Hafta sonu dahil. Ritmin çapası yatış değil, kalkıştır.</li>
        <li><b>Sabah ışığı al.</b> Uyanınca 10–30 dakika gün ışığı iç saatini doğru ayarlar.</li>
        <li><b>Kafeini erken bırak.</b> Yatıştan 8 saat önce son fincan.</li>
        <li><b>Alkol uyutmaz, böler.</b> Gecenin ikinci yarısında uyanmaları artırır.</li>
        <li><b>Serin, karanlık, sessiz oda.</b> 18–20 °C ideal.</li>
        <li><b>Yatak sadece uyku için.</b> 20 dakikada uyuyamazsan kalk, loş ışıkta sakin bir şey yap.</li>
        <li><b>Şekerlemeyi kısa tut.</b> 15–20 dakika ve 15:00’ten önce.</li>
        <li><b>Akşam rutini kur.</b> Her gece aynı sırayla yapılan sakin işler beynine “uyku geliyor” der.</li>
      </ul>
    </section>
  </div>`;
}

function fillCalculators() {
  const wakeIn = $('#calc-wake');
  const bedIn = $('#calc-bed');
  if (!wakeIn || !bedIn) return;
  const toMod = (v) => {
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  };
  const row = (c, at, best) => `<div class="cycle ${best ? 'best' : ''}"><b>${A.fmtClock(at)}</b><span>${c.cycles} döngü · ${A.fmtDur(c.sleep)} uyku</span>${best ? '<em>önerilen</em>' : ''}</div>`;
  const upd = () => {
    if (wakeIn.value) $('#calc-bed-out').innerHTML = A.bedtimesFor(toMod(wakeIn.value)).map((c) => row(c, c.at, c.cycles === 5 || (c.cycles === 6 && state.user.goalMinutes >= 510))).join('');
    if (bedIn.value) $('#calc-wake-out').innerHTML = A.wakeTimesFor(toMod(bedIn.value)).map((c) => row(c, c.at, c.cycles === 5)).join('');
  };
  wakeIn.addEventListener('input', upd);
  bedIn.addEventListener('input', upd);
  upd();
}

// ----- settings -----

function viewSettings() {
  const u = state.user;
  const theme = document.documentElement.dataset.theme || 'auto';
  return `<div class="cards settings">
    <section class="card">
      <div class="card-head"><h3>Profil ve hedef</h3></div>
      <form id="profile-form" class="stack">
        <label class="field"><span>Adın</span><input name="displayName" value="${esc(u.displayName)}" maxlength="40" required></label>
        <label class="field"><span>Yaş grubun</span><select name="ageGroup">${Object.entries(A.AGE_GROUPS).map(([k, g]) => `<option value="${k}" ${k === u.ageGroup ? 'selected' : ''}>${g.label} · önerilen ${A.fmtHours(g.min)}–${A.fmtHours(g.max)} sa</option>`).join('')}</select></label>
        <label class="field"><span>Gecelik uyku hedefin: <b id="goal-out">${A.fmtDur(u.goalMinutes)}</b></span><input type="range" name="goalMinutes" min="360" max="600" step="15" value="${u.goalMinutes}"></label>
        <button class="btn primary">Kaydet</button>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h3>Görünüm</h3></div>
      <div class="seg wide" role="group" aria-label="Tema">
        ${[['auto', '🌗 Sistem'], ['dark', '🌙 Gece'], ['light', '☀️ Gündüz']].map(([k, l]) => `<button class="${theme === k ? 'on' : ''}" data-action="theme" data-theme="${k}">${l}</button>`).join('')}
      </div>
      <p class="muted small">Telefonda tarayıcı menüsünden <b>Ana ekrana ekle</b> diyerek Ninni’yi uygulama gibi kullanabilirsin.</p>
    </section>
    <section class="card">
      <div class="card-head"><h3>Verilerin</h3><span class="muted">${state.sleeps.length} kayıt</span></div>
      <div class="stack">
        <a class="btn ghost" href="/api/export?format=csv" download>📄 CSV indir (Excel)</a>
        <a class="btn ghost" href="/api/export?format=json" download>💾 Yedek indir (JSON)</a>
        <label class="btn ghost file-btn">📥 Yedekten geri yükle<input type="file" accept="application/json,.json" id="import-file" hidden></label>
        <button class="btn ghost" data-action="sample">✨ Örnek 60 gece ekle</button>
        <button class="btn danger-ghost" data-action="wipe">🗑️ Tüm uyku kayıtlarını sil</button>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Şifre</h3></div>
      <form id="pw-form" class="stack">
        <input type="text" name="username" value="${esc(u.username)}" autocomplete="username" hidden>
        <label class="field"><span>Mevcut şifre</span><input type="password" name="currentPassword" autocomplete="current-password" required></label>
        <label class="field"><span>Yeni şifre</span><input type="password" name="newPassword" autocomplete="new-password" minlength="6" required></label>
        <button class="btn primary">Şifreyi değiştir</button>
        <small class="muted">Şifre değişince diğer cihazlardan çıkış yapılır.</small>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h3>Hesap</h3><span class="muted">@${esc(u.username)}</span></div>
      <div class="stack">
        <button class="btn ghost" data-action="logout">Çıkış yap</button>
        <button class="btn danger-ghost" data-action="delete-account">Hesabımı sil</button>
      </div>
    </section>
  </div>
  <p class="disclaimer">Ninni · <a href="https://github.com/yavuzkrm/ninni" target="_blank" rel="noopener">GitHub</a> · Claude ile vibe-coding yapılarak geliştirildi.</p>`;
}

function bindSettings() {
  const pf = $('#profile-form');
  if (!pf) return;
  const range = pf.querySelector('[name=goalMinutes]');
  range.addEventListener('input', () => ($('#goal-out').textContent = A.fmtDur(Number(range.value))));
  pf.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(pf).entries());
    try {
      const { user } = await api('PATCH', '/api/me', { displayName: f.displayName, ageGroup: f.ageGroup, goalMinutes: Number(f.goalMinutes) });
      state.user = user;
      toast('Kaydedildi', 'good');
      render();
    } catch (e) {
      toast(errText(e), 'bad');
    }
  });
  $('#pw-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await api('PATCH', '/api/me', { currentPassword: f.currentPassword, newPassword: f.newPassword });
      ev.target.reset();
      toast('Şifren değişti', 'good');
    } catch (e) {
      toast(errText(e), 'bad');
    }
  });
  $('#import-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.sleeps;
      if (!Array.isArray(list)) throw Object.assign(new Error(), { code: 'invalid_import' });
      const clean = list.map(({ kind, bedAt, wakeAt, quality, awakenings, tags, note }) => ({ kind, bedAt, wakeAt, quality, awakenings, tags, note }));
      const r = await api('POST', '/api/sleeps/import', { sleeps: clean });
      await loadSleeps();
      render();
      toast(`${r.added} kayıt eklendi${r.skipped ? `, ${r.skipped} çakışan atlandı` : ''}`, 'good');
    } catch (e) {
      toast(e instanceof SyntaxError ? ERRORS.invalid_import : errText(e), 'bad');
    }
    ev.target.value = '';
  });
}

// ---------- the sleep form ----------

function openModal(html, { onClose } = {}) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(back);
  document.body.classList.add('modal-open');
  back.addEventListener('mousedown', (e) => e.target === back && closeModal());
  back._onClose = onClose;
  requestAnimationFrame(() => back.classList.add('in'));
  return back.querySelector('.modal');
}
function closeModal() {
  const b = $('.modal-backdrop');
  if (!b) return;
  b.remove();
  document.body.classList.remove('modal-open');
  b._onClose?.();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

function defaultTimes() {
  const nights = A.buildNights(state.sleeps).slice(-14);
  const bedOff = nights.length ? Math.round(A.median(nights.map((n) => n.bedOff)) / 5) * 5 : 300;
  const wakeOff = nights.length ? Math.round(A.median(nights.map((n) => n.wakeOff)) / 5) * 5 : 780;
  const night = A.addDays(today(), -1);
  const base = A.dayStart(night) + 18 * 60;
  return { bedAt: A.fromMin(base + bedOff), wakeAt: A.fromMin(base + wakeOff) };
}

function openSleepForm(sleep = null, { live = false } = {}) {
  const editing = !!sleep;
  const d = sleep || (live ? { bedAt: state.user.sleepingSince, wakeAt: A.nowLocal() } : defaultTimes());
  const f = {
    kind: sleep?.kind || 'night',
    bedAt: d.bedAt,
    wakeAt: d.wakeAt,
    quality: sleep?.quality ?? null,
    awakenings: sleep?.awakenings ?? 0,
    tags: new Set(sleep?.tags || []),
    note: sleep?.note || '',
  };
  const customTags = [...new Set(state.sleeps.flatMap((s) => s.tags))].filter((t) => !A.TAGS.some((x) => x.key === t));
  const tagBtn = (t) => `<button type="button" class="tag ${f.tags.has(t.key) ? 'on' : ''}" data-tag="${esc(t.key)}" aria-pressed="${f.tags.has(t.key)}">${t.icon} ${esc(t.label)}</button>`;
  const m = openModal(`
    <form id="sleep-form">
      <div class="modal-head">
        <h2>${editing ? 'Uykuyu düzenle' : live ? 'Günaydın! ☀️' : 'Uyku ekle'}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Kapat">✕</button>
      </div>
      <div class="seg wide" role="group" aria-label="Tür">
        <button type="button" data-kind="night" class="${f.kind === 'night' ? 'on' : ''}">🌙 Gece uykusu</button>
        <button type="button" data-kind="nap" class="${f.kind === 'nap' ? 'on' : ''}">☕ Şekerleme</button>
      </div>
      <div class="time-grid">
        <fieldset class="tblock"><legend>😴 Yaklaşık uyuduğum an</legend>
          <input type="date" name="bedDate" value="${f.bedAt.slice(0, 10)}" required>
          <input type="time" name="bedTime" value="${f.bedAt.slice(11)}" required>
        </fieldset>
        <fieldset class="tblock"><legend>⏰ Uyandığım an</legend>
          <input type="date" name="wakeDate" value="${f.wakeAt.slice(0, 10)}" required>
          <input type="time" name="wakeTime" value="${f.wakeAt.slice(11)}" required>
        </fieldset>
      </div>
      <div class="dur-preview" id="dur-preview"></div>
      <div class="fgroup"><div class="flabel">Nasıl uyudun?</div>
        <div class="faces" role="radiogroup">${[1, 2, 3, 4, 5].map((q) => `<button type="button" class="face ${f.quality === q ? 'on' : ''}" data-q="${q}" role="radio" aria-checked="${f.quality === q}"><span>${FACES[q]}</span><small>${FACE_LABELS[q]}</small></button>`).join('')}</div>
      </div>
      <div class="fgroup row"><div class="flabel">Gece kaç kez uyandın?</div>
        <div class="stepper"><button type="button" data-step="-1" aria-label="Azalt">−</button><output id="aw-out">${f.awakenings}</output><button type="button" data-step="1" aria-label="Arttır">＋</button></div>
      </div>
      <div class="fgroup"><div class="flabel">Bu gün / gece neler vardı?</div>
        <div class="tags">${A.TAGS.map(tagBtn).join('')}${customTags.map((k) => tagBtn(A.tagInfo(k))).join('')}</div>
        <div class="custom-tag"><input id="custom-tag" maxlength="24" placeholder="Kendi etiketin (ör. melatonin)" autocomplete="off"><button type="button" class="btn ghost sm" data-addtag>Ekle</button></div>
      </div>
      <label class="field"><span>Not / rüya</span><textarea name="note" rows="2" maxlength="1000" placeholder="Rüyanda ne gördün? Aklında kalan bir şey?">${esc(f.note)}</textarea></label>
      <p class="form-error" id="sleep-error" hidden></p>
      <div class="modal-actions">
        ${editing ? '<button type="button" class="btn danger-ghost" data-delete>Sil</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Vazgeç</button>
        <button type="submit" class="btn primary">${editing ? 'Kaydet' : 'Ekle'}</button>
      </div>
    </form>`);
  const form = $('#sleep-form', m);
  const get = () => `${form.bedDate.value}T${form.bedTime.value}`;
  const getW = () => `${form.wakeDate.value}T${form.wakeTime.value}`;
  const preview = () => {
    const dur = A.toMin(getW()) - A.toMin(get());
    const el = $('#dur-preview', m);
    if (!Number.isFinite(dur)) return (el.textContent = '');
    if (dur <= 0) {
      el.className = 'dur-preview bad';
      el.textContent = 'Uyanma, uyumadan sonra olmalı';
      return;
    }
    const goal = state.user.goalMinutes;
    const diff = dur - goal;
    el.className = 'dur-preview';
    el.innerHTML = `<b>${A.fmtDur(dur)}</b> uyku${f.kind === 'night' ? ` · ${Math.abs(diff) <= 15 ? 'tam hedefinde 🎯' : diff < 0 ? `hedefin ${A.fmtDur(-diff)} altında` : `hedefin ${A.fmtDur(diff)} üstünde`} · ${Math.floor(dur / 90)} döngü` : ''}`;
  };
  // Changing a clock time keeps the wake date sensible: wake time before bed time means the next morning.
  const autoWakeDate = () => {
    if (!form.bedDate.value || !form.bedTime.value || !form.wakeTime.value) return;
    form.wakeDate.value = form.wakeTime.value <= form.bedTime.value ? A.addDays(form.bedDate.value, 1) : form.bedDate.value;
  };
  form.bedTime.addEventListener('input', () => { autoWakeDate(); preview(); });
  form.wakeTime.addEventListener('input', () => { autoWakeDate(); preview(); });
  form.bedDate.addEventListener('input', () => { autoWakeDate(); preview(); });
  form.wakeDate.addEventListener('input', preview);
  preview();

  m.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-close]')) return closeModal();
    if (t.dataset.kind) {
      f.kind = t.dataset.kind;
      $$('[data-kind]', m).forEach((b) => b.classList.toggle('on', b === t));
      preview();
    }
    if (t.dataset.q) {
      const q = Number(t.dataset.q);
      f.quality = f.quality === q ? null : q;
      $$('[data-q]', m).forEach((b) => {
        const on = Number(b.dataset.q) === f.quality;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on);
      });
    }
    if (t.dataset.step) {
      f.awakenings = Math.max(0, Math.min(20, f.awakenings + Number(t.dataset.step)));
      $('#aw-out', m).textContent = f.awakenings;
    }
    if (t.dataset.tag !== undefined) {
      const k = t.dataset.tag;
      f.tags.has(k) ? f.tags.delete(k) : f.tags.add(k);
      t.classList.toggle('on', f.tags.has(k));
      t.setAttribute('aria-pressed', f.tags.has(k));
    }
    if (t.matches('[data-addtag]')) addCustomTag();
    if (t.matches('[data-delete]')) {
      if (!confirm('Bu kayıt silinsin mi?')) return;
      try {
        await api('DELETE', `/api/sleeps/${sleep.id}`);
        state.sleeps = state.sleeps.filter((s) => s.id !== sleep.id);
        closeModal();
        render();
        toast('Silindi');
      } catch (err) {
        toast(errText(err), 'bad');
      }
    }
  });
  const addCustomTag = () => {
    const inp = $('#custom-tag', m);
    const k = inp.value.trim().toLowerCase();
    if (!k) return;
    if (f.tags.size >= 12) return toast('En fazla 12 etiket', 'bad');
    f.tags.add(k);
    if (!$(`[data-tag="${CSS.escape(k)}"]`, m)) $('.tags', m).insertAdjacentHTML('beforeend', tagBtn(A.tagInfo(k)));
    const b = $(`[data-tag="${CSS.escape(k)}"]`, m);
    b.classList.add('on');
    b.setAttribute('aria-pressed', 'true');
    inp.value = '';
  };
  $('#custom-tag', m).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomTag();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { kind: f.kind, bedAt: get(), wakeAt: getW(), quality: f.quality, awakenings: f.awakenings, tags: [...f.tags], note: form.note.value };
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (editing) {
        const { sleep: s } = await api('PATCH', `/api/sleeps/${sleep.id}`, body);
        state.sleeps = state.sleeps.map((x) => (x.id === s.id ? s : x));
      } else {
        const { sleep: s } = await api('POST', '/api/sleeps', { ...body, endLive: live });
        state.sleeps.push(s);
        if (live) state.user = { ...state.user, sleepingSince: null };
      }
      closeModal();
      if (!editing && f.kind === 'night') state.view = 'home';
      render();
      toast(editing ? 'Güncellendi' : live ? 'Günaydın! Gecen kaydedildi.' : 'Eklendi', 'good');
    } catch (err) {
      const el = $('#sleep-error', m);
      el.textContent = errText(err);
      el.hidden = false;
      btn.disabled = false;
    }
  });
  setTimeout(() => $('.modal')?.focus(), 0);
}

function openNight(date) {
  const n = A.buildNights(state.sleeps).find((x) => x.date === date);
  if (!n) return;
  const sl = state.sleeps.find((s) => s.id === n.ids[0]);
  if (sl) openSleepForm(sl);
}

function openLiveEdit() {
  const cur = state.user.sleepingSince;
  const m = openModal(`<form id="live-form">
    <div class="modal-head"><h2>Uyuma saatini düzelt</h2><button type="button" class="icon-btn" data-close aria-label="Kapat">✕</button></div>
    <p class="muted">Düğmeye bastıktan sonra hemen uyumadıysan, yaklaşık uykuya daldığın anı gir.</p>
    <div class="tblock"><input type="date" name="d" value="${cur.slice(0, 10)}" required><input type="time" name="t" value="${cur.slice(11)}" required></div>
    <div class="modal-actions"><span class="spacer"></span><button type="button" class="btn ghost" data-close>Vazgeç</button><button class="btn primary">Kaydet</button></div>
  </form>`);
  m.addEventListener('click', (e) => e.target.closest('[data-close]') && closeModal());
  $('#live-form', m).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { user } = await api('POST', '/api/live', { at: `${e.target.d.value}T${e.target.t.value}` });
      state.user = user;
      closeModal();
      render();
    } catch (err) {
      toast(errText(err), 'bad');
    }
  });
}

// ---------- actions ----------

const actions = {
  reload: () => location.reload(),
  'auth-mode': (el) => {
    state.authMode = el.dataset.mode;
    renderAuth();
  },
  add: () => openSleepForm(),
  edit: (el) => openSleepForm(state.sleeps.find((s) => s.id === Number(el.dataset.id))),
  'sleep-now': async () => {
    try {
      const { user } = await api('POST', '/api/live', { at: A.nowLocal() });
      state.user = user;
      render();
      toast('İyi geceler 🌙 Sabah “Uyandım”a basmayı unutma.', 'good');
    } catch (e) {
      toast(errText(e), 'bad');
    }
  },
  wake: () => openSleepForm(null, { live: true }),
  'edit-live': () => openLiveEdit(),
  'cancel-live': async () => {
    if (!confirm('Canlı uyku kaydı iptal edilsin mi?')) return;
    const { user } = await api('DELETE', '/api/live');
    state.user = user;
    render();
  },
  range: (el) => {
    state.range = Number(el.dataset.days);
    localSet('ninni-range', state.range);
    render();
  },
  theme: (el) => {
    const t = el.dataset.theme;
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    localSet('ninni-theme', t);
    render();
  },
  sample: async () => {
    if (state.sleeps.length && !confirm('Mevcut kayıtlarının yanına 60 gecelik örnek veri eklensin mi? Çakışan geceler atlanır.')) return;
    try {
      const r = await api('POST', '/api/sleeps/import', { sleeps: A.sampleSleeps(today()) });
      await loadSleeps();
      state.view = 'stats';
      render();
      toast(`${r.added} örnek kayıt eklendi. Ayarlar’dan hepsini silebilirsin.`, 'good');
    } catch (e) {
      toast(errText(e), 'bad');
    }
  },
  wipe: async () => {
    const password = prompt('Tüm uyku kayıtların silinecek. Onaylamak için şifreni yaz:');
    if (!password) return;
    try {
      await api('DELETE', '/api/sleeps', { password });
      state.sleeps = [];
      render();
      toast('Tüm kayıtlar silindi');
    } catch (e) {
      toast(errText(e), 'bad');
    }
  },
  logout: async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    state.user = null;
    state.sleeps = [];
    render();
  },
  'delete-account': async () => {
    const password = prompt('Hesabın ve tüm kayıtların kalıcı olarak silinecek. Onaylamak için şifreni yaz:');
    if (!password) return;
    try {
      await api('DELETE', '/api/me', { password });
      state.user = null;
      state.sleeps = [];
      render();
      toast('Hesabın silindi');
    } catch (e) {
      toast(errText(e), 'bad');
    }
  },
};

root.addEventListener('click', (e) => {
  if (!e.target.closest('[data-tip]')) hideTip();
  const v = e.target.closest('[data-view]');
  if (v) {
    state.view = v.dataset.view;
    localSet('ninni-view', state.view);
    render();
    window.scrollTo({ top: 0 });
    return;
  }
  const a = e.target.closest('[data-action]');
  if (a && actions[a.dataset.action]) {
    e.preventDefault();
    actions[a.dataset.action](a);
    return;
  }
  // On touch screens a tap on a chart mark shows its tooltip; with a mouse, a click opens the night.
  const t = e.target.closest('[data-tip]');
  if (t && lastPointer !== 'mouse') {
    showTip(t, e.clientX, e.clientY);
    return;
  }
  const n = e.target.closest('[data-night]');
  if (n) openNight(n.dataset.night);
});
let lastPointer = 'mouse';
document.addEventListener('pointerdown', (e) => (lastPointer = e.pointerType), true);


// ---------- tooltip ----------

const tip = $('#tip');
function showTip(el, x, y) {
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
function hideTip() {
  tip.hidden = true;
  $$('.hovered').forEach((x) => x.classList.remove('hovered'));
}
document.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest?.('[data-tip]');
  if (!el) return hideTip();
  if (!el.classList.contains('hovered')) {
    $$('.hovered').forEach((x) => x.classList.remove('hovered'));
    el.classList.add('hovered');
  }
  showTip(el, e.clientX, e.clientY);
});
document.addEventListener('scroll', hideTip, { passive: true });

boot();
