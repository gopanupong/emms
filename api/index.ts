import express from "express";
import { google } from "googleapis";
import multer from "multer";
import fs from "fs";
import os from "os";

import { GoogleGenAI, Type } from "@google/genai";
import { getStoredRefreshToken, setStoredRefreshToken } from "./token-store";

const router = express.Router();

// Gemini AI Setup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Method 2: OAuth2 with Refresh Token
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const APP_URL = process.env.APP_URL?.replace(/\/$/, "");

const getOAuth2Client = () => {
  const redirectUri = `${APP_URL}/api/auth/callback`;
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
};

// Method 1: Service Account
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

async function getAuthenticatedClient() {
  const currentRefreshToken = getStoredRefreshToken() || GOOGLE_REFRESH_TOKEN;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && currentRefreshToken) {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: currentRefreshToken });

    // Automatically persist rotated tokens
    oauth2Client.on("tokens", (tokens) => {
      if (tokens.refresh_token) {
        console.log("Auto-saving rotated refresh token...");
        setStoredRefreshToken(tokens.refresh_token);
      }
    });

    return oauth2Client;
  }

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

// --- Multer Setup ---
const upload = multer({ dest: os.tmpdir() });

// --- Utilities ---
function toArabicNumerals(str: string): string {
  const thaiNumerals = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];
  const arabicNumerals = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  let result = str;
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(thaiNumerals[i], "g"), arabicNumerals[i]);
  }
  return result;
}

// AI Extraction Route
router.post("/api/ai/extract", upload.single("file"), async (req, res) => {
  console.log("AI Extraction requested");
  const file = (req as any).file;
  try {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured on the server.");
    }

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    let mimeType = file.mimetype;
    if (!mimeType || mimeType === "application/octet-stream") {
      const ext = file.originalname?.split(".").pop()?.toLowerCase();
      if (ext === "pdf") mimeType = "application/pdf";
      else if (ext === "png") mimeType = "image/png";
      else if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
      else if (ext === "webp") mimeType = "image/webp";
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const fileBuffer = fs.readFileSync(file.path);
    const base64Data = fileBuffer.toString("base64");

    // Candidate models in order of availability and speed
    const CANDIDATE_MODELS = [
      "gemini-3.1-flash-lite", // Fast, dedicated queue, lowest 503 chance
      "gemini-3.6-flash",      // Next-gen high intelligence
      "gemini-flash-latest"    // Standard flash alias
    ];

    let extractedData: any = null;
    let lastError: any = null;
    const maxRounds = 2;

    for (let round = 1; round <= maxRounds; round++) {
      for (const modelName of CANDIDATE_MODELS) {
        try {
          console.log(`Extracting with model: ${modelName} (round ${round})...`);
          const response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType: mimeType,
                      data: base64Data,
                    },
                  },
                  {
                    text: `Extract repair information from this document in Thai. 
IMPORTANT: Convert all Thai numerals (๐-๙) to Arabic numerals (0-9) in all extracted fields.
Return a JSON object with these fields:
- substation: ดึงข้อมูลจากหัวข้อ "เรื่อง" โดยเอาข้อความที่อยู่หลังคำว่า "สถานีไฟฟ้า" (เช่น ถ้าเรื่องคือ "แจ้งอุปกรณ์ชำรุด สถานีไฟฟ้าสมุทรสาคร 10" ให้เอาแค่ "สมุทรสาคร 10")
- docNumber: เลขที่ ก3 กปบ. (เช่น 123/2567)
- equipmentId: รหัสอุปกรณ์ที่ชำรุด (หากมีหลายบรรทัดหรือหลายรายการ ให้รวมเข้าด้วยกันและคั่นด้วยเครื่องหมายจุลภาค ",")
- details: รายละเอียดการชำรุด (ดึงข้อความต้นฉบับมาจาก PDF โดยตรง ไม่ต้องแก้ไขคำ แต่ให้แปลงเลขไทยเป็นเลขอารบิก)
- detailsAI: รายละเอียดการชำรุด (นำข้อมูลจาก details มาเรียบเรียงใหม่เป็นภาษาราชการที่สุภาพและเป็นทางการ โดยหากมีคำศัพท์เทคนิคหรือชื่ออุปกรณ์ภาษาอังกฤษ ให้ใช้คำภาษาอังกฤษทับศัพท์ไปเลย ไม่ต้องแปลเป็นภาษาไทย เพื่อป้องกันความหมายคลาดเคลื่อน และใช้เลขอารบิกเท่านั้น)
- responsible: หน่วยงานที่รับผิดชอบ
- signedDate: วันที่ผู้บริหารเซ็น โดยให้หาจากบริเวณใกล้ๆ กับคำว่า "อก.ปบ.(ก3)" (ระบุเป็น วว/ดด/ปปปป ในรูปแบบเลขอารบิก)

If a field is not found, leave it as an empty string.`,
                  },
                ],
              },
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  substation: { type: Type.STRING },
                  docNumber: { type: Type.STRING },
                  equipmentId: { type: Type.STRING },
                  details: { type: Type.STRING },
                  detailsAI: { type: Type.STRING },
                  responsible: { type: Type.STRING },
                  signedDate: { type: Type.STRING },
                },
                required: ["substation", "docNumber", "equipmentId", "details", "detailsAI", "responsible", "signedDate"],
              },
            },
          });

          let rawText = response.text || "{}";
          rawText = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
          const parsed = JSON.parse(rawText);

          Object.keys(parsed).forEach((key) => {
            if (typeof parsed[key] === "string") {
              parsed[key] = toArabicNumerals(parsed[key]);
            }
          });

          extractedData = parsed;
          console.log(`AI Extraction succeeded using ${modelName}`);
          break;
        } catch (err: any) {
          lastError = err;
          console.warn(`Model ${modelName} failed (${err.status || err.message}). Failing over to next model...`);
        }
      }

      if (extractedData) break;
      if (round < maxRounds) {
        console.log("Waiting 2s before round 2...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (extractedData) {
      return res.json(extractedData);
    }

    if (lastError?.status === 503 || lastError?.message?.includes("503")) {
      return res.status(503).json({ 
        error: "ขณะนี้ระบบ AI ของ Google กำลังมีผู้ใช้งานหนาแน่น กรุณารอสักครู่แล้วกดปุ่ม 'ลองให้ AI อ่านเอกสารอีกครั้ง' ได้เลยครับ" 
      });
    }

    if (lastError?.message?.includes("invalid_grant")) {
      return res.status(401).json({
        error: "สิทธิ์การเข้าถึง Google หมดอายุ (invalid_grant) กรุณาทำการยืนยันตัวตนใหม่ที่ " + APP_URL + "/api/auth/init"
      });
    }
    
    throw lastError;
  } catch (error: any) {
    console.error("AI Extraction failed:", error);
    res.status(500).json({ error: error.message || "เกิดข้อผิดพลาดในการประมวลผลเอกสาร" });
  } finally {
    if (file && fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
      } catch (cleanupErr) {
        console.error("Failed to clean up temp file:", cleanupErr);
      }
    }
  }
});

