import express from "express";
import path from "path";
import { google } from "googleapis";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import stream from "stream";
import admin from "firebase-admin";
import fs from "fs";

dotenv.config();

// --- Write-Safe Workspace Path for Serverless Environments (Vercel) ---
const DB_DIR = (process.env.VERCEL || process.env.NODE_ENV === "production") ? "/tmp" : process.cwd();

// --- Error Logging Utility ---
const logErrorToFile = (context: string, err: any, extra?: any) => {
  try {
    const logPath = path.join(DB_DIR, "error_logs.txt");
    const timestamp = new Date().toISOString();
    const errorMessage = err instanceof Error ? err.stack || err.message : String(err);
    const extraStr = extra ? `\nExtra Data: ${JSON.stringify(extra, null, 2)}` : "";
    const entry = `[${timestamp}] CONTEXT: ${context}\nERROR: ${errorMessage}${extraStr}\n---------------------------------------\n`;
    fs.appendFileSync(logPath, entry, "utf-8");
  } catch (e) {
    console.error("Failed to write to error_logs.txt", e);
  }
};

// --- Firebase Admin Initialization ---
let firebaseProjectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
let firebaseDatabaseId = process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID;

try {
  // If FIREBASE_PROJECT_ID is not provided in env, fall back to sandbox appletconfig
  if (!firebaseProjectId) {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      firebaseProjectId = config.projectId;
      if (!firebaseDatabaseId) {
        firebaseDatabaseId = config.firestoreDatabaseId;
      }
    }
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();

  if (firebaseProjectId) {
    const options: any = {
      projectId: firebaseProjectId,
    };

    if (clientEmail && privateKey) {
      options.credential = admin.credential.cert({
        projectId: firebaseProjectId,
        clientEmail: clientEmail,
        privateKey: privateKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n"),
      });
    }

    admin.initializeApp(options);
    console.log(`Firebase Admin initialized successfully for project: ${firebaseProjectId}`);
  } else {
    console.warn("FIREBASE_PROJECT_ID missing. Firestore operations will fail.");
  }
} catch (error: any) {
  if (error.code !== 'app/duplicate-app') {
    console.error("Firebase Admin initialization error:", error);
  }
}

// --- Firebase Admin Instance Proxy (Lazy Loaded to prevent module-load crashes on Vercel) ---
let firestoreInstance: admin.firestore.Firestore | null = null;
const getFirestoreInstance = () => {
  if (!firestoreInstance) {
    if (admin.apps.length === 0) {
      console.warn("Firebase App is not initialized yet. Returning fallback mock to prevent crash.");
      // Return a basic mock to prevent immediate throw during setup-checks
      return {
        collection: () => ({
          limit: () => ({
            get: async () => { throw new Error("Firebase not initialized in this environment. Please configure FIREBASE_PROJECT_ID."); }
          })
        })
      } as any;
    }
    try {
      firestoreInstance = (firebaseDatabaseId && firebaseDatabaseId !== "(default)") ? (admin.app() as any).firestore(firebaseDatabaseId) : admin.firestore();
    } catch (err) {
      console.error("Failed to fetch firestore instance:", err);
      throw err;
    }
  }
  return firestoreInstance;
};

const db = new Proxy({} as admin.firestore.Firestore, {
  get(target, prop) {
    // Return early for known inspection/prototype calls to prevent auto-initializing
    if (
      prop === "then" || 
      prop === "inspect" || 
      prop === "toJSON" || 
      prop === "toString" ||
      typeof prop === "symbol" || 
      prop === "util.inspect.custom" ||
      prop === "prototype" ||
      prop === "constructor"
    ) {
      return undefined;
    }
    const instance = getFirestoreInstance();
    const val = Reflect.get(instance, prop);
    return typeof val === "function" ? val.bind(instance) : val;
  }
});
const app = express();
const PORT = 3000;

// --- Safe Fallback Persistent JSON Databases ---
const ADMINS_FILE = path.join(DB_DIR, "admins_database.json");
const CLAIMS_FILE = path.join(DB_DIR, "claims_database.json");
const MAIL_MAP_FILE = path.join(DB_DIR, "mail_map_database.json");

const loadLocalJSON = (filePath: string, defaultVal: any) => {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (err) {
    console.error(`Error loading local JSON from ${filePath}:`, err);
  }
  return defaultVal;
};

