import express from "express";
import { google } from "googleapis";
import multer from "multer";
import fs from "fs";
import os from "os";

import { GoogleGenAI, Type } from "@google/genai";

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
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
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
  try {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured on the server.");
    }

    const file = (req as any).file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const fileBuffer = fs.readFileSync(file.path);
    const base64Data = fileBuffer.toString("base64");

    // Retry logic for 503 errors (High Demand)
    let attempt = 0;
    const maxAttempts = 3; // Increase to 3 attempts
    let lastError: any = null;

    while (attempt <= maxAttempts) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-flash-latest", // Use latest flash for better availability
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: file.mimetype,
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

        // Cleanup temp file
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

        const extracted = JSON.parse(response.text || '{}');
        
        // Final pass to ensure all Thai numerals are converted
        Object.keys(extracted).forEach(key => {
          if (typeof extracted[key] === 'string') {
            extracted[key] = toArabicNumerals(extracted[key]);
          }
        });

        return res.json(extracted);
      } catch (error: any) {
        lastError = error;
        // If it's a 503 error or 429 (Rate Limit), wait and retry
        const isRetryable = error.message?.includes("503") || error.status === 503 || error.status === 429;
        
        if (isRetryable) {
          attempt++;
          if (attempt <= maxAttempts) {
            const delay = 3000 * attempt; // 3s, 6s, 9s
            console.log(`AI busy or rate limited, retrying in ${delay}ms (attempt ${attempt})...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        break;
      }
    }

    // If we reach here, it means all attempts failed
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    
    // Custom friendly error message for 503
    if (lastError?.status === 503 || lastError?.message?.includes("503")) {
      return res.status(503).json({ 
        error: "ขณะนี้ระบบ AI ของ Google มีผู้ใช้งานจำนวนมาก กรุณารอสัก 10-20 วินาทีแล้วลองใหม่อีกครั้งครับ" 
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
    res.status(500).json({ error: error.message });
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

router.get(["/api/auth/status", "/auth/status"], (req, res) => {
  res.json({ isAuthenticated: !!GOOGLE_REFRESH_TOKEN });
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
      range: `${sheetName}!A:L`,
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
      completionDate: (row[7] || "").trim(),
      responsible: row[8] || "",
      status: row[9] || "",
      signedDate: row[10] || "",
      fileUrl: row[11] || "",
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

        const cleanSubstation = substationName.replace(/[\\\/:*?"<>|]/g, "");
        const cleanDocNumber = (data.docNumber || "").replace(/[\\\/:*?"<>|]/g, "").replace(/\//g, "-");
        const cleanSignedDate = (data.signedDate || "").replace(/\//g, "");
        
        const finalFileName = `${runNumber}_${cleanSubstation}_${cleanDocNumber}_${cleanSignedDate}.pdf`;

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
          "", // completionDate (Column H)
          data.responsible,
          data.status,
          data.signedDate,
          fileUrl
        ]];

        // 3. Append to Sheets
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${sheetName}!A:L`,
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
        "", // completionDate (Column H)
        data.responsible,
        data.status,
        data.signedDate,
        ""
      ]];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:L`,
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