// Auth Routes
router.get(["/api/auth/init", "/auth/init"], (req, res) => {
  console.log("Auth init requested");
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

router.get(["/api/auth/callback", "/auth/callback"], async (req, res) => {
  const { code } = req.query;
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code as string);
    if (tokens.refresh_token) {
      setStoredRefreshToken(tokens.refresh_token);
      console.log("Successfully stored refresh token from auth callback");
    }
    res.send(`
      <div style="font-family: sans-serif; padding: 40px; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">✅ ยืนยันตัวตนสำเร็จและบันทึก Refresh Token เรียบร้อยแล้ว!</h2>
        <p style="color: #374151;">ระบบได้บันทึก Token ล่าสุดให้โดยอัตโนมัติแล้ว ท่านสามารถกลับไปใช้งานระบบได้ทันทีโดยไม่ต้องตั้งค่าใหม่</p>
        
        <div style="margin: 25px 0;">
          <a href="/" style="display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
            กลับสู่หน้าหลักของระบบ
          </a>
        </div>

        <div style="margin-top: 30px; padding: 20px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px;">
          <p style="font-size: 13px; color: #6B7280; margin-top: 0;">(สำรอง) Refresh Token สำหรับบันทึกใน Vercel Environment Variables หากต้องการ:</p>
          <textarea style="width: 100%; height: 90px; padding: 10px; border: 1px solid #D1D5DB; border-radius: 8px; font-family: monospace; font-size: 13px; background: white;" readonly>${tokens.refresh_token || "ไม่มี refresh_token ใหม่ส่งกลับมา (ใช้ token เดิมที่บันทึกไว้)"}</textarea>
        </div>
      </div>
    `);
  } catch (error: any) {
    res.status(500).send("Error getting token: " + error.message);
  }
});

router.get(["/api/auth/status", "/auth/status"], (req, res) => {
  const currentRefreshToken = getStoredRefreshToken() || GOOGLE_REFRESH_TOKEN;
  res.json({ isAuthenticated: !!currentRefreshToken });
});

