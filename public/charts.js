// Hand-written SVG charts. Each function returns a string; colors come from CSS tokens
// (--series-1, --series-2, --seq-*, --div-pos/neg, grid/axis/ink), so light and dark themes
// swap in one place. Any element with data-tip gets a tooltip from app.js.

import { DAY, addDays, fmtDur, fmtOff, fmtClock, fmtNight, fmtHours, dateOf, weekday, WEEKDAYS_SHORT, MONTHS_SHORT } from './analysis.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const r1 = (x) => Math.round(x * 10) / 10;

// A column with a 4px rounded top and a square base (bars grow from the baseline).
function colPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${r1(x)},${r1(y + h)}V${r1(y + r)}Q${r1(x)},${r1(y)} ${r1(x + r)},${r1(y)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}V${r1(y + h)}Z`;
}
// A floating bar rounded at both ends (a sleep window has no baseline).
function pillPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h / 2);
  return `M${r1(x)},${r1(y + r)}Q${r1(x)},${r1(y)} ${r1(x + r)},${r1(y)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}V${r1(y + h - r)}Q${r1(x + w)},${r1(y + h)} ${r1(x + w - r)},${r1(y + h)}H${r1(x + r)}Q${r1(x)},${r1(y + h)} ${r1(x)},${r1(y + h - r)}Z`;
}
// Horizontal bar from a center line, rounded at the data end only.
function hbarPath(x0, x1, y, h) {
  const r = Math.min(4, Math.abs(x1 - x0), h / 2);
  if (x1 >= x0) return `M${r1(x0)},${r1(y)}H${r1(x1 - r)}Q${r1(x1)},${r1(y)} ${r1(x1)},${r1(y + r)}V${r1(y + h - r)}Q${r1(x1)},${r1(y + h)} ${r1(x1 - r)},${r1(y + h)}H${r1(x0)}Z`;
  return `M${r1(x0)},${r1(y)}H${r1(x1 + r)}Q${r1(x1)},${r1(y)} ${r1(x1)},${r1(y + r)}V${r1(y + h - r)}Q${r1(x1)},${r1(y + h)} ${r1(x1 + r)},${r1(y + h)}H${r1(x0)}Z`;
}

const svgOpen = (w, h, label) => `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">`;
const empty = (msg = 'Bu aralıkta henüz yeterli gece yok.') => `<div class="chart-empty">${esc(msg)}</div>`;

function dateSpan(nights, today, days) {
  const from = days ? addDays(today, -days + 1) : nights[0].date;
  const out = [];
  for (let d = from; d <= today; d = addDays(d, 1)) out.push(d);
  return out;
}

function xLabelEvery(n, plotW) {
  const fit = Math.max(1, Math.floor(plotW / 56));
  const steps = [1, 2, 7, 14, 28, 56, 91, 182, 364];
  return steps.find((s) => n / s <= fit) || 364;
}

// ---------- 1. nightly duration ----------

