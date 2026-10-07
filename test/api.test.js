const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createApp, parseLocal } = require('../server/app');

let server, base;

before(async () => {
  const app = createApp(openDb(':memory:'), { authRateLimit: 1000 });
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// A tiny cookie-keeping client, one per simulated person (or device).
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  };
}

const ayse = client();
const mert = client();
let sleepId;

test('local time parsing rejects impossible values', () => {
  assert.equal(parseLocal('2026-10-06T23:30') - parseLocal('2026-10-06T23:00'), 30);
  assert.notEqual(parseLocal('2024-02-29T07:00'), null);
  assert.equal(parseLocal('2023-02-29T07:00'), null);
  assert.equal(parseLocal('2026-10-06T24:00'), null);
  assert.equal(parseLocal('2026-10-06 23:00'), null);
});

test('register, me, login and logout', async () => {
  let r = await ayse('POST', '/api/auth/register', { username: 'Ayse', password: 'secret1', displayName: 'Ayşe', ageGroup: '18-25' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.username, 'ayse');
  assert.equal(r.data.user.goalMinutes, 480);
  assert.equal(r.data.user.ageGroup, '18-25');

  r = await mert('POST', '/api/auth/register', { username: 'ayse', password: 'secret1' });
  assert.equal(r.status, 409);
  r = await mert('POST', '/api/auth/register', { username: 'mert', password: '123' });
  assert.equal(r.data.error, 'weak_password');
  r = await mert('POST', '/api/auth/register', { username: 'mert', password: 'secret2' });
  assert.equal(r.status, 201);

  r = await ayse('GET', '/api/me');
  assert.equal(r.data.user.displayName, 'Ayşe');

  const other = client();
  r = await other('POST', '/api/auth/login', { username: 'AYSE', password: 'nope' });
  assert.equal(r.status, 401);
  r = await other('POST', '/api/auth/login', { username: 'AYSE', password: 'secret1' });
  assert.equal(r.status, 200);
  await other('POST', '/api/auth/logout', {});
  r = await other('GET', '/api/me');
  assert.equal(r.status, 401);
});

test('mutations must be JSON', async () => {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=a&password=b',
  });
  assert.equal(res.status, 415);
});

