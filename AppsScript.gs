/**
 * APEX FIT Email Forwarder — Google Apps Script
 * 
 * SETUP:
 * 1. Go to https://script.google.com and create a new project
 * 2. Paste this entire script
 * 3. Set the CONFIG values below
 * 4. Run setup() once to create the trigger
 * 5. Authorize when prompted
 * 
 * HOW IT WORKS:
 * - Checks Gmail every 5 minutes for emails with .FIT attachments
 * - Sends the FIT file (base64) to your Firebase Cloud Function
 * - Labels processed emails so they're not re-processed
 * - Emails can come from any address (Garmin, Wahoo, Strava, etc.)
 * 
 * USAGE:
 * Forward or send .FIT files to YOUR Gmail address.
 * The script auto-detects .FIT attachments and uploads them.
 */

// ════════════════════════════════════════════
// CONFIGURATION — UPDATE THESE VALUES
// ════════════════════════════════════════════
const CONFIG = {
  // Your Firebase Cloud Function URL (deployed endpoint)
  FUNCTION_URL: "https://us-central1-apex-performance-1fe0a.cloudfunctions.net/ingestFitFromEmail",
  
  // The email address registered in your Apex app (for user lookup)
  APEX_USER_EMAIL: "YOUR_EMAIL@gmail.com",
  
  // API key for authentication (set the same in Firebase config)
  API_KEY: "YOUR_SECRET_API_KEY_HERE",
  
  // Gmail label for processed emails (created automatically)
  PROCESSED_LABEL: "Apex/Processed",
  
  // Gmail search query to find FIT emails
  // Default: any email with .fit attachment, not yet processed
  SEARCH_QUERY: "has:attachment filename:fit -label:apex-processed",
};

// ════════════════════════════════════════════
// SETUP — Run this once
// ════════════════════════════════════════════
function setup() {
  // Create Gmail label
  let label = GmailApp.getUserLabelByName(CONFIG.PROCESSED_LABEL);
  if (!label) {
    label = GmailApp.createLabel(CONFIG.PROCESSED_LABEL);
    Logger.log("Created label: " + CONFIG.PROCESSED_LABEL);
  }
  
  // Delete existing triggers for this function
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "checkForFitEmails") {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // Create time-based trigger: every 5 minutes
  ScriptApp.newTrigger("checkForFitEmails")
    .timeBased()
    .everyMinutes(5)
    .create();
  
  Logger.log("Trigger created: checkForFitEmails runs every 5 minutes");
  Logger.log("Setup complete! FIT files emailed to you will be auto-uploaded.");
}

// ════════════════════════════════════════════
// MAIN — Called by trigger every 5 minutes
// ════════════════════════════════════════════
function checkForFitEmails() {
  const threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, 10);
  
  if (threads.length === 0) {
    Logger.log("No new FIT emails found");
    return;
  }
  
  Logger.log(`Found ${threads.length} threads with FIT attachments`);
  
  const label = GmailApp.getUserLabelByName(CONFIG.PROCESSED_LABEL) 
    || GmailApp.createLabel(CONFIG.PROCESSED_LABEL);
  
  let totalFiles = 0;
  let errors = 0;
  
  for (const thread of threads) {
    const messages = thread.getMessages();
    
    for (const message of messages) {
      const attachments = message.getAttachments();
      const sender = message.getFrom();
      const subject = message.getSubject();
      
      for (const attachment of attachments) {
        const name = attachment.getName();
        
        if (!name.toLowerCase().endsWith(".fit")) continue;
        
        Logger.log(`Processing: ${name} from ${sender}`);
        
        try {
          // Get the FIT file as base64
          const bytes = attachment.getBytes();
          const base64 = Utilities.base64Encode(bytes);
          
          // Send to Firebase Cloud Function
          const payload = {
            userEmail: CONFIG.APEX_USER_EMAIL,
            fileName: name,
            fitBase64: base64,
            sender: sender,
            apiKey: CONFIG.API_KEY,
          };
          
          const options = {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify(payload),
            muteHttpExceptions: true,
          };
          
          const response = UrlFetchApp.fetch(CONFIG.FUNCTION_URL, options);
          const code = response.getResponseCode();
          const body = response.getContentText();
          
          if (code === 200) {
            Logger.log(`✓ Uploaded: ${name}`);
            totalFiles++;
          } else {
            Logger.log(`✗ Error ${code}: ${body}`);
            errors++;
          }
          
        } catch (e) {
          Logger.log(`✗ Exception: ${e.message}`);
          errors++;
        }
      }
    }
    
    // Mark thread as processed
    thread.addLabel(label);
  }
  
  Logger.log(`Done: ${totalFiles} files uploaded, ${errors} errors`);
}

// ════════════════════════════════════════════
// MANUAL TEST — Run to test with the latest email
// ════════════════════════════════════════════
function testManual() {
  Logger.log("Running manual test...");
  checkForFitEmails();
  Logger.log("Test complete — check Execution Log for results");
}