export function durationChart(nights, { width, today, days, goal, age }) {
  if (!nights.length) return empty();
  const H = 240;
  const m = { t: 16, r: 12, b: 26, l: 34 };
  const pw = width - m.l - m.r;
  const ph = H - m.t - m.b;
  const span = dateSpan(nights, today, days);
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const maxH = Math.max(10, Math.ceil((Math.max(...nights.map((n) => n.dur)) + 30) / 60));
  const y = (min) => m.t + ph - (min / (maxH * 60)) * ph;
  const slot = pw / span.length;
  const bw = Math.max(2, Math.min(24, slot - 2));
  let s = svgOpen(width, H, 'Gece gece uyku süresi');

  // recommended band
  s += `<rect class="band" x="${m.l}" y="${r1(y(age.max))}" width="${pw}" height="${r1(y(age.min) - y(age.max))}"/>`;
  for (let h = 0; h <= maxH; h += 2) {
    s += `<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${r1(y(h * 60))}" y2="${r1(y(h * 60))}"/>`;
    s += `<text class="tick" x="${m.l - 6}" y="${r1(y(h * 60)) + 4}" text-anchor="end">${h} sa</text>`;
  }
  const every = xLabelEvery(span.length, pw);
  span.forEach((d, i) => {
    const n = byDate.get(d);
    const cx = m.l + slot * i + slot / 2;
    if (n) {
      s += `<path class="mark s1" d="${colPath(cx - bw / 2, y(n.dur), bw, y(0) - y(n.dur))}"/>`;
    }
    const tip = n
      ? `${fmtNight(d, { long: true })}\n${fmtDur(n.dur)} · ${fmtOff(n.bedOff)} → ${fmtOff(n.wakeOff)}\nSkor ${n.score.total}`
      : `${fmtNight(d, { long: true })}\nKayıt yok`;
    s += `<rect class="hit" x="${r1(m.l + slot * i)}" y="${m.t}" width="${r1(slot)}" height="${ph}" data-tip="${esc(tip)}"${n ? ` data-night="${d}"` : ''}/>`;
    if ((span.length - 1 - i) % every === 0) {
      s += `<text class="tick" x="${r1(cx)}" y="${H - 8}" text-anchor="middle">${esc(shortDate(d, every))}</text>`;
    }
  });
  s += `<line class="axis" x1="${m.l}" x2="${m.l + pw}" y1="${r1(y(0))}" y2="${r1(y(0))}"/>`;
  // goal reference line, labelled
  s += `<line class="ref" x1="${m.l}" x2="${m.l + pw}" y1="${r1(y(goal))}" y2="${r1(y(goal))}"/>`;
  s += `<text class="ref-label" x="${m.l + pw - 2}" y="${r1(y(goal)) - 5}" text-anchor="end">Hedef ${fmtDur(goal)}</text>`;
  return s + '</svg>';
}

function shortDate(d, every) {
  const [, mo, day] = d.split('-').map(Number);
  if (every >= 28) return `${MONTHS_SHORT[mo - 1]}`;
  return `${day} ${MONTHS_SHORT[mo - 1]}`;
}

// ---------- 2. sleep window (when, not how long) ----------

export function windowChart(nights, { width, today, days, avgBed, avgWake }) {
  if (!nights.length) return empty();
  const H = 280;
  const m = { t: 14, r: 12, b: 26, l: 46 };
  const pw = width - m.l - m.r;
  const ph = H - m.t - m.b;
  const span = dateSpan(nights, today, days);
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const lo = Math.floor((Math.min(...nights.map((n) => n.bedOff)) - 30) / 60) * 60;
  const hi = Math.ceil((Math.max(...nights.map((n) => n.wakeOff)) + 30) / 60) * 60;
  const y = (off) => m.t + ((off - lo) / (hi - lo)) * ph; // later = lower, like reading a timetable
  const slot = pw / span.length;
  const bw = Math.max(2, Math.min(24, slot - 2));
  const step = hi - lo > 12 * 60 ? 180 : 120;
  let s = svgOpen(width, H, 'Uyku penceresi: yatış ve kalkış saatleri');
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
    s += `<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${r1(y(t))}" y2="${r1(y(t))}"/>`;
    s += `<text class="tick" x="${m.l - 6}" y="${r1(y(t)) + 4}" text-anchor="end">${fmtOff(t)}</text>`;
  }
  const every = xLabelEvery(span.length, pw);
  span.forEach((d, i) => {
    const n = byDate.get(d);
    const cx = m.l + slot * i + slot / 2;
    if (n) s += `<path class="mark ${n.free ? 's2' : 's1'}" d="${pillPath(cx - bw / 2, y(n.bedOff), bw, Math.max(3, y(n.wakeOff) - y(n.bedOff)))}"/>`;
    const tip = n ? `${fmtNight(d, { long: true })}\n${fmtOff(n.bedOff)} → ${fmtOff(n.wakeOff)} (${fmtDur(n.dur)})` : `${fmtNight(d, { long: true })}\nKayıt yok`;
    s += `<rect class="hit" x="${r1(m.l + slot * i)}" y="${m.t}" width="${r1(slot)}" height="${ph}" data-tip="${esc(tip)}"${n ? ` data-night="${d}"` : ''}/>`;
    if ((span.length - 1 - i) % every === 0) s += `<text class="tick" x="${r1(cx)}" y="${H - 8}" text-anchor="middle">${esc(shortDate(d, every))}</text>`;
  });
  for (const [v, label] of [[avgBed, 'ort. yatış'], [avgWake, 'ort. kalkış']]) {
    if (!Number.isFinite(v)) continue;
    s += `<line class="ref" x1="${m.l}" x2="${m.l + pw}" y1="${r1(y(v))}" y2="${r1(y(v))}"/>`;
    s += `<text class="ref-label halo" x="${m.l + 4}" y="${r1(y(v)) - 5}">${label} ${fmtOff(v)}</text>`;
  }
  return s + '</svg>';
}

