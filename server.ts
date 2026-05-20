import express from "express";
import path from "path";
import { google } from "googleapis";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import stream from "stream";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

dotenv.config();

// --- Firebase Admin Initialization ---
let firebaseDatabaseId: string | undefined = undefined;

try {
  let firebaseProjectId = process.env.FIREBASE_PROJECT_ID;

  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      // Default to applet config project ID if env project ID is missing or set to the old tutorial/example project
      if (!firebaseProjectId || firebaseProjectId === "expenses-e82d5") {
        firebaseProjectId = config.projectId;
      }
      firebaseDatabaseId = config.firestoreDatabaseId;
    }
  } catch (err) {
    console.error("Failed to read firebase-applet-config.json for Server:", err);
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
const db = new Proxy({} as admin.firestore.Firestore, {
  get(target, prop) {
    const instance = firebaseDatabaseId ? getFirestore(firebaseDatabaseId) : getFirestore();
    const val = Reflect.get(instance, prop);
    return typeof val === "function" ? val.bind(instance) : val;
  }
});
const app = express();
const PORT = 3000;

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
  "Timestamp", "Submission ID", "Branch", "Name", "Category", 
  "Date", "From", "To", "Amount", "Attachment", "Remark", 
  "Grand Total", "Admin Remark", "Mail Sent", "Approved", 
  "Approved Details", "Payment Process", "Processed By", 
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

// 1. Submit Claim
app.post("/api/claim", async (req, res) => {
  try {
    const { 
      branchName, salespersonName, salespersonEmail, 
      items, grandTotal, branchHeadEmail
    } = req.body;

    const sheets = await getSheetsClient();
    const submissionId = `EXP-${Date.now()}`;
    const timestamp = new Date().toLocaleString();

    // Process File Uploads
    const processedItems = await Promise.all(items.map(async (item: any, idx: number) => {
      let attachmentUrl = item.attachment;
      if (item.fileData && item.fileName) {
        attachmentUrl = await uploadToDrive(
          `${submissionId}_item${idx+1}_${item.fileName}`,
          item.fileData,
          item.fileType
        ) || "Upload Failed";
      }
      return { ...item, attachment: attachmentUrl };
    }));

    const rows = processedItems.map((item: any) => [
      timestamp, 
      submissionId, 
      branchName, 
      salespersonName, 
      item.category, 
      item.itemDate, 
      item.fromLoc, 
      item.toLoc, 
      item.amount, 
      item.attachment, 
      item.remark, 
      grandTotal,
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

    // Added to branch-specific Google Sheet
    const sheetTitle = branchName || "Sheet1";
    await ensureSheetExists(sheets, SHEET_ID, sheetTitle);
    await saveEmailMapping(sheets, SHEET_ID, submissionId, salespersonEmail);
    
    // --- FIRESTORE SYNC ---
    try {
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
    } catch (fsError) {
      console.error("Firestore Save Error:", fsError);
    }
    
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
              // Columns to merge (0-indexed): 
              // 0-3 (Bio), 11 (Grand Total), 12-20 (Admin)
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
        console.error("Merging Error:", mergeError);
        // Don't fail the whole request if merging fails
      }
    }

    // Notify Admins & Branch Head
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

    res.json({ success: true, submissionId });
  } catch (error: any) {
    console.error("Submit Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Get Claims for Admin
app.get("/api/claims", async (req, res) => {
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
        // Restore email from map
        obj.employeeemail = emailMap[obj.submissionid] || "";
        return obj;
      });
      allClaims = [...allClaims, ...data];
    }

    res.json(allClaims);
  } catch (error: any) {
    console.error("Admin Fetch Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Admin Actions (Remark, Approve, Process, Release)
app.post("/api/admin/action", async (req, res) => {
  const { action, rowIndex, claimId, data, adminName: reqAdminName, adminEmail: reqAdminEmail, sheetName } = req.body;
  const targetSheet = sheetName || "Sheet1";
  const adminName = reqAdminName || "Admin"; 
  const adminEmail = reqAdminEmail || process.env.SMTP_USER || "";

  try {
    const sheets = await getSheetsClient();
    const timestamp = new Date().toLocaleString();

    if (action === "REMARK") {
      // Column M (Admin Remark), N (Mail Sent)
      const range = `${targetSheet}!M${rowIndex}:N${rowIndex}`;
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[data.remark, "Yes"]] },
      });

      // --- Firestore Update ---
      try {
        await db.collection('claims').doc(claimId).update({
          adminRemark: data.remark,
          status: 'REMARKED',
          mailSent: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (fsErr) { console.error("Firestore Admin Update Error:", fsErr); }

      // Send Email to Employee, CC Branch Head and Admin
      await sendMail(
        data.employeeemail, 
        `${process.env.ADMIN_EMAILS},${data.branchheademail || ""}`, 
        `Action Required: Expense Claim Update (${data.submissionid})`, 
        `Dear Employee,\n\nAdmin has left a remark regarding your claim:\n\n"${data.remark}"\n\nPlease check and respond.`,
        adminName,
        adminEmail
      );
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

      // --- Firestore Update ---
      try {
        await db.collection('claims').doc(claimId).update({
          status: 'APPROVED',
          approvedAt: admin.firestore.FieldValue.serverTimestamp(),
          approvedBy: `${adminName} (${adminEmail})`,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (fsErr) { console.error("Firestore Admin Update Error:", fsErr); }

      // Mail to Employee about approval
      await sendMail(
        data.employeeemail,
        `${process.env.ADMIN_EMAILS},${data.branchheademail || ""}`,
        `Claim Approved: ${data.submissionid}`,
        `Your expense claim for ₹${data.grandtotal} has been APPROVED by Admin and sent for payment processing.`,
        adminName,
        adminEmail
      );
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

      // --- Firestore Update ---
      try {
        await db.collection('claims').doc(claimId).update({
          status: 'PROCESSED',
          processedBy: `${adminName} (${adminEmail})`,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (fsErr) { console.error("Firestore Admin Update Error:", fsErr); }

      // Mail to Accounts Dept (TO: Accounts, CC: Employee, Branch Head, Admin)
      await sendMail(
        process.env.ACCOUNTS_EMAIL || "",
        `${data.employeeemail},${data.branchheademail || ""},${process.env.ADMIN_EMAILS}`,
        `PAYMENT PROCESSING REQUEST: ${data.salespersonname}`,
        `Dear Accounts Department,\n\nPlease release the payment for the following approved claim:\n\nEmployee: ${data.salespersonname}\nBranch: ${data.branchname}\nAmount: ₹${data.grandtotal}\nSubmission ID: ${data.submissionid}\n\nApproved By: ${adminName}\nTimestamp: ${timestamp}`,
        adminName,
        adminEmail
      );
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

      // --- Firestore Update ---
      try {
        await db.collection('claims').doc(claimId).update({
          status: 'RELEASED',
          releasedBy: `${adminName} (${adminEmail})`,
          releasedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (fsErr) { console.error("Firestore Admin Update Error:", fsErr); }

      // Final Mail to Employee (TO: Employee, CC: Admin, Branch Head)
      await sendMail(
        data.employeeemail,
        `${process.env.ADMIN_EMAILS},${data.branchheademail || ""}`,
        `PAYMENT RELEASED: ${data.submissionid}`,
        `Dear Employee,\n\nWe are pleased to inform you that your expense claim payment of ₹${data.grandtotal} has been released.\n\nTransaction processed by: ${adminName}\nDate: ${timestamp}`,
        adminName,
        adminEmail
      );
    }

    res.json({ success: true });
  } catch (error: any) {
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
