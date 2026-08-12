import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  BookOpen, MapPin, Phone, Search, X, LogOut, ArrowLeft, Check, Clock3,
  Sparkles, Coffee, Library, QrCode, Upload, CircleDot, CheckCircle2, AlertTriangle,
  ChevronRight
} from "lucide-react";

/* ---------------------------------- theme (matches owner portal) ---------------------------------- */
const C = {
  ink: "#1C2B28",
  inkSoft: "#2A3B37",
  paper: "#F4F5F1",
  paperCard: "#FFFFFF",
  line: "#E1E1D8",
  brass: "#B8823D",
  brassSoft: "#EADFC8",
  vacant: "#2F8F5B",
  vacantSoft: "#E4F3EB",
  occupied: "#35618C",
  occupiedSoft: "#E4ECF4",
  due: "#C1542C",
  dueSoft: "#FBE7DD",
  muted: "#6B7370",
};

const FONTS = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
    .f-display { font-family: 'Fraunces', serif; }
    .f-body { font-family: 'Inter', sans-serif; }
    .f-mono { font-family: 'IBM Plex Mono', monospace; }
  `}</style>
);

/* ---------------------------------- utils ---------------------------------- */
const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmt = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/* ---------------------------------- storage ---------------------------------- */
// --- Backend storage (Supabase) — replaces the Claude-artifact-only window.storage API ---
import { supabase } from "../lib/supabaseClient";

async function getShared(key, fallback) {
  const { data, error } = await supabase.from("app_kv").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  try { return JSON.parse(data.value); } catch { return fallback; }
}
async function setShared(key, value) {
  const { error } = await supabase.from("app_kv").upsert({ key, value: JSON.stringify(value) });
  return !error;
}
// "Personal" (remember-me on this device) — plain localStorage, no server round trip needed.
async function getPersonal(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
async function setPersonal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function fileToCompressedDataUrl(file, maxW = 480, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------- root ---------------------------------- */
export default function StudentPortal() {
  const [booting, setBooting] = useState(true);
  const [student, setStudent] = useState(null); // {id, name, ...}
  const [screen, setScreen] = useState("browse"); // browse | tour | auth | library | bookings
  const [activeLibrary, setActiveLibrary] = useState(null); // public lib summary
  const [toast, setToast] = useState(null);

  const showToast = (msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    (async () => {
      const last = await getPersonal("last_student_session", null);
      if (last?.id) setStudent(last);
      setBooting(false);
    })();
  }, []);

  const login = async (studentRecord) => {
    setStudent(studentRecord);
    await setPersonal("last_student_session", studentRecord);
    showToast(`Welcome, ${studentRecord.name.split(" ")[0]}`);
    setScreen("browse");
  };
  const logout = async () => {
    setStudent(null);
    await setPersonal("last_student_session", null);
    setScreen("browse");
  };

  if (booting) {
    return (
      <div className="f-body min-h-screen flex items-center justify-center" style={{ background: C.paper }}>
        {FONTS}
        <div style={{ color: C.muted }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.paper, minHeight: "100vh" }} className="f-body">
      {FONTS}
      <style>{styleSheet}</style>
      <TopBar student={student} screen={screen} setScreen={setScreen} onLogout={logout} activeLibrary={activeLibrary} setActiveLibrary={setActiveLibrary} />

      <div className="max-w-3xl mx-auto px-4 py-6 pb-16">
        {screen === "browse" && (
          <Browse
            onOpenLibrary={(l) => { setActiveLibrary(l); setScreen("library"); }}
            onTour={() => setScreen("tour")}
          />
        )}
        {screen === "tour" && <VirtualTour onBack={() => setScreen("browse")} />}
        {screen === "auth" && <AuthScreen onDone={login} showToast={showToast} onCancel={() => setScreen(activeLibrary ? "library" : "browse")} />}
        {screen === "library" && activeLibrary && (
          <LibraryDetail
            summary={activeLibrary}
            student={student}
            onBack={() => setScreen("browse")}
            onRequireAuth={() => setScreen("auth")}
            showToast={showToast}
          />
        )}
        {screen === "bookings" && (
          student ? <MyBookings student={student} showToast={showToast} /> : <AuthScreen onDone={login} showToast={showToast} onCancel={() => setScreen("browse")} />
        )}
      </div>

      {toast && <Toast toast={toast} />}
    </div>
  );
}

function Toast({ toast }) {
  const good = toast.kind === "ok";
  return (
    <div className="fixed bottom-5 right-5 left-5 sm:left-auto px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50 text-sm" style={{ background: good ? C.ink : C.due, color: "#fff" }}>
      {good ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      {toast.msg}
    </div>
  );
}

/* ---------------------------------- top bar ---------------------------------- */
function TopBar({ student, screen, setScreen, onLogout, activeLibrary, setActiveLibrary }) {
  return (
    <div className="sticky top-0 z-30" style={{ background: C.ink }}>
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        <button onClick={() => { setActiveLibrary(null); setScreen("browse"); }} className="flex items-center gap-2">
          <BookOpen size={17} color={C.brass} />
          <span className="f-display text-white text-base">Readingroom</span>
        </button>
        <div className="flex items-center gap-4 text-sm">
          <button onClick={() => setScreen("bookings")} className="hidden sm:inline" style={{ color: screen === "bookings" ? "#fff" : "#B8C0BC" }}>My bookings</button>
          {student ? (
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: "#B8C0BC" }}>{student.name.split(" ")[0]}</span>
              <button onClick={onLogout}><LogOut size={15} color="#B8C0BC" /></button>
            </div>
          ) : (
            <button onClick={() => setScreen("auth")} className="text-xs font-medium px-3 py-1.5 rounded-md" style={{ background: C.brass, color: "#fff" }}>Log in</button>
          )}
        </div>
      </div>
      <div className="sm:hidden flex justify-center pb-2">
        <button onClick={() => setScreen("bookings")} className="text-xs" style={{ color: screen === "bookings" ? "#fff" : "#B8C0BC" }}>My bookings</button>
      </div>
    </div>
  );
}

/* ---------------------------------- browse libraries ---------------------------------- */
function Browse({ onOpenLibrary, onTour }) {
  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const idx = await getShared("public_libraries_index", []);
      setLibraries(idx);
      setLoading(false);
    })();
  }, []);

  const filtered = libraries.filter((l) => l.libraryName.toLowerCase().includes(q.toLowerCase()) || (l.address || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="rounded-xl p-6 mb-6" style={{ background: C.ink }}>
        <h1 className="f-display text-2xl text-white mb-1">Find your reading room</h1>
        <p className="text-sm mb-4" style={{ color: "#B8C0BC" }}>Book a seat, track your dues, and get access once your library confirms payment.</p>
        <button onClick={onTour} className="text-xs font-medium px-3 py-2 rounded-md flex items-center gap-1.5 w-fit" style={{ background: C.brass, color: "#fff" }}>
          <Sparkles size={13} /> Take the virtual tour — no login needed
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-2.5 top-2.5" color={C.muted} />
        <input className="input pl-8" placeholder="Search by library name or area" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: C.muted }}>Loading libraries…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm" style={{ color: C.muted }}>No libraries found yet — check back soon.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((l) => (
            <button key={l.id} onClick={() => onOpenLibrary(l)} className="w-full text-left rounded-xl p-4 flex items-center justify-between transition hover:opacity-90" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
              <div>
                <div className="f-display text-lg" style={{ color: C.ink }}>{l.libraryName}</div>
                {l.address && <div className="text-xs flex items-center gap-1 mt-1" style={{ color: C.muted }}><MapPin size={12} /> {l.address}</div>}
              </div>
              <div className="text-right shrink-0 pl-3">
                <div className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: l.vacantSeats > 0 ? C.vacantSoft : C.dueSoft, color: l.vacantSeats > 0 ? C.vacant : C.due }}>
                  {l.vacantSeats > 0 ? `${l.vacantSeats} seats free` : "Full"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- virtual tour ---------------------------------- */
function VirtualTour({ onBack }) {
  const stops = [
    { title: "Reading hall", desc: "Rows of individually lit desks, designed for long focus sessions with minimal distraction." },
    { title: "Quiet zone", desc: "A no-conversation area for deep work, separated from the general seating." },
    { title: "Cafeteria corner", desc: "A short break area for tea, coffee and light snacks between study sessions." },
    { title: "E-library access", desc: "Digital reference material and past papers, unlocked once your seat is confirmed." },
  ];
  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-5" style={{ color: C.muted }}><ArrowLeft size={14} /> Back</button>
      <h1 className="f-display text-2xl mb-1" style={{ color: C.ink }}>Virtual tour</h1>
      <p className="text-sm mb-6" style={{ color: C.muted }}>A quick look at what a typical reading room offers — exact layout varies by library.</p>
      <div className="space-y-3">
        {stops.map((s, i) => (
          <div key={s.title} className="rounded-xl p-4 flex gap-4 items-start" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
            <div className="f-mono text-xs w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: C.brassSoft, color: C.brass }}>{i + 1}</div>
            <div>
              <div className="f-display text-base" style={{ color: C.ink }}>{s.title}</div>
              <div className="text-sm mt-0.5" style={{ color: C.muted }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- auth ---------------------------------- */
function AuthScreen({ onDone, showToast, onCancel }) {
  const [mode, setMode] = useState("login");
  const [reg, setReg] = useState({ name: "", phone: "", address: "", whatsapp: "", email: "", guardianPhone: "", password: "" });
  const [log, setLog] = useState({ phone: "", password: "" });
  const [busy, setBusy] = useState(false);

  const register = async () => {
    if (!reg.name || !reg.phone || !reg.password) { showToast("Name, phone and password are required", "err"); return; }
    setBusy(true);
    const accounts = await getShared("student_accounts", []);
    if (accounts.some((a) => a.id === reg.phone)) {
      showToast("An account with this phone already exists — log in instead", "err");
      setBusy(false);
      return;
    }
    const record = { id: reg.phone, name: reg.name, address: reg.address, whatsapp: reg.whatsapp || reg.phone, email: reg.email, guardianPhone: reg.guardianPhone, password: reg.password, createdAt: new Date().toISOString() };
    await setShared("student_accounts", [...accounts, record]);
    setBusy(false);
    onDone(record);
  };

  const login = async () => {
    if (!log.phone || !log.password) { showToast("Enter phone and password", "err"); return; }
    setBusy(true);
    const accounts = await getShared("student_accounts", []);
    const acc = accounts.find((a) => a.id === log.phone && a.password === log.password);
    if (!acc) { showToast("Invalid phone or password", "err"); setBusy(false); return; }
    setBusy(false);
    onDone(acc);
  };

  return (
    <div>
      <button onClick={onCancel} className="flex items-center gap-1 text-sm mb-5" style={{ color: C.muted }}><ArrowLeft size={14} /> Back</button>
      <div className="max-w-sm mx-auto rounded-xl p-6" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
        <div className="flex gap-1 mb-6 p-1 rounded-lg" style={{ background: C.paper }}>
          <button onClick={() => setMode("login")} className="flex-1 py-2 rounded-md text-sm font-medium" style={mode === "login" ? { background: C.ink, color: "#fff" } : { color: C.muted }}>Log in</button>
          <button onClick={() => setMode("register")} className="flex-1 py-2 rounded-md text-sm font-medium" style={mode === "register" ? { background: C.ink, color: "#fff" } : { color: C.muted }}>Register</button>
        </div>

        {mode === "login" ? (
          <div className="space-y-3">
            <Field label="Phone number"><input className="input" value={log.phone} onChange={(e) => setLog((f) => ({ ...f, phone: e.target.value }))} /></Field>
            <Field label="Password"><input type="password" className="input" value={log.password} onChange={(e) => setLog((f) => ({ ...f, password: e.target.value }))} /></Field>
            <button disabled={busy} onClick={login} className="btn-primary w-full mt-2">{busy ? "Please wait…" : "Log in"}</button>
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <Field label="Full name *"><input className="input" value={reg.name} onChange={(e) => setReg((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Phone — this becomes your ID *"><input className="input" value={reg.phone} onChange={(e) => setReg((f) => ({ ...f, phone: e.target.value }))} /></Field>
            <Field label="WhatsApp number"><input className="input" value={reg.whatsapp} onChange={(e) => setReg((f) => ({ ...f, whatsapp: e.target.value }))} /></Field>
            <Field label="Email"><input className="input" value={reg.email} onChange={(e) => setReg((f) => ({ ...f, email: e.target.value }))} /></Field>
            <Field label="Address as per ID proof"><input className="input" value={reg.address} onChange={(e) => setReg((f) => ({ ...f, address: e.target.value }))} /></Field>
            <Field label="Guardian number"><input className="input" value={reg.guardianPhone} onChange={(e) => setReg((f) => ({ ...f, guardianPhone: e.target.value }))} /></Field>
            <Field label="Password *"><input type="password" className="input" value={reg.password} onChange={(e) => setReg((f) => ({ ...f, password: e.target.value }))} /></Field>
            <p className="text-xs" style={{ color: C.muted }}>One account works across every library on Readingroom.</p>
            <button disabled={busy} onClick={register} className="btn-primary w-full mt-2">{busy ? "Please wait…" : "Create account"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium block mb-1" style={{ color: C.muted }}>{label}</span>
      {children}
    </label>
  );
}

/* ---------------------------------- library detail + booking ---------------------------------- */
function LibraryDetail({ summary, student, onBack, onRequireAuth, showToast }) {
  const [pub, setPub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeat, setSelectedSeat] = useState(null);

  const load = useCallback(async () => {
    const p = await getShared(`public:${summary.id}`, null);
    setPub(p);
    setLoading(false);
  }, [summary.id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-sm" style={{ color: C.muted }}>Loading…</p>;
  if (!pub) return <p className="text-sm" style={{ color: C.muted }}>This library isn't available right now.</p>;

  const vacantSeats = (pub.seats || []).filter((s) => s.status === "vacant");

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm mb-5" style={{ color: C.muted }}><ArrowLeft size={14} /> All libraries</button>

      <div className="rounded-xl p-5 mb-6" style={{ background: C.ink }}>
        <h1 className="f-display text-2xl text-white">{pub.libraryName}</h1>
        {pub.address && <div className="text-xs flex items-center gap-1 mt-2" style={{ color: "#B8C0BC" }}><MapPin size={12} /> {pub.address}</div>}
        {pub.contactPhone && <div className="text-xs flex items-center gap-1 mt-1" style={{ color: "#B8C0BC" }}><Phone size={12} /> {pub.contactPhone}</div>}
      </div>

      <h2 className="f-display text-lg mb-3" style={{ color: C.ink }}>Choose a seat</h2>
      {vacantSeats.length === 0 ? (
        <p className="text-sm mb-6" style={{ color: C.muted }}>No vacant seats right now — check back later.</p>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mb-6">
          {vacantSeats.map((s) => (
            <button key={s.number} onClick={() => (student ? setSelectedSeat(s.number) : onRequireAuth())} className="rounded-lg py-3 text-center f-mono text-sm font-medium transition hover:opacity-80" style={{ background: C.vacantSoft, color: C.vacant, border: `1px solid ${C.vacant}55` }}>
              #{s.number}
            </button>
          ))}
        </div>
      )}

      {(pub.plans || []).length > 0 && (
        <div className="mb-6">
          <h2 className="f-display text-lg mb-3" style={{ color: C.ink }}>Plans</h2>
          <div className="grid sm:grid-cols-2 gap-2">
            {pub.plans.map((p) => (
              <div key={p.id} className="rounded-lg px-3 py-2.5 flex justify-between text-sm" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
                <span style={{ color: C.ink }}>{p.name}</span>
                <span className="f-mono" style={{ color: C.muted }}>₹{p.amount} / {p.days}d</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedSeat && (
        <BookingModal
          ownerId={summary.id}
          seatNumber={selectedSeat}
          pub={pub}
          student={student}
          onClose={() => setSelectedSeat(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function BookingModal({ ownerId, seatNumber, pub, student, onClose, showToast }) {
  const [step, setStep] = useState("plan"); // plan | pay | done
  const [planId, setPlanId] = useState(pub.plans?.[0]?.id || "");
  const [customAmount, setCustomAmount] = useState("");
  const [customDays, setCustomDays] = useState(30);
  const [method, setMethod] = useState("screenshot");
  const [txnId, setTxnId] = useState("");
  const [screenshot, setScreenshot] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const plan = (pub.plans || []).find((p) => p.id === planId);
  const amount = plan ? plan.amount : customAmount;
  const days = plan ? plan.days : customDays;

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file, 420, 0.8);
      setScreenshot(dataUrl);
    } catch {
      showToast("Couldn't read that image", "err");
    }
    setUploading(false);
  };

  const submit = async () => {
    if (!amount || !days) { showToast("Choose a plan or enter amount and duration", "err"); return; }
    if (method === "screenshot" && !txnId) { showToast("Enter your transaction ID", "err"); return; }
    setSubmitting(true);
    const requests = await getShared(`requests:${ownerId}`, []);
    const req = {
      id: uid("req_"), studentId: student.id, studentName: student.name, studentWhatsapp: student.whatsapp,
      studentAddress: student.address, studentEmail: student.email, guardianPhone: student.guardianPhone,
      seatNumber, planName: plan ? plan.name : "Custom", amount: Number(amount), days: Number(days),
      paymentMethod: method, txnId: txnId || null, screenshot: method === "screenshot" ? screenshot : "",
      status: "pending", createdAt: new Date().toISOString(),
    };
    await setShared(`requests:${ownerId}`, [...requests, req]);
    setSubmitting(false);
    setStep("done");
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: "rgba(28,43,40,.5)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-xl overflow-hidden" style={{ background: C.paperCard }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.line}` }}>
          <div className="f-display text-lg" style={{ color: C.ink }}>Seat #{seatNumber}</div>
          <button onClick={onClose}><X size={18} color={C.muted} /></button>
        </div>

        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
          {step === "plan" && (
            <div className="space-y-4">
              <div>
                <span className="text-xs font-medium block mb-1.5" style={{ color: C.muted }}>Plan</span>
                <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">Custom amount / duration</option>
                  {(pub.plans || []).map((p) => <option key={p.id} value={p.id}>{p.name} · ₹{p.amount} / {p.days}d</option>)}
                </select>
                {!plan && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input type="number" className="input" placeholder="Amount ₹" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} />
                    <input type="number" className="input" placeholder="Duration (days)" value={customDays} onChange={(e) => setCustomDays(e.target.value)} />
                  </div>
                )}
              </div>
              <button onClick={() => setStep("pay")} className="btn-primary w-full">Continue to payment</button>
            </div>
          )}

          {step === "pay" && (
            <div className="space-y-4">
              <div className="rounded-lg p-3 text-sm flex justify-between" style={{ background: C.paper }}>
                <span style={{ color: C.muted }}>Amount due</span>
                <span className="f-mono font-medium" style={{ color: C.ink }}>₹{amount}</span>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setMethod("screenshot")} className="flex-1 py-2 rounded-md text-xs font-medium" style={method === "screenshot" ? { background: C.ink, color: "#fff" } : { background: "#EDEEEA", color: C.muted }}>Pay via UPI / QR</button>
                <button onClick={() => setMethod("cash")} className="flex-1 py-2 rounded-md text-xs font-medium" style={method === "cash" ? { background: C.ink, color: "#fff" } : { background: "#EDEEEA", color: C.muted }}>Pay cash at desk</button>
              </div>

              {method === "screenshot" ? (
                <div className="space-y-3">
                  {pub.paymentInfo?.qrImage ? (
                    <img src={pub.paymentInfo.qrImage} alt="Payment QR" className="w-40 h-40 mx-auto rounded-lg" style={{ border: `1px solid ${C.line}` }} />
                  ) : pub.paymentInfo?.upiId ? (
                    <div className="text-center text-sm py-6 rounded-lg" style={{ background: C.paper }}>
                      <QrCode size={20} className="mx-auto mb-2" color={C.muted} />
                      <span className="f-mono" style={{ color: C.ink }}>{pub.paymentInfo.upiId}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-center py-4" style={{ color: C.muted }}>This library hasn't added payment details yet — choose cash instead or check with the desk.</p>
                  )}
                  <input className="input" placeholder="Transaction ID *" value={txnId} onChange={(e) => setTxnId(e.target.value)} />
                  <label className="btn-secondary text-xs w-full flex items-center justify-center gap-1.5 cursor-pointer">
                    <Upload size={13} /> {uploading ? "Uploading…" : screenshot ? "Screenshot attached ✓" : "Upload payment screenshot"}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                  </label>
                </div>
              ) : (
                <p className="text-xs" style={{ color: C.muted }}>You'll pay in person — the owner confirms once received.</p>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setStep("plan")} className="btn-secondary flex-1">Back</button>
                <button disabled={submitting} onClick={submit} className="btn-primary flex-1">{submitting ? "Submitting…" : "Submit request"}</button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="text-center py-6">
              <CheckCircle2 size={28} color={C.vacant} className="mx-auto mb-3" />
              <p className="f-display text-lg mb-1" style={{ color: C.ink }}>Request sent</p>
              <p className="text-sm mb-5" style={{ color: C.muted }}>Waiting for the library to confirm your payment and approve seat #{seatNumber}. Check "My bookings" for status.</p>
              <button onClick={onClose} className="btn-primary w-full">Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- my bookings ---------------------------------- */
function MyBookings({ student, showToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const idx = await getShared("public_libraries_index", []);
      const all = [];
      for (const l of idx) {
        const reqs = await getShared(`requests:${l.id}`, []);
        reqs.filter((r) => r.studentId === student.id).forEach((r) => all.push({ ...r, libraryName: l.libraryName }));
      }
      all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setRows(all);
      setLoading(false);
    })();
  }, [student.id]);

  const statusStyle = (s) =>
    s === "approved" ? { background: C.vacantSoft, color: C.vacant }
    : s === "rejected" ? { background: C.dueSoft, color: C.due }
    : { background: C.brassSoft, color: C.brass };

  return (
    <div>
      <h1 className="f-display text-2xl mb-1" style={{ color: C.ink }}>My bookings</h1>
      <p className="text-sm mb-6" style={{ color: C.muted }}>{student.name} · {student.id}</p>

      {loading ? (
        <p className="text-sm" style={{ color: C.muted }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: C.muted }}>No booking requests yet — browse libraries to book a seat.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl p-4" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
              <div className="flex items-center justify-between">
                <div className="f-display text-base" style={{ color: C.ink }}>{r.libraryName}</div>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full capitalize" style={statusStyle(r.status)}>{r.status}</span>
              </div>
              <div className="text-sm mt-1" style={{ color: C.muted }}>Seat #{r.seatNumber} · {r.planName} · ₹{r.amount} / {r.days}d</div>
              <div className="text-xs mt-1" style={{ color: C.muted }}>Requested {fmt(r.createdAt.slice(0, 10))}</div>

              {r.status === "approved" && <Perks />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Perks() {
  return (
    <div className="mt-3 pt-3 grid grid-cols-2 gap-2" style={{ borderTop: `1px solid ${C.line}` }}>
      <div className="rounded-lg p-2.5 flex items-center gap-2" style={{ background: C.paper }}>
        <Coffee size={15} color={C.brass} />
        <span className="text-xs" style={{ color: C.ink }}>Cafeteria <span style={{ color: C.muted }}>· coming soon</span></span>
      </div>
      <div className="rounded-lg p-2.5 flex items-center gap-2" style={{ background: C.paper }}>
        <Library size={15} color={C.brass} />
        <span className="text-xs" style={{ color: C.ink }}>E-library <span style={{ color: C.muted }}>· coming soon</span></span>
      </div>
    </div>
  );
}

/* ---------------------------------- shared css ---------------------------------- */
const styleSheet = `
  .input {
    width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid ${C.line};
    background: #fff; font-size: 13.5px; color: ${C.ink}; outline: none;
  }
  .input:focus { border-color: ${C.brass}; }
  .btn-primary {
    background: ${C.ink}; color: #fff; padding: 9px 16px; border-radius: 8px;
    font-size: 13.5px; font-weight: 500; transition: opacity .15s;
  }
  .btn-primary:hover { opacity: .88; }
  .btn-secondary {
    background: #EDEEEA; color: ${C.ink}; padding: 9px 16px; border-radius: 8px;
    font-size: 13.5px; font-weight: 500; transition: opacity .15s;
  }
  .btn-secondary:hover { opacity: .85; }
`;
