import express from "express";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();
const PORT = 3000;

// Multer setup for temporary file storage
const upload = multer({ dest: "uploads/" });

app.use(express.json());

// Google Service Account Logic
// The user needs to provide GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

async function getAuthenticatedClient() {
  if (!SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("Google Service Account credentials not configured in environment variables.");
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
    if (file) {
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
      // Include docNumber in filename for easier identification
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
      
      // Cleanup temp file
      fs.unlinkSync(file.path);
    }

    // 3. Append to Google Sheet
    const values = [[
      Date.now().toString(),
      data.substation,
      data.docNumber,
      data.equipmentId,
      data.details,
      data.responsible,
      data.status,
      data.signedDate,
      fileUrl
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A:I",
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error saving repair data", error);
    res.status(500).json({ error: error.message });
  }
});

// Serve Vite
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
