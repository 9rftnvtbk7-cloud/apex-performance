const { onRequest } = require("firebase-functions/v2/https"); // Updated to v2
const admin = require("firebase-admin");
const Busboy = require("busboy");

admin.initializeApp();
const db = admin.firestore();

/**
 * HTTP Cloud Function: Receives FIT file data from email forwarding
 * Migrated to Cloud Functions v2
 */
exports.ingestFitFromEmail = onRequest({ cors: true }, async (req, res) => { // v2 handles CORS via options
  if (req.method !== "POST") { 
    res.status(405).json({ error: "POST only" }); 
    return; 
  }

  try {
    let userEmail, fileName, fitBase64, sender, apiKey;

    if (req.is("application/json")) {
      ({ userEmail, fileName, fitBase64, sender, apiKey } = req.body);
    } else {
      const fields = await parseMultipart(req);
      userEmail = fields.userEmail;
      fileName = fields.fileName;
      fitBase64 = fields.fitBase64;
      sender = fields.sender;
      apiKey = fields.apiKey;
    }

    // Accessing API key via process.env for 2nd Gen / .env support
    const expectedKey = process.env.APEX_API_KEY; 
    if (expectedKey && apiKey !== expectedKey) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    if (!userEmail || !fitBase64) {
      res.status(400).json({ error: "Missing userEmail or fitBase64" });
      return;
    }

    const userRecord = await admin.auth().getUserByEmail(userEmail);
    const uid = userRecord.uid;

    const docRef = await db.collection("users").doc(uid)
      .collection("pending_fits").add({
        fileName: fileName || "email_upload.fit",
        fitBase64: fitBase64,
        sender: sender || "unknown",
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        processed: false,
      });

    res.status(200).json({ 
      success: true, 
      message: `FIT file queued for processing`,
      docId: docRef.id 
    });

  } catch (error) {
    console.error("Error ingesting FIT:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Strava OAuth Token Exchange (v2)
 */
exports.stravaTokenExchange = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const { code } = req.body;
  if (!code) { res.status(400).json({ error: "Missing authorization code" }); return; }

  // Using process.env to read from your .env file
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

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
      res.status(400).json({ error: data.message || "Token exchange failed" });
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
    res.status(500).json({ error: error.message });
  }
});

/**
 * Strava Token Refresh (v2)
 */
exports.stravaTokenRefresh = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const { refresh_token } = req.body;
  if (!refresh_token) { res.status(400).json({ error: "Missing refresh_token" }); return; }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

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
      res.status(400).json({ error: data.message || "Token refresh failed" });
      return;
    }

    res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at
    });

  } catch (error) {
    console.error("Strava token refresh error:", error);
    res.status(500).json({ error: error.message });
  }
});

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const busboy = Busboy({ headers: req.headers });
    busboy.on("field", (name, val) => { fields[name] = val; });
    busboy.on("file", (name, file, info) => {
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => { fields[name] = Buffer.concat(chunks).toString("base64"); });
    });
    busboy.on("finish", () => resolve(fields));
    busboy.on("error", reject);
    req.pipe(busboy);
  });
}