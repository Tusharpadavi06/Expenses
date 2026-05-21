import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  FileText, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Menu, 
  ChevronRight,
  LogOut,
  Mail,
  IndianRupee,
  ShieldCheck,
  CreditCard,
  Check,
  Info,
  MapPin,
  LogIn,
  Plus,
  SendHorizontal
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toaster, toast } from 'sonner';
import { BRANCH_DATA, Branch, Salesperson } from './constants';

// --- Types ---
const BRANCHES = BRANCH_DATA.map(b => b.name);

interface Claim {
  rowIndex: number;
  sheetName?: string;
  timestamp: string;
  submissionid: string;
  branchname: string;
  salespersonname: string;
  expensecategory: string;
  itemdate: string;
  fromlocation: string;
  tolocation: string;
  amount: string;
  attachmentlink: string;
  itemremark: string;
  grandtotal: string;
  adminremark: string;
  mailsent: string;
  approved: string;
  approvedtimestamp: string;
  paymentprocess: string;
  processedby: string;
  status: string;
  paymentrelease: string;
  releasedby: string;
  employeeemail?: string;
  branchheademail?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('submit');
  const [user, setUser] = useState<{ displayName: string; email: string } | null>(() => {
    try {
      const saved = localStorage.getItem('custom_admin_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(false);

  // Authentication custom states
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [authTab, setAuthTab] = useState('login');

  const handleCustomLogin = async () => {
    if (!loginEmail || !loginPassword) {
      toast.error("Email and password are required.");
      return;
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Authentication failed.");
      }
      const adminProfile = { displayName: data.user.name, email: data.user.email };
      localStorage.setItem('custom_admin_user', JSON.stringify(adminProfile));
      setUser(adminProfile);
      toast.success(`Logged in successfully as ${data.user.name}!`);
      setLoginEmail('');
      setLoginPassword('');
    } catch (err: any) {
      console.error("Login Error:", err);
      toast.error(err.message || "Invalid credentials.");
    }
  };

  const handleCustomRegister = async () => {
    if (!registerName || !registerEmail || !registerPassword) {
      toast.error("All fields are required for registration.");
      return;
    }
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: registerName, email: registerEmail, password: registerPassword })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Registration failed.");
      }
      toast.success("Account created successfully! Switching to Login tab.");
      setLoginEmail(registerEmail);
      setRegisterName('');
      setRegisterEmail('');
      setRegisterPassword('');
      setAuthTab('login'); // Automatically switch to Login tab
    } catch (err: any) {
      console.error("Register Error:", err);
      toast.error(err.message || "Registration failed.");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('custom_admin_user');
    setUser(null);
    toast.success("Logged out successfully.");
  };
  const [filters, setFilters] = useState({
    branch: 'all',
    status: 'all',
    month: 'all',
    year: '',
    employeeSearch: ''
  });

  const filteredClaims = claims.filter(claim => {
    const matchBranch = filters.branch === 'all' || claim.branchname === filters.branch;
    const matchEmployee = !filters.employeeSearch || claim.salespersonname?.toLowerCase().includes(filters.employeeSearch.toLowerCase());
    
    let matchStatus = true;
    if (filters.status === 'pending') matchStatus = claim.approved !== 'Yes';
    else if (filters.status === 'approved') matchStatus = claim.approved === 'Yes' && claim.paymentrelease !== 'Yes';
    else if (filters.status === 'released') matchStatus = claim.paymentrelease === 'Yes';

    const matchMonth = filters.month === 'all' || claim.timestamp.includes(filters.month);
    const matchYear = !filters.year || claim.timestamp.includes(filters.year);

    return matchBranch && matchEmployee && matchStatus && matchMonth && matchYear;
  });

  // Group filtered claims by submission ID for the admin view
  const filteredGroups = useMemo(() => {
    const groups: { [key: string]: Claim[] } = {};
    filteredClaims.forEach(claim => {
      if (!groups[claim.submissionid]) {
        groups[claim.submissionid] = [];
      }
      groups[claim.submissionid].push(claim);
    });
    // Sort by row index descending (latest first)
    return Object.values(groups).sort((a, b) => {
      const idxA = a[0].rowIndex;
      const idxB = b[0].rowIndex;
      return idxB - idxA;
    });
  }, [filteredClaims]);

  // Form State
  const [formData, setFormData] = useState({
    branchName: '',
    salespersonName: '',
    salespersonEmail: '',
  });

  const [items, setItems] = useState([{
    id: crypto.randomUUID(),
    category: 'Food',
    itemDate: '',
    fromLoc: '',
    toLoc: '',
    amount: '',
    attachment: '',
    remark: ''
  }]);

