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
  LogIn,
  Plus,
  Trash2,
  ChevronRight,
  Settings,
  LayoutDashboard,
  Calendar,
  Filter,
  Search,
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { format, parse, startOfMonth, endOfMonth, isWithinInterval, getYear, getMonth } from 'date-fns';
import { th } from 'date-fns/locale';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function toArabicNumerals(str: string): string {
  const thaiNumerals = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];
  const arabicNumerals = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  let result = str;
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(thaiNumerals[i], "g"), arabicNumerals[i]);
  }
  return result;
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
  completionDate?: string;
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
  completionDate: '',
};

// --- Components ---

interface RepairItem extends RepairData {
  timestamp: string;
  runNumber: string;
  fileUrl: string;
}

type View = 'form' | 'dashboard';

// --- Components ---

const Dashboard = ({ onBack }: { onBack: () => void }) => {
  const [data, setData] = useState<RepairItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // Default to current Thai year (BE)
  const currentYearBE = new Date().getFullYear() + 543;
  const currentMonth = new Date().getMonth() + 1;
  
  const [filterMonth, setFilterMonth] = useState<number>(currentMonth);
  const [filterYear, setFilterYear] = useState<number>(currentYearBE);
  const [filterType, setFilterType] = useState<'month' | 'year' | 'all'>('all');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/repair/list');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch data');
      }
      const json = await res.json();
      setData(json);
    } catch (error: any) {
      console.error('Failed to fetch data', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredData = data.filter(item => {
    try {
      // Robust date parsing: handle DD/MM/YYYY, YYYY-MM-DD, etc.
      let itemDay, itemMonth, itemYear;
      
      if (item.signedDate.includes('/')) {
        const parts = item.signedDate.split('/');
        itemDay = parseInt(parts[0]);
        itemMonth = parseInt(parts[1]);
        itemYear = parseInt(parts[2]);
      } else if (item.signedDate.includes('-')) {
        const parts = item.signedDate.split('-');
        if (parts[0].length === 4) { // YYYY-MM-DD
          itemYear = parseInt(parts[0]);
          itemMonth = parseInt(parts[1]);
          itemDay = parseInt(parts[2]);
        } else { // DD-MM-YYYY
          itemDay = parseInt(parts[0]);
          itemMonth = parseInt(parts[1]);
          itemYear = parseInt(parts[2]);
        }
      }

      const matchesDate = filterType === 'all' 
        ? true 
        : filterType === 'year' 
          ? itemYear === filterYear 
          : (itemYear === filterYear && itemMonth === filterMonth);

      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        item.substation.toLowerCase().includes(searchLower) ||
        item.equipmentId.toLowerCase().includes(searchLower) ||
        item.docNumber.toLowerCase().includes(searchLower) ||
        item.responsible.toLowerCase().includes(searchLower) ||
        item.details.toLowerCase().includes(searchLower) ||
        item.runNumber.toLowerCase().includes(searchLower);

      return matchesDate && matchesSearch;
    } catch (e) {
      return false;
    }
  });

  const stats = {
    total: filteredData.length,
    inProgress: filteredData.filter(i => !i.completionDate || i.completionDate.trim() === '').length,
    completed: filteredData.filter(i => i.completionDate && i.completionDate.trim() !== '').length,
  };

  const chartData = [
    { name: 'อยู่ระหว่างดำเนินการ', value: stats.inProgress, color: '#F59E0B' },
    { name: 'แก้ไขเสร็จแล้ว', value: stats.completed, color: '#10B981' },
  ];

  const substationData = Object.entries(
    filteredData.reduce((acc, item) => {
      acc[item.substation] = (acc[item.substation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name, value }))
   .sort((a, b) => b.value - a.value)
   .slice(0, 10);

  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="w-10 h-10 text-purple-900 animate-spin" />
        <p className="text-purple-400 font-medium text-center">
          กำลังโหลดข้อมูล Dashboard...<br/>
          <span className="text-[10px] font-normal">AI กำลังดึงข้อมูลจาก Google Sheets</span>
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-6">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-lg font-bold text-red-900">เกิดข้อผิดพลาดในการโหลดข้อมูล</h3>
          <p className="text-sm text-red-600 max-w-md mx-auto">{error}</p>
        </div>
        <button 
          onClick={fetchData}
          className="px-6 py-2 bg-purple-900 text-white rounded-xl font-bold text-sm shadow-lg hover:bg-purple-800 transition-all"
        >
          ลองใหม่อีกครั้ง
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-purple-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-purple-900" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-purple-900">Dashboard ผู้บริหาร</h2>
            <p className="text-sm text-purple-400">สรุปภาพรวมงานซ่อมบำรุงอุปกรณ์</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-2xl shadow-sm border border-purple-100">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-purple-300" />
            <input 
              type="text"
              placeholder="ค้นหา..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-purple-50 border-none rounded-xl text-xs font-medium text-purple-900 focus:ring-2 focus:ring-purple-200 w-40 md:w-60"
            />
          </div>

          <div className="h-6 w-px bg-purple-100 mx-1" />

          <select 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="bg-purple-50 border-none rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wider text-purple-900 focus:ring-0"
          >
            <option value="all">ทั้งหมด</option>
            <option value="month">รายเดือน</option>
            <option value="year">รายปี</option>
          </select>

          {filterType === 'month' && (
            <select 
              value={filterMonth}
              onChange={(e) => setFilterMonth(parseInt(e.target.value))}
              className="bg-purple-50 border-none rounded-xl px-3 py-2 text-xs font-bold text-purple-900 focus:ring-0"
            >
              {months.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          )}

          {filterType !== 'all' && (
            <select 
              value={filterYear}
              onChange={(e) => setFilterYear(parseInt(e.target.value))}
              className="bg-purple-50 border-none rounded-xl px-3 py-2 text-xs font-bold text-purple-900 focus:ring-0"
            >
              {[2567, 2568, 2569, 2570, 2571].map(y => (
                <option key={y} value={y}>พ.ศ. {y}</option>
              ))}
            </select>
          )}

          <button 
            onClick={fetchData}
            className="p-2 hover:bg-purple-100 rounded-xl transition-colors text-purple-900"
            title="รีเฟรชข้อมูล"
          >
            <Loader2 className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="bg-white rounded-[32px] p-20 text-center border border-purple-100 shadow-sm space-y-4">
          <div className="w-20 h-20 bg-purple-50 rounded-full flex items-center justify-center mx-auto">
            <FileText className="w-10 h-10 text-purple-200" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-purple-900">ไม่พบข้อมูลในระบบ</h3>
            <p className="text-purple-400 text-sm max-w-xs mx-auto">
              ยังไม่มีการบันทึกข้อมูลงานซ่อมบำรุงลงใน Google Sheets กรุณาเพิ่มข้อมูลใหม่ที่หน้า "แจ้งซ่อมใหม่"
            </p>
          </div>
          <button 
            onClick={onBack}
            className="px-8 py-3 bg-purple-900 text-white rounded-2xl font-bold text-sm shadow-lg hover:bg-purple-800 transition-all"
          >
            ไปที่หน้าแจ้งซ่อมใหม่
          </button>
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-purple-50 flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-100 rounded-2xl flex items-center justify-center">
                <FileText className="w-6 h-6 text-purple-900" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-purple-400">งานทั้งหมด</p>
                <p className="text-2xl font-bold text-purple-900">{stats.total}</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-purple-50 flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">กำลังดำเนินการ</p>
                <p className="text-2xl font-bold text-amber-600">{stats.inProgress}</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-purple-50 flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">เสร็จสิ้นแล้ว</p>
                <p className="text-2xl font-bold text-emerald-600">{stats.completed}</p>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-purple-50 space-y-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-purple-400">สัดส่วนสถานะงาน</h3>
              <div className="h-[300px] w-full">
                {stats.total > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={36}/>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-purple-300 text-xs italic">
                    ไม่มีข้อมูลสำหรับแสดงกราฟ
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-purple-50 space-y-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-purple-400">10 อันดับสถานีที่แจ้งซ่อมสูงสุด</h3>
              <div className="h-[300px] w-full">
                {substationData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={substationData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" width={100} fontSize={10} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#4F46E5" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-purple-300 text-xs italic">
                    ไม่มีข้อมูลสำหรับแสดงกราฟ
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-[32px] shadow-sm border border-purple-50 overflow-hidden">
            <div className="p-8 border-b border-purple-50 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest text-purple-400">รายการงานซ่อมบำรุง (Google Sheet View)</h3>
              <div className="flex items-center gap-4">
                <span className="text-xs font-medium text-purple-400">แสดง {filteredData.length} จาก {data.length} รายการ</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[1200px]">
                <thead>
                  <tr className="bg-purple-50/50">
                    <th className="w-20 px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-purple-400">เลขรัน</th>
                    <th className="w-32 px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-purple-400">สถานีไฟฟ้า</th>
                    <th className="w-32 px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-purple-400">เลขที่เอกสาร</th>
                    <th className="w-40 px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-purple-400">อุปกรณ์</th>
                    <th className="w-60 px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-purple-400">รายละเอียดความชำรุด</th>
                    <th className="w-32 px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-purple-400">ผู้รับผิดชอบ</th>
                    <th className="w-32 px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-purple-400">สถานะ</th>
                    <th className="w-28 px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-purple-400">วันที่เซ็น</th>
                    <th className="w-28 px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-purple-400">วันที่แล้วเสร็จ</th>
                    <th className="w-16 px-4 py-4 text-[10px] font-bold uppercase tracking-wider text-purple-400"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-50">
                  {filteredData.map((item, idx) => (
                    <tr key={idx} className="hover:bg-purple-50/30 transition-colors">
                      <td className="px-4 py-4 text-xs font-mono text-purple-900">{item.runNumber}</td>
                      <td className="px-4 py-4 text-xs font-bold text-purple-900">{item.substation}</td>
                      <td className="px-4 py-4 text-xs text-purple-500">{item.docNumber}</td>
                      <td className="px-4 py-4 text-xs text-purple-500 truncate" title={item.equipmentId}>{item.equipmentId}</td>
                      <td className="px-4 py-4 text-xs text-purple-500 line-clamp-2 h-12 flex items-center" title={item.details}>{item.details}</td>
                      <td className="px-4 py-4 text-xs text-purple-500">{item.responsible}</td>
                      <td className="px-4 py-4">
                        <span className={cn(
                          "text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter",
                          (item.completionDate && item.completionDate.trim() !== '') ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        )}>
                          {(item.completionDate && item.completionDate.trim() !== '') ? 'แก้ไขเสร็จแล้ว' : 'อยู่ระหว่างดำเนินการ'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs text-purple-500">{item.signedDate}</td>
                      <td className="px-4 py-4 text-xs font-bold text-emerald-600">{item.completionDate || '-'}</td>
                      <td className="px-4 py-4 text-right">
                        {item.fileUrl && (
                          <a href={item.fileUrl} target="_blank" rel="noreferrer" className="text-purple-400 hover:text-purple-900 transition-colors">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredData.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center text-purple-300 text-sm italic">
                        ไม่พบข้อมูลสำหรับเงื่อนไขที่เลือก (ลองเปลี่ยนตัวกรองเป็น "ทั้งหมด")
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default function App() {
  const [view, setView] = useState<View>('form');
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
    setIsExtracting(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/ai/extract', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'AI Extraction failed');
      }

      const extracted = await res.json();
      setRepairData({
        ...INITIAL_DATA,
        ...extracted,
        status: 'อยู่ระหว่างดำเนินการ'
      });
    } catch (error: any) {
      console.error('AI Extraction failed', error);
      setMessage({ type: 'error', text: `AI ไม่สามารถดึงข้อมูลได้: ${error.message}` });
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
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setView(view === 'form' ? 'dashboard' : 'form')}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all",
                view === 'dashboard' 
                  ? "bg-purple-900 text-white shadow-lg" 
                  : "bg-purple-50 text-purple-900 hover:bg-purple-100"
              )}
            >
              {view === 'form' ? (
                <>
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  แจ้งซ่อมใหม่
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {view === 'form' ? (
            <motion.div 
              key="form"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-12"
            >
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
                        onChange={(e) => setRepairData({ ...repairData, substation: toArabicNumerals(e.target.value) })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all"
                        placeholder="ระบุชื่อสถานี"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">เลขที่ ก3 กปบ.</label>
                      <input 
                        type="text"
                        value={repairData.docNumber}
                        onChange={(e) => setRepairData({ ...repairData, docNumber: toArabicNumerals(e.target.value) })}
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
                        onChange={(e) => setRepairData({ ...repairData, equipmentId: toArabicNumerals(e.target.value) })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all"
                        placeholder="ระบุรหัสอุปกรณ์"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">ผู้รับผิดชอบ</label>
                      <input 
                        type="text"
                        value={repairData.responsible}
                        onChange={(e) => setRepairData({ ...repairData, responsible: toArabicNumerals(e.target.value) })}
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
                        onChange={(e) => setRepairData({ ...repairData, details: toArabicNumerals(e.target.value) })}
                        className="w-full bg-purple-50/30 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-900 transition-all resize-none"
                        placeholder="ระบุรายละเอียดอาการชำรุด"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-purple-400">รายละเอียดการชำรุด (ภาษาราชการ)</label>
                      <textarea 
                        rows={3}
                        value={repairData.detailsAI}
                        onChange={(e) => setRepairData({ ...repairData, detailsAI: toArabicNumerals(e.target.value) })}
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
                        onChange={(e) => setRepairData({ ...repairData, signedDate: toArabicNumerals(e.target.value) })}
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
                        {message.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                        <div className="flex-1">
                          {message.text}
                          {message.text.includes('invalid_grant') && (
                            <div className="mt-3">
                              <a 
                                href="/api/auth/init" 
                                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all shadow-sm active:scale-95"
                              >
                                <LogIn className="w-4 h-4" />
                                ยืนยันตัวตนใหม่ (Re-authenticate)
                              </a>
                            </div>
                          )}
                        </div>
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
          </motion.div>
        ) : (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <Dashboard onBack={() => setView('form')} />
          </motion.div>
        )}
        </AnimatePresence>
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
