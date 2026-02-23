import express from "express";
import { google } from "googleapis";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";

const app = express();

// Multer setup for temporary file storage in serverless environment
// Use /tmp directory which is writable in Vercel
const upload = multer({ dest: os.tmpdir() });

app.use(express.json());

const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

async function getAuthenticatedClient() {
  if (!SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("Google Service Account credentials not configured.");
  }

  const auth = new google.auth.JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    key: SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });
  return auth;
}

app.post("/api/repair/save", upload.single("file"), async (req, res) => {
  try {
    const auth = await getAuthenticatedClient();
    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });
    
    const data = JSON.parse(req.body.data);
    const file = (req as any).file;

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

    let fileUrl = "";
    let uploadError = "";

    if (file) {
      try {
        // 1. Find or create substation folder
        const substation = (data.substation || "Unknown").replace(/'/g, "\\'");
        let folderId = "";
        
        const folderSearch = await drive.files.list({
          q: `name = '${substation}' and mimeType = 'application/vnd.google-apps.folder' and '${rootFolderId}' in parents and trashed = false`,
          fields: "files(id)",
        });

        if (folderSearch.data.files && folderSearch.data.files.length > 0) {
          folderId = folderSearch.data.files[0].id!;
        } else {
          const folderMetadata = {
            name: data.substation || "Unknown",
            mimeType: "application/vnd.google-apps.folder",
            parents: [rootFolderId!],
          };
          const newFolder = await drive.files.create({
            requestBody: folderMetadata,
            fields: "id",
          });
          folderId = newFolder.data.id!;
        }

        // 2. Upload file to folder
        const fileName = data.docNumber 
          ? `${data.docNumber}_${file.originalname}`
          : file.originalname;

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

    // 3. Append to Google Sheet (Always try to save text data)
    const values = [[
      new Date().toLocaleString('th-TH'),
      data.substation,
      data.docNumber,
      data.equipmentId,
      data.details,
      data.responsible,
      data.status,
      data.signedDate,
      fileUrl || "ไม่มีไฟล์ (Quota Error)"
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A:I",
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