  const addItem = () => {
    setItems([...items, {
      id: crypto.randomUUID(),
      category: 'Food',
      itemDate: '',
      fromLoc: '',
      toLoc: '',
      amount: '',
      attachment: '',
      remark: ''
    }]);
  };

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id));
    }
  };

  const updateItem = (id: string, field: string, value: any) => {
    setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleFileChange = async (id: string, file: File | null) => {
    if (!file) return;

    // 1. If it's an image, perform client-side canvas compression
    if (file.type.startsWith('image/')) {
      try {
        const compressedBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
              const canvas = document.createElement("canvas");
              let width = img.width;
              let height = img.height;
              const maxWidth = 1200;
              const maxHeight = 1200;

              // Fit to maximum bounding box
              if (width > height) {
                if (width > maxWidth) {
                  height = Math.round((height * maxWidth) / width);
                  width = maxWidth;
                }
              } else {
                if (height > maxHeight) {
                  width = Math.round((width * maxHeight) / height);
                  height = maxHeight;
                }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                resolve(event.target?.result as string); // fallback
                return;
              }

              ctx.drawImage(img, 0, 0, width, height);
              // Export as high-compression JPEG (0.65 quality is indistinguishable but highly compressed)
              const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
              resolve(dataUrl);
            };
            img.onerror = (e) => reject(e);
          };
          reader.onerror = (e) => reject(e);
        });

        updateItem(id, 'fileData', compressedBase64);
        updateItem(id, 'fileName', file.name.replace(/\.[^/.]+$/, "") + ".jpg"); // force extension to jpg
        updateItem(id, 'fileType', "image/jpeg");
        toast.success("Image auto-compressed successfully for lightning-fast submission!");
      } catch (err) {
        console.error("Compression error, falling back to raw upload:", err);
        // Fallback to reading file normally
        const reader = new FileReader();
        reader.onload = (e) => {
          updateItem(id, 'fileData', e.target?.result as string);
          updateItem(id, 'fileName', file.name);
          updateItem(id, 'fileType', file.type);
        };
        reader.readAsDataURL(file);
      }
    } else {
      // 2. Non-image files (e.g. PDF). Enforce a strict 2.5MB limit to prevent Vercel 4.5MB request payload limit errors
      if (file.size > 2.5 * 1024 * 1024) {
        toast.error(`File size is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Please upload a PDF/Document smaller than 2.5MB.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        updateItem(id, 'fileData', e.target?.result as string);
        updateItem(id, 'fileName', file.name);
        updateItem(id, 'fileType', file.type);
      };
      reader.readAsDataURL(file);
    }
  };

  const grandTotal = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

  const selectedBranch = BRANCH_DATA.find(b => b.name === formData.branchName);
  const salespeople = selectedBranch ? selectedBranch.salespeople : [];

  const handleBranchChange = (branchName: string) => {
    setFormData({
      ...formData,
      branchName,
      salespersonName: '',
      salespersonEmail: ''
    });
  };

  const handleSalespersonChange = (name: string) => {
    const sp = salespeople.find(s => s.name === name);
    setFormData({
      ...formData,
      salespersonName: name,
      salespersonEmail: sp ? sp.email : ''
    });
  };

  const handleTabChange = (v: string) => {
    setActiveTab(v);
  };

  const fetchClaims = async () => {
    try {
      const res = await fetch('/api/claims');
      const clone = res.clone();
      if (!res.ok) {
        let text = "";
        try {
          // Attempt clone first to bypass any extension interference on original
          text = await clone.text();
        } catch {
          try {
            text = await res.text();
          } catch {
            text = "Error reading response body";
          }
        }
        try {
          const errData = JSON.parse(text);
          toast.error(`Failed to load claims: ${errData.error || res.statusText}`);
        } catch {
          const cleanText = text.slice(0, 100);
          toast.error(`Server Error (${res.status}): ${cleanText}... Please check /api/diagnose for diagnostics.`);
        }
        setClaims([]);
        return;
      }
      
      let data;
      try {
        data = await res.json();
      } catch {
        try {
          data = await clone.json();
        } catch (e: any) {
          throw new Error("Failed to parse JSON response: " + e.message);
        }
      }

      if (Array.isArray(data)) {
        setClaims(data);
      } else {
        console.error('API did not return an array:', data);
        setClaims([]);
      }
    } catch (error: any) {
      console.error(error);
      toast.error(`Connection failed: ${error.message || error}`);
    }
  };

  useEffect(() => {
    if (activeTab === 'admin') {
      fetchClaims();
    }
  }, [activeTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          items,
          grandTotal,
          branchHeadEmail: selectedBranch?.headEmail
        })
      });

      const clone = res.clone();
      if (res.ok) {
        toast.success('Claim submitted successfully!');
        setFormData({
          branchName: '',
          salespersonName: '',
          salespersonEmail: '',
        });
        setItems([{
          id: crypto.randomUUID(),
          category: 'Food',
          itemDate: '',
          fromLoc: '',
          toLoc: '',
          amount: '',
          attachment: '',
          remark: ''
        }]);
      } else {
        let text = "";
        try {
          text = await clone.text();
        } catch {
          try {
            text = await res.text();
          } catch {
            text = "Error reading response body";
          }
        }
        try {
          const errData = JSON.parse(text);
          toast.error(`Submission failed: ${errData.error || res.statusText}`);
        } catch {
          const cleanText = text.slice(0, 100);
          toast.error(`Submission Server Error (${res.status}): ${cleanText}... Please check /api/diagnose for diagnostics.`);
        }
      }
    } catch (error: any) {
      console.error(error);
      toast.error(`Submission connection failed: ${error.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAdminAction = async (action: string, claimGroup: Claim[], extraData?: any) => {
    setLoading(true);
    try {
      // Use the first claim in group for row index reference
      const claim = claimGroup[0];
      const res = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action, 
          rowIndex: claim.rowIndex, 
          claimId: claim.submissionid,
          sheetName: claim.sheetName,
          adminName: extraData?.adminName,
          adminEmail: extraData?.adminEmail,
          data: { ...claim, ...extraData } 
        })
      });

      const clone = res.clone();
      if (res.ok) {
        toast.success(`Action ${action} successful`);
        fetchClaims();
      } else {
        let text = "";
        try {
          text = await clone.text();
        } catch {
          try {
            text = await res.text();
          } catch {
            text = "Error reading response body";
          }
        }
        try {
          const errData = JSON.parse(text);
          toast.error(`Action ${action} failed: ${errData.error || res.statusText}`);
        } catch {
          const cleanText = text.slice(0, 100);
          toast.error(`Action Error (${res.status}): ${cleanText}... Please check /api/diagnose for diagnostics.`);
        }
      }
    } catch (error: any) {
      console.error(error);
      toast.error(`Action connection failed: ${error.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans">
      <Toaster position="top-center" />
      
      {/* Header */}
      <header className="bg-white border-b border-[#141414]/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[#141414] p-2 rounded-lg">
              <IndianRupee className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight uppercase">ExpensePro</h1>
          </div>
          
          <Tabs value={activeTab} onValueChange={handleTabChange} className="flex">
            <TabsList className="bg-[#141414]/5 border border-[#141414]/10">
              <TabsTrigger value="submit" className="text-[10px] md:text-xs uppercase font-black data-[state=active]:bg-[#141414] data-[state=active]:text-white">Submit</TabsTrigger>
              <TabsTrigger value="admin" className="text-[10px] md:text-xs uppercase font-black data-[state=active]:bg-[#141414] data-[state=active]:text-white">Admin</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden lg:flex border-[#141414] text-[10px] font-bold">V1.28.0</Badge>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {activeTab === 'submit' ? (
            <motion.div
              key="submit"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="max-w-4xl mx-auto space-y-8"
            >
              <div className="text-center space-y-2 mb-8">
                <Badge variant="outline" className="border-[#141414] text-[8px] py-0.5 px-3 tracking-widest uppercase opacity-60">Official Personnel Only</Badge>
                <h2 className="text-[12px] font-black italic tracking-tighter uppercase leading-tight">
                  Seamless <br className="md:hidden"/> Expense Claims
                </h2>
                <p className="max-w-xs mx-auto text-[#141414]/60 font-serif italic text-[9px]">
                  Register business expenses with instant verification.
                </p>
              </div>

              <Card className="max-w-md mx-auto border-2 border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden bg-white">
                <div className="bg-[#141414] text-white px-2 py-1.5 flex justify-between items-center">
                  <span className="text-[7px] font-black uppercase tracking-[0.1em]">Submission // v1.2</span>
                  <div className="flex gap-1">
                    <div className="w-1 h-1 rounded-full bg-red-400"></div>
                    <div className="w-1 h-1 rounded-full bg-yellow-400"></div>
                    <div className="w-1 h-1 rounded-full bg-green-400"></div>
                  </div>
                </div>
                <CardHeader className="pt-2 pb-0.5 px-4 text-center">
                  <CardTitle className="text-[9px] font-black italic tracking-tighter uppercase opacity-40">ITEM SUBMISSION PORTAL</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-4 pb-4">
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="branch" className="text-[10px] uppercase font-bold opacity-50">Branch</Label>
                        <Select value={formData.branchName} onValueChange={handleBranchChange}>
                          <SelectTrigger className="h-8 text-xs border-[#141414]">
                            <SelectValue placeholder="Branch" />
                          </SelectTrigger>
                          <SelectContent>
                            {BRANCH_DATA.map(b => (
                              <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="name" className="text-[10px] uppercase font-bold opacity-50">Name</Label>
                        <Select value={formData.salespersonName} onValueChange={handleSalespersonChange} disabled={!formData.branchName}>
                          <SelectTrigger className="h-8 text-xs border-[#141414]">
                            <SelectValue placeholder="Name" />
                          </SelectTrigger>
                          <SelectContent>
                            {salespeople.map(s => (
                              <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="email" className="text-[10px] uppercase font-bold opacity-50">Auto-Detected Email</Label>
                      <Input id="email" readOnly value={formData.salespersonEmail} className="h-8 text-xs border-[#141414] bg-[#F5F5F0] italic" />
                    </div>

                    <div className="space-y-4 pt-4 border-t border-[#141414]/10">
                      <div className="flex justify-between items-center bg-[#141414] text-white py-1 px-2 rounded-sm">
                        <h4 className="text-[9px] font-black uppercase tracking-widest">Expense Entry</h4>
                        <span className="text-[8px] opacity-40 italic">#Entries: {items.length}</span>
                      </div>

                      {items.map((item, index) => (
                        <div key={item.id} className="relative p-3 border border-dashed border-[#141414]/20 rounded-lg space-y-3 bg-slate-50/30">
                          <div className="flex justify-between items-center">
                            <span className="text-[8px] font-bold bg-[#141414] text-white px-1.5 rounded">ITEM {index + 1}</span>
                            {items.length > 1 && (
                              <Button 
                                type="button" 
                                variant="ghost"
                                size="sm" 
                                className="h-5 px-1 text-[8px] uppercase font-black text-red-500 hover:text-red-600 hover:bg-red-50"
                                onClick={() => removeItem(item.id)}
                              >
                                Delete
                              </Button>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-[9px] font-bold uppercase opacity-60">Category</Label>
                              <Select value={item.category} onValueChange={v => updateItem(item.id, 'category', v)}>
                                <SelectTrigger className="h-7 text-[10px] border-[#141414]/20">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Travel">Travel</SelectItem>
                                  <SelectItem value="Food">Food</SelectItem>
                                  <SelectItem value="Stay">Stay</SelectItem>
                                  <SelectItem value="Misc">Misc</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] font-bold uppercase opacity-60">Date</Label>
                              <Input type="date" value={item.itemDate} onChange={e => updateItem(item.id, 'itemDate', e.target.value)} required className="h-7 text-[10px] border-[#141414]/20" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] font-bold uppercase opacity-60">Amount (₹)</Label>
                              <Input type="number" placeholder="0.00" value={item.amount} onChange={e => updateItem(item.id, 'amount', e.target.value)} required className="h-7 text-[10px] border-[#141414]/20" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] font-bold uppercase opacity-60 flex items-center gap-1">
                                <FileText className="w-2 h-2" /> Upload
                              </Label>
                              <Input 
                                type="file" 
                                accept="image/*,.pdf,.doc,.docx"
                                onChange={e => handleFileChange(item.id, e.target.files ? e.target.files[0] : null)}
                                className="h-7 text-[8px] border-[#141414]/20 p-0 file:h-full file:bg-[#141414] file:text-white file:border-0 file:px-2" 
                              />
                            </div>
                          </div>

                          <AnimatePresence>
                            {item.category === 'Travel' && (
                              <motion.div 
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="grid grid-cols-2 gap-3 overflow-hidden"
                              >
                                <Input placeholder="From" value={item.fromLoc} onChange={e => updateItem(item.id, 'fromLoc', e.target.value)} className="h-7 text-[10px] border-[#141414]/20" />
                                <Input placeholder="To" value={item.toLoc} onChange={e => updateItem(item.id, 'toLoc', e.target.value)} className="h-7 text-[10px] border-[#141414]/20" />
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <Input placeholder="Brief remark..." value={item.remark} onChange={e => updateItem(item.id, 'remark', e.target.value)} className="h-7 text-[10px] border-[#141414]/20" />
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3 pt-2">
                      <Button 
                        type="button" 
                        variant="outline" 
                        className="w-full border border-dashed border-[#141414] h-8 text-[9px] uppercase font-black hover:bg-[#141414] hover:text-white transition-colors"
                        onClick={addItem}
                      >
                        + Add Next Item
                      </Button>

                      <div className="bg-[#141414] text-white p-3 rounded-md flex justify-between items-center">
                        <span className="font-bold uppercase tracking-widest text-[8px] opacity-60">Total Payable</span>
                        <span className="text-xl font-black italic tracking-tighter">₹{grandTotal}</span>
                      </div>
                    </div>

                    <Button type="submit" disabled={loading} className="w-full bg-[#141414] hover:bg-[#141414]/90 text-white font-bold h-8 text-[10px] uppercase shadow-[1px_1px_0px_0px_#888] border border-[#141414]">
                      {loading ? 'Transmitting...' : 'Confirm Submission'}
                      <Send className="ml-2 w-2.5 h-2.5" />
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="admin"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-8"
            >
              <div className="flex flex-col gap-4">
                <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-end">
                  <div>
                    <h2 className="text-4xl font-black uppercase italic">Claims Dashboard</h2>
                    <p className="text-[#141414]/60 font-serif italic">Review and process employee claims securely.</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    {user ? (
                      <div className="flex items-center gap-3 bg-white border-2 border-blue-600 p-1.5 pr-4 rounded-xl shadow-[4px_4px_0px_0px_rgba(37,99,235,1)]">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black text-sm">
                          {user.displayName?.charAt(0)}
                        </div>
                        <div className="text-left">
                          <p className="text-[10px] font-black uppercase leading-none">{user.displayName}</p>
                          <p className="text-[8px] opacity-40 font-mono">{user.email}</p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 ml-2 text-slate-400 hover:text-red-500"
                          onClick={handleLogout}
                        >
                          <LogOut className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <Dialog>
                        <DialogTrigger
                          render={
                            <Button className="bg-blue-600 border-2 border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] hover:bg-blue-700 h-10 px-4 font-black uppercase text-xs italic">
                              <LogIn className="w-4 h-4 mr-2" /> Admin Sign In
                            </Button>
                          }
                        />
                        <DialogContent className="max-w-md border-2 border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] p-6 bg-white rounded-xl">
                          <DialogHeader>
                            <DialogTitle className="text-xl font-black uppercase italic tracking-tight">
                              Administrative Entry
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-xs text-slate-500">
                              Access the claims dashboard using your administrator credentials or register an account.
                            </DialogDescription>
                          </DialogHeader>
                          <Tabs value={authTab} onValueChange={setAuthTab} className="w-full mt-4">
                            <TabsList className="grid grid-cols-2 bg-slate-100 p-1 rounded-lg border border-[#141414]/10">
                              <TabsTrigger value="login" className="font-black uppercase text-xs">Login</TabsTrigger>
                              <TabsTrigger value="register" className="font-black uppercase text-xs">Register</TabsTrigger>
                            </TabsList>
                            <TabsContent value="login" className="space-y-4 pt-4 text-left">
                              <div className="space-y-1">
                                <Label className="text-[10px] font-black uppercase">Email Address</Label>
                                <Input 
                                  type="email" 
                                  placeholder="admin@expense.com" 
                                  value={loginEmail} 
                                  onChange={(e) => setLoginEmail(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] font-black uppercase">Password</Label>
                                <Input 
                                  type="password" 
                                  placeholder="••••••••" 
                                  value={loginPassword} 
                                  onChange={(e) => setLoginPassword(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCustomLogin();
                                  }}
                                />
                                <span className="text-[9px] text-slate-400 italic block mt-1">
                                  * Quick Demo Login: Use <b>admin@expense.com</b> with password <b>admin123</b>
                                </span>
                              </div>
                              <Button 
                                onClick={handleCustomLogin} 
                                className="w-full bg-[#141414] hover:bg-slate-800 text-white uppercase font-black text-xs h-10 border-2 border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
                              >
                                Sign In
                              </Button>
                            </TabsContent>
                            <TabsContent value="register" className="space-y-4 pt-4 text-left">
                              <div className="space-y-1">
                                <Label className="text-[10px] font-black uppercase">Full Name</Label>
                                <Input 
                                  type="text" 
                                  placeholder="John Doe" 
                                  value={registerName} 
                                  onChange={(e) => setRegisterName(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] font-black uppercase">Email Address</Label>
                                <Input 
                                  type="email" 
                                  placeholder="john@example.com" 
                                  value={registerEmail} 
                                  onChange={(e) => setRegisterEmail(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] font-black uppercase">Password</Label>
                                <Input 
                                  type="password" 
                                  placeholder="••••••••" 
                                  value={registerPassword} 
                                  onChange={(e) => setRegisterPassword(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCustomRegister();
                                  }}
                                />
                              </div>
                              <Button 
                                onClick={handleCustomRegister} 
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white uppercase font-black text-xs h-10 border-2 border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
                              >
                                Create Account
                              </Button>
                            </TabsContent>
                          </Tabs>
                        </DialogContent>
                      </Dialog>
                    )}
                    <Button onClick={fetchClaims} loading={loading} variant="outline" className="border-[#141414] border-2 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] bg-white h-10 font-black uppercase text-xs italic">
                      Refresh Data
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-white border-2 border-[#141414] rounded-xl shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-black uppercase opacity-60">Employee</Label>
                    <Input 
                      placeholder="Search name..." 
                      value={filters.employeeSearch}
                      onChange={e => setFilters(prev => ({ ...prev, employeeSearch: e.target.value }))}
                      className="h-8 text-xs border-[#141414]/20" 
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-black uppercase opacity-60">Branch</Label>
                    <Select value={filters.branch} onValueChange={(v) => setFilters(prev => ({ ...prev, branch: v }))}>
                      <SelectTrigger className="h-8 text-xs border-[#141414]/20">
                        <SelectValue placeholder="All Branches" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Branches</SelectItem>
                        {BRANCH_DATA.map(b => (
                          <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-black uppercase opacity-60">Status</Label>
                    <Select value={filters.status} onValueChange={(v) => setFilters(prev => ({ ...prev, status: v }))}>
                      <SelectTrigger className="h-8 text-xs border-[#141414]/20">
                        <SelectValue placeholder="All Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="released">Released</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-black uppercase opacity-60">Month</Label>
                    <Select value={filters.month} onValueChange={(v) => setFilters(prev => ({ ...prev, month: v }))}>
                      <SelectTrigger className="h-8 text-xs border-[#141414]/20">
                        <SelectValue placeholder="All Months" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Months</SelectItem>
                        {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-2 p-2 bg-[#141414] text-white rounded text-[8px] font-mono uppercase">
                  <div className="flex items-center gap-1 border-r border-white/20 pr-2">
                    <ShieldCheck className="w-2.5 h-2.5 text-green-400" />
                    <span>Cloud Database: Connected</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <CreditCard className="w-2.5 h-2.5 text-blue-400" />
                    <span>Spreadsheet Sync: Active</span>
                  </div>
                </div>
              </div>

              <div className="bg-white border-2 border-[#141414] rounded-xl overflow-x-auto shadow-[8px_8px_0px_rgba(20,20,20,1)]">
                <Table>
                  <TableHeader className="bg-[#141414]">
                    <TableRow className="border-b border-white/20 hover:bg-transparent">
                      <TableHead className="text-white font-black uppercase text-[7px] h-8 w-[100px]">ID / Date</TableHead>
                      <TableHead className="text-white font-black uppercase text-[7px] h-8">Branch</TableHead>
                      <TableHead className="text-white font-black uppercase text-[7px] h-8">Employee</TableHead>
                      <TableHead className="text-white font-black uppercase text-[7px] h-8">Category</TableHead>
                      <TableHead className="text-white font-black uppercase text-[7px] h-8">Details</TableHead>
                      <TableHead className="text-white font-black uppercase text-[7px] h-8 text-right">Amount</TableHead>
                      <TableHead className="text-white font-black uppercase text-[7px] h-8 max-w-[150px]">Admin Remark</TableHead>
                      <TableHead className="text-white font-black uppercase text-[7px] h-8 text-center">Status</TableHead>
                      <TableHead className="text-white font-black uppercase text-[7px] h-8 text-right pr-6 min-w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredGroups.map((group) => {
                      const mainClaim = group[0];
                      return (
                        <TableRow key={mainClaim.submissionid} className="hover:bg-[#F5F5F0]/50 border-b border-[#141414]/10">
                          <TableCell className="py-2">
                            <div className="font-bold text-[9px]">{mainClaim.submissionid}</div>
                            <div className="text-[7px] text-muted-foreground uppercase">{mainClaim.timestamp}</div>
                            <Badge variant="outline" className="text-[6px] h-3 px-1 mt-1 opacity-60 bg-white">
                              {group.length} ITEM(S)
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="font-bold uppercase text-[8px]">{mainClaim.branchname}</div>
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="font-bold uppercase text-[8px]">{mainClaim.salespersonname}</div>
                            <div className="text-[7px] opacity-40 truncate max-w-[120px]">{mainClaim.employeeemail}</div>
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="space-y-1">
                              {group.map((item, idx) => (
                                <div key={idx} className="flex items-center gap-1">
                                  <Badge variant="secondary" className="text-[6px] h-3 px-1 bg-slate-100/50">
                                    {item.expensecategory}
                                  </Badge>
                                  <span className="text-[7px] font-mono">₹{item.amount}</span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="text-[8px] font-medium max-w-[150px] truncate">
                              {group.map(item => item.fromlocation).filter(Boolean).join(', ')}
                            </div>
                            <div className="flex gap-1 mt-0.5">
                              {group.some(i => i.attachmentlink && i.attachmentlink !== "Upload Failed") && (
                                <Badge variant="outline" className="text-[6px] h-3 px-1 border-blue-200 text-blue-600 bg-blue-50">FILES</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono font-bold text-[10px] text-right py-2">
                            ₹{mainClaim.grandtotal}
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="text-[8px] text-muted-foreground italic truncate max-w-[150px]">
                              {mainClaim.adminremark || '---'}
                            </div>
                            {mainClaim.mailsent === 'Yes' && <Badge variant="outline" className="text-[6px] h-3 px-1 border-green-200 text-green-600 bg-green-50 mt-0.5">MAIL</Badge>}
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="flex flex-col items-center gap-0.5">
                              <div className="flex gap-0.5">
                                {mainClaim.approved === 'Yes' ? (
                                  <Badge className="bg-green-100 text-green-700 border-green-200 text-[6px] h-3 px-1 font-bold">APPV</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[6px] h-3 px-1 font-bold opacity-40">PEND</Badge>
                                )}
                                {mainClaim.paymentprocess === 'Yes' && <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[6px] h-3 px-1 font-bold">PROC</Badge>}
                              </div>
                              {mainClaim.paymentrelease === 'Yes' && <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[6px] h-3 px-1 font-bold">RELS</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right py-2">
                            <AdminActionDialog 
                              claim={mainClaim} 
                              group={group} 
                              onAction={(action, d) => handleAdminAction(action, group, d)} 
                              predefinedAdmin={user ? { name: user.displayName || 'Admin', email: user.email || '' } : undefined}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredGroups.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                          No claims found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="mt-20 border-t border-[#141414]/10 py-8 bg-white">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-[#141414] p-1.5 rounded">
              <IndianRupee className="text-white w-4 h-4" />
            </div>
            <h1 className="font-bold uppercase text-sm">ExpensePro</h1>
          </div>
          <div className="text-[10px] opacity-30 uppercase tracking-widest font-bold">
            © 2026 Enterprise Solutions
          </div>
        </div>
      </footer>
    </div>
  );
}

function AdminActionDialog({ claim, onAction, group, predefinedAdmin }: { claim: Claim, onAction: (a: string, d?: any) => void, group: Claim[], predefinedAdmin?: { name: string; email: string } }) {
  const [remark, setRemark] = useState(claim.adminremark || '');
  const [email, setEmail] = useState(claim.employeeemail || '');
  const [adminName, setAdminName] = useState(predefinedAdmin?.name || 'Expense Admin');
  const [adminEmail, setAdminEmail] = useState(predefinedAdmin?.email || '');

  // Update when predefined admin changes
  useEffect(() => {
    if (predefinedAdmin?.name) setAdminName(predefinedAdmin.name);
    if (predefinedAdmin?.email) setAdminEmail(predefinedAdmin.email);
  }, [predefinedAdmin]);

  // Update email if claim changes
  useEffect(() => {
    setEmail(claim.employeeemail || '');
  }, [claim.employeeemail]);

  // Look up branch head email from constants
  const branchInfo = BRANCH_DATA.find(b => b.name === claim.branchname);
  const branchHeadEmail = branchInfo?.headEmail || '';

  const getActionData = (extra?: any) => ({
    remark,
    employeeemail: email,
    branchheademail: branchHeadEmail,
    adminName,
    adminEmail,
    ...extra
  });

  return (
    <Dialog>
      <DialogTrigger
        render={
          <button className="inline-flex items-center justify-center rounded-md text-[10px] font-black uppercase border-2 border-[#141414] bg-white hover:bg-[#141414] hover:text-white h-8 px-4 transition-all shadow-[2px_2px_0px_0px_rgba(20,20,20,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none">
            Manage <ChevronRight className="w-3 h-3 ml-1" />
          </button>
        }
      />
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col border-2 border-[#141414] shadow-[12px_12px_0px_rgba(20,20,20,1)] p-0 bg-white overflow-hidden">
        <div className="p-6 overflow-y-auto space-y-6">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <Badge className="bg-[#141414] text-white text-[8px] px-2 py-0 font-bold uppercase tracking-widest">Review Portal</Badge>
              <h2 className="text-2xl font-black uppercase tracking-tight leading-none pt-1">{claim.salespersonname}</h2>
              <div className="flex items-center gap-2">
                <Mail className="w-3 h-3 text-blue-600" />
                <span className="text-[11px] font-bold text-blue-600 underline">{claim.employeeemail || 'No Email Found'}</span>
              </div>
              <p className="text-[10px] opacity-40 uppercase font-mono">{claim.submissionid} | {claim.branchname}</p>
            </div>
            <div className="text-right space-y-2">
              <div className="bg-yellow-50 border-2 border-yellow-400 p-2 rounded shadow-[4px_4px_0px_rgba(161,98,7,0.2)]">
                <Label className="text-[8px] font-black uppercase opacity-60 block text-right tracking-widest">Active Administrator</Label>
                <div className="text-[11px] font-black text-[#141414] uppercase">{adminName}</div>
                <div className="text-[9px] opacity-70 font-mono">{adminEmail}</div>
                <p className="text-[7px] mt-1 text-yellow-700 italic font-bold leading-none">* Mails will be sent as {adminName}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b-2 border-[#141414] pb-1">
                <p className="text-[10px] font-black uppercase tracking-tight">Summary by Category</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] bg-slate-50 p-2 rounded border border-[#141414]/5">
                {Object.entries(group.reduce((acc: any, item) => {
                  acc[item.expensecategory] = (acc[item.expensecategory] || 0) + Number(item.amount);
                  return acc;
                }, {})).map(([cat, amt]: any) => (
                  <div key={cat} className="flex justify-between border-b border-dashed border-[#141414]/10 pb-1">
                    <span className="font-bold opacity-60 uppercase">{cat}:</span>
                    <span className="font-black text-blue-900">₹{amt}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-b-2 border-[#141414] pb-1 pt-2">
                <p className="text-[10px] font-black uppercase tracking-tight">Itemized Breakdown ({group.length})</p>
                <div className="bg-[#141414] text-white text-[10px] px-2 py-0.5 rounded font-black">
                  ₹{claim.grandtotal}
                </div>
              </div>
              
              <div className="max-h-[380px] overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                {group.map((item, idx) => (
                  <div key={idx} className="bg-slate-50 border border-[#141414]/10 rounded-md p-3 hover:bg-white hover:border-[#141414]/30 transition-all border-l-4 border-l-blue-500 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[9px] font-black uppercase border-blue-200 bg-blue-50 text-blue-700 h-4 px-1.5 rounded-sm">
                            {item.expensecategory}
                          </Badge>
                          <span className="text-[9px] opacity-40 font-mono">{item.itemdate}</span>
                        </div>
                        <p className="text-[11px] font-bold leading-tight">
                          {item.fromlocation} {item.tolocation ? `→ ${item.tolocation}` : ''}
                        </p>
                        {item.itemremark && (
                          <div className="text-[9px] mt-2 p-1.5 bg-white/60 border border-dashed border-[#141414]/10 rounded font-serif italic text-slate-600">
                             {item.itemremark}
                          </div>
                        )}
                      </div>
                      <div className="text-right ml-4">
                        <div className="text-sm font-black text-blue-900 leading-none">₹{item.amount}</div>
                        {item.attachmentlink && item.attachmentlink !== "Upload Failed" && (
                          <a 
                            href={item.attachmentlink} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="inline-flex items-center gap-1 text-[8px] font-black text-blue-600 hover:bg-blue-50 px-2 py-1 rounded border border-blue-200 mt-2 transition-colors uppercase"
                          >
                            <FileText className="w-2.5 h-2.5" /> View Bill
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              {/* SENDER PROFILE BOX */}
              <div className="bg-blue-50 border-2 border-blue-200 p-4 rounded-xl space-y-4 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-100/30 rounded-full -mr-12 -mt-12 blur-2xl" />
                <div className="flex items-center justify-between border-b border-blue-100 pb-3 relative z-10">
                   <div className="flex items-center gap-2">
                     <div className="bg-blue-600 p-2 rounded-lg shadow-[2px_2px_0px_rgba(20,20,20,0.2)]">
                       <ShieldCheck className="w-5 h-5 text-white" />
                     </div>
                     <div>
                       <p className="text-[10px] font-black uppercase text-blue-900 leading-none tracking-tight">Active Identity</p>
                       <p className="text-[8px] text-blue-600 font-bold uppercase tracking-widest mt-0.5">Admin Session</p>
                     </div>
                   </div>
                   <div className="text-right">
                     <p className="text-[12px] font-black text-blue-900 uppercase tracking-tight">{adminName}</p>
                     <p className="text-[9px] text-blue-700 font-mono italic opacity-70">{adminEmail}</p>
                   </div>
                </div>
                
                <div className="space-y-3 relative z-10">
                   <div className="flex items-center justify-between">
                     <Label className="text-[10px] font-black uppercase text-blue-800/60">Target Recipient</Label>
                     <span className="bg-blue-600 text-white text-[7px] px-1.5 py-0.5 rounded font-black italic">AUTO-SYNCED</span>
                   </div>
                   <div className="relative group">
                     <Mail className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-blue-400 group-focus-within:text-blue-600 transition-colors" />
                     <Input 
                       value={email} 
                       onChange={e => setEmail(e.target.value)} 
                       className="h-10 text-xs pl-8 border-blue-100 bg-white font-bold text-blue-900 focus:ring-4 focus:ring-blue-100 transition-all border-2" 
                     />
                   </div>
                   <div className="bg-white/60 p-3 rounded-lg border-2 border-dashed border-blue-200 text-[9px] text-blue-700 leading-relaxed">
                     <div className="flex items-start gap-2">
                       <Info className="w-3 h-3 mt-0.5 shrink-0" />
                       <p>Mails deploy via SMTP protocol. Visual header will display <b>"{adminName}"</b>. Reply-to routing points to <b>{adminEmail}</b>.</p>
                     </div>
                   </div>
                </div>
              </div>

              {/* REMARK BOX */}
              <div className="bg-slate-50 border-2 border-[#141414] p-4 rounded-xl space-y-3 shadow-[4px_4px_0px_rgba(20,20,20,0.05)]">
                <div className="flex items-center gap-2 border-b border-[#141414]/10 pb-2">
                  <div className="bg-[#141414] p-1.5 rounded text-white italic font-serif text-[10px] lowercase">"txt"</div>
                  <Label className="text-[10px] font-black uppercase text-[#141414]">Administrative Communication</Label>
                </div>
                <Textarea 
                  placeholder="Enter official remark or feedback for the claimant..." 
                  value={remark} 
                  onChange={e => setRemark(e.target.value)}
                  className="border-slate-200 min-h-[90px] text-xs resize-none bg-white focus:border-[#141414] transition-all"
                />
                <Button 
                  className="w-full bg-[#141414] hover:bg-blue-600 text-white text-[10px] h-9 font-black uppercase tracking-widest shadow-[4px_4px_0px_0px_rgba(20,20,20,0.1)] active:shadow-none active:translate-x-[1px] active:translate-y-[1px] transition-all"
                  disabled={!remark || !email}
                  onClick={() => onAction('REMARK', getActionData())}
                >
                  <Send className="w-3 h-3 mr-2" /> Dispatch Remark
                </Button>
              </div>
            </div>

            {/* ACTION SECTION IN A PROPER BOX */}
            <div className="col-span-full mt-2">
              <div className="bg-white border-4 border-[#141414] rounded-2xl p-5 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3">
                  <Badge className="bg-slate-100 text-slate-400 font-mono text-[7px] border-none shadow-none uppercase">Sequence Controls</Badge>
                </div>
                <h3 className="text-[12px] font-black uppercase tracking-tighter mb-4 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                  Administrator Control Center
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <Button 
                    variant="outline" 
                    className={`flex-col h-auto py-5 border-2 border-[#141414] transition-all group ${
                      claim.approved === 'Yes' 
                        ? 'bg-slate-100 opacity-50 grayscale cursor-not-allowed' 
                        : 'bg-green-50 hover:bg-green-100 shadow-[4px_4px_0px_0px_rgba(22,163,74,1)] active:shadow-none hover:-translate-y-1'
                    }`}
                    onClick={() => onAction('APPROVE', getActionData())}
                    disabled={claim.approved === 'Yes'}
                  >
                    <ShieldCheck className={`w-8 h-8 mb-2 ${claim.approved === 'Yes' ? 'text-slate-400' : 'text-green-600 group-hover:scale-110 transition-transform'}`} />
                    <span className="text-[10px] font-black uppercase text-center leading-tight">01. Admin<br/>Approve</span>
                  </Button>

                  <Button 
                    variant="outline" 
                    className={`flex-col h-auto py-5 border-2 border-[#141414] transition-all group ${
                      claim.approved !== 'Yes' || claim.paymentprocess === 'Yes'
                        ? 'bg-slate-100 opacity-50 grayscale cursor-not-allowed' 
                        : 'bg-blue-50 hover:bg-blue-100 shadow-[4px_4px_0px_0px_rgba(37,99,235,1)] active:shadow-none hover:-translate-y-1'
                    }`}
                    onClick={() => onAction('PROCESS', getActionData())}
                    disabled={claim.approved !== 'Yes' || claim.paymentprocess === 'Yes'}
                  >
                    <CreditCard className={`w-8 h-8 mb-2 ${claim.approved !== 'Yes' || claim.paymentprocess === 'Yes' ? 'text-slate-400' : 'text-blue-600 group-hover:scale-110 transition-transform'}`} />
                    <span className="text-[10px] font-black uppercase text-center leading-tight">02. Process<br/>Payment</span>
                  </Button>

                  <Button 
                    variant="outline" 
                    className={`flex-col h-auto py-5 border-2 border-[#141414] transition-all group ${
                      claim.paymentprocess !== 'Yes' || claim.paymentrelease === 'Yes'
                        ? 'bg-slate-100 opacity-50 grayscale cursor-not-allowed' 
                        : 'bg-purple-50 hover:bg-purple-100 shadow-[4px_4px_0px_0px_rgba(147,51,234,1)] active:shadow-none hover:-translate-y-1'
                    }`}
                    onClick={() => onAction('RELEASE', getActionData())}
                    disabled={claim.paymentprocess !== 'Yes' || claim.paymentrelease === 'Yes'}
                  >
                    <CheckCircle2 className={`w-8 h-8 mb-2 ${claim.paymentprocess !== 'Yes' || claim.paymentrelease === 'Yes' ? 'text-slate-400' : 'text-purple-600 group-hover:scale-110 transition-transform'}`} />
                    <span className="text-[10px] font-black uppercase text-center leading-tight">03. Final<br/>Release</span>
                  </Button>
                  
                  <div className="flex flex-col justify-center items-center p-4 bg-slate-900 text-white rounded-xl border-4 border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,0.4)]">
                    <span className="text-[8px] font-black opacity-50 uppercase tracking-[0.2em] mb-1">Current State</span>
                    <div className="flex items-center gap-2">
                       {claim.paymentrelease === 'Yes' && <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                       <span className="text-[14px] font-black uppercase tracking-tighter">
                        {claim.paymentrelease === 'Yes' ? 'Settled' : 
                         claim.paymentprocess === 'Yes' ? 'Processed' :
                         claim.approved === 'Yes' ? 'Approved' : 'Pending'}
                      </span>
                    </div>
                    <p className="text-[7px] font-mono mt-2 opacity-40 uppercase tracking-widest">
                       Ref: {claim.submissionid?.slice(-8)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
