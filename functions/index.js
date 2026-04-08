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