const saveLocalJSON = (filePath: string, data: any) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`Error saving local JSON to ${filePath}:`, err);
  }
};

let fallbackClaims: any[] = loadLocalJSON(CLAIMS_FILE, []);
const fallbackEmailMap: { [key: string]: string } = loadLocalJSON(MAIL_MAP_FILE, {});

const initialAdmins = loadLocalJSON(ADMINS_FILE, {
  "admin@expense.com": {
    name: "Default Admin",
    email: "admin@expense.com",
    password: "admin123"
  }
});
const fallbackAdmins = new Map<string, any>(Object.entries(initialAdmins));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- Google Client Helper ---
const getGoogleAuth = () => {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();

  if (!clientEmail || !privateKey) {
    console.error("Missing Google Credentials: EMAIL length:", clientEmail?.length || 0, "KEY length:", privateKey?.length || 0);
    throw new Error("Google Service Account credentials (EMAIL or PRIVATE_KEY) are missing in environment variables.");
  }

  // Handle potential double-quotes and escaped newlines commonly found in environment variables
  privateKey = privateKey.replace(/^"|"$/g, "").replace(/\\n/g, "\n");

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file"
    ],
  });
};

const getSheetsClient = async () => {
  const auth = await getGoogleAuth().getClient();
  return google.sheets({ version: "v4", auth: auth as any });
};

const getDriveClient = async () => {
  const auth = await getGoogleAuth().getClient();
  return google.drive({ version: "v3", auth: auth as any });
};

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1L6iVHvBuknqum6lFf26BAp1_wrEwyyqwnj5o3lznCZ4";
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const HEADERS = [
  "Timestamp", "Submission ID", "Branch Name", "Salesperson Name", "Expense Category", 
  "Item Date", "From Location", "To Location", "Amount", "Attachment Link", "Item Remark", 
  "Grand Total", "Admin Remark", "Mail Sent", "Approved", 
  "Approved Timestamp", "Payment Process", "Processed By", 
  "Status", "Payment Release", "Released By"
];

// Helper to ensure a sheet exists and has headers
const ensureSheetExists = async (sheets: any, spreadsheetId: string, title: string) => {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets?.find((s: any) => s.properties?.title === title);

  if (!sheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }]
      }
    });
    // Add headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [HEADERS] }
    });
  }
  return title;
};

// Helper for private email storage
const getEmailMapping = async (sheets: any, spreadsheetId: string) => {
  const title = "_Mails_";
  await ensureSheetExists(sheets, spreadsheetId, title);
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!A:B` });
  const rows = response.data.values || [];
  const map: { [key: string]: string } = {};
  rows.forEach((row: string[]) => {
    if (row[0]) map[row[0]] = row[1];
  });
  return map;
};

const saveEmailMapping = async (sheets: any, spreadsheetId: string, submissionId: string, email: string) => {
  const title = "_Mails_";
  await ensureSheetExists(sheets, spreadsheetId, title);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${title}!A:B`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[submissionId, email]] }
  });
};

// Helper to get the correct range/sheet name
const getSheetRange = async (sheets: any, spreadsheetId: string, baseRange: string) => {
  try {
    // Try original range first
    await sheets.spreadsheets.values.get({ spreadsheetId, range: baseRange });
    return baseRange;
  } catch (error: any) {
    if (error.message.includes("Unable to parse range")) {
      // If "Sheet1" fails, try to get the first sheet's actual name
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const firstSheetName = spreadsheet.data.sheets?.[0]?.properties?.title;
      if (firstSheetName) {
        console.log(`Sheet1 not found. Using first sheet: "${firstSheetName}"`);
        return `${firstSheetName}!${baseRange.split('!')[1] || baseRange}`;
      }
    }
    throw error;
  }
};

const RANGE = "Sheet1!A:Z"; 

