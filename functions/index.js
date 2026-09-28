const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Busboy = require("busboy");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

// Secrets live in Google Secret Manager — set them with:
//   firebase functions:secrets:set APEX_API_KEY
//   firebase functions:secrets:set STRAVA_CLIENT_SECRET
const APEX_API_KEY = defineSecret("APEX_API_KEY");
const STRAVA_CLIENT_SECRET = defineSecret("STRAVA_CLIENT_SECRET");

// Browser origins allowed to call the Strava endpoints
const ALLOWED_ORIGINS = [
  "https://apex-performance-1fe0a.web.app",
  "https://apex-performance-1fe0a.firebaseapp.com",
  "http://localhost:5000",
];

// Firestore documents max out at 1 MiB; keep base64 FIT payloads safely below that
const MAX_FIT_BASE64_LENGTH = 900 * 1024;

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Verifies the caller's Firebase ID token ("Authorization: Bearer <token>").
// Returns the decoded token, or null after sending a 401.
async function requireFirebaseUser(req, res) {
  const match = (req.get("Authorization") || "").match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (e) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
}

/**
 * HTTP Cloud Function: Receives FIT file data from email forwarding (Apps Script).
 * Server-to-server only, so no CORS.
 */
exports.ingestFitFromEmail = onRequest({ cors: false, secrets: [APEX_API_KEY] }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  // Fail closed: refuse everything if the key is not configured
  const expectedKey = APEX_API_KEY.value();
  if (!expectedKey) {
    console.error("APEX_API_KEY secret is not configured");
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  try {
    let userEmail, fileName, fitBase64, sender, apiKey;

    if (req.is("application/json")) {
      ({ userEmail, fileName, fitBase64, sender, apiKey } = req.body || {});
    } else {
      const fields = await parseMultipart(req);
      ({ userEmail, fileName, fitBase64, sender, apiKey } = fields);
    }

    if (!safeEqual(apiKey, expectedKey)) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    if (typeof userEmail !== "string" || typeof fitBase64 !== "string" || !userEmail || !fitBase64) {
      res.status(400).json({ error: "Missing userEmail or fitBase64" });
      return;
    }
    if (fitBase64.length > MAX_FIT_BASE64_LENGTH) {
      res.status(413).json({ error: "FIT file too large" });
      return;
    }

    let uid;
    try {
      uid = (await admin.auth().getUserByEmail(userEmail)).uid;
    } catch (e) {
      res.status(404).json({ error: "Unknown user" });
      return;
    }

    const docRef = await db.collection("users").doc(uid)
      .collection("pending_fits").add({
        fileName: String(fileName || "email_upload.fit").slice(0, 200),
        fitBase64: fitBase64,
        sender: String(sender || "unknown").slice(0, 200),
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        processed: false,
      });

    res.status(200).json({
      success: true,
      message: "FIT file queued for processing",
      docId: docRef.id
    });

  } catch (error) {
    console.error("Error ingesting FIT:", error);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * Strava OAuth Token Exchange (v2) — requires a signed-in Firebase user
 */
exports.stravaTokenExchange = onRequest({ cors: ALLOWED_ORIGINS, secrets: [STRAVA_CLIENT_SECRET] }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!(await requireFirebaseUser(req, res))) return;

  const { code } = req.body || {};
  if (typeof code !== "string" || !code) { res.status(400).json({ error: "Missing authorization code" }); return; }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = STRAVA_CLIENT_SECRET.value();

  if (!clientId || !clientSecret) {
    res.status(500).json({ error: "Strava API credentials not configured on server" });
    return;
  }

  try {
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: "authorization_code"
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Strava token exchange rejected:", data);
      res.status(400).json({ error: "Token exchange failed" });
      return;
    }

    res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete: data.athlete ? { firstname: data.athlete.firstname, lastname: data.athlete.lastname, id: data.athlete.id } : null
    });

  } catch (error) {
    console.error("Strava token exchange error:", error);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * Strava Token Refresh (v2) — requires a signed-in Firebase user
 */
exports.stravaTokenRefresh = onRequest({ cors: ALLOWED_ORIGINS, secrets: [STRAVA_CLIENT_SECRET] }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!(await requireFirebaseUser(req, res))) return;

  const { refresh_token } = req.body || {};
  if (typeof refresh_token !== "string" || !refresh_token) { res.status(400).json({ error: "Missing refresh_token" }); return; }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = STRAVA_CLIENT_SECRET.value();

  if (!clientId || !clientSecret) {
    res.status(500).json({ error: "Strava API credentials not configured on server" });
    return;
  }

  try {
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh_token,
        grant_type: "refresh_token"
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Strava token refresh rejected:", data);
      res.status(400).json({ error: "Token refresh failed" });
      return;
    }

    res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at
    });

  } catch (error) {
    console.error("Strava token refresh error:", error);
    res.status(500).json({ error: "Internal error" });
  }
});

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const busboy = Busboy({
      headers: req.headers,
      limits: { fields: 10, files: 1, fieldSize: MAX_FIT_BASE64_LENGTH, fileSize: MAX_FIT_BASE64_LENGTH }
    });
    busboy.on("field", (name, val) => { fields[name] = val; });
    busboy.on("file", (name, file, info) => {
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("limit", () => reject(new Error("File too large")));
      file.on("end", () => { fields[name] = Buffer.concat(chunks).toString("base64"); });
    });
    busboy.on("finish", () => resolve(fields));
    busboy.on("error", reject);
    // Cloud Functions buffers the body; pipe the raw bytes when available
    if (req.rawBody) busboy.end(req.rawBody); else req.pipe(busboy);
  });
}