router.get("/api/repair/next-run-number", async (req, res) => {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not configured.");
    const auth = await getAuthenticatedClient();
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetName = spreadsheet.data.sheets?.[0]?.properties?.title || "Sheet1";
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!B:B`,
    });
    
    const values = response.data.values || [];
    const nextRunNumber = String(values.length).padStart(3, '0');
    res.json({ nextRunNumber });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/repair/list", async (req, res) => {
  console.log("Repair list requested");
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      throw new Error("GOOGLE_SHEET_ID is not configured.");
    }

    const auth = await getAuthenticatedClient();
    const sheets = google.sheets({ version: "v4", auth });

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetName = spreadsheet.data.sheets?.[0]?.properties?.title || "Sheet1";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:M`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return res.json([]);
    }

    // Skip header row and map to objects
    const data = rows.slice(1).map((row) => ({
      timestamp: row[0] || "",
      runNumber: row[1] || "",
      substation: row[2] || "",
      docNumber: row[3] || "",
      equipmentId: row[4] || "",
      details: row[5] || "",
      detailsAI: row[6] || "",
      responsible: row[7] || "", // Column H
      status: row[8] || "",      // Column I
      signedDate: row[9] || "",  // Column J
      fileUrl: row[10] || "",    // Column K
      completionDate: (row[12] || "").trim(), // Column M
    }));

    res.json(data);
  } catch (error: any) {
    console.error("Error fetching repair list:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- Main Logic ---
router.post("/api/repair/save", upload.single("file"), async (req, res) => {
  console.log("Save repair data requested");
  try {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

    if (!spreadsheetId) {
      throw new Error("GOOGLE_SHEET_ID is not configured in environment variables.");
    }

    const auth = await getAuthenticatedClient();
    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });
    
    const data = JSON.parse(req.body.data);
    // Convert all Thai numerals to Arabic numerals in the data
    Object.keys(data).forEach(key => {
      if (typeof data[key] === 'string') {
        data[key] = toArabicNumerals(data[key]);
      }
    });

    const file = (req as any).file;

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetName = spreadsheet.data.sheets?.[0]?.properties?.title || "Sheet1";

    // Get current row count to determine the next run number
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:A`,
    });
    const rowCount = sheetData.data.values ? sheetData.data.values.length : 0;
    const runNumber = String(rowCount).padStart(3, '0'); // e.g., 001, 002

    let fileUrl = "";
    let uploadError = "";

    if (file) {
      try {
        if (!rootFolderId) {
          throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured.");
        }

        let substationName = (data.substation || "Unknown").trim();
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

        const cleanSubstation = substationName.replace(/[\\\/:*?"<>|]/g, "").replace(/\s+/g, "");
        const cleanDocNumber = (data.docNumber || "").replace(/[\\\/:*?"<>|]/g, "").replace(/\//g, "-").replace(/\s+/g, "");
        const cleanEquipmentId = (data.equipmentId || "").replace(/[\\\/:*?"<>|]/g, "").replace(/\s+/g, "");
        
        const finalFileName = `${runNumber}_${cleanSubstation}_${cleanDocNumber}แจ้งอุปกรณ์ชำรุด${cleanEquipmentId}.pdf`;

        // 1. Upload with temporary name first (or original name)
        const fileMetadata = {
          name: `uploading_${Date.now()}.pdf`,
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
        
        const fileId = uploadedFile.data.id!;
        fileUrl = uploadedFile.data.webViewLink!;

        // 2. Prepare values for Sheets
        const values = [[
          new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
          runNumber,
          data.substation,
          data.docNumber,
          data.equipmentId,
          data.details,
          data.detailsAI,
          data.responsible, // Column H
          data.status,      // Column I
          data.signedDate,  // Column J
          fileUrl,          // Column K
          "",               // Column L
          ""                // Column M (completionDate)
        ]];

        // 3. Append to Sheets
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${sheetName}!A:M`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values },
        });

        // 4. Rename the file in Drive to the final name after successful save
        await drive.files.update({
          fileId: fileId,
          requestBody: {
            name: finalFileName
          }
        });

      } catch (err: any) {
        console.error("Drive/Sheets operation failed:", err);
        uploadError = ` (ดำเนินการไม่สำเร็จ: ${err.message})`;
      } finally {
        if (file && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    } else {
      // If no file, just append to sheets
      const values = [[
        new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
        runNumber,
        data.substation,
        data.docNumber,
        data.equipmentId,
        data.details,
        data.detailsAI,
        data.responsible, // Column H
        data.status,      // Column I
        data.signedDate,  // Column J
        "",               // Column K (fileUrl)
        "",               // Column L
        ""                // Column M (completionDate)
      ]];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:M`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
    }

    if (uploadError) {
      res.status(500).json({ error: uploadError });
    } else {
      res.json({ success: true });
    }
  } catch (error: any) {
    console.error("Error saving repair data:", error);
    let errorMessage = error.message;
    if (errorMessage.includes("invalid_grant")) {
      errorMessage = "สิทธิ์การเข้าถึง Google หมดอายุ (invalid_grant) กรุณาทำการยืนยันตัวตนใหม่ที่ " + APP_URL + "/api/auth/init";
    }
    res.status(500).json({ error: errorMessage });
  }
});

export default router;
