// ══════════════════════════════════════════════
// Apex Strava token proxy — Cloudflare Worker
// ══════════════════════════════════════════════
// Holds the Strava Client Secret (which Strava requires server-side) and
// exposes two endpoints to signed-in Apex users:
//   POST /stravaTokenExchange  { code }           → access/refresh tokens
//   POST /stravaTokenRefresh   { refresh_token }  → refreshed tokens
// Every request must carry a Firebase ID token: "Authorization: Bearer <token>".
//
// Config (wrangler.toml [vars]): STRAVA_CLIENT_ID, FIREBASE_PROJECT_ID, ALLOWED_ORIGINS
// Secret (wrangler secret put):   STRAVA_CLIENT_SECRET

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
    }
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

    const path = new URL(request.url).pathname;
    if (path !== '/stravaTokenExchange' && path !== '/stravaTokenRefresh') {
      return json({ error: 'Not found' }, 404, cors);
    }

    const match = (request.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
    if (!match || !(await verifyFirebaseIdToken(match[1], env.FIREBASE_PROJECT_ID))) {
      return json({ error: 'Unauthorized' }, 401, cors);
    }

    if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
      return json({ error: 'Strava API credentials not configured on server' }, 500, cors);
    }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400, cors); }

    try {
      if (path === '/stravaTokenExchange') {
        if (typeof body.code !== 'string' || !body.code) return json({ error: 'Missing authorization code' }, 400, cors);
        const data = await stravaToken(env, { code: body.code, grant_type: 'authorization_code' });
        if (!data) return json({ error: 'Token exchange failed' }, 400, cors);
        return json({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at,
          athlete: data.athlete ? { firstname: data.athlete.firstname, lastname: data.athlete.lastname, id: data.athlete.id } : null
        }, 200, cors);
      }

      if (typeof body.refresh_token !== 'string' || !body.refresh_token) return json({ error: 'Missing refresh_token' }, 400, cors);
      const data = await stravaToken(env, { refresh_token: body.refresh_token, grant_type: 'refresh_token' });
      if (!data) return json({ error: 'Token refresh failed' }, 400, cors);
      return json({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at }, 200, cors);
    } catch (e) {
      console.error('Strava token error:', e);
      return json({ error: 'Internal error' }, 500, cors);
    }
  }
};

async function stravaToken(env, params) {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, ...params })
  });
  const data = await res.json();
  if (!res.ok) { console.error('Strava rejected token request:', res.status, data); return null; }
  return data;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return { 'Vary': 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// ── Firebase ID token verification (RS256 JWT signed by Google's securetoken service) ──
// https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library

let jwksCache = { keys: null, expiresAt: 0 };

async function getFirebaseJwks(fetchImpl = fetch) {
  if (jwksCache.keys && Date.now() < jwksCache.expiresAt) return jwksCache.keys;
  const res = await fetchImpl(FIREBASE_JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const maxAge = +((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/) || [])[1] || 3600;
  jwksCache = { keys: (await res.json()).keys, expiresAt: Date.now() + maxAge * 1000 };
  return jwksCache.keys;
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

// Returns the token's claims if valid, otherwise null
export async function verifyFirebaseIdToken(token, projectId, { fetchImpl = fetch, now = Date.now() } = {}) {
  try {
    if (!projectId) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = b64urlToJson(parts[0]);
    const claims = b64urlToJson(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) return null;

    const nowSec = Math.floor(now / 1000);
    const skew = 60;
    if (claims.aud !== projectId) return null;
    if (claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (typeof claims.sub !== 'string' || !claims.sub) return null;
    if (!(claims.exp > nowSec - skew)) return null;
    if (!(claims.iat <= nowSec + skew)) return null;
    if (!(claims.auth_time <= nowSec + skew)) return null;

    const jwk = (await getFirebaseJwks(fetchImpl)).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return ok ? claims : null;
  } catch (e) {
    console.error('ID token verification error:', e);
    return null;
  }
}

// Test hook: reset the JWKS cache between test cases
export function _resetJwksCache() { jwksCache = { keys: null, expiresAt: 0 }; }