test('add, validate, edit and delete sleeps', async () => {
  let r = await ayse('POST', '/api/sleeps', {
    bedAt: '2026-10-05T23:40',
    wakeAt: '2026-10-06T07:10',
    quality: 4,
    awakenings: 1,
    tags: ['kahve', 'Spor', 'kahve'],
    note: 'uçuyordum',
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.sleep.tags, ['kahve', 'spor']);
  assert.equal(r.data.sleep.kind, 'night');
  sleepId = r.data.sleep.id;

  r = await ayse('POST', '/api/sleeps', { bedAt: '2026-10-06T07:00', wakeAt: '2026-10-06T06:00' });
  assert.equal(r.data.error, 'too_short');
  r = await ayse('POST', '/api/sleeps', { bedAt: '2026-10-01T07:00', wakeAt: '2026-10-02T06:00' });
  assert.equal(r.data.error, 'too_long');
  r = await ayse('POST', '/api/sleeps', { bedAt: '2026-10-06T02:00', wakeAt: '2026-10-06T08:00' });
  assert.equal(r.status, 409, 'overlapping sleep is refused');
  r = await ayse('POST', '/api/sleeps', { bedAt: '2026-10-06T07:10', wakeAt: '2026-10-06T07:40', kind: 'nap' });
  assert.equal(r.status, 201, 'touching is not overlapping');
  r = await ayse('POST', '/api/sleeps', { bedAt: '2026-10-06T14:00', wakeAt: '2026-10-06T14:30', kind: 'siesta' });
  assert.equal(r.data.error, 'invalid_kind');
  r = await ayse('POST', '/api/sleeps', { bedAt: '2026-10-06T14:00', wakeAt: '2026-10-06T14:30', quality: 9 });
  assert.equal(r.data.error, 'invalid_quality');

  r = await ayse('PATCH', `/api/sleeps/${sleepId}`, { wakeAt: '2026-10-06T06:50', quality: null });
  assert.equal(r.status, 200);
  assert.equal(r.data.sleep.wakeAt, '2026-10-06T06:50');
  assert.equal(r.data.sleep.quality, null);
  assert.equal(r.data.sleep.note, 'uçuyordum', 'fields not sent are kept');

  // Another person's sleep is invisible
  r = await mert('PATCH', `/api/sleeps/${sleepId}`, { quality: 1 });
  assert.equal(r.status, 404);
  r = await mert('GET', '/api/sleeps');
  assert.equal(r.data.sleeps.length, 0);

  r = await ayse('GET', '/api/sleeps');
  assert.equal(r.data.sleeps.length, 2);
  const nap = r.data.sleeps.find((s) => s.kind === 'nap');
  r = await ayse('DELETE', `/api/sleeps/${nap.id}`);
  assert.equal(r.status, 200);
  r = await ayse('DELETE', `/api/sleeps/${nap.id}`);
  assert.equal(r.status, 404);
});

test('live sleep is shared across devices and ends with a saved night', async () => {
  const phone = ayse;
  const laptop = client();
  await laptop('POST', '/api/auth/login', { username: 'ayse', password: 'secret1' });

  let r = await phone('POST', '/api/live', { at: '2026-10-06T23:15' });
  assert.equal(r.data.user.sleepingSince, '2026-10-06T23:15');
  r = await laptop('GET', '/api/me');
  assert.equal(r.data.user.sleepingSince, '2026-10-06T23:15');
  r = await phone('POST', '/api/live', { at: 'tonight' });
  assert.equal(r.data.error, 'invalid_at');

  r = await laptop('POST', '/api/sleeps', { bedAt: '2026-10-06T23:15', wakeAt: '2026-10-07T07:00', endLive: true });
  assert.equal(r.status, 201);
  r = await phone('GET', '/api/me');
  assert.equal(r.data.user.sleepingSince, null);

  await phone('POST', '/api/live', { at: '2026-10-07T23:00' });
  r = await phone('DELETE', '/api/live');
  assert.equal(r.data.user.sleepingSince, null);
});

test('profile settings are validated', async () => {
  let r = await ayse('PATCH', '/api/me', { goalMinutes: 450, ageGroup: '26-64' });
  assert.equal(r.data.user.goalMinutes, 450);
  r = await ayse('PATCH', '/api/me', { goalMinutes: 30 });
  assert.equal(r.data.error, 'invalid_goal');
  r = await ayse('PATCH', '/api/me', { ageGroup: 'baby' });
  assert.equal(r.data.error, 'invalid_age_group');
});

test('import skips overlaps, export as JSON and CSV', async () => {
  let r = await ayse('POST', '/api/sleeps/import', {
    sleeps: [
      { bedAt: '2026-10-01T23:00', wakeAt: '2026-10-02T07:00', quality: 3, tags: ['alkol'] },
      { bedAt: '2026-10-02T23:30', wakeAt: '2026-10-03T07:30' },
      { bedAt: '2026-10-02T23:45', wakeAt: '2026-10-03T06:00' },
    ],
  });
  assert.deepEqual(r.data, { added: 2, skipped: 1 });
  r = await ayse('POST', '/api/sleeps/import', { sleeps: [{ bedAt: 'x', wakeAt: 'y' }] });
  assert.equal(r.status, 400, 'one bad row rejects the whole import');

  r = await ayse('GET', '/api/export?format=json');
  assert.equal(r.data.app, 'ninni');
  assert.equal(r.data.sleeps.length, 4);
  r = await ayse('GET', '/api/export?format=csv');
  assert.match(r.headers.get('content-type'), /text\/csv/);
  const lines = r.data.trim().split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines[1], /^gece,2026-10-01 23:00,2026-10-02 07:00,480,3,0,alkol,/);
});

test('wiping data and deleting the account need the password', async () => {
  let r = await mert('POST', '/api/sleeps', { bedAt: '2026-10-05T23:00', wakeAt: '2026-10-06T07:00' });
  assert.equal(r.status, 201);
  r = await mert('DELETE', '/api/sleeps', { password: 'wrong' });
  assert.equal(r.status, 403);
  r = await mert('DELETE', '/api/sleeps', { password: 'secret2' });
  assert.equal(r.status, 200);
  r = await mert('GET', '/api/sleeps');
  assert.equal(r.data.sleeps.length, 0);

  r = await mert('DELETE', '/api/me', { password: 'secret2' });
  assert.equal(r.status, 200);
  r = await mert('GET', '/api/me');
  assert.equal(r.status, 401);
  r = await client()('POST', '/api/auth/login', { username: 'mert', password: 'secret2' });
  assert.equal(r.status, 401);
});

test('serves the app with security headers', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Ninni/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  const h = await fetch(base + '/api/health');
  assert.deepEqual(await h.json(), { ok: true });
});
