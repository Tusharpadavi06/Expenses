import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import stream from "stream";

dotenv.config();

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

const sendMail = async (to: string, cc: string, subject: string, text: string) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("SMTP credentials missing. Email skipped.");
    return;
  }
  try {
    await transporter.sendMail({
      from: `"${process.env.SMTP_USER_NAME || 'Expense System'}" <${process.env.SMTP_USER}>`,
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
      "", // Released By
      salespersonEmail
    ]);

    // Added to Google Sheet
    const resolvedRange = await getSheetRange(sheets, SHEET_ID, "Sheet1!A:V");
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: resolvedRange,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });

    // Notify Admins & Branch Head
    const adminEmails = process.env.ADMIN_EMAILS || "";
    const recipients = branchHeadEmail ? `${adminEmails},${branchHeadEmail}` : adminEmails;
    
    await sendMail(
      recipients,
      "",
      `New Multi-Entry Claim: ${salespersonName}`,
      `A new claim has been submitted by ${salespersonName} (${branchName}).\nTotal Amount: ₹${grandTotal}\nTotal Items: ${items.length}\n\nCheck the sheet: https://docs.google.com/spreadsheets/d/${SHEET_ID}`
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
    const resolvedRange = await getSheetRange(sheets, SHEET_ID, RANGE);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: resolvedRange,
    });
    const rows = response.data.values || [];
    if (rows.length === 0) {
      return res.json([]);
    }
    const headers = rows[0];
    const data = rows.slice(1).map((row, index) => {
      const obj: any = { rowIndex: index + 2 }; 
      headers.forEach((header: string, i: number) => {
        const key = header.toLowerCase().replace(/ /g, "");
        obj[key] = row[i] || "";
      });
      return obj;
    });
    res.json(data);
  } catch (error: any) {
    console.error("Admin Fetch Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Admin Actions (Remark, Approve, Process, Release)
app.post("/api/admin/action", async (req, res) => {
  const { action, rowIndex, claimId, data } = req.body;
  const adminName = "Admin"; // In real app, get from auth

  try {
    const sheets = await getSheetsClient();
    const timestamp = new Date().toLocaleString();

    if (action === "REMARK") {
      // Column M (Admin Remark), N (Mail Sent)
      const resolvedRange = await getSheetRange(sheets, SHEET_ID, `Sheet1!M${rowIndex}:N${rowIndex}`);
      const rangeParts = resolvedRange.split('!');
      const finalRange = rangeParts.length > 1 ? `${rangeParts[0]}!M${rowIndex}:N${rowIndex}` : `M${rowIndex}:N${rowIndex}`;
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: finalRange,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[data.remark, "Yes"]] },
      });
      // Send Email to Employee, CC Branch Head and Admin
      await sendMail(
        data.employeeemail, 
        `${process.env.ADMIN_EMAILS},${data.branchheademail || ""}`, 
        `Action Required: Expense Claim Update (${data.submissionid})`, 
        `Dear Employee,\n\nAdmin has left a remark regarding your claim:\n\n"${data.remark}"\n\nPlease check and respond.`
      );
    } 
    else if (action === "APPROVE") {
      // Column O (Approved), P (Approved Detail)
      const resolvedRange = await getSheetRange(sheets, SHEET_ID, `Sheet1!O${rowIndex}:P${rowIndex}`);
      const rangeParts = resolvedRange.split('!');
      const finalRange = rangeParts.length > 1 ? `${rangeParts[0]}!O${rowIndex}:P${rowIndex}` : `O${rowIndex}:P${rowIndex}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: finalRange,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Yes", `${adminName} - ${timestamp}`]] },
      });
      // Mail to Employee about approval
      await sendMail(
        data.employeeemail,
        `${process.env.ADMIN_EMAILS},${data.branchheademail || ""}`,
        `Claim Approved: ${data.submissionid}`,
        `Your expense claim for ₹${data.grandtotal} has been APPROVED by Admin and sent for payment processing.`
      );
    }
    else if (action === "PROCESS") {
      // Column Q (Payment Process), R (Processed By), S (Status Log)
      const resolvedRange = await getSheetRange(sheets, SHEET_ID, `Sheet1!Q${rowIndex}:S${rowIndex}`);
      const rangeParts = resolvedRange.split('!');
      const finalRange = rangeParts.length > 1 ? `${rangeParts[0]}!Q${rowIndex}:S${rowIndex}` : `Q${rowIndex}:S${rowIndex}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: finalRange,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Yes", `${adminName} - ${timestamp}`, `Mail sent to Accounts at ${timestamp}`]] },
      });
      // Mail to Accounts Dept (TO: Accounts, CC: Employee, Branch Head, Admin)
      await sendMail(
        process.env.ACCOUNTS_EMAIL || "",
        `${data.employeeemail},${data.branchheademail || ""},${process.env.ADMIN_EMAILS}`,
        `PAYMENT PROCESSING REQUEST: ${data.salespersonname}`,
        `Dear Accounts Department,\n\nPlease release the payment for the following approved claim:\n\nEmployee: ${data.salespersonname}\nBranch: ${data.branchname}\nAmount: ₹${data.grandtotal}\nSubmission ID: ${data.submissionid}\n\nApproved By: ${adminName}\nTimestamp: ${timestamp}`
      );
    }
    else if (action === "RELEASE") {
      // Column T (Payment Release), U (Released By)
      const resolvedRange = await getSheetRange(sheets, SHEET_ID, `Sheet1!T${rowIndex}:U${rowIndex}`);
      const rangeParts = resolvedRange.split('!');
      const finalRange = rangeParts.length > 1 ? `${rangeParts[0]}!T${rowIndex}:U${rowIndex}` : `T${rowIndex}:U${rowIndex}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: finalRange,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Yes", `${adminName} - ${timestamp}`]] },
      });
      // Final Mail to Employee (TO: Employee, CC: Admin, Branch Head)
      await sendMail(
        data.employeeemail,
        `${process.env.ADMIN_EMAILS},${data.branchheademail || ""}`,
        `PAYMENT RELEASED: ${data.submissionid}`,
        `Dear Employee,\n\nWe are pleased to inform you that your expense claim payment of ₹${data.grandtotal} has been released.\n\nTransaction processed by: ${adminName}\nDate: ${timestamp}`
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

startServer();