// ---------- 3. 24-hour dial: the last nights as rings around a clock ----------

export function clockChart(nights, { size = 300 } = {}) {
  const list = nights.slice(-14);
  if (!list.length) return empty();
  const c = size / 2;
  const outer = c - 26;
  const inner = outer * 0.42;
  const ring = (outer - inner) / list.length;
  const sw = Math.max(3, Math.min(10, ring - 2));
  const pt = (minOfDay, r) => {
    const a = (minOfDay / DAY) * 2 * Math.PI - Math.PI / 2;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  let s = svgOpen(size, size, '24 saatlik uyku kadranı, son geceler');
  s += `<circle class="dial" cx="${c}" cy="${c}" r="${outer + 8}"/>`;
  for (let h = 0; h < 24; h++) {
    const [x1, y1] = pt(h * 60, outer + 4);
    const [x2, y2] = pt(h * 60, outer + (h % 6 ? 8 : 12));
    s += `<line class="axis" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`;
  }
  for (const [h, label] of [[0, '00'], [6, '06'], [12, '12'], [18, '18']]) {
    const [x, y] = pt(h * 60, outer + 20);
    s += `<text class="tick" x="${r1(x)}" y="${r1(y) + 4}" text-anchor="middle">${label}</text>`;
  }
  list.forEach((n, i) => {
    const r = inner + ring * (i + 0.5);
    const start = (n.bedOff + 18 * 60) % DAY;
    const len = Math.min(n.wakeOff - n.bedOff, DAY - 1);
    const [x1, y1] = pt(start, r);
    const [x2, y2] = pt(start + len, r);
    const large = len > DAY / 2 ? 1 : 0;
    s += `<circle class="track" cx="${c}" cy="${c}" r="${r1(r)}" stroke-width="${r1(sw)}"/>`;
    s += `<path class="arc ${n.free ? 's2' : 's1'}" stroke-width="${r1(sw)}" d="M${r1(x1)},${r1(y1)}A${r1(r)},${r1(r)} 0 ${large} 1 ${r1(x2)},${r1(y2)}"/>`;
    s += `<path class="hit-arc" stroke-width="${r1(Math.max(ring, 10))}" d="M${r1(x1)},${r1(y1)}A${r1(r)},${r1(r)} 0 ${large} 1 ${r1(x2)},${r1(y2)}" data-tip="${esc(`${fmtNight(n.date, { long: true })}\n${fmtOff(n.bedOff)} → ${fmtOff(n.wakeOff)} (${fmtDur(n.dur)})`)}" data-night="${n.date}"/>`;
  });
  const last = list[list.length - 1];
  s += `<text class="dial-big" x="${c}" y="${c + 2}" text-anchor="middle">${fmtDur(last.dur, { short: true })}</text>`;
  s += `<text class="dial-small" x="${c}" y="${c + 20}" text-anchor="middle">son gece</text>`;
  return s + '</svg>';
}

// ---------- 4. average by weekday ----------

export function weekdayChart(byWeekday, { width, goal }) {
  if (!byWeekday || byWeekday.every((d) => !d.count)) return empty();
  const H = 220;
  const m = { t: 22, r: 8, b: 26, l: 34 };
  const pw = width - m.l - m.r;
  const ph = H - m.t - m.b;
  const maxH = Math.max(10, Math.ceil((Math.max(...byWeekday.filter((d) => d.count).map((d) => d.dur)) + 20) / 60));
  const y = (min) => m.t + ph - (min / (maxH * 60)) * ph;
  const slot = pw / 7;
  const bw = Math.min(24, slot - 8);
  let s = svgOpen(width, H, 'Haftanın günlerine göre ortalama uyku');
  for (let h = 0; h <= maxH; h += 2) {
    s += `<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${r1(y(h * 60))}" y2="${r1(y(h * 60))}"/>`;
    s += `<text class="tick" x="${m.l - 6}" y="${r1(y(h * 60)) + 4}" text-anchor="end">${h} sa</text>`;
  }
  byWeekday.forEach((d, i) => {
    const cx = m.l + slot * i + slot / 2;
    if (d.count) {
      s += `<path class="mark ${d.free ? 's2' : 's1'}" d="${colPath(cx - bw / 2, y(d.dur), bw, y(0) - y(d.dur))}"/>`;
      s += `<text class="value" x="${r1(cx)}" y="${r1(y(d.dur)) - 6}" text-anchor="middle">${fmtDur(d.dur, { short: true })}</text>`;
    }
    const tip = d.count ? `${d.name} gecesi (${d.count} gece)\nOrtalama ${fmtDur(d.dur)}\nYatış ${fmtOff(d.bed)} · Kalkış ${fmtOff(d.wake)}` : `${d.name} gecesi\nKayıt yok`;
    s += `<rect class="hit" x="${r1(m.l + slot * i)}" y="${m.t}" width="${r1(slot)}" height="${ph}" data-tip="${esc(tip)}"/>`;
    s += `<text class="tick" x="${r1(cx)}" y="${H - 8}" text-anchor="middle">${d.short}</text>`;
  });
  s += `<line class="axis" x1="${m.l}" x2="${m.l + pw}" y1="${r1(y(0))}" y2="${r1(y(0))}"/>`;
  s += `<line class="ref" x1="${m.l}" x2="${m.l + pw}" y1="${r1(y(goal))}" y2="${r1(y(goal))}"/>`;
  return s + '</svg>';
}

// ---------- 5. calendar heatmap ----------

export const HEAT_BINS = [
  { max: 300, label: '< 5 sa' },
  { max: 360, label: '5–6' },
  { max: 420, label: '6–7' },
  { max: 480, label: '7–8' },
  { max: Infinity, label: '8+ sa' },
];
const heatBin = (dur) => HEAT_BINS.findIndex((b) => dur < b.max) + 1;

export function heatmap(nights, { width, today, weeks = 26 }) {
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const m = { t: 18, l: 30, r: 4 };
  // Fill the card: as many weeks as fit at a comfortable cell size, up to a year.
  weeks = Math.max(8, Math.min(53, Math.floor((width - m.l - m.r) / Math.max(14, Math.min(24, (width - m.l - m.r) / weeks)))));
  const cell = Math.min(22, Math.floor((width - m.l - m.r) / weeks) - 2);
  const gap = 2;
  const end = addDays(today, 6 - weekday(today)); // Sunday of this week
  const start = addDays(end, -(weeks * 7) + 1);
  const H = m.t + 7 * (cell + gap) + 4;
  let s = svgOpen(m.l + weeks * (cell + gap) + m.r, H, 'Takvim ısı haritası');
  [0, 2, 4, 6].forEach((w) => {
    s += `<text class="tick" x="${m.l - 6}" y="${m.t + w * (cell + gap) + cell * 0.75}" text-anchor="end">${WEEKDAYS_SHORT[w]}</text>`;
  });
  let lastMonth = '';
  for (let wk = 0; wk < weeks; wk++) {
    for (let wd = 0; wd < 7; wd++) {
      const d = addDays(start, wk * 7 + wd);
      if (d > today) continue;
      const n = byDate.get(d);
      const x = m.l + wk * (cell + gap);
      const yy = m.t + wd * (cell + gap);
      const cls = n ? `seq${heatBin(n.dur)}` : 'cell-empty';
      const tip = n ? `${fmtNight(d, { long: true })}\n${fmtDur(n.dur)} · skor ${n.score.total}` : `${fmtNight(d, { long: true })}\nKayıt yok`;
      s += `<rect class="cell ${cls}" x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="3" data-tip="${esc(tip)}"${n ? ` data-night="${d}"` : ''}/>`;
      if (wd === 0) {
        const mon = d.slice(0, 7);
        if (mon !== lastMonth && Number(d.slice(8)) <= 7) {
          s += `<text class="tick" x="${x}" y="${m.t - 6}">${MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}</text>`;
          lastMonth = mon;
        }
      }
    }
  }
  return s + '</svg>';
}

// ---------- 6. duration vs how it felt ----------

export function scatterChart(nights, { width }) {
  const list = nights.filter((n) => n.quality);
  if (list.length < 3) return empty('Kalite puanı verdiğin en az 3 gece gerekiyor.');
  const H = 240;
  const m = { t: 14, r: 14, b: 30, l: 40 };
  const pw = width - m.l - m.r;
  const ph = H - m.t - m.b;
  const lo = Math.floor(Math.min(...list.map((n) => n.dur)) / 60);
  const hi = Math.ceil(Math.max(...list.map((n) => n.dur)) / 60);
  const x = (min) => m.l + ((min / 60 - lo) / Math.max(1, hi - lo)) * pw;
  const y = (q) => m.t + ph - ((q - 0.5) / 5) * ph;
  const faces = ['', '😣', '😕', '😐', '🙂', '😊'];
  let s = svgOpen(width, H, 'Uyku süresi ve kalite');
  for (let q = 1; q <= 5; q++) {
    s += `<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${r1(y(q))}" y2="${r1(y(q))}"/>`;
    s += `<text class="tick emoji" x="${m.l - 10}" y="${r1(y(q)) + 5}" text-anchor="end">${faces[q]}</text>`;
  }
  for (let h = lo; h <= hi; h++) {
    s += `<text class="tick" x="${r1(x(h * 60))}" y="${H - 10}" text-anchor="middle">${h} sa</text>`;
  }
  list.forEach((n, i) => {
    const jitter = (((i * 37) % 11) - 5) / 30; // stable, small vertical spread so equal scores don't stack
    const cx = x(n.dur);
    const cy = y(n.quality + jitter);
    s += `<circle class="dot s1" cx="${r1(cx)}" cy="${r1(cy)}" r="4.5"/>`;
    s += `<circle class="hit" cx="${r1(cx)}" cy="${r1(cy)}" r="11" data-tip="${esc(`${fmtNight(n.date, { long: true })}\n${fmtDur(n.dur)} · kalite ${n.quality.toFixed(0)}/5`)}" data-night="${n.date}"/>`;
  });
  return s + '</svg>';
}

// ---------- 7. tag effects (diverging) ----------

export function tagChart(tagImpact, { width }) {
  if (!tagImpact || !tagImpact.length) return empty('Etiket etkisini görmek için gecelerine etiket ekle (her etiket için en az 2 gece).');
  const rowH = 34;
  const labelW = Math.min(170, width * 0.42);
  const m = { t: 8, r: 54, b: 22, l: labelW };
  const H = m.t + tagImpact.length * rowH + m.b;
  const pw = width - m.l - m.r;
  const maxAbs = Math.max(30, ...tagImpact.map((t) => Math.abs(t.durDiff)));
  const lim = Math.ceil(maxAbs / 30) * 30;
  const x = (v) => m.l + pw / 2 + (v / lim) * (pw / 2);
  let s = svgOpen(width, H, 'Etiketlerin uyku süresine etkisi');
  for (const v of [-lim, 0, lim]) {
    s += `<line class="${v ? 'grid' : 'axis'}" x1="${r1(x(v))}" x2="${r1(x(v))}" y1="${m.t}" y2="${H - m.b}"/>`;
    s += `<text class="tick" x="${r1(x(v))}" y="${H - 6}" text-anchor="middle">${v > 0 ? '+' : ''}${v ? fmtDur(v) : '0'}</text>`;
  }
  tagImpact.forEach((t, i) => {
    const yy = m.t + i * rowH;
    const bh = 16;
    const by = yy + (rowH - bh) / 2;
    s += `<text class="label" x="${m.l - 10}" y="${r1(by + 12)}" text-anchor="end">${esc(`${t.icon} ${t.label}`)} <tspan class="muted">(${t.count})</tspan></text>`;
    s += `<path class="mark ${t.durDiff >= 0 ? 'pos' : 'neg'}" d="${hbarPath(x(0), x(t.durDiff), by, bh)}"/>`;
    const tx = t.durDiff >= 0 ? x(t.durDiff) + 6 : x(t.durDiff) - 6;
    s += `<text class="value" x="${r1(tx)}" y="${r1(by + 12)}" text-anchor="${t.durDiff >= 0 ? 'start' : 'end'}">${t.durDiff > 0 ? '+' : ''}${fmtDur(t.durDiff)}</text>`;
    const q = Number.isFinite(t.qualityDiff) ? `\nKalite farkı ${t.qualityDiff > 0 ? '+' : ''}${t.qualityDiff.toFixed(1)}` : '';
    s += `<rect class="hit" x="0" y="${yy}" width="${width}" height="${rowH}" data-tip="${esc(`${t.label}: ${t.count} gece\nSüre farkı ${t.durDiff > 0 ? '+' : ''}${fmtDur(t.durDiff)}${q}\nSkor farkı ${t.scoreDiff > 0 ? '+' : ''}${Math.round(t.scoreDiff)}`)}"/>`;
  });
  return s + '</svg>';
}

// ---------- score ring ----------

export function scoreRing(score, band, { size = 132, label = 'Uyku skoru' } = {}) {
  const c = size / 2;
  const r = c - 9;
  const len = 2 * Math.PI * r;
  const v = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(`${label}: ${Number.isFinite(score) ? Math.round(score) : 'yok'}, ${band.label}`)}">
    <circle class="ring-track st-${band.status}" cx="${c}" cy="${c}" r="${r}"/>
    <circle class="ring-fill st-${band.status}" cx="${c}" cy="${c}" r="${r}" stroke-dasharray="${r1((v / 100) * len)} ${r1(len)}" transform="rotate(-90 ${c} ${c})"/>
    <text class="ring-num" x="${c}" y="${c + 4}" text-anchor="middle">${Number.isFinite(score) ? Math.round(score) : '–'}</text>
    <text class="ring-sub" x="${c}" y="${c + 24}" text-anchor="middle">${esc(band.icon)} ${esc(band.label)}</text>
  </svg>`;
}

// ---------- tiny 7-night strip for the home screen ----------

export function weekStrip(nights, { today, goal }) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(today, -i - 1));
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const max = Math.max(goal + 60, ...days.map((d) => byDate.get(d)?.dur || 0));
  return `<div class="week-strip">${days
    .map((d) => {
      const n = byDate.get(d);
      const h = n ? Math.max(6, (n.dur / max) * 100) : 0;
      return `<div class="ws-col" data-tip="${esc(n ? `${fmtNight(d, { long: true })}\n${fmtDur(n.dur)}` : `${fmtNight(d, { long: true })}\nKayıt yok`)}"${n ? ` data-night="${d}"` : ''}>
        <div class="ws-bar-wrap"><div class="ws-goal" style="bottom:${(goal / max) * 100}%"></div>${n ? `<div class="ws-bar" style="height:${h}%"></div>` : '<div class="ws-none"></div>'}</div>
        <div class="ws-val">${n ? fmtHours(n.dur) : '–'}</div>
        <div class="ws-day">${WEEKDAYS_SHORT[weekday(d)]}</div>
      </div>`;
    })
    .join('')}</div>`;
}

export { fmtClock, dateOf };
