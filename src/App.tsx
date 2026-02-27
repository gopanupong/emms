import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Save, 
  Loader2, 
  LogOut, 
  ExternalLink,
  Plus,
  Trash2,
  ChevronRight,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface RepairData {
  substation: string;
  docNumber: string;
  equipmentId: string;
  details: string;
  detailsAI: string;
  responsible: string;
  status: 'อยู่ระหว่างดำเนินการ' | 'แก้ไขเสร็จแล้ว';
  signedDate: string;
}

const INITIAL_DATA: RepairData = {
  substation: '',
  docNumber: '',
  equipmentId: '',
  details: '',
  detailsAI: '',
  responsible: '',
  status: 'อยู่ระหว่างดำเนินการ',
  signedDate: '',
};

// --- Components ---

export default function App() {
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [repairData, setRepairData] = useState<RepairData>(INITIAL_DATA);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = async (file: File) => {
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    
    // Auto-extract with AI
    extractData(file);
  };

  const extractData = async (file: File) => {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      console.error('Gemini API Key is missing. Please set VITE_GEMINI_API_KEY in environment variables.');
      setMessage({ type: 'error', text: 'ไม่พบ API Key (VITE_GEMINI_API_KEY) กรุณาตรวจสอบการตั้งค่าใน Vercel' });
      return;
    }

    setIsExtracting(true);
    setMessage(null);
    try {
      const ai = new GoogleGenAI({ apiKey });
      
      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(file);
      });
      const base64Data = await base64Promise;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64Data,
                },
              },
              {
                text: `Extract repair information from this document in Thai. 
                Return a JSON object with these fields:
                - substation: ดึงข้อมูลจากหัวข้อ "เรื่อง" โดยเอาข้อความที่อยู่หลังคำว่า "สถานีไฟฟ้า" (เช่น ถ้าเรื่องคือ "แจ้งอุปกรณ์ชำรุด สถานีไฟฟ้าสมุทรสาคร 10" ให้เอาแค่ "สมุทรสาคร 10")
                - docNumber: เลขที่ ก3 กปบ. (เช่น 123/2567)
                - equipmentId: รหัสอุปกรณ์ที่ชำรุด (หากมีหลายบรรทัดหรือหลายรายการ ให้รวมเข้าด้วยกันและคั่นด้วยเครื่องหมายจุลภาค ",")
                - details: รายละเอียดการชำรุด (ดึงข้อความต้นฉบับมาจาก PDF โดยตรง ไม่ต้องแก้ไขคำ)
                - detailsAI: รายละเอียดการชำรุด (นำข้อมูลจาก details มาเรียบเรียงใหม่เป็นภาษาราชการที่สุภาพและเป็นทางการ ไม่ใช้ภาษาพูด)
                - responsible: หน่วยงานที่รับผิดชอบ
                - signedDate: วันที่ผู้บริหารเซ็น (ระบุเป็น วว/ดด/ปปปป)
                
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
              substation: { 
                type: Type.STRING,
                description: "ข้อความหลังคำว่า 'สถานีไฟฟ้า' ในหัวข้อเรื่อง"
              },
              docNumber: { type: Type.STRING },
              equipmentId: { 
                type: Type.STRING,
                description: "รหัสอุปกรณ์ คั่นด้วยเครื่องหมายจุลภาคหากมีหลายรายการ"
              },
              details: { 
                type: Type.STRING,
                description: "รายละเอียดการชำรุด (ข้อความต้นฉบับจาก PDF)"
              },
              detailsAI: { 
                type: Type.STRING,
                description: "รายละเอียดการชำรุด (เรียบเรียงเป็นภาษาราชการ)"
              },
              responsible: { type: Type.STRING },
              signedDate: { type: Type.STRING },
            },
            required: ["substation", "docNumber", "equipmentId", "details", "detailsAI", "responsible", "signedDate"],
          },
        },
      });

      const extracted = JSON.parse(response.text || '{}');
      setRepairData({
        ...INITIAL_DATA,
        ...extracted,
        status: 'อยู่ระหว่างดำเนินการ'
      });
    } catch (error) {
      console.error('AI Extraction failed', error);
      setMessage({ type: 'error', text: 'AI ไม่สามารถดึงข้อมูลได้ โปรดกรอกข้อมูลด้วยตนเอง' });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);

    const formData = new FormData();
    if (selectedFile) {
      formData.append('file', selectedFile);
    }
    formData.append('data', JSON.stringify(repairData));

    try {
      const res = await fetch('/api/repair/save', {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();
      if (result.success) {
        if (result.warning) {
          setMessage({ type: 'error', text: result.warning });
        } else {
          setMessage({ type: 'success', text: 'บันทึกข้อมูลเรียบร้อยแล้ว' });
          // Reset form after delay only on full success
          setTimeout(() => {
            setRepairData(INITIAL_DATA);
            setSelectedFile(null);
            setPreviewUrl(null);
            setMessage(null);
          }, 3000);
        }
      } else {
        throw new Error(result.error || 'Failed to save');
      }
    } catch (error: any) {
      console.error('Save failed', error);
      setMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${error.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-purple-50/50 text-[#1A1A1A] font-sans selection:bg-purple-100">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-purple-900 rounded-lg flex items-center justify-center">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">EMMS</h1>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            {/* Left Column: Upload & Preview */}
            <div className="lg:col-span-5 space-y-8">
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-purple-400">1. อัปโหลดเอกสาร</h2>
                  {selectedFile && (
                    <button 
                      onClick={() => {
                        setSelectedFile(null);
                        setPreviewUrl(null);
                        setRepairData(INITIAL_DATA);
                      }}
                      className="text-xs font-medium text-red-500 hover:text-red-600 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> ล้างข้อมูล
                    </button>
                  )}
                </div>
                
                <div 
                  onClick={() => !isExtracting && fileInputRef.current?.click()}
                  className={cn(
                    "relative border-2 border-dashed rounded-3xl p-12 transition-all cursor-pointer group",
                    selectedFile ? "border-purple-900 bg-white" : "border-purple-100 hover:border-purple-300 bg-purple-50/30",
                    isExtracting && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    className="hidden" 
                    accept="image/*,application/pdf"
                  />
                  
                  <div className="flex flex-col items-center text-center space-y-4">
                    {isExtracting ? (
                      <>
                        <Loader2 className="w-12 h-12 text-purple-900 animate-spin" />
                        <div className="space-y-1">
                          <p className="font-medium">AI กำลังอ่านข้อมูล...</p>
                          <p className="text-xs text-purple-400">โปรดรอสักครู่</p>
                        </div>
                      </>
                    ) : selectedFile ? (
                      <>
                        <div className="w-16 h-16 bg-purple-900 rounded-2xl flex items-center justify-center shadow-lg">
                          <FileText className="w-8 h-8 text-white" />
                        </div>
                        <div className="space-y-1">
                          <p className="font-medium truncate max-w-[200px]">{selectedFile.name}</p>
                          <p className="text-xs text-purple-400">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                          <Upload className="w-8 h-8 text-purple-300" />
                        </div>
                        <div className="space-y-1">
                          <p className="font-medium">คลิกเพื่ออัปโหลด</p>
                          <p className="text-xs text-purple-400">รองรับรูปภาพ และ PDF</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {previewUrl && selectedFile?.type.startsWith('image/') && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-3xl overflow-hidden border border-stone-200 shadow-sm bg-white p-2"
                  >
                    <img src={previewUrl} alt="Preview" className="w-full h-auto rounded-2xl" />
                  </motion.div>
                )}
              </section>
            </div>

            {/* Right Column: Form */}
            <div className="lg:col-span-7 space-y-8">
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-purple-400">2. ตรวจสอบและแก้ไขข้อมูล</h2>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter",
                      isExtracting ? "bg-amber-100 text-amber-700" : "bg-purple-100 text-purple-700"
                    )}>
                      {isExtracting ? "AI Processing" : "Ready"}
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-[32px] p-8 shadow-sm border border-purple-50 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">สถานีไฟฟ้า</label>
                      <input 
                        type="text"
                        value={repairData.substation}
                        onChange={(e) => setRepairData({ ...repairData, substation: e.target.value })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all"
                        placeholder="ระบุชื่อสถานี"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">เลขที่ ก3 กปบ.</label>
                      <input 
                        type="text"
                        value={repairData.docNumber}
                        onChange={(e) => setRepairData({ ...repairData, docNumber: e.target.value })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all"
                        placeholder="ระบุเลขที่เอกสาร"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">รหัสอุปกรณ์</label>
                      <input 
                        type="text"
                        value={repairData.equipmentId}
                        onChange={(e) => setRepairData({ ...repairData, equipmentId: e.target.value })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all"
                        placeholder="ระบุรหัสอุปกรณ์"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">ผู้รับผิดชอบ</label>
                      <input 
                        type="text"
                        value={repairData.responsible}
                        onChange={(e) => setRepairData({ ...repairData, responsible: e.target.value })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all"
                        placeholder="ระบุหน่วยงาน"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">รายละเอียดการชำรุด (ต้นฉบับ)</label>
                      <textarea 
                        rows={3}
                        value={repairData.details}
                        onChange={(e) => setRepairData({ ...repairData, details: e.target.value })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all resize-none"
                        placeholder="ระบุรายละเอียดอาการชำรุด"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">รายละเอียดการชำรุด (ภาษาราชการ)</label>
                      <textarea 
                        rows={3}
                        value={repairData.detailsAI}
                        onChange={(e) => setRepairData({ ...repairData, detailsAI: e.target.value })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all resize-none border-2 border-purple-200"
                        placeholder="AI ประมวลผลเป็นภาษาราชการ..."
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">วันที่ผู้บริหารเซ็น</label>
                      <input 
                        type="text"
                        value={repairData.signedDate}
                        onChange={(e) => setRepairData({ ...repairData, signedDate: e.target.value })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all"
                        placeholder="วว/ดด/ปปปป"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">สถานะ</label>
                      <select 
                        value={repairData.status}
                        onChange={(e) => setRepairData({ ...repairData, status: e.target.value as any })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all appearance-none"
                      >
                        <option value="อยู่ระหว่างดำเนินการ">อยู่ระหว่างดำเนินการ</option>
                        <option value="แก้ไขเสร็จแล้ว">แก้ไขเสร็จแล้ว</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-4">
                    <button 
                      onClick={handleSave}
                      disabled={isSaving || isExtracting || !selectedFile}
                      className={cn(
                        "w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-3",
                        isSaving || isExtracting || !selectedFile
                          ? "bg-purple-50 text-purple-200 cursor-not-allowed shadow-none"
                          : "bg-purple-900 text-white hover:bg-purple-800 active:scale-[0.98]"
                      )}
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          กำลังบันทึก...
                        </>
                      ) : (
                        <>
                          <Save className="w-5 h-5" />
                          บันทึกข้อมูล
                        </>
                      )}
                    </button>
                  </div>

                  <AnimatePresence>
                    {message && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className={cn(
                          "p-4 rounded-xl flex items-center gap-3 text-sm font-medium",
                          message.type === 'success' ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                        )}
                      >
                        {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                        {message.text}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="bg-purple-900/5 rounded-2xl p-6 border border-purple-200/50">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm shrink-0">
                      <ExternalLink className="w-5 h-5 text-purple-400" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold">แหล่งเก็บข้อมูล</p>
                      <p className="text-xs text-purple-500 leading-relaxed">
                        ข้อมูลจะถูกบันทึกลงใน Google Sheets และไฟล์จะถูกเก็บไว้ใน Google Drive โดยแยกตามโฟลเดอร์ชื่อสถานีไฟฟ้าอัตโนมัติ
                      </p>
                      <div className="pt-2 flex gap-3">
                        <a 
                          href={`https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-[10px] font-bold uppercase tracking-wider text-purple-900 hover:underline"
                        >
                          เปิด Google Sheets
                        </a>
                        <a 
                          href={`https://drive.google.com/drive/folders/${process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-[10px] font-bold uppercase tracking-wider text-purple-900 hover:underline"
                        >
                          เปิด Google Drive
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-purple-200/50">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-xs text-purple-400 font-medium tracking-wide">
            © 2024 EMMS SYSTEM. POWERED BY GEMINI.
          </p>
          <div className="flex gap-8">
            <span className="text-[10px] font-bold uppercase tracking-widest text-purple-300">Privacy</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-purple-300">Terms</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-purple-300">Support</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
