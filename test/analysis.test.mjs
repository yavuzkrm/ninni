import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../public/analysis.js';

let nextId = 1;
const night = (bed, wake, extra = {}) => ({ id: nextId++, kind: 'night', bedAt: bed, wakeAt: wake, quality: null, awakenings: 0, tags: [], note: '', ...extra });

test('a sleep belongs to the evening it started from', () => {
  assert.equal(A.nightOf(A.toMin('2026-10-07T02:00')), '2026-10-06');
  assert.equal(A.nightOf(A.toMin('2026-10-06T21:30')), '2026-10-06');
  assert.equal(A.weekday('2026-10-05'), 0); // Monday
  assert.equal(A.isFreeNight('2026-10-09'), true); // Friday night
  assert.equal(A.isFreeNight('2026-10-11'), false); // Sunday night: work tomorrow
});

test('nights are measured on an 18:00 timeline and pieces are merged', () => {
  const ns = A.buildNights([
    night('2026-10-05T23:30', '2026-10-06T03:00'),
    night('2026-10-06T03:30', '2026-10-06T07:00', { quality: 4 }),
    { ...night('2026-10-06T14:00', '2026-10-06T14:20'), kind: 'nap' },
  ]);
  assert.equal(ns.length, 1);
  const n = ns[0];
  assert.equal(n.bedOff, 330);
  assert.equal(n.wakeOff, 780);
  assert.equal(n.dur, 420, 'the 30 minute gap is not sleep');
  assert.equal(n.awakenings, 1, 'a break between pieces counts as waking');
  assert.equal(n.quality, 4);
});

test('formatting', () => {
  assert.equal(A.fmtDur(455), '7 sa 35 dk');
  assert.equal(A.fmtDur(45), '45 dk');
  assert.equal(A.fmtDur(-90, { short: true }), '−1:30');
  assert.equal(A.fmtOff(330), '23:30');
  assert.equal(A.fmtOff(780), '07:00');
});

test('night score rewards duration, quality, timing and continuity', () => {
  const perfect = A.nightScore({ dur: 480, quality: 5, mid: 555, awakenings: 0 }, { goal: 480, refMid: 555 });
  assert.equal(perfect.total, 100);
  const short = A.nightScore({ dur: 300, quality: 2, mid: 700, awakenings: 3 }, { goal: 480, refMid: 555 });
  assert.ok(short.total < 30, `short night scored ${short.total}`);
});

test('summary finds social jetlag, debt and tag effects in sample data', () => {
  const today = '2026-10-07';
  const s = A.summarize(A.buildNights(A.sampleSleeps(today, 60)), { goal: 480, ageGroup: '26-64', today, days: 0 });
  assert.ok(s.count >= 50);
  assert.ok(s.socialJetlag > 60, `weekend mid-sleep should be later, got ${s.socialJetlag}`);
  assert.ok(s.freeDur > s.workDur);
  assert.ok(Number.isFinite(s.regularity));
  assert.ok(s.chronotype);
  const coffee = s.tagImpact.find((t) => t.key === 'kahve');
  assert.ok(coffee && coffee.durDiff < 0, 'coffee nights are shorter in the sample');
  const notes = A.insights(s);
  assert.ok(notes.length >= 4);
  assert.ok(notes.some((n) => /jet-lag/.test(n.title)));
  const plan = A.tonightPlan(s, today);
  assert.ok(plan.bedOff < plan.wakeOff);
});

test('sleep debt pays back but never goes below zero', () => {
  const today = '2026-10-07';
  const short = [];
  const long = [];
  for (let i = 1; i <= 7; i++) {
    const d = A.addDays(today, -i);
    short.push(night(`${d}T23:00`, `${A.addDays(d, 1)}T05:00`)); // 6 h, 2 h under goal
    long.push(night(`${d}T22:00`, `${A.addDays(d, 1)}T08:00`)); // 10 h
  }
  let s = A.summarize(A.buildNights(short), { goal: 480, ageGroup: '26-64', today, days: 30 });
  assert.equal(s.debt, 7 * 120);
  s = A.summarize(A.buildNights(long), { goal: 480, ageGroup: '26-64', today, days: 30 });
  assert.equal(s.debt, 0);
});

test('cycle calculator', () => {
  const [six] = A.bedtimesFor(7 * 60);
  assert.equal(A.fmtClock(six.at), '21:45');
  const [, five] = A.wakeTimesFor(23 * 60);
  assert.equal(A.fmtClock(five.at), '06:45');
});
