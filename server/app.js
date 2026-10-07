const path = require('path');
const crypto = require('crypto');
const express = require('express');

const SESSION_COOKIE = 'ninni_sid';
const SESSION_DAYS = 90;
const AGE_GROUPS = ['14-17', '18-25', '26-64', '65+'];
const MAX_TAGS = 12;
const MIN_SLEEP_MIN = 10;
const MAX_SLEEP_MIN = 20 * 60;
const MAX_IMPORT = 5000;

// ---------- small helpers ----------

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => { throw new HttpError(status, code); };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

// Local wall-clock time as "YYYY-MM-DDTHH:MM". Returns minutes since the epoch (as if UTC) or null.
// Treating local time as UTC keeps durations exact and free of server time zone surprises.
function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (y < 1970 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}

function str(v, max, { required = false, field = 'field' } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') fail(400, `invalid_${field}`);
  v = v.trim();
  if (required && !v) fail(400, `missing_${field}`);
  if (v.length > max) fail(400, `too_long_${field}`);
  return v;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // ignore malformed cookies
      }
    }
  }
  return out;
}

function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    if (++h.count > max) return res.status(429).json({ error: 'too_many_attempts' });
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- app ----------

function createApp(db, { secureCookies = false, authRateLimit = 30 } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    insertUser: db.prepare('INSERT INTO users (username, display_name, password_hash, goal_minutes, age_group) VALUES (?, ?, ?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    sleepsFor: db.prepare('SELECT * FROM sleeps WHERE user_id = ? ORDER BY bed_at'),
    sleepById: db.prepare('SELECT * FROM sleeps WHERE id = ? AND user_id = ?'),
    overlap: db.prepare('SELECT id FROM sleeps WHERE user_id = ? AND id != ? AND bed_at < ? AND wake_at > ? LIMIT 1'),
    insertSleep: db.prepare(`INSERT INTO sleeps (user_id, kind, bed_at, wake_at, quality, awakenings, tags, note)
      VALUES (@uid, @kind, @bedAt, @wakeAt, @quality, @awakenings, @tags, @note)`),
    updateSleep: db.prepare(`UPDATE sleeps SET kind = @kind, bed_at = @bedAt, wake_at = @wakeAt, quality = @quality,
      awakenings = @awakenings, tags = @tags, note = @note, updated_at = datetime('now') WHERE id = @id AND user_id = @uid`),
    setLive: db.prepare('UPDATE users SET sleeping_since = ? WHERE id = ?'),
  };

  // ---------- serializers ----------

  const userOut = (u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    goalMinutes: u.goal_minutes,
    ageGroup: u.age_group,
    sleepingSince: u.sleeping_since || null,
  });

  const sleepOut = (s) => ({
    id: s.id,
    kind: s.kind,
    bedAt: s.bed_at,
    wakeAt: s.wake_at,
    quality: s.quality,
    awakenings: s.awakenings,
    tags: JSON.parse(s.tags),
    note: s.note,
  });

  // ---------- middleware ----------

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  app.use('/api', express.json({ limit: '2mb' }));

  // Mutations must be JSON: browsers can't send cross-site JSON without CORS preflight,
  // which together with SameSite cookies keeps CSRF out.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'json_required' });
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      req.sessionHash = sha256(token);
      req.user = q.sessionUser.get(req.sessionHash, Date.now()) || null;
    }
    next();
  });

  const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'unauthorized' }));
  const authLimit = rateLimiter({ windowMs: 10 * 60 * 1000, max: authRateLimit });

  function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = Date.now() + SESSION_DAYS * 864e5;
    q.purgeSessions.run(Date.now());
    q.insertSession.run(sha256(token), userId, expires);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      maxAge: SESSION_DAYS * 864e5,
      path: '/',
    });
  }

  const wrap = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (err) {
      next(err);
    }
  };

  function goalFrom(v, fallback) {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 240 || n > 720) fail(400, 'invalid_goal');
    return n;
  }
  function ageFrom(v, fallback) {
    if (v === undefined) return fallback;
    if (!AGE_GROUPS.includes(v)) fail(400, 'invalid_age_group');
    return v;
  }

  // Validates one sleep from a request body. `current` supplies defaults for PATCH.
  function sleepFields(b, current = null) {
    const pick = (k, ck) => (b[k] !== undefined ? b[k] : current ? current[ck] : undefined);
    const kind = pick('kind', 'kind') ?? 'night';
    if (!['night', 'nap'].includes(kind)) fail(400, 'invalid_kind');
    const bedAt = pick('bedAt', 'bed_at');
    const wakeAt = pick('wakeAt', 'wake_at');
    const bed = parseLocal(bedAt);
    const wake = parseLocal(wakeAt);
    if (bed === null) fail(400, 'invalid_bed_at');
    if (wake === null) fail(400, 'invalid_wake_at');
    const minutes = wake - bed;
    if (minutes < MIN_SLEEP_MIN) fail(400, 'too_short');
    if (minutes > MAX_SLEEP_MIN) fail(400, 'too_long');

    let quality = pick('quality', 'quality');
    if (quality === '' || quality === undefined) quality = null;
    if (quality !== null && (!Number.isInteger(quality) || quality < 1 || quality > 5)) fail(400, 'invalid_quality');

    let awakenings = pick('awakenings', 'awakenings') ?? 0;
    if (!Number.isInteger(awakenings) || awakenings < 0 || awakenings > 20) fail(400, 'invalid_awakenings');

    let tags = b.tags !== undefined ? b.tags : current ? JSON.parse(current.tags) : [];
    if (!Array.isArray(tags) || tags.length > MAX_TAGS) fail(400, 'invalid_tags');
    tags = [...new Set(tags.map((t) => str(t, 24, { required: true, field: 'tag' }).toLowerCase()))];

    const note = b.note !== undefined ? str(b.note, 1000, { field: 'note' }) : current ? current.note : '';
    return { kind, bedAt, wakeAt, quality, awakenings, tags: JSON.stringify(tags), note };
  }

  // ---------- auth ----------

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.post('/api/auth/register', authLimit, wrap((req, res) => {
    const username = str(req.body.username, 24, { required: true, field: 'username' }).toLowerCase();
    if (!/^[a-z0-9_.]{3,24}$/.test(username)) fail(400, 'invalid_username');
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < 6) fail(400, 'weak_password');
    if (password.length > 200) fail(400, 'too_long_password');
    const displayName = str(req.body.displayName, 40, { field: 'displayName' }) || username;
    const goal = goalFrom(req.body.goalMinutes, 480);
    const age = ageFrom(req.body.ageGroup, '26-64');
    if (q.userByName.get(username)) fail(409, 'username_taken');

    const { lastInsertRowid: uid } = q.insertUser.run(username, displayName, hashPassword(password), goal, age);
    startSession(res, uid);
    res.status(201);
    return { user: userOut(q.userById.get(uid)) };
  }));

  app.post('/api/auth/login', authLimit, wrap((req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = q.userByName.get(username);
    if (!user || !verifyPassword(password, user.password_hash)) fail(401, 'wrong_credentials');
    startSession(res, user.id);
    return { user: userOut(user) };
  }));

  app.post('/api/auth/logout', wrap((req, res) => {
    if (req.sessionHash) q.deleteSession.run(req.sessionHash);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  app.get('/api/me', auth, wrap((req) => ({ user: userOut(req.user) })));

  app.patch('/api/me', auth, wrap((req) => {
    const u = req.user;
    const b = req.body;
    const displayName = b.displayName !== undefined ? str(b.displayName, 40, { required: true, field: 'displayName' }) : u.display_name;
    const goal = goalFrom(b.goalMinutes, u.goal_minutes);
    const age = ageFrom(b.ageGroup, u.age_group);
    let hash = u.password_hash;
    if (b.newPassword !== undefined) {
      if (!verifyPassword(String(b.currentPassword || ''), u.password_hash)) fail(403, 'wrong_password');
      if (typeof b.newPassword !== 'string' || b.newPassword.length < 6) fail(400, 'weak_password');
      if (b.newPassword.length > 200) fail(400, 'too_long_password');
      hash = hashPassword(b.newPassword);
    }
    db.prepare('UPDATE users SET display_name = ?, goal_minutes = ?, age_group = ?, password_hash = ? WHERE id = ?')
      .run(displayName, goal, age, hash, u.id);
    if (hash !== u.password_hash) {
      // Changing the password signs out every other device.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(u.id, req.sessionHash);
    }
    return { user: userOut(q.userById.get(u.id)) };
  }));

  app.delete('/api/me', auth, wrap((req, res) => {
    const u = req.user;
    if (!verifyPassword(String((req.body && req.body.password) || ''), u.password_hash)) fail(403, 'wrong_password');
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  // ---------- live sleep (start on one device, stop on another) ----------

  app.post('/api/live', auth, wrap((req) => {
    const at = req.body.at;
    if (parseLocal(at) === null) fail(400, 'invalid_at');
    q.setLive.run(at, req.user.id);
    return { user: userOut(q.userById.get(req.user.id)) };
  }));

  app.delete('/api/live', auth, wrap((req) => {
    q.setLive.run(null, req.user.id);
    return { user: userOut(q.userById.get(req.user.id)) };
  }));

  // ---------- sleeps ----------

  app.get('/api/sleeps', auth, wrap((req) => ({ sleeps: q.sleepsFor.all(req.user.id).map(sleepOut) })));

  app.post('/api/sleeps', auth, wrap((req, res) => {
    const f = sleepFields(req.body);
    if (q.overlap.get(req.user.id, 0, f.wakeAt, f.bedAt)) fail(409, 'overlap');
    const id = db.transaction(() => {
      const { lastInsertRowid } = q.insertSleep.run({ uid: req.user.id, ...f });
      if (req.body.endLive) q.setLive.run(null, req.user.id);
      return lastInsertRowid;
    })();
    res.status(201);
    return { sleep: sleepOut(q.sleepById.get(id, req.user.id)) };
  }));

  app.patch('/api/sleeps/:id', auth, wrap((req) => {
    const cur = q.sleepById.get(Number(req.params.id), req.user.id);
    if (!cur) fail(404, 'sleep_not_found');
    const f = sleepFields(req.body, cur);
    if (q.overlap.get(req.user.id, cur.id, f.wakeAt, f.bedAt)) fail(409, 'overlap');
    q.updateSleep.run({ id: cur.id, uid: req.user.id, ...f });
    return { sleep: sleepOut(q.sleepById.get(cur.id, req.user.id)) };
  }));

  app.delete('/api/sleeps/:id', auth, wrap((req) => {
    const r = db.prepare('DELETE FROM sleeps WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    if (!r.changes) fail(404, 'sleep_not_found');
    return { ok: true };
  }));

  // Bulk import (backup restore and sample data). Overlapping rows are skipped, not fatal.
  app.post('/api/sleeps/import', auth, wrap((req) => {
    const list = req.body.sleeps;
    if (!Array.isArray(list) || list.length > MAX_IMPORT) fail(400, 'invalid_import');
    const rows = list.map((s) => sleepFields(s || {}));
    const result = db.transaction(() => {
      if (req.body.replace) db.prepare('DELETE FROM sleeps WHERE user_id = ?').run(req.user.id);
      let added = 0;
      let skipped = 0;
      for (const f of rows) {
        if (q.overlap.get(req.user.id, 0, f.wakeAt, f.bedAt)) skipped++;
        else {
          q.insertSleep.run({ uid: req.user.id, ...f });
          added++;
        }
      }
      return { added, skipped };
    })();
    return result;
  }));

  app.delete('/api/sleeps', auth, wrap((req) => {
    if (!verifyPassword(String((req.body && req.body.password) || ''), req.user.password_hash)) fail(403, 'wrong_password');
    db.prepare('DELETE FROM sleeps WHERE user_id = ?').run(req.user.id);
    return { ok: true };
  }));

  app.get('/api/export', auth, wrap((req, res) => {
    const sleeps = q.sleepsFor.all(req.user.id).map(sleepOut);
    const stamp = new Date().toISOString().slice(0, 10);
    if (req.query.format === 'csv') {
      const head = ['tur', 'yatis', 'uyanis', 'sure_dk', 'kalite', 'uyanma_sayisi', 'etiketler', 'not'];
      const lines = sleeps.map((s) => [
        s.kind === 'nap' ? 'sekerleme' : 'gece',
        s.bedAt.replace('T', ' '),
        s.wakeAt.replace('T', ' '),
        parseLocal(s.wakeAt) - parseLocal(s.bedAt),
        s.quality ?? '',
        s.awakenings,
        s.tags.join(' '),
        s.note,
      ].map(csvCell).join(','));
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="ninni-${stamp}.csv"`);
      res.send('﻿' + [head.join(','), ...lines].join('\n'));
      return undefined;
    }
    res.set('Content-Disposition', `attachment; filename="ninni-${stamp}.json"`);
    return { app: 'ninni', version: 1, exportedAt: new Date().toISOString(), sleeps };
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  // ---------- static frontend ----------

  const pub = path.join(__dirname, '..', 'public');
  // no-cache = always revalidate via ETag, so a new version shows up right after a deploy or restart.
  app.use(express.static(pub, { index: 'index.html', setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

  // ---------- errors ----------

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return app;
}

module.exports = { createApp, parseLocal };
