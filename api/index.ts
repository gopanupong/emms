import express from "express";
import { google } from "googleapis";
import multer from "multer";
import fs from "fs";
import os from "os";

const app = express();

app.use(express.json());

// Method 2: OAuth2 with Refresh Token (Acts as the owner of the token)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const APP_URL = process.env.APP_URL?.replace(/\/$/, "");

const getOAuth2Client = () => {
  const redirectUri = `${APP_URL}/api/auth/callback`;
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
};

// Method 1: Service Account (Fallback or for Sheets only if needed)
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

async function getAuthenticatedClient() {
  // Priority: OAuth2 Refresh Token (Method 2)
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    return oauth2Client;
  }

  // Fallback: Service Account (Method 1)
  if (SERVICE_ACCOUNT_EMAIL && SERVICE_ACCOUNT_PRIVATE_KEY) {
    return new google.auth.JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: SERVICE_ACCOUNT_PRIVATE_KEY,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
      ],
    });
  }

  throw new Error("Google credentials not configured. Please set GOOGLE_REFRESH_TOKEN or Service Account keys.");
}

// Auth Routes
app.get(["/api/auth/init", "/auth/init"], (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !APP_URL) {
    return res.status(400).send("Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or APP_URL in environment variables.");
  }
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"],
    prompt: "consent",
  });
  res.redirect(url);
});

app.get(["/api/auth/callback", "/auth/callback"], async (req, res) => {
  const { code } = req.query;
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code as string);
    res.send(`
      <div style="font-family: sans-serif; padding: 40px; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">✅ คัดลอก Refresh Token ของคุณ</h2>
        <p>นำค่าด้านล่างนี้ไปใส่ใน Vercel Environment Variables ชื่อ <b>GOOGLE_REFRESH_TOKEN</b></p>
        <textarea style="width: 100%; height: 120px; padding: 15px; border: 2px solid #E5E7EB; border-radius: 12px; font-family: monospace; font-size: 14px; background: #F9FAFB;" readonly>${tokens.refresh_token}</textarea>
        <div style="margin-top: 20px; padding: 15px; background: #FEF2F2; border-radius: 8px; border: 1px solid #FEE2E2;">
          <p style="color: #EF4444; font-size: 14px; margin: 0;"><b>ขั้นตอนสุดท้าย:</b> เมื่อใส่ค่าใน Vercel แล้ว อย่าลืมกด <b>Redeploy</b> เพื่อให้ระบบเริ่มทำงานนะครับ</p>
        </div>
      </div>
    `);
  } catch (error: any) {
    res.status(500).send("Error getting token: " + error.message);
  }
});

app.get(["/api/auth/status", "/auth/status"], (req, res) => {
  res.json({ isAuthenticated: !!GOOGLE_REFRESH_TOKEN });
});

// --- Main Logic ---
const upload = multer({ dest: os.tmpdir() });

app.post("/api/repair/save", upload.single("file"), async (req, res) => {
  try {
    const auth = await getAuthenticatedClient();
    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });
    
    const data = JSON.parse(req.body.data);
    const file = (req as any).file;

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetName = spreadsheet.data.sheets?.[0]?.properties?.title || "Sheet1";

    let fileUrl = "";
    let uploadError = "";

    if (file) {
      try {
        let substationName = (data.substation || "Unknown").trim();
        // Normalize: Remove "สถานีไฟฟ้า" prefix to group folders with similar names together
        substationName = substationName.replace(/^สถานีไฟฟ้า/, "").trim();
        
        const escapedSubstation = substationName.replace(/'/g, "\\'");
        let folderId = "";
        
        const folderSearch = await drive.files.list({
          q: `name = '${escapedSubstation}' and mimeType = 'application/vnd.google-apps.folder' and '${rootFolderId}' in parents and trashed = false`,
          fields: "files(id)",
        });

        if (folderSearch.data.files && folderSearch.data.files.length > 0) {
          folderId = folderSearch.data.files[0].id!;
        } else {
          const folderMetadata = {
            name: substationName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [rootFolderId!],
          };
          const newFolder = await drive.files.create({
            requestBody: folderMetadata,
            fields: "id",
          });
          folderId = newFolder.data.id!;
        }

        // Fix Thai filename encoding issue from multer
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        
        // Construct a clean filename: [DocNumber]_[Substation].pdf
        const cleanSubstation = substationName.replace(/[\\\/:*?"<>|]/g, "");
        const cleanDocNumber = (data.docNumber || "").replace(/[\\\/:*?"<>|]/g, "").replace(/\//g, "-");
        
        const fileName = cleanDocNumber 
          ? `${cleanDocNumber}_${cleanSubstation}.pdf`
          : originalName;

        const fileMetadata = {
          name: fileName,
          parents: [folderId],
        };
        const media = {
          mimeType: file.mimetype,
          body: fs.createReadStream(file.path),
        };
        const uploadedFile = await drive.files.create({
          requestBody: fileMetadata,
          media: media,
          fields: "id, webViewLink",
        });
        fileUrl = uploadedFile.data.webViewLink!;
      } catch (err: any) {
        console.error("Drive upload failed:", err);
        uploadError = ` (ไฟล์อัปโหลดไม่สำเร็จ: ${err.message})`;
      } finally {
        if (file && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    const values = [[
      new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
      data.substation,
      data.docNumber,
      data.equipmentId,
      data.details,
      data.detailsAI,
      data.responsible,
      data.status,
      data.signedDate,
      fileUrl || (uploadError ? "อัปโหลดล้มเหลว" : "")
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:J`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    if (uploadError) {
      res.json({ success: true, warning: `บันทึกข้อมูลลงตารางแล้ว แต่${uploadError}` });
    } else {
      res.json({ success: true });
    }
  } catch (error: any) {
    console.error("Error saving repair data", error);
    res.status(500).json({ error: error.message });
  }
});

export default app;
