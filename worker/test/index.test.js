import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { verifyFirebaseIdToken, _resetJwksCache } from '../src/index.js';

const PROJECT = 'apex-performance-1fe0a';
const ORIGIN = 'https://apex-performance-1fe0a.web.app';
const env = {
  STRAVA_CLIENT_ID: '222662',
  STRAVA_CLIENT_SECRET: 'test-secret',
  FIREBASE_PROJECT_ID: PROJECT,
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5000`,
};

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
);
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'test-kid', alg: 'RS256', use: 'sig' };

async function makeToken(overrides = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = { alg: 'RS256', kid: 'test-kid', typ: 'JWT', ...header };
  const c = { aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'user-123', iat: now - 10, auth_time: now - 10, exp: now + 3600, ...overrides };
  const input = `${b64url(JSON.stringify(h))}.${b64url(JSON.stringify(c))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

// Mock network: Google JWKS + Strava token endpoint
let stravaCalls;
const realFetch = globalThis.fetch;
beforeEach(() => {
  _resetJwksCache();
  stravaCalls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('securetoken@system')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'Cache-Control': 'public, max-age=100' } });
    }
    if (String(url) === 'https://www.strava.com/oauth/token') {
      const body = JSON.parse(init.body);
      stravaCalls.push(body);
      if (body.code === 'bad') return new Response(JSON.stringify({ message: 'Bad Request' }), { status: 400 });
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_at: 123, athlete: { firstname: 'T', lastname: 'G', id: 1, city: 'x' } }));
    }
    throw new Error('unexpected fetch ' + url);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const call = (path, { token, body = {}, origin = ORIGIN, method = 'POST' } = {}) =>
  worker.fetch(new Request(`https://apex-strava.example.workers.dev${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  }), env);

// ── Token verification ──
test('accepts a valid Firebase ID token', async () => {
  const claims = await verifyFirebaseIdToken(await makeToken(), PROJECT);
  assert.equal(claims.sub, 'user-123');
});

test('rejects wrong audience, issuer, expiry, empty sub', async () => {
  for (const o of [{ aud: 'other-project' }, { iss: 'https://evil.example' }, { exp: Math.floor(Date.now() / 1000) - 3600 }, { sub: '' }]) {
    assert.equal(await verifyFirebaseIdToken(await makeToken(o), PROJECT), null, JSON.stringify(o));
  }
});

test('rejects tampered payload, unknown kid, alg none, garbage', async () => {
  const [h, , s] = (await makeToken()).split('.');
  const forged = b64url(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'attacker', iat: 1, auth_time: 1, exp: 9e9 }));
  assert.equal(await verifyFirebaseIdToken(`${h}.${forged}.${s}`, PROJECT), null);
  assert.equal(await verifyFirebaseIdToken(await makeToken({}, { kid: 'nope' }), PROJECT), null);
  assert.equal(await verifyFirebaseIdToken(await makeToken({}, { alg: 'none' }), PROJECT), null);
  assert.equal(await verifyFirebaseIdToken('not.a.jwt', PROJECT), null);
});

// ── HTTP handler ──
test('requires a valid token', async () => {
  assert.equal((await call('/stravaTokenExchange', { body: { code: 'c' } })).status, 401);
  assert.equal((await call('/stravaTokenExchange', { token: 'junk', body: { code: 'c' } })).status, 401);
  assert.equal(stravaCalls.length, 0);
});

test('exchanges a code and strips extra athlete fields', async () => {
  const res = await call('/stravaTokenExchange', { token: await makeToken(), body: { code: 'good' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.deepEqual(await res.json(), { access_token: 'at', refresh_token: 'rt', expires_at: 123, athlete: { firstname: 'T', lastname: 'G', id: 1 } });
  assert.deepEqual(stravaCalls[0], { client_id: '222662', client_secret: 'test-secret', code: 'good', grant_type: 'authorization_code' });
});

test('refreshes a token', async () => {
  const res = await call('/stravaTokenRefresh', { token: await makeToken(), body: { refresh_token: 'old' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { access_token: 'at', refresh_token: 'rt', expires_at: 123 });
  assert.equal(stravaCalls[0].grant_type, 'refresh_token');
});

test('Strava rejection returns a generic 400', async () => {
  const res = await call('/stravaTokenExchange', { token: await makeToken(), body: { code: 'bad' } });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Token exchange failed' });
});

test('validates input, method and path', async () => {
  const t = await makeToken();
  assert.equal((await call('/stravaTokenExchange', { token: t, body: {} })).status, 400);
  assert.equal((await call('/stravaTokenRefresh', { token: t, body: {} })).status, 400);
  assert.equal((await call('/other', { token: t })).status, 404);
  assert.equal((await call('/stravaTokenExchange', { method: 'GET' })).status, 405);
});

test('CORS: preflight allowed only for listed origins', async () => {
  const ok = await call('/stravaTokenExchange', { method: 'OPTIONS' });
  assert.equal(ok.status, 204);
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const bad = await call('/stravaTokenExchange', { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});