// --- Drive Upload Helper ---
const uploadToDrive = async (fileName: string, base64Data: string, mimeType: string) => {
  try {
    const drive = await getDriveClient();
    const buffer = Buffer.from(base64Data.split(',')[1] || base64Data, 'base64');
    
    const fileMetadata = {
      name: fileName,
      parents: FOLDER_ID ? [FOLDER_ID] : undefined,
    };
    const media = {
      mimeType: mimeType,
      body: stream.Readable.from(buffer),
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    // Make file readable by anyone with the link (optional but helpful for admins)
    await drive.permissions.create({
      fileId: file.data.id!,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    return file.data.webViewLink;
  } catch (error) {
    console.error("Drive Upload Error:", error);
    return "Upload Failed";
  }
};

// --- Email Helper ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendMail = async (to: string, cc: string, subject: string, text: string, fromName?: string, replyTo?: string) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("SMTP credentials missing. Email skipped.");
    return;
  }
  try {
    // We use a display name that includes the user's email if provided
    // but the actual 'from' address must remain the authenticated SMTP_USER to avoid spam filters/refusal
    const displayName = fromName ? `${fromName}${replyTo ? ` (${replyTo})` : ''}` : (process.env.SMTP_USER_NAME || 'Expense System');
    
    await transporter.sendMail({
      from: `"${displayName}" <${process.env.SMTP_USER}>`,
      replyTo: replyTo || process.env.SMTP_USER,
      to,
      cc,
      subject,
      text,
    });
    console.log(`Email sent to ${to} (CC: ${cc})`);
  } catch (error) {
    console.error("Email error:", error);
  }
};

// --- API Routes ---

// --- Admin Authentication Routes ---

// Optional: Register a new admin account
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    const lowerEmail = email.toLowerCase().trim();

    // Store in-memory fallback & persist to JSON database
    fallbackAdmins.set(lowerEmail, { name, email: lowerEmail, password });
    saveLocalJSON(ADMINS_FILE, Object.fromEntries(fallbackAdmins));

    // Store in Firestore (with safe try-catch so it doesn't fail if Firestore is off)
    try {
      if (admin.apps.length > 0) {
        await db.collection("admins").doc(lowerEmail).set({
          name,
          email: lowerEmail,
          password,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    } catch (fsErr) {
      console.warn("Firestore save skipped during register:", fsErr);
    }

    res.json({ success: true, user: { name, email: lowerEmail } });
  } catch (err: any) {
    console.error("Register Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Login admin account
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const lowerEmail = email.toLowerCase().trim();

    // 1. Check fallback memory
    let adminUser = fallbackAdmins.get(lowerEmail);

    // Support flexible "admin" / "admin123" for the default admin
    if (lowerEmail === "admin@expense.com" && (password === "admin" || password === "admin123")) {
      return res.json({
        success: true,
        user: { name: "Default Admin", email: "admin@expense.com" }
      });
    }

    // 2. Check Firestore if memory doesn't have it (or to sync down)
    if (!adminUser) {
      try {
        if (admin.apps.length > 0) {
          const doc = await db.collection("admins").doc(lowerEmail).get();
          if (doc.exists) {
            const data = doc.data();
            if (data && data.password === password) {
              adminUser = { name: data.name, email: data.email, password: data.password };
              // Cache back into memory
              fallbackAdmins.set(lowerEmail, adminUser);
            }
          }
        }
      } catch (fsErr) {
        console.warn("Firestore check skipped during login:", fsErr);
      }
    }

    if (adminUser && adminUser.password === password) {
      return res.json({
        success: true,
        user: { name: adminUser.name, email: adminUser.email }
      });
    }

    res.status(401).json({ error: "Invalid email or password" });
  } catch (err: any) {
    console.error("Login Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 1. Submit Claim
app.post("/api/claim", async (req, res) => {
  try {
    const { 
      branchName, salespersonName, salespersonEmail, 
      items, grandTotal, branchHeadEmail
    } = req.body;

    const submissionId = `EXP-${Date.now()}`;
    const timestamp = new Date().toLocaleString();

    // Process File Uploads (Safe Google Drive attachment helper)
    let driveClient: any = null;
    try {
      driveClient = await getDriveClient();
    } catch (e: any) {
      console.warn("Google Drive client not available (using mockup values):", e.message);
    }

    const processedItems = await Promise.all(items.map(async (item: any, idx: number) => {
      let attachmentUrl = item.attachment;
      if (item.fileData && item.fileName && driveClient) {
        try {
          attachmentUrl = await uploadToDrive(
            `${submissionId}_item${idx+1}_${item.fileName}`,
            item.fileData,
            item.fileType
          ) || "Upload Failed";
        } catch (uploadError) {
          console.error("Google Drive Upload failed:", uploadError);
          attachmentUrl = "Upload Failed (Google Drive Error)";
        }
      } else if (item.fileData && item.fileName) {
        attachmentUrl = item.attachment || "Attachment Loaded (Local Copy Only)";
      }
      return { ...item, attachment: attachmentUrl };
    }));

    // Backwards-compatible row format for our local cache mapping
    const localRows = processedItems.map((item: any, idx: number) => ({
      rowIndex: idx + 2,
      sheetName: branchName || "Sheet1",
      timestamp,
      submissionid: submissionId,
      branchname: branchName || "Sheet1",
      salespersonname: salespersonName,
      expensecategory: item.category,
      itemdate: item.itemDate,
      fromlocation: item.fromLoc || "",
      tolocation: item.toLoc || "",
      amount: String(item.amount),
      attachmentlink: item.attachment || "",
      itemremark: item.remark || "",
      grandtotal: String(grandTotal),
      adminremark: "",
      mailsent: "No",
      approved: "No",
      approvedtimestamp: "",
      paymentprocess: "No",
      processedby: "",
      status: "Pending",
      paymentrelease: "No",
      releasedby: "",
      employeeemail: salespersonEmail,
      branchheademail: branchHeadEmail
    }));

    // Save into server-side cache immediately for instant local reflection
    fallbackClaims.push(...localRows);
    fallbackEmailMap[submissionId] = salespersonEmail;
    saveLocalJSON(CLAIMS_FILE, fallbackClaims);
    saveLocalJSON(MAIL_MAP_FILE, fallbackEmailMap);

    // --- FIRESTORE SYNC (Safe Try-Catch) ---
    try {
      if (admin.apps.length > 0) {
        const claimRef = db.collection('claims').doc(submissionId);
        await claimRef.set({
          submissionId,
          branchName: branchName || "Unknown",
          salespersonName: salespersonName || "Unknown",
          employeeEmail: salespersonEmail,
          grandTotal: Number(grandTotal),
          status: 'PENDING',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          mailSent: false
        });

        const itemsBatch = db.batch();
        processedItems.forEach((item, idx) => {
          const itemRef = claimRef.collection('items').doc(`item_${idx}`);
          itemsBatch.set(itemRef, {
            category: item.category,
            itemDate: item.itemDate,
            fromLoc: item.fromLoc || "",
            toLoc: item.toLoc || "",
            amount: Number(item.amount),
            attachmentLink: item.attachment || "",
            remark: item.remark || ""
          });
        });
        await itemsBatch.commit();
        console.log(`Claim ${submissionId} synced to Firestore.`);
      }
    } catch (fsError) {
      console.error("Firestore Save Error (handled gracefully):", fsError);
    }

    // --- GOOGLE SHEETS ACCESS (Safe Try-Catch) ---
    try {
      const sheets = await getSheetsClient();
      const sheetTitle = branchName || "Sheet1";
      await ensureSheetExists(sheets, SHEET_ID, sheetTitle);
      await saveEmailMapping(sheets, SHEET_ID, submissionId, salespersonEmail);

      const rows = processedItems.map((item: any) => [
        timestamp || "", 
        submissionId || "", 
        branchName || "", 
        salespersonName || "", 
        item.category || "", 
        item.itemDate || "", 
        item.fromLoc || "", 
        item.toLoc || "", 
        item.amount || "", 
        item.attachment || "", 
        item.remark || "", 
        grandTotal || 0,
        "", // Admin Remark
        "No", // Mail Sent
        "No", // Approved
        "", // Approved Timestamp
        "No", // Payment Process
        "", // Processed By
        "Pending", // Status
        "No", // Payment Release
        ""  // Released By
      ]);

      const appendResponse = await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${sheetTitle}!A:U`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });

      // Merge Cells Logic for multi-item submissions
      if (items.length > 1) {
        try {
          const updatedRange = appendResponse.data.updates?.updatedRange;
          if (updatedRange) {
            const rowsMatch = updatedRange.match(/(\d+):[A-Z]+(\d+)/);
            if (rowsMatch) {
              const startRowIndex = parseInt(rowsMatch[1]) - 1; // 0-indexed
              const endRowIndex = parseInt(rowsMatch[2]); // Exclusive
              
              const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
              const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === sheetTitle);
              const sheetId = sheet?.properties?.sheetId;

              if (sheetId !== undefined) {
                const columnsToMerge = [0, 1, 2, 3, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
                const requests = columnsToMerge.map(colIndex => ({
                  mergeCells: {
                    range: {
                      sheetId,
                      startRowIndex,
                      endRowIndex,
                      startColumnIndex: colIndex,
                      endColumnIndex: colIndex + 1
                    },
                    mergeType: "MERGE_ALL"
                  }
                }));

                await sheets.spreadsheets.batchUpdate({
                  spreadsheetId: SHEET_ID,
                  requestBody: { requests }
                });
              }
            }
          }
        } catch (mergeError) {
          console.error("Merging Error (non-blocking):", mergeError);
        }
      }
    } catch (sheetError: any) {
      console.warn("Google Sheets save skipped/failed (using fallback and database stores):", sheetError.message);
    }

    // Notify Admins & Branch Head (Safe SMTP routing)
    try {
      const adminEmails = process.env.ADMIN_EMAILS || "";
      const recipients = branchHeadEmail ? `${adminEmails},${branchHeadEmail}` : adminEmails;
      
      await sendMail(
        recipients,
        "",
        `New Multi-Entry Claim: ${salespersonName}`,
        `A new claim has been submitted by ${salespersonName} (${branchName}).\nTotal Amount: ₹${grandTotal}\nTotal Items: ${items.length}\n\nCheck the sheet: https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
        salespersonName,
        salespersonEmail
      );
    } catch (mailErr) {
      console.error("Safe notification skip:", mailErr);
    }

    res.json({ success: true, submissionId });
  } catch (error: any) {
    console.error("Submit Error:", error);
    logErrorToFile("Submit Claim API", error, { body: req.body });
    res.status(500).json({ error: error.message });
  }
});

// --- Diagnostics Endpoint for Vercel Deployment Troubleshooting ---
app.get("/api/diagnose", async (req, res) => {
  const report: any = {
    timestamp: new Date().toISOString(),
    environment: {
      isVercel: !!process.env.VERCEL,
      nodeEnv: process.env.NODE_ENV || "not set",
    },
    googleCredentials: {
      emailConfigured: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      emailLength: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.length || 0,
      emailValue: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? `${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.slice(0, 10)}...` : "missing",
      keyConfigured: !!process.env.GOOGLE_PRIVATE_KEY,
      keyLength: process.env.GOOGLE_PRIVATE_KEY?.length || 0,
      keyStartsWithBegin: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.includes("-----BEGIN PRIVATE KEY-----") : false,
      keyEndsWithEnd: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.includes("-----END PRIVATE KEY-----") : false,
      keyContainsRawNewlines: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.includes("\n") : false,
      keyContainsEscapedNewlines: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.includes("\\n") : false,
      spreadsheetIdConfigured: !!process.env.GOOGLE_SHEET_ID,
      spreadsheetId: SHEET_ID,
    },
    firebaseConfig: {
      projectIdConfigured: !!process.env.FIREBASE_PROJECT_ID,
      projectId: process.env.FIREBASE_PROJECT_ID || "missing",
      databaseId: firebaseDatabaseId || "default",
    },
    smtpConfig: {
      smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
      smtpUserConfigured: !!process.env.SMTP_USER,
      smtpUser: process.env.SMTP_USER ? `${process.env.SMTP_USER.slice(0, 5)}...` : "missing",
      smtpPassConfigured: !!process.env.SMTP_PASS,
    },
    checks: {}
  };

  // Check 1: Google Auth & Sheets connection
  try {
    const sheets = await getSheetsClient();
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    report.checks.googleSheets = {
      status: "success",
      title: spreadsheet.data.properties?.title || "No Title",
      sheetsCount: spreadsheet.data.sheets?.length || 0,
      sheetNames: spreadsheet.data.sheets?.map(s => s.properties?.title)
    };
  } catch (err: any) {
    report.checks.googleSheets = {
      status: "failed",
      error: err.message,
      code: err.code,
      details: err.response?.data?.error || err.toString()
    };
  }

  // Check 2: Firestore Admin connection
  try {
    const testDoc = await db.collection("claims").limit(1).get();
    report.checks.firestore = {
      status: "success",
      documentsFetched: testDoc.size
    };
  } catch (err: any) {
    report.checks.firestore = {
      status: "failed",
      error: err.message,
      details: err.toString()
    };
  }

  // Decide overall status code - only fail if critical Google Sheets connection fails
  const hasFailedCheck = report.checks.googleSheets?.status === "failed";
  res.status(200).json(report);
});

// 2. Get Claims for Admin
app.get("/api/claims", async (req, res) => {
  try {
    // 1. Try Google Sheets first
    try {
      const sheets = await getSheetsClient();
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
      const sheetTitles = (spreadsheet.data.sheets || [])
        .map(s => s.properties?.title)
        .filter(title => title && title !== "_Mails_" && title !== "Sheet1");

      const emailMap = await getEmailMapping(sheets, SHEET_ID);
      let allClaims: any[] = [];

      for (const title of sheetTitles) {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `${title}!A:U`,
        });
        const rows = response.data.values || [];
        if (rows.length < 2) continue;

        const headers = rows[0];
        const data = rows.slice(1).map((row, index) => {
          const obj: any = { rowIndex: index + 2, sheetName: title }; 
          headers.forEach((header: string, i: number) => {
            const key = header.toLowerCase().replace(/ /g, "");
            obj[key] = row[i] || "";
          });

          // Dynamic backwards compatibility mapping for simple vs full headers
          if (obj.branch && !obj.branchname) obj.branchname = obj.branch;
          if (obj.name && !obj.salespersonname) obj.salespersonname = obj.name;
          if (obj.category && !obj.expensecategory) obj.expensecategory = obj.category;
          if (obj.date && !obj.itemdate) obj.itemdate = obj.date;
          if (obj.from && !obj.fromlocation) obj.fromlocation = obj.from;
          if (obj.to && !obj.tolocation) obj.tolocation = obj.to;
          if (obj.attachment && !obj.attachmentlink) obj.attachmentlink = obj.attachment;
          if (obj.remark && !obj.itemremark) obj.itemremark = obj.remark;
          if (obj.approveddetails && !obj.approvedtimestamp) obj.approvedtimestamp = obj.approveddetails;

          // Restore email from map
          obj.employeeemail = emailMap[obj.submissionid] || "";
          return obj;
        });
        allClaims = [...allClaims, ...data];
      }

      // Merge with in-memory claims that aren't already fetched
      const mergedClaims = [...allClaims];
      fallbackClaims.forEach(fc => {
        if (!mergedClaims.some(c => c.submissionid === fc.submissionid)) {
          mergedClaims.push(fc);
        }
      });

      return res.json(mergedClaims);
    } catch (sheetError: any) {
      console.warn("Google Sheets fetch failed, falling back to database/memory storage:", sheetError.message);
      
      // 2. Try Firestore claims
      try {
        if (admin.apps.length > 0) {
          const claimsSnapshot = await db.collection('claims').orderBy('createdAt', 'desc').limit(100).get();
          const dbClaims: any[] = [];
          
          for (const doc of claimsSnapshot.docs) {
            const docData = doc.data();
            const subId = doc.id;
            
            // Try fetching sub-items
            let itemsSnapshot: any;
            try {
              itemsSnapshot = await doc.ref.collection('items').get();
            } catch (ite) {
              itemsSnapshot = { docs: [] };
            }
            const itemsData = itemsSnapshot.docs.map((idoc: any) => idoc.data());
            
            if (itemsData.length === 0) {
              // Create a fallback row-like claim representation
              dbClaims.push({
                rowIndex: 2,
                sheetName: docData.branchName,
                timestamp: docData.createdAt?.toDate().toLocaleString() || new Date().toLocaleString(),
                submissionid: subId,
                branchname: docData.branchName,
                salespersonname: docData.salespersonName,
                expensecategory: "General",
                itemdate: new Date().toLocaleDateString(),
                fromlocation: "",
                tolocation: "",
                amount: String(docData.grandTotal),
                attachmentlink: "",
                itemremark: "",
                grandtotal: String(docData.grandTotal),
                adminremark: docData.adminRemark || "",
                mailsent: docData.mailSent ? "Yes" : "No",
                approved: docData.status === "APPROVED" || docData.status === "PROCESSED" || docData.status === "RELEASED" ? "Yes" : "No",
                approvedtimestamp: docData.approvedAt?.toDate().toLocaleString() || "",
                paymentprocess: docData.status === "PROCESSED" || docData.status === "RELEASED" ? "Yes" : "No",
                processedby: docData.processedBy || "",
                status: docData.status,
                paymentrelease: docData.status === "RELEASED" ? "Yes" : "No",
                releasedby: docData.releasedBy || "",
                employeeemail: docData.employeeEmail || ""
              });
            } else {
              itemsData.forEach((item: any, idx: number) => {
                dbClaims.push({
                  rowIndex: idx + 2,
                  sheetName: docData.branchName,
                  timestamp: docData.createdAt?.toDate().toLocaleString() || new Date().toLocaleString(),
                  submissionid: subId,
                  branchname: docData.branchName,
                  salespersonname: docData.salespersonName,
                  expensecategory: item.category || "General",
                  itemdate: item.itemDate || "",
                  fromlocation: item.fromLoc || "",
                  tolocation: item.toLoc || "",
                  amount: String(item.amount || ""),
                  attachmentlink: item.attachmentLink || "",
                  itemremark: item.remark || "",
                  grandtotal: String(docData.grandTotal),
                  adminremark: docData.adminRemark || "",
                  mailsent: docData.mailSent ? "Yes" : "No",
                  approved: docData.status === "APPROVED" || docData.status === "PROCESSED" || docData.status === "RELEASED" ? "Yes" : "No",
                  approvedtimestamp: docData.approvedAt?.toDate().toLocaleString() || "",
                  paymentprocess: docData.status === "PROCESSED" || docData.status === "RELEASED" ? "Yes" : "No",
                  processedby: docData.processedBy || "",
                  status: docData.status,
                  paymentrelease: docData.status === "RELEASED" ? "Yes" : "No",
                  releasedby: docData.releasedBy || "",
                  employeeemail: docData.employeeEmail || ""
                });
              });
            }
          }
          
          if (dbClaims.length > 0) {
            const mergedClaims = [...dbClaims];
            fallbackClaims.forEach(fc => {
              if (!mergedClaims.some(c => c.submissionid === fc.submissionid)) {
                mergedClaims.push(fc);
              }
            });
            return res.json(mergedClaims);
          }
        }
      } catch (firestoreError) {
        console.error("Firestore claims fetch failed:", firestoreError);
      }

      // 3. Complete fallback back to in-memory array
      res.json(fallbackClaims);
    }
  } catch (error: any) {
    console.error("Critical Admin Fetch Error:", error);
    res.json([]); // Return empty list instead of 500 error to ensure UI can still load smoothly
  }
});

// 3. Admin Actions (Remark, Approve, Process, Release)
app.post("/api/admin/action", async (req, res) => {
  const { action, rowIndex, claimId, data, adminName: reqAdminName, adminEmail: reqAdminEmail, sheetName } = req.body;
  const targetSheet = sheetName || "Sheet1";
  const adminName = reqAdminName || "Admin"; 
  const adminEmail = reqAdminEmail || process.env.SMTP_USER || "";
  const timestamp = new Date().toLocaleString();

  try {
    // --- 1. LOCAL CACHE MEMORY UPDATE ---
    fallbackClaims = fallbackClaims.map(c => {
      if (c.submissionid === claimId) {
        const updated = { ...c };
        if (action === "REMARK") {
          updated.adminremark = data.remark;
          updated.mailsent = "Yes";
          updated.status = "Remarked";
        } else if (action === "APPROVE") {
          updated.approved = "Yes";
          updated.approvedtimestamp = `${adminName} - ${timestamp}`;
          updated.status = "Approved";
        } else if (action === "PROCESS") {
          updated.paymentprocess = "Yes";
          updated.processedby = `${adminName} - ${timestamp}`;
          updated.status = "Processed";
        } else if (action === "RELEASE") {
          updated.paymentrelease = "Yes";
          updated.releasedby = `${adminName} - ${timestamp}`;
          updated.status = "Released";
        }
        return updated;
      }
      return c;
    });
    saveLocalJSON(CLAIMS_FILE, fallbackClaims);

    // --- 2. FIRESTORE UPDATE (Safe Try-Catch) ---
    try {
      if (admin.apps.length > 0) {
        const updateData: any = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        if (action === "REMARK") {
          updateData.adminRemark = data.remark;
          updateData.status = "REMARKED";
          updateData.mailSent = true;
        } else if (action === "APPROVE") {
          updateData.status = "APPROVED";
          updateData.approvedAt = admin.firestore.FieldValue.serverTimestamp();
          updateData.approvedBy = `${adminName} (${adminEmail})`;
        } else if (action === "PROCESS") {
          updateData.status = "PROCESSED";
          updateData.processedBy = `${adminName} (${adminEmail})`;
          updateData.processedAt = admin.firestore.FieldValue.serverTimestamp();
        } else if (action === "RELEASE") {
          updateData.status = "RELEASED";
          updateData.releasedBy = `${adminName} (${adminEmail})`;
          updateData.releasedAt = admin.firestore.FieldValue.serverTimestamp();
        }
        await db.collection('claims').doc(claimId).update(updateData);
        console.log(`Firestore synchronized for action ${action} on claim ${claimId}`);
      }
    } catch (fsErr) {
      console.error("Firestore Admin Update Error (non-blocking):", fsErr);
    }

    // --- 3. GOOGLE SHEETS ACCESS (Safe Try-Catch) ---
    try {
      const sheets = await getSheetsClient();
      if (action === "REMARK") {
        // Column M (Admin Remark), N (Mail Sent)
        const range = `${targetSheet}!M${rowIndex}:N${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[data.remark, "Yes"]] },
        });
      } 
      else if (action === "APPROVE") {
        // Column O (Approved), P (Approved Detail)
        const range = `${targetSheet}!O${rowIndex}:P${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Yes", `${adminName} - ${timestamp}`]] },
        });
      }
      else if (action === "PROCESS") {
        // Column Q (Payment Process), R (Processed By), S (Status Log)
        const range = `${targetSheet}!Q${rowIndex}:S${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Yes", `${adminName} - ${timestamp}`, `Mail sent to Accounts at ${timestamp}`]] },
        });
      }
      else if (action === "RELEASE") {
        // Column T (Payment Release), U (Released By)
        const range = `${targetSheet}!T${rowIndex}:U${rowIndex}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Yes", `${adminName} - ${timestamp}`]] },
        });
      }
    } catch (sheetError: any) {
      console.warn("Google Sheets update skipped/failed for Admin Action:", sheetError.message);
    }

    // --- 4. SECURE EMAIL ROUTING ---
    try {
      if (action === "REMARK") {
        await sendMail(
          data.employeeemail, 
          `${process.env.ADMIN_EMAILS || ""},${data.branchheademail || ""}`, 
          `Action Required: Expense Claim Update (${claimId})`, 
          `Dear Employee,\n\nAdmin has left a remark regarding your claim:\n\n"${data.remark}"\n\nPlease check and respond.`,
          adminName,
          adminEmail
        );
      } 
      else if (action === "APPROVE") {
        await sendMail(
          data.employeeemail,
          `${process.env.ADMIN_EMAILS || ""},${data.branchheademail || ""}`,
          `Claim Approved: ${claimId}`,
          `Your expense claim for ₹${data.grandtotal} has been APPROVED by Admin and sent for payment processing.`,
          adminName,
          adminEmail
        );
      }
      else if (action === "PROCESS") {
        await sendMail(
          process.env.ACCOUNTS_EMAIL || "",
          `${data.employeeemail},${data.branchheademail || ""},${process.env.ADMIN_EMAILS || ""}`,
          `PAYMENT PROCESSING REQUEST: ${data.salespersonname}`,
          `Dear Accounts Department,\n\nPlease release the payment for the following approved claim:\n\nEmployee: ${data.salespersonname}\nBranch: ${data.branchname}\nAmount: ₹${data.grandtotal}\nSubmission ID: ${claimId}\n\nApproved By: ${adminName}\nTimestamp: ${timestamp}`,
          adminName,
          adminEmail
        );
      }
      else if (action === "RELEASE") {
        await sendMail(
          data.employeeemail,
          `${process.env.ADMIN_EMAILS || ""},${data.branchheademail || ""}`,
          `PAYMENT RELEASED: ${claimId}`,
          `Dear Employee,\n\nWe are pleased to inform you that your expense claim payment of ₹${data.grandtotal} has been released.\n\nTransaction processed by: ${adminName}\nDate: ${timestamp}`,
          adminName,
          adminEmail
        );
      }
    } catch (mailErr) {
      console.error("Safe notification skip on admin action:", mailErr);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Admin Action Failed:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- Vite Infrastructure ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
