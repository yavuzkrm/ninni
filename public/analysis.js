// Pure sleep math and the plain-language reading of it. No DOM here, so it can be unit tested.
//
// Times are local wall-clock strings ("YYYY-MM-DDTHH:MM"). They are turned into
// "minutes since the epoch as if UTC", which keeps durations exact without time zone noise.
// Each night is measured on a timeline that starts at 18:00 of the evening it belongs to,
// so 23:30 is 330 and 07:00 the next morning is 780: no wrap-around at midnight.

export const DAY = 1440;
const EVENING = 18 * 60;

export const AGE_GROUPS = {
  '14-17': { label: '14–17 yaş', min: 480, max: 600 },
  '18-25': { label: '18–25 yaş', min: 420, max: 540 },
  '26-64': { label: '26–64 yaş', min: 420, max: 540 },
  '65+': { label: '65 yaş ve üstü', min: 420, max: 480 },
};

export const TAGS = [
  { key: 'kahve', label: 'Kahve / çay', icon: '☕' },
  { key: 'alkol', label: 'Alkol', icon: '🍷' },
  { key: 'spor', label: 'Spor', icon: '🏃' },
  { key: 'gec-yemek', label: 'Geç yemek', icon: '🍕' },
  { key: 'ekran', label: 'Yatakta ekran', icon: '📱' },
  { key: 'stres', label: 'Stres', icon: '😰' },
  { key: 'okuma', label: 'Kitap okudum', icon: '📖' },
  { key: 'meditasyon', label: 'Meditasyon', icon: '🧘' },
  { key: 'hastalik', label: 'Hastalık', icon: '🤒' },
  { key: 'seyahat', label: 'Seyahat', icon: '✈️' },
  { key: 'gurultu', label: 'Gürültü', icon: '🔊' },
  { key: 'sicak', label: 'Oda sıcaktı', icon: '🌡️' },
];
export const tagInfo = (key) => TAGS.find((t) => t.key === key) || { key, label: key, icon: '🏷️' };

const WEEKDAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const WEEKDAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export { WEEKDAYS, WEEKDAYS_SHORT, MONTHS_SHORT };

// ---------- time primitives ----------

export function toMin(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
}

export function fromMin(min) {
  return new Date(min * 60000).toISOString().slice(0, 16);
}

export const dateOf = (min) => fromMin(min).slice(0, 10);
export const dayStart = (date) => toMin(`${date}T00:00`);
export const addDays = (date, n) => dateOf(dayStart(date) + n * DAY);

// Monday = 0 … Sunday = 6
export function weekday(date) {
  return (new Date(dayStart(date) * 60000).getUTCDay() + 6) % 7;
}

export function nowLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// A sleep belongs to the evening 12 hours before it started: 02:00 on the 7th is the night of the 6th.
export const nightOf = (bedMin) => dateOf(bedMin - 12 * 60);

// "Night of Friday" and "night of Saturday" are followed by a free morning.
export const isFreeNight = (date) => {
  const w = weekday(date);
  return w === 4 || w === 5;
};

// ---------- formatting ----------

export function fmtDur(min, { short = false } = {}) {
  if (!Number.isFinite(min)) return '–';
  const sign = min < 0 ? '−' : '';
  min = Math.round(Math.abs(min));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (short) return `${sign}${h}:${String(m).padStart(2, '0')}`;
  if (!h) return `${sign}${m} dk`;
  if (!m) return `${sign}${h} sa`;
  return `${sign}${h} sa ${m} dk`;
}

export const fmtHours = (min) => (Number.isFinite(min) ? (min / 60).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : '–');

