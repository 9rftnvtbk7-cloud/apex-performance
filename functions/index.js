const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Busboy = require("busboy");

admin.initializeApp();
const db = admin.firestore();

/**
 * HTTP Cloud Function: Receives FIT file data from email forwarding
 * 
 * Accepts POST with:
 * - JSON body: { userEmail, fileName, fitBase64, sender }
 * - OR multipart form: userEmail, fileName, fitFile (binary)
 * 
 * The function looks up the user by email, then saves the raw FIT data
 * to Firestore for client-side parsing on next login.
 */
exports.ingestFitFromEmail = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  try {
    let userEmail, fileName, fitBase64, sender, apiKey;

    // Parse body (JSON or multipart)
    if (req.is("application/json")) {
      ({ userEmail, fileName, fitBase64, sender, apiKey } = req.body);
    } else {
      // multipart
      const fields = await parseMultipart(req);
      userEmail = fields.userEmail;
      fileName = fields.fileName;
      fitBase64 = fields.fitBase64;
      sender = fields.sender;
      apiKey = fields.apiKey;
    }

    // Validate API key (simple shared secret)
    const expectedKey = functions.config().apex?.api_key || process.env.APEX_API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    if (!userEmail || !fitBase64) {
      res.status(400).json({ error: "Missing userEmail or fitBase64" });
      return;
    }

    // Find user by email
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(userEmail);
    } catch (e) {
      res.status(404).json({ error: `User not found for email: ${userEmail}` });
      return;
    }

    const uid = userRecord.uid;

    // Save to Firestore pending queue (client will parse on next load)
    const docRef = await db.collection("users").doc(uid)
      .collection("pending_fits").add({
        fileName: fileName || "email_upload.fit",
        fitBase64: fitBase64,
        sender: sender || "unknown",
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        processed: false,
      });

    console.log(`FIT file queued for ${userEmail} (${uid}): ${docRef.id}`);
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
 * Strava OAuth Token Exchange
 * Client sends the authorization code, this function exchanges it for tokens
 * using the client_secret (which stays server-side).
 */
exports.stravaTokenExchange = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const { code, uid } = req.body;
  if (!code) { res.status(400).json({ error: "Missing authorization code" }); return; }

  const clientId = functions.config().strava?.client_id || process.env.STRAVA_CLIENT_ID;
  const clientSecret = functions.config().strava?.client_secret || process.env.STRAVA_CLIENT_SECRET;

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

    if (!response.ok) {
      const err = await response.json();
      res.status(400).json({ error: err.message || "Token exchange failed" });
      return;
    }

    const data = await response.json();
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
 * Strava Token Refresh
 * Refreshes an expired access token using the refresh token.
 */
exports.stravaTokenRefresh = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const { refresh_token } = req.body;
  if (!refresh_token) { res.status(400).json({ error: "Missing refresh_token" }); return; }

  const clientId = functions.config().strava?.client_id || process.env.STRAVA_CLIENT_ID;
  const clientSecret = functions.config().strava?.client_secret || process.env.STRAVA_CLIENT_SECRET;

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

    if (!response.ok) {
      const err = await response.json();
      res.status(400).json({ error: err.message || "Token refresh failed" });
      return;
    }

    const data = await response.json();
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
      file.on("end", () => {
        fields[name] = Buffer.concat(chunks).toString("base64");
      });
    });
    busboy.on("finish", () => resolve(fields));
    busboy.on("error", reject);
    req.pipe(busboy);
  });
}
