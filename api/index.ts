import express from "express";
import { google } from "googleapis";
import multer from "multer";
import fs from "fs";
import os from "os";
import cookieParser from "cookie-parser";
import session from "express-session";

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: "repair-tracker-secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: true,
      sameSite: "none",
      httpOnly: true,
    },
  })
);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const getOAuth2Client = (req?: express.Request) => {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.error("APP_URL environment variable is missing!");
  }
  const redirectUri = `${appUrl}/auth/callback`;
  console.log("OAuth Redirect URI:", redirectUri);
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    redirectUri
  );
};

// Auth Routes
app.get("/api/auth/url", (req, res) => {
  const client = getOAuth2Client(req);
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
    prompt: "consent",
    // Explicitly pass redirect_uri if needed, though constructor should handle it
    redirect_uri: `${process.env.APP_URL}/auth/callback`
  });
  res.json({ url });
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  const client = getOAuth2Client(req);
  try {
    const { tokens } = await client.getToken(code as string);
    (req as any).session.tokens = tokens;
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error exchanging code for tokens", error);
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/auth/status", (req, res) => {
  res.json({ isAuthenticated: !!(req as any).session?.tokens });
});

app.post("/api/auth/logout", (req, res) => {
  (req as any).session.destroy(() => {
    res.json({ success: true });
  });
});

// Multer setup
const upload = multer({ dest: os.tmpdir() });

async function getAuthenticatedClient(req: express.Request) {
  const tokens = (req as any).session.tokens;
  if (!tokens) throw new Error("Not authenticated");
  const client = getOAuth2Client(req);
  client.setCredentials(tokens);
  return client;
}

app.post("/api/repair/save", upload.single("file"), async (req, res) => {
  try {
    const auth = await getAuthenticatedClient(req);
    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });
    
    const data = JSON.parse(req.body.data);
    const file = (req as any).file;

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

    // Get the spreadsheet to find the correct sheet name
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetName = spreadsheet.data.sheets?.[0]?.properties?.title || "Sheet1";

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
      
      fs.unlinkSync(file.path);
    }

    const values = [[
      new Date().toLocaleString('th-TH'),
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
      range: `${sheetName}!A:I`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error saving repair data", error);
    res.status(500).json({ error: error.message });
  }
});

export default app;