// Clock time from a minute-of-day (any integer, wrapped).
export function fmtClock(minOfDay) {
  if (!Number.isFinite(minOfDay)) return '–';
  const m = (((Math.round(minOfDay) % DAY) + DAY) % DAY);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Clock time from a night-timeline offset (0 = 18:00).
export const fmtOff = (off) => fmtClock(EVENING + off);

export function fmtNight(date, { long = false } = {}) {
  const [, mo, d] = date.split('-').map(Number);
  const w = weekday(date);
  return long ? `${d} ${MONTHS_SHORT[mo - 1]} ${WEEKDAYS[w]} gecesi` : `${WEEKDAYS_SHORT[w]} ${d} ${MONTHS_SHORT[mo - 1]}`;
}

// ---------- small stats ----------

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}
export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function pearson(xs, ys) {
  if (xs.length < 3) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp01 = (x, good, bad) => clamp((bad - x) / (bad - good), 0, 1);

// ---------- nights ----------

// Groups night sleeps by the evening they belong to. Several pieces of one night
// (woke at 3, slept again) become one night: first bed, last wake, summed sleep.
export function buildNights(sleeps) {
  const byNight = new Map();
  for (const s of sleeps) {
    if (s.kind === 'nap') continue;
    const bed = toMin(s.bedAt);
    const wake = toMin(s.wakeAt);
    if (!(wake > bed)) continue;
    const date = nightOf(bed);
    let n = byNight.get(date);
    if (!n) {
      n = { date, bed, wake, dur: 0, ids: [], qualities: [], awakenings: 0, tags: new Set(), notes: [], pieces: 0 };
      byNight.set(date, n);
    }
    n.bed = Math.min(n.bed, bed);
    n.wake = Math.max(n.wake, wake);
    n.dur += wake - bed;
    n.ids.push(s.id);
    if (s.quality) n.qualities.push(s.quality);
    n.awakenings += s.awakenings || 0;
    for (const t of s.tags || []) n.tags.add(t);
    if (s.note) n.notes.push(s.note);
    n.pieces++;
  }
  return [...byNight.values()]
    .map((n) => {
      const base = dayStart(n.date) + EVENING;
      const bedOff = n.bed - base;
      const wakeOff = n.wake - base;
      return {
        date: n.date,
        ids: n.ids,
        bed: n.bed,
        wake: n.wake,
        bedOff,
        wakeOff,
        mid: (bedOff + wakeOff) / 2,
        dur: n.dur,
        quality: n.qualities.length ? mean(n.qualities) : null,
        awakenings: n.awakenings + (n.pieces - 1),
        tags: [...n.tags],
        note: n.notes.join(' · '),
        weekday: weekday(n.date),
        free: isFreeNight(n.date),
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function buildNaps(sleeps) {
  return sleeps
    .filter((s) => s.kind === 'nap')
    .map((s) => ({ ...s, start: toMin(s.bedAt), dur: toMin(s.wakeAt) - toMin(s.bedAt), date: s.bedAt.slice(0, 10) }))
    .sort((a, b) => a.start - b.start);
}

export function inRange(items, today, days) {
  if (!days) return items;
  const from = addDays(today, -days);
  return items.filter((n) => n.date >= from && n.date <= today);
}

// ---------- score ----------

// One night, 0–100: duration 40, quality 25, timing vs your usual rhythm 20, unbroken sleep 15.
export function nightScore(n, { goal, refMid }) {
  const diff = n.dur - goal;
  let dur;
  if (diff >= -30 && diff <= 60) dur = 1;
  else if (diff < -30) dur = lerp01(-diff, 30, 180);
  else dur = lerp01(diff, 60, 240);
  const quality = n.quality ? (n.quality - 1) / 4 : 0.6;
  const timing = Number.isFinite(refMid) ? lerp01(Math.abs(n.mid - refMid), 30, 150) : 1;
  const cont = [1, 0.8, 0.55, 0.3][n.awakenings] ?? 0;
  const parts = { dur: dur * 40, quality: quality * 25, timing: timing * 20, cont: cont * 15 };
  return { total: Math.round(parts.dur + parts.quality + parts.timing + parts.cont), parts };
}

// Scores every night against the median sleep midpoint of the 14 nights before it.
export function scoreNights(nights, goal) {
  return nights.map((n, i) => {
    const prev = nights.slice(Math.max(0, i - 14), i).map((p) => p.mid);
    const refMid = prev.length >= 3 ? median(prev) : NaN;
    return { ...n, score: nightScore(n, { goal, refMid }) };
  });
}

export function scoreBand(score) {
  if (!Number.isFinite(score)) return { key: 'none', label: 'Veri yok', status: 'muted', icon: '·' };
  if (score >= 85) return { key: 'great', label: 'Harika', status: 'good', icon: '★' };
  if (score >= 70) return { key: 'good', label: 'İyi', status: 'good', icon: '✓' };
  if (score >= 55) return { key: 'ok', label: 'İdare eder', status: 'warning', icon: '!' };
  if (score >= 40) return { key: 'weak', label: 'Zayıf', status: 'serious', icon: '!' };
  return { key: 'bad', label: 'Kötü', status: 'critical', icon: '×' };
}

// ---------- the big summary ----------

export function chronotypeOf(msfsc) {
  // Mid-sleep on free days, corrected for catch-up sleep (MCTQ). Expressed as a clock time.
  const h = ((((msfsc + EVENING) % DAY) + DAY) % DAY) / 60;
  const hh = h < 12 ? h : h - 24; // 23:30 → -0.5
  if (hh < 2.5) return { key: 'erken', label: 'Belirgin sabahçıl', emoji: '🐓', text: 'Erken yatıp erken kalkmaya yatkınsın. Sabah saatleri en verimli zamanın olabilir.' };
  if (hh < 3.5) return { key: 'sabah', label: 'Sabahçıl', emoji: '🌅', text: 'Biraz erken bir ritmin var. Sabah toplantıları sana çoğu insandan daha kolay gelir.' };
  if (hh < 5) return { key: 'ara', label: 'Ara tip', emoji: '🌤️', text: 'Ne çok erken ne çok geç: nüfusun çoğu gibi orta bir ritmin var.' };
  if (hh < 6) return { key: 'aksam', label: 'Akşamcıl', emoji: '🌆', text: 'Vücudun geç yatmayı seviyor. Erken alarmlar seni hafta içi borca sokuyor olabilir.' };
  return { key: 'gece', label: 'Gece kuşu', emoji: '🦉', text: 'Belirgin bir gece insanısın. İç saatin günün ritmine göre epey geride.' };
}

export function summarize(allNights, { goal, ageGroup, today, days }) {
  const scored = scoreNights(allNights, goal);
  const nights = inRange(scored, today, days);
  const age = AGE_GROUPS[ageGroup] || AGE_GROUPS['26-64'];
  const s = { count: nights.length, nights, goal, age };
  if (!nights.length) return s;

  const durs = nights.map((n) => n.dur);
  s.avgDur = mean(durs);
  s.medDur = median(durs);
  s.minNight = nights.reduce((a, b) => (b.dur < a.dur ? b : a));
  s.maxNight = nights.reduce((a, b) => (b.dur > a.dur ? b : a));
  s.avgBed = mean(nights.map((n) => n.bedOff));
  s.avgWake = mean(nights.map((n) => n.wakeOff));
  s.sdBed = sd(nights.map((n) => n.bedOff));
  s.sdWake = sd(nights.map((n) => n.wakeOff));
  const q = nights.filter((n) => n.quality).map((n) => n.quality);
  s.avgQuality = q.length ? mean(q) : NaN;
  s.avgAwakenings = mean(nights.map((n) => n.awakenings));
  s.score = mean(nights.map((n) => n.score.total));
  s.band = scoreBand(s.score);
  s.inRecommended = nights.filter((n) => n.dur >= age.min && n.dur <= age.max).length / nights.length;
  s.short = nights.filter((n) => n.dur < age.min).length;
  s.long = nights.filter((n) => n.dur > age.max).length;

  // Regularity 0–100 from how much bed and wake times wander (SD 20 min → 100, 2 h → 0).
  if (nights.length >= 3) {
    const spread = mean([s.sdBed, s.sdWake]);
    s.spread = spread;
    s.regularity = Math.round(lerp01(spread, 20, 120) * 100);
  }

  // Sleep debt: the last 14 nights against the goal. Extra sleep pays back, but never below zero.
  const last14 = inRange(scored, today, 14);
  s.debt = Math.max(0, last14.reduce((acc, n) => acc + (goal - n.dur), 0));
  s.debtNights = last14.length;

  // Workdays vs free days: social jetlag and chronotype.
  const work = nights.filter((n) => !n.free);
  const free = nights.filter((n) => n.free);
  if (work.length >= 2 && free.length >= 1) {
    s.workMid = mean(work.map((n) => n.mid));
    s.freeMid = mean(free.map((n) => n.mid));
    s.workDur = mean(work.map((n) => n.dur));
    s.freeDur = mean(free.map((n) => n.dur));
    s.socialJetlag = s.freeMid - s.workMid;
    const weekAvg = (5 * s.workDur + 2 * s.freeDur) / 7;
    s.msfsc = s.freeDur > s.workDur ? s.freeMid - (s.freeDur - weekAvg) / 2 : s.freeMid;
  } else if (nights.length >= 5) {
    s.msfsc = mean(nights.map((n) => n.mid));
  }
  if (Number.isFinite(s.msfsc)) s.chronotype = chronotypeOf(s.msfsc);

  // By weekday
  s.byWeekday = WEEKDAYS.map((name, i) => {
    const ns = nights.filter((n) => n.weekday === i);
    return {
      i,
      name,
      short: WEEKDAYS_SHORT[i],
      free: i === 4 || i === 5,
      count: ns.length,
      dur: ns.length ? mean(ns.map((n) => n.dur)) : NaN,
      bed: ns.length ? mean(ns.map((n) => n.bedOff)) : NaN,
      wake: ns.length ? mean(ns.map((n) => n.wakeOff)) : NaN,
    };
  });

  // What tags do to you. Each tagged night is compared with untagged nights of the same kind
  // (workday vs free night), so a tag that mostly happens on weekends isn't credited with weekend lie-ins.
  const tagKeys = [...new Set(nights.flatMap((n) => n.tags))];
  s.tagImpact = tagKeys
    .map((key) => {
      const withT = nights.filter((n) => n.tags.includes(key));
      const without = nights.filter((n) => !n.tags.includes(key));
      if (withT.length < 2 || without.length < 2) return null;
      const base = (free, f) => {
        const pool = without.filter((n) => n.free === free && f(n) !== null);
        return pool.length ? mean(pool.map(f)) : NaN;
      };
      const diffs = (f) =>
        withT
          .filter((n) => f(n) !== null)
          .map((n) => f(n) - base(n.free, f))
          .filter(Number.isFinite);
      const dd = diffs((n) => n.dur);
      if (dd.length < 2) return null;
      const qd = diffs((n) => n.quality);
      const sdiff = diffs((n) => n.score.total);
      return {
        key,
        ...tagInfo(key),
        count: withT.length,
        durDiff: mean(dd),
        qualityDiff: qd.length ? mean(qd) : NaN,
        scoreDiff: mean(sdiff),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.durDiff - b.durDiff);

  // Does sleeping longer feel better?
  const withQ = nights.filter((n) => n.quality);
  s.durQualityR = pearson(withQ.map((n) => n.dur), withQ.map((n) => n.quality));

  // Trend: the latest 7 nights vs the 7 before.
  const recent = inRange(scored, today, 7);
  const before = scored.filter((n) => n.date < addDays(today, -7) && n.date >= addDays(today, -14));
  if (recent.length >= 3 && before.length >= 3) {
    s.trendDur = mean(recent.map((n) => n.dur)) - mean(before.map((n) => n.dur));
    s.trendScore = mean(recent.map((n) => n.score.total)) - mean(before.map((n) => n.score.total));
  }

  // Streak of nights that reached the goal (within 15 minutes), counting back from the latest.
  let streak = 0;
  for (let i = scored.length - 1; i >= 0; i--) {
    if (scored[i].dur >= goal - 15) streak++;
    else break;
  }
  s.goalStreak = streak;
  s.bestNight = nights.reduce((a, b) => (b.score.total > a.score.total ? b : a));
  s.worstNight = nights.reduce((a, b) => (b.score.total < a.score.total ? b : a));
  return s;
}

// ---------- suggestions ----------

// Sleep cycles are ~90 minutes, plus ~15 minutes to fall asleep.
export const CYCLE = 90;
export const FALL_ASLEEP = 15;

export function bedtimesFor(wakeMinOfDay) {
  return [6, 5, 4].map((c) => ({ cycles: c, sleep: c * CYCLE, at: wakeMinOfDay - c * CYCLE - FALL_ASLEEP }));
}
export function wakeTimesFor(bedMinOfDay) {
  return [4, 5, 6].map((c) => ({ cycles: c, sleep: c * CYCLE, at: bedMinOfDay + FALL_ASLEEP + c * CYCLE }));
}

// Tonight's suggested bedtime: your usual wake time on the coming morning, minus the goal.
export function tonightPlan(summary, today) {
  if (!summary.count) return null;
  const free = isFreeNight(today);
  const pool = summary.nights.filter((n) => n.free === free);
  const ref = (pool.length >= 2 ? pool : summary.nights).map((n) => n.wakeOff);
  const wakeOff = median(ref);
  const extra = Math.min(summary.debt || 0, 60) / 2; // pay back a little debt, at most 30 min a night
  const bedOff = wakeOff - summary.goal - extra - FALL_ASLEEP;
  return { wakeOff, bedOff, extra, free, caffeineCutoff: bedOff - 8 * 60, screensOff: bedOff - 60 };
}

// ---------- the reading ----------

const pct = (x) => `%${Math.round(x * 100)}`;

// Turns the summary into short, honest notes. Each note has a status so the UI can mark it.
export function insights(s) {
  const out = [];
  if (!s.count) return out;
  const add = (status, icon, title, text) => out.push({ status, icon, title, text });
  const { age, goal } = s;

  // Duration vs age norm
  if (s.avgDur < age.min - 60) {
    add('critical', '⏳', 'Belirgin şekilde az uyuyorsun',
      `Ortalaman ${fmtDur(s.avgDur)}. ${age.label} için önerilen en az ${fmtDur(age.min)}. Her gece yaklaşık ${fmtDur(age.min - s.avgDur)} eksik kalıyorsun; bu dikkat, ruh hali ve bağışıklık üzerinde birikerek etki eder.`);
  } else if (s.avgDur < age.min) {
    add('serious', '⏳', 'Önerilen sürenin biraz altındasın',
      `Ortalaman ${fmtDur(s.avgDur)}, önerilen alt sınır ${fmtDur(age.min)}. Yatışı ${fmtDur(Math.ceil((age.min - s.avgDur) / 5) * 5)} öne çekmek farkı kapatır.`);
  } else if (s.avgDur > age.max + 30) {
    add('warning', '🛌', 'Önerilenden uzun uyuyorsun',
      `Ortalaman ${fmtDur(s.avgDur)}, üst sınır ${fmtDur(age.max)}. Sürekli uzun uyku bazen borç ödemesidir, bazen de yorgunluk veya düşük uyku kalitesinin işaretidir. Uzun sürüyorsa bir hekime danışmak iyi olur.`);
  } else {
    add('good', '✅', 'Süre olarak yerindesin',
      `Ortalaman ${fmtDur(s.avgDur)}, ${age.label} için önerilen ${fmtHours(age.min)}–${fmtHours(age.max)} saat aralığında. Gecelerin ${pct(s.inRecommended)}'i bu aralıkta.`);
  }

  // Regularity
  if (Number.isFinite(s.regularity)) {
    if (s.regularity >= 75) {
      add('good', '🎯', 'Saatlerin çok düzenli', `Yatış ve kalkış saatin ortalama ±${Math.round(s.spread)} dakika oynuyor. İç saatin için en değerli alışkanlık bu.`);
    } else if (s.regularity >= 45) {
      add('warning', '🎯', 'Düzen fena değil ama oynak', `Yatış ve kalkış saatin ortalama ±${Math.round(s.spread)} dakika kayıyor. Bunu 30 dakikanın altına indirmek, aynı süreyi uyusan bile daha dinç uyanmanı sağlar.`);
    } else {
      add('serious', '🎢', 'Uyku saatlerin çok dağınık', `Yatış ve kalkış saatin ortalama ±${fmtDur(s.spread)} kayıyor. Vücudun her gün farklı bir saat dilimine uçuyormuş gibi davranıyor. Önce kalkış saatini sabitle; yatış saati arkasından gelir.`);
    }
  }

  // Social jetlag
  if (Number.isFinite(s.socialJetlag)) {
    const sj = Math.abs(s.socialJetlag);
    if (sj >= 120) {
      add('serious', '✈️', `Sosyal jet-lag: ${fmtDur(sj)}`, `Hafta sonu uyku ortan, hafta içine göre ${fmtDur(sj)} ${s.socialJetlag > 0 ? 'daha geç' : 'daha erken'}. Her pazartesi ${Math.round(sj / 60)} saat dilimi uçmuş gibisin. Hafta sonu kalkışını en fazla 1 saat kaydırmayı dene.`);
    } else if (sj >= 60) {
      add('warning', '✈️', `Sosyal jet-lag: ${fmtDur(sj)}`, `Hafta sonları uyku ortan ${fmtDur(sj)} kayıyor. Hafif bir jet-lag; pazartesi sabahlarının zor geçmesi bundan olabilir.`);
    } else {
      add('good', '🧭', 'Hafta içi ve hafta sonu uyumlu', `Hafta sonu ritmin hafta içinden sadece ${fmtDur(sj)} farklı. Pazartesi sendromu için uyku bahanesi yok.`);
    }
    if (s.freeDur - s.workDur >= 60) {
      add('warning', '💤', 'Hafta sonu borç ödüyorsun', `Hafta sonu geceleri hafta içinden ${fmtDur(s.freeDur - s.workDur)} daha uzun uyuyorsun. Bu, hafta içi biriken uyku borcunun klasik işareti.`);
    }
  }

  // Debt
  if (s.debt >= 300) {
    add('critical', '💳', `Uyku borcun ${fmtDur(s.debt)}`, `Son ${s.debtNights} gecede hedefinin (${fmtDur(goal)}) gerisinde kaldın. Tek bir uzun uykuyla kapanmaz; birkaç gece 30–60 dakika erken yatmak en sağlıklı ödeme planı.`);
  } else if (s.debt >= 120) {
    add('warning', '💳', `Uyku borcun ${fmtDur(s.debt)}`, `Son ${s.debtNights} gecede biriken eksik. Bu hafta birkaç gece 30 dakika erken yatmak yeter.`);
  } else if (s.debtNights >= 5) {
    add('good', '💳', 'Uyku borcun yok denecek kadar az', `Son ${s.debtNights} gecede hedefine yetişmişsin.`);
  }

  // Bedtime
  const bedClock = s.avgBed + EVENING;
  if (Number.isFinite(bedClock) && bedClock >= DAY + 90) {
    add('warning', '🌙', 'Yatış saatin geç', `Ortalama ${fmtOff(s.avgBed)}'te uyuyorsun. Gece yarısından sonraki saatlerde uyku ilk saatlerdeki derin uykuyu kaçırmaz ama sabah alarmıyla birlikte süreyi kısaltır.`);
  }

  // Trend
  if (Number.isFinite(s.trendDur) && Math.abs(s.trendDur) >= 20) {
    if (s.trendDur > 0) add('good', '📈', 'Son haftada toparlanıyorsun', `Son 7 gece, önceki haftaya göre gecede ortalama ${fmtDur(s.trendDur)} daha fazla uyudun.`);
    else add('warning', '📉', 'Son haftada uykun azaldı', `Son 7 gece, önceki haftaya göre gecede ortalama ${fmtDur(-s.trendDur)} daha az uyudun.`);
  }

  // Quality link
  if (Number.isFinite(s.durQualityR) && s.nights.filter((n) => n.quality).length >= 7) {
    if (s.durQualityR >= 0.35) add('info', '🔗', 'Uzun uyuduğunda kendini daha iyi hissediyorsun', `Süre ile kalite puanın arasında belirgin bir bağ var (r = ${s.durQualityR.toFixed(2)}). Senin için süre gerçekten önemli.`);
    else if (s.durQualityR <= 0.1) add('info', '🔗', 'Kalite süreden çok başka şeylere bağlı', `Süre ile kalite puanın arasında neredeyse bağ yok (r = ${s.durQualityR.toFixed(2)}). Etiketlerin etkisine bakmak daha çok ipucu verebilir.`);
  }

  // Awakenings
  if (s.avgAwakenings >= 2) {
    add('warning', '🌗', 'Gece sık uyanıyorsun', `Gece başına ortalama ${s.avgAwakenings.toFixed(1)} uyanma. Oda sıcaklığı (18–20 °C ideal), ışık, gürültü ve akşam sıvı tüketimi ilk bakılacak yerler.`);
  }

  // Tags
  for (const t of s.tagImpact || []) {
    if (t.durDiff <= -25) add('serious', t.icon, `${t.label} uykunu kısaltıyor`, `${t.label} etiketli ${t.count} gecede ortalama ${fmtDur(-t.durDiff)} daha az uyudun${Number.isFinite(t.qualityDiff) && t.qualityDiff < -0.3 ? `, kalite puanın da ${Math.abs(t.qualityDiff).toFixed(1)} düştü` : ''}.`);
    else if (t.durDiff >= 25) add('good', t.icon, `${t.label} sana iyi geliyor`, `${t.label} etiketli ${t.count} gecede ortalama ${fmtDur(t.durDiff)} daha fazla uyudun${Number.isFinite(t.qualityDiff) && t.qualityDiff > 0.3 ? `, kalite puanın da ${t.qualityDiff.toFixed(1)} arttı` : ''}.`);
    else if (Number.isFinite(t.qualityDiff) && t.qualityDiff <= -0.5) add('warning', t.icon, `${t.label} kaliteni düşürüyor`, `Süre aynı kalsa da ${t.label} etiketli gecelerde kalite puanın ${Math.abs(t.qualityDiff).toFixed(1)} daha düşük.`);
  }

  if (s.goalStreak >= 3) add('good', '🔥', `${s.goalStreak} gecedir hedefindesin`, 'Seriyi bozmamak için bu akşam da aynı saatte yat.');

  const order = { critical: 0, serious: 1, warning: 2, info: 3, good: 4 };
  return out.sort((a, b) => order[a.status] - order[b.status]);
}

// One sentence for a single night, used on the home screen and in the log.
export function nightVerdict(n, goal) {
  const diff = n.dur - goal;
  const b = scoreBand(n.score?.total);
  let t;
  if (diff >= -15 && diff <= 60) t = 'Hedefini tutturdun';
  else if (diff < -15) t = `Hedefinin ${fmtDur(-diff)} gerisinde kaldın`;
  else t = `Hedefinden ${fmtDur(diff)} fazla uyudun`;
  if (n.awakenings >= 3) t += `, gece ${n.awakenings} kez uyandın`;
  return `${b.label}. ${t}.`;
}

// ---------- sample data ----------

// Sixty believable nights: weekday alarms, later weekends, a few coffee and screen nights.
export function sampleSleeps(today, nightsBack = 60) {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const out = [];
  for (let i = nightsBack; i >= 1; i--) {
    if (rnd() < 0.06) continue; // forgot to log
    const date = addDays(today, -i);
    const free = isFreeNight(date);
    const tags = [];
    if (rnd() < 0.25) tags.push('kahve');
    if (rnd() < 0.3) tags.push('ekran');
    if (rnd() < 0.25) tags.push('spor');
    if (free && rnd() < 0.35) tags.push('alkol');
    if (rnd() < 0.15) tags.push('stres');
    if (rnd() < 0.2) tags.push('okuma');
    let bed = (free ? 330 : 285) + gauss() * 40; // 23:30 / 22:45 + noise, on the 18:00 timeline
    let wake = free ? 900 + gauss() * 50 : 765 + gauss() * 15; // 09:00 / 06:45
    if (tags.includes('kahve')) bed += 35;
    if (tags.includes('ekran')) bed += 25;
    if (tags.includes('spor')) bed -= 15;
    if (tags.includes('okuma')) bed -= 10;
    if (tags.includes('alkol')) wake -= 40;
    let awakenings = Math.max(0, Math.round(0.8 + gauss() * 1.2 + (tags.includes('alkol') ? 1.2 : 0) + (tags.includes('stres') ? 1 : 0)));
    const dur = wake - bed;
    let quality = Math.round(clamp(3 + (dur - 450) / 60 - awakenings * 0.4 + (tags.includes('spor') ? 0.6 : 0) - (tags.includes('alkol') ? 0.8 : 0) + gauss() * 0.6, 1, 5));
    const base = dayStart(date) + EVENING;
    out.push({
      kind: 'night',
      bedAt: fromMin(base + Math.round(bed / 5) * 5),
      wakeAt: fromMin(base + Math.round(wake / 5) * 5),
      quality,
      awakenings: Math.min(awakenings, 6),
      tags,
      note: '',
    });
    if (!free && rnd() < 0.12) {
      const s = dayStart(addDays(date, 1)) + 14 * 60 + Math.round(rnd() * 6) * 10;
      out.push({ kind: 'nap', bedAt: fromMin(s), wakeAt: fromMin(s + 20 + Math.round(rnd() * 4) * 10), quality: null, awakenings: 0, tags: [], note: '' });
    }
  }
  return out;
}
