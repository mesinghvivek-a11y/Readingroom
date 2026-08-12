import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  LayoutGrid, Users, Clock3, Settings as SettingsIcon, LogOut, Plus, Search,
  Download, Phone, X, Check, MessageCircle, BookOpen, ChevronRight, Trash2,
  Pencil, AlertTriangle, CheckCircle2, CircleDot, Inbox, Image as ImageIcon, Upload
} from "lucide-react";
import * as XLSX from "xlsx";

/* ---------------------------------- theme ---------------------------------- */
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
const addDays = (dateStr, days) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const fmt = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const waLink = (phone, text) => `https://wa.me/${String(phone).replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

const DEFAULT_TEMPLATE =
  "Hi {name}, your seat #{seat} at our library was due on {dueDate}. Please renew soon to keep your seat reserved. Thank you!";
const DEFAULT_GRACE = 5;

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

/* ---------------------------------- public directory sync ---------------------------------- */
// Mirrors safe, non-sensitive fields to shared keys the Student portal reads from,
// so students never see full student lists / passwords / history.
async function syncPublic(ownerId, lib) {
  const pub = {
    id: ownerId,
    libraryName: lib.profile.libraryName,
    address: lib.profile.address,
    contactPhone: lib.profile.contactPhone,
    subscriptionStatus: lib.profile.subscriptionStatus,
    seats: (lib.seats || []).map((s) => ({ number: s.number, status: s.status })),
    plans: lib.settings?.plans || [],
    paymentInfo: lib.settings?.paymentInfo || {},
  };
  await setShared(`public:${ownerId}`, pub);
  const idx = await getShared("public_libraries_index", []);
  const next = idx.filter((x) => x.id !== ownerId);
  next.push({
    id: ownerId,
    libraryName: lib.profile.libraryName,
    address: lib.profile.address,
    contactPhone: lib.profile.contactPhone,
    totalSeats: (lib.seats || []).length,
    vacantSeats: (lib.seats || []).filter((s) => s.status === "vacant").length,
  });
  await setShared("public_libraries_index", next);
}

/* ---------------------------------- image compression helper ---------------------------------- */
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

/* ---------------------------------- recompute due/vacant ---------------------------------- */
function recomputeSeats(lib) {
  const grace = lib.settings?.gracePeriodDays ?? DEFAULT_GRACE;
  const today = todayStr();
  let changed = false;
  const newHistory = [...(lib.history || [])];
  const seats = (lib.seats || []).map((s) => {
    if (s.status === "occupied" || s.status === "due") {
      const diff = daysBetween(s.endDate, today); // positive if past due
      if (diff > grace) {
        changed = true;
        newHistory.unshift({
          id: uid("h"),
          seatNumber: s.number,
          studentId: s.studentId,
          studentName: s.studentName,
          planName: s.planName,
          amount: s.amount,
          startDate: s.startDate,
          endDate: s.endDate,
          action: "auto-vacated",
          timestamp: new Date().toISOString(),
        });
        return { ...s, status: "vacant", studentId: null, studentName: null, planName: null, amount: null, startDate: null, endDate: null };
      } else if (diff > 0 && s.status !== "due") {
        changed = true;
        return { ...s, status: "due" };
      } else if (diff <= 0 && s.status !== "occupied") {
        changed = true;
        return { ...s, status: "occupied" };
      }
    }
    return s;
  });
  if (!changed) return null;
  return { ...lib, seats, history: newHistory };
}

/* ---------------------------------- root app ---------------------------------- */
export default function OwnerPortal() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null); // {ownerId, email, libraryName}
  const [authMode, setAuthMode] = useState("login");
  const [lib, setLib] = useState(null);
  const [tab, setTab] = useState("overview");
  const [toast, setToast] = useState(null);

  const showToast = (msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    (async () => {
      const last = await getPersonal("last_owner_session", null);
      if (last?.ownerId) {
        const l = await getShared(`library:${last.ownerId}`, null);
        if (l && l.profile) {
          setSession(last);
          setLib({ ...l, __loadedAt: Date.now() });
        } else {
          await setPersonal("last_owner_session", null);
        }
      }
      setBooting(false);
    })();
  }, []);

  const persist = useCallback(async (nextLib) => {
    if (!session) return;
    setLib(nextLib);
    await setShared(`library:${session.ownerId}`, nextLib);
    await syncPublic(session.ownerId, nextLib);
  }, [session]);

  // recompute due/auto-vacate whenever library data loads or date changes
  useEffect(() => {
    if (!lib || !session) return;
    const updated = recomputeSeats(lib);
    if (updated) persist(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib?.__loadedAt, session]);

  const handleLogin = async (ownerId, sessionInfo, libraryData) => {
    let l = libraryData;
    if (!l) l = await getShared(`library:${ownerId}`, null);
    if (!l || !l.profile) {
      showToast("Couldn't load library data — please try again", "err");
      return;
    }
    setSession(sessionInfo);
    setLib({ ...l, __loadedAt: Date.now() });
    await setPersonal("last_owner_session", sessionInfo);
  };

  const handleLogout = async () => {
    setSession(null);
    setLib(null);
    await setPersonal("last_owner_session", null);
  };

  if (booting) {
    return (
      <div className="f-body min-h-screen flex items-center justify-center" style={{ background: C.paper }}>
        {FONTS}
        <div style={{ color: C.muted }}>Loading…</div>
      </div>
    );
  }

  if (!session || !lib) {
    return (
      <div style={{ background: C.paper }} className="min-h-screen f-body">
        {FONTS}
        <AuthScreen mode={authMode} setMode={setAuthMode} onLogin={handleLogin} showToast={showToast} />
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  return (
    <div style={{ background: C.paper, minHeight: "100vh" }} className="f-body">
      {FONTS}
      <Shell
        session={session}
        lib={lib}
        tab={tab}
        setTab={setTab}
        persist={persist}
        onLogout={handleLogout}
        showToast={showToast}
      />
      {toast && <Toast toast={toast} />}
    </div>
  );
}

function Toast({ toast }) {
  const good = toast.kind === "ok";
  return (
    <div
      className="fixed bottom-5 right-5 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50 f-body text-sm"
      style={{ background: good ? C.ink : C.due, color: "#fff" }}
    >
      {good ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      {toast.msg}
    </div>
  );
}

/* ---------------------------------- auth screen ---------------------------------- */
function AuthScreen({ mode, setMode, onLogin, showToast }) {
  const [form, setForm] = useState({
    libraryName: "", ownerName: "", address: "", contactPhone: "", email: "",
    password: "", seatsCount: 20,
  });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [subPlans, setSubPlans] = useState([]);
  const [subPlanId, setSubPlanId] = useState("");
  const [subTxnId, setSubTxnId] = useState("");
  const [subScreenshot, setSubScreenshot] = useState("");
  const [subUploading, setSubUploading] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => setSubPlans(await getShared("admin_subscription_plans", [])))();
  }, []);

  const eligiblePlans = subPlans.filter((p) => Number(form.seatsCount) >= p.seatsMin && Number(form.seatsCount) <= p.seatsMax);

  const handleSubScreenshot = async (file) => {
    if (!file) return;
    setSubUploading(true);
    try {
      setSubScreenshot(await fileToCompressedDataUrl(file, 420, 0.8));
    } catch {
      showToast("Couldn't read that image", "err");
    }
    setSubUploading(false);
  };

  const register = async () => {
    if (!form.libraryName || !form.ownerName || !form.email || !form.password || !form.contactPhone) {
      showToast("Please fill all required fields", "err");
      return;
    }
    setBusy(true);
    const accounts = await getShared("owner_accounts", []);
    if (accounts.some((a) => a.email.toLowerCase() === form.email.toLowerCase())) {
      showToast("An account with this email already exists", "err");
      setBusy(false);
      return;
    }
    const ownerId = uid("own_");
    const account = { id: ownerId, email: form.email, password: form.password, libraryName: form.libraryName, createdAt: new Date().toISOString() };
    await setShared("owner_accounts", [...accounts, account]);

    const seats = Array.from({ length: Number(form.seatsCount) || 0 }, (_, i) => ({
      number: i + 1, status: "vacant", studentId: null, studentName: null,
      planName: null, amount: null, startDate: null, endDate: null,
    }));

    const chosenPlan = subPlans.find((p) => p.id === subPlanId);
    const library = {
      profile: {
        libraryName: form.libraryName, ownerName: form.ownerName, address: form.address,
        contactPhone: form.contactPhone, email: form.email, seatsCount: Number(form.seatsCount),
        subscriptionStatus: "pending_approval",
        subscriptionPlanId: chosenPlan?.id || null,
        subscriptionPlanName: chosenPlan?.name || null,
        subscriptionAmount: chosenPlan?.amount || null,
        subscriptionDays: chosenPlan?.days || null,
        subscriptionTxnId: subTxnId || null,
        subscriptionScreenshot: subScreenshot || "",
        subscriptionExpiresAt: null,
      },
      seats,
      students: [],
      history: [],
      settings: { gracePeriodDays: DEFAULT_GRACE, reminderTemplate: DEFAULT_TEMPLATE, plans: [] },
    };
    await setShared(`library:${ownerId}`, library);
    await syncPublic(ownerId, library);
    showToast("Library registered. Logging you in…");
    await onLogin(ownerId, { ownerId, email: form.email, libraryName: form.libraryName }, library);
    setBusy(false);
  };

  const login = async () => {
    if (!loginForm.email || !loginForm.password) {
      showToast("Enter email and password", "err");
      return;
    }
    setBusy(true);
    const accounts = await getShared("owner_accounts", []);
    const acc = accounts.find(
      (a) => a.email.toLowerCase() === loginForm.email.toLowerCase() && a.password === loginForm.password
    );
    if (!acc) {
      showToast("Invalid email or password", "err");
      setBusy(false);
      return;
    }
    await onLogin(acc.id, { ownerId: acc.id, email: acc.email, libraryName: acc.libraryName });
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-9 h-9 rounded-md flex items-center justify-center" style={{ background: C.ink }}>
            <BookOpen size={18} color={C.brass} />
          </div>
          <span className="f-display text-2xl" style={{ color: C.ink }}>Readingroom</span>
        </div>

        <div className="rounded-xl p-7 shadow-sm" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
          <div className="flex gap-1 mb-6 p-1 rounded-lg" style={{ background: C.paper }}>
            <button
              onClick={() => setMode("login")}
              className="flex-1 py-2 rounded-md text-sm font-medium transition"
              style={mode === "login" ? { background: C.ink, color: "#fff" } : { color: C.muted }}
            >
              Log in
            </button>
            <button
              onClick={() => setMode("register")}
              className="flex-1 py-2 rounded-md text-sm font-medium transition"
              style={mode === "register" ? { background: C.ink, color: "#fff" } : { color: C.muted }}
            >
              Register library
            </button>
          </div>

          {mode === "login" ? (
            <div className="space-y-3">
              <Field label="Email">
                <input className="input" value={loginForm.email} onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))} placeholder="owner@library.com" />
              </Field>
              <Field label="Password">
                <input type="password" className="input" value={loginForm.password} onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
              </Field>
              <button disabled={busy} onClick={login} className="btn-primary w-full mt-2">{busy ? "Please wait…" : "Log in"}</button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
              <Field label="Library name *"><input className="input" value={form.libraryName} onChange={(e) => set("libraryName", e.target.value)} /></Field>
              <Field label="Owner name *"><input className="input" value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></Field>
              <Field label="Library address"><input className="input" value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
              <Field label="Contact phone *"><input className="input" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></Field>
              <Field label="Number of seats *"><input type="number" min="1" className="input" value={form.seatsCount} onChange={(e) => set("seatsCount", e.target.value)} /></Field>
              <Field label="Email *"><input className="input" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Password *"><input type="password" className="input" value={form.password} onChange={(e) => set("password", e.target.value)} /></Field>

              <div className="pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
                <span className="text-xs font-medium block mb-1.5 mt-2" style={{ color: C.muted }}>Subscription plan</span>
                {eligiblePlans.length === 0 ? (
                  <p className="text-xs" style={{ color: C.muted }}>No plan matches {form.seatsCount} seats yet — you can still register; the admin will assign a plan before approving you.</p>
                ) : (
                  <select className="input" value={subPlanId} onChange={(e) => setSubPlanId(e.target.value)}>
                    <option value="">Choose a plan…</option>
                    {eligiblePlans.map((p) => <option key={p.id} value={p.id}>{p.name} · ₹{p.amount} / {p.days}d</option>)}
                  </select>
                )}
              </div>

              {subPlanId && (
                <div className="space-y-2">
                  <span className="text-xs font-medium block mb-1" style={{ color: C.muted }}>Subscription payment</span>
                  <input className="input" placeholder="Transaction ID" value={subTxnId} onChange={(e) => setSubTxnId(e.target.value)} />
                  <label className="btn-secondary text-xs w-full flex items-center justify-center gap-1.5 cursor-pointer">
                    {subUploading ? "Uploading…" : subScreenshot ? "Screenshot attached ✓" : "Upload payment screenshot"}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSubScreenshot(e.target.files?.[0])} />
                  </label>
                </div>
              )}

              <p className="text-xs" style={{ color: C.muted }}>Your account is fully usable right away — it's just marked "pending approval" until the admin confirms your subscription.</p>
              <button disabled={busy} onClick={register} className="btn-primary w-full mt-2">{busy ? "Please wait…" : "Create account"}</button>
            </div>
          )}
        </div>
      </div>
      <style>{styleSheet}</style>
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

/* ---------------------------------- shell / nav ---------------------------------- */
function Shell({ session, lib, tab, setTab, persist, onLogout, showToast }) {
  const counts = useMemo(() => {
    const seats = lib.seats || [];
    return {
      vacant: seats.filter((s) => s.status === "vacant").length,
      occupied: seats.filter((s) => s.status === "occupied").length,
      due: seats.filter((s) => s.status === "due").length,
      total: seats.length,
    };
  }, [lib.seats]);

  const [pendingCount, setPendingCount] = useState(0);
  const refreshPending = useCallback(async () => {
    const r = await getShared(`requests:${session.ownerId}`, []);
    setPendingCount(r.filter((x) => x.status === "pending").length);
  }, [session.ownerId]);
  useEffect(() => { refreshPending(); }, [refreshPending, tab]);

  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "requests", label: "Requests", icon: Inbox, badge: pendingCount },
    { id: "seats", label: "Seats", icon: CircleDot },
    { id: "students", label: "Students", icon: Users },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <div className="flex min-h-screen">
      <style>{styleSheet}</style>
      {/* sidebar */}
      <div className="w-60 shrink-0 hidden md:flex flex-col" style={{ background: C.ink }}>
        <div className="flex items-center gap-2 px-5 py-5">
          <BookOpen size={18} color={C.brass} />
          <span className="f-display text-lg text-white">Readingroom</span>
        </div>
        <div className="px-5 pb-4">
          <div className="f-display text-white text-base leading-tight">{lib.profile.libraryName}</div>
          <span
            className="inline-block mt-2 text-[11px] px-2 py-0.5 rounded-full f-mono"
            style={{
              background: lib.profile.subscriptionStatus === "approved" ? "rgba(47,143,91,.25)" : "rgba(184,130,61,.25)",
              color: lib.profile.subscriptionStatus === "approved" ? "#8FE0B4" : C.brass,
            }}
          >
            {lib.profile.subscriptionStatus === "approved" ? "Subscription active" : "Pending approval"}
          </span>
        </div>
        <nav className="flex-1 px-3 space-y-1 mt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition"
              style={tab === t.id ? { background: C.inkSoft, color: "#fff" } : { color: "#B8C0BC" }}
            >
              <t.icon size={16} /> {t.label}
              {!!t.badge && (
                <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: C.brass, color: "#fff" }}>{t.badge}</span>
              )}
            </button>
          ))}
        </nav>
        <button onClick={onLogout} className="flex items-center gap-3 px-3 py-2.5 mx-3 mb-5 rounded-lg text-sm" style={{ color: "#B8C0BC" }}>
          <LogOut size={16} /> Log out
        </button>
      </div>

      {/* mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3" style={{ background: C.ink }}>
        <div className="flex items-center gap-2">
          <BookOpen size={16} color={C.brass} />
          <span className="f-display text-white text-sm">{lib.profile.libraryName}</span>
        </div>
        <button onClick={onLogout}><LogOut size={16} color="#B8C0BC" /></button>
      </div>
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex justify-around py-2" style={{ background: C.ink, borderTop: `1px solid ${C.inkSoft}` }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="relative flex flex-col items-center gap-0.5 px-3 py-1" style={{ color: tab === t.id ? "#fff" : "#8A928E" }}>
            <t.icon size={17} /><span className="text-[10px]">{t.label}</span>
            {!!t.badge && <span className="absolute top-0 right-1 w-3.5 h-3.5 text-[9px] flex items-center justify-center rounded-full" style={{ background: C.brass, color: "#fff" }}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* main */}
      <div className="flex-1 pt-14 md:pt-0 pb-16 md:pb-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">
          {tab === "overview" && <Overview lib={lib} counts={counts} setTab={setTab} pendingCount={pendingCount} />}
          {tab === "requests" && <RequestsTab lib={lib} persist={persist} session={session} showToast={showToast} onChanged={refreshPending} />}
          {tab === "seats" && <SeatsTab lib={lib} persist={persist} showToast={showToast} />}
          {tab === "students" && <StudentsTab lib={lib} persist={persist} showToast={showToast} />}
          {tab === "settings" && <SettingsTab lib={lib} persist={persist} showToast={showToast} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- overview ---------------------------------- */
function Overview({ lib, counts, setTab, pendingCount }) {
  const dueSeats = (lib.seats || []).filter((s) => s.status === "due");
  return (
    <div>
      <h1 className="f-display text-2xl mb-1" style={{ color: C.ink }}>Overview</h1>
      <p className="text-sm mb-6" style={{ color: C.muted }}>{fmt(todayStr())}</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <StatCard label="Booking requests" value={pendingCount} color={C.brass} bg={C.brassSoft} onClick={() => setTab("requests")} />
        <StatCard label="Vacant seats" value={counts.vacant} color={C.vacant} bg={C.vacantSoft} onClick={() => setTab("seats")} />
        <StatCard label="Occupied" value={counts.occupied} color={C.occupied} bg={C.occupiedSoft} onClick={() => setTab("seats")} />
        <StatCard label="Due (grace period)" value={counts.due} color={C.due} bg={C.dueSoft} onClick={() => setTab("seats")} />
        <StatCard label="Total students" value={(lib.students || []).length} color={C.ink} bg="#EDEEEA" onClick={() => setTab("students")} />
      </div>

      <div className="rounded-xl p-5" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
        <h2 className="f-display text-lg mb-3" style={{ color: C.ink }}>Seats needing a reminder</h2>
        {dueSeats.length === 0 ? (
          <p className="text-sm" style={{ color: C.muted }}>No seats are currently in the grace period.</p>
        ) : (
          <div className="space-y-2">
            {dueSeats.map((s) => (
              <div key={s.number} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: C.dueSoft }}>
                <div className="text-sm">
                  <span className="font-medium" style={{ color: C.ink }}>Seat {s.number}</span>
                  <span style={{ color: C.muted }}> · {s.studentName} · due {fmt(s.endDate)}</span>
                </div>
                <button onClick={() => setTab("seats")} className="text-xs font-medium flex items-center gap-1" style={{ color: C.due }}>
                  View <ChevronRight size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, bg, onClick }) {
  return (
    <button onClick={onClick} className="text-left rounded-xl p-4 transition hover:opacity-90" style={{ background: bg }}>
      <div className="f-display text-3xl" style={{ color }}>{value}</div>
      <div className="text-xs mt-1 font-medium" style={{ color: C.ink }}>{label}</div>
    </button>
  );
}

/* ---------------------------------- requests tab ---------------------------------- */
function RequestsTab({ lib, persist, session, showToast, onChanged }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    const r = await getShared(`requests:${session.ownerId}`, []);
    setRequests(r);
    setLoading(false);
  }, [session.ownerId]);

  useEffect(() => { load(); }, [load]);

  const saveRequests = async (updated) => {
    setRequests(updated);
    await setShared(`requests:${session.ownerId}`, updated);
    onChanged && onChanged();
  };

  const approve = async (req) => {
    const seat = (lib.seats || []).find((s) => s.number === req.seatNumber);
    if (!seat || seat.status !== "vacant") {
      showToast("That seat is no longer vacant", "err");
      return;
    }
    const exists = (lib.students || []).find((s) => s.id === req.studentId);
    const students = exists
      ? lib.students
      : [...(lib.students || []), {
          id: req.studentId, name: req.studentName, address: req.studentAddress || "",
          whatsapp: req.studentWhatsapp || req.studentId, email: req.studentEmail || "",
          guardianPhone: req.guardianPhone || "", registeredBy: "student", registeredAt: new Date().toISOString(),
        }];
    const start = todayStr();
    const end = addDays(start, req.days);
    const seats = lib.seats.map((s) =>
      s.number === req.seatNumber
        ? { ...s, status: "occupied", studentId: req.studentId, studentName: req.studentName, planName: req.planName, amount: req.amount, startDate: start, endDate: end }
        : s
    );
    const historyEntry = {
      id: uid("h"), seatNumber: req.seatNumber, studentId: req.studentId, studentName: req.studentName,
      planName: req.planName, amount: req.amount, startDate: start, endDate: end, action: "booked",
      paymentMethod: req.paymentMethod, transactionId: req.txnId || null, timestamp: new Date().toISOString(),
    };
    await persist({ ...lib, students, seats, history: [historyEntry, ...(lib.history || [])] });
    await saveRequests(requests.map((r) => (r.id === req.id ? { ...r, status: "approved", decidedAt: new Date().toISOString() } : r)));
    showToast(`Approved — seat ${req.seatNumber} booked for ${req.studentName}`);
  };

  const reject = async (req) => {
    await saveRequests(requests.map((r) => (r.id === req.id ? { ...r, status: "rejected", decidedAt: new Date().toISOString() } : r)));
    showToast("Request rejected");
  };

  const pending = requests.filter((r) => r.status === "pending").sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const decided = requests.filter((r) => r.status !== "pending").slice(0, 15);

  if (loading) return <p className="text-sm" style={{ color: C.muted }}>Loading requests…</p>;

  return (
    <div>
      <h1 className="f-display text-2xl mb-1" style={{ color: C.ink }}>Booking requests</h1>
      <p className="text-sm mb-6" style={{ color: C.muted }}>Submitted from the student portal, waiting on your approval.</p>

      {pending.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
          <Inbox size={22} color={C.muted} className="mx-auto mb-2" />
          <p className="text-sm" style={{ color: C.muted }}>No pending requests right now.</p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {pending.map((r) => (
            <div key={r.id} className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
              <div className="flex items-center gap-3">
                {r.screenshot ? (
                  <img src={r.screenshot} alt="payment proof" onClick={() => setPreview(r.screenshot)} className="w-12 h-12 rounded-lg object-cover cursor-pointer" style={{ border: `1px solid ${C.line}` }} />
                ) : (
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: C.paper }}>
                    <span className="text-[10px] font-medium" style={{ color: C.muted }}>Cash</span>
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium" style={{ color: C.ink }}>{r.studentName} <span className="f-mono text-xs" style={{ color: C.muted }}>· {r.studentId}</span></div>
                  <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                    Seat #{r.seatNumber} · {r.planName} · ₹{r.amount} / {r.days}d
                    {r.txnId ? ` · Txn ${r.txnId}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => reject(r)} className="btn-secondary text-xs px-3">Reject</button>
                <button onClick={() => approve(r)} className="btn-primary text-xs px-3 flex items-center gap-1"><Check size={13} /> Approve</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <div>
          <h2 className="f-display text-base mb-3" style={{ color: C.ink }}>Recent decisions</h2>
          <div className="space-y-2">
            {decided.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: C.paper }}>
                <span style={{ color: C.ink }}>{r.studentName} · Seat #{r.seatNumber}</span>
                <span className="text-xs capitalize" style={{ color: r.status === "approved" ? C.vacant : C.due }}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.7)" }} onClick={() => setPreview(null)}>
          <img src={preview} alt="payment proof full" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- seats tab ---------------------------------- */
function SeatsTab({ lib, persist, showToast }) {
  const [filter, setFilter] = useState("all");
  const [activeSeat, setActiveSeat] = useState(null);

  const seats = lib.seats || [];
  const filtered = filter === "all" ? seats : seats.filter((s) => s.status === filter);

  const seatStyle = (status) => {
    if (status === "vacant") return { background: C.vacantSoft, border: `1px solid ${C.vacant}55`, color: C.vacant };
    if (status === "occupied") return { background: C.occupiedSoft, border: `1px solid ${C.occupied}55`, color: C.occupied };
    return { background: C.dueSoft, border: `1px solid ${C.due}55`, color: C.due };
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="f-display text-2xl" style={{ color: C.ink }}>Seats</h1>
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: "#EDEEEA" }}>
          {[
            { id: "all", label: "All" },
            { id: "vacant", label: "Vacant" },
            { id: "occupied", label: "Occupied" },
            { id: "due", label: "Due" },
          ].map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className="px-3 py-1.5 rounded-md text-xs font-medium" style={filter === f.id ? { background: C.ink, color: "#fff" } : { color: C.muted }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 mb-5 text-xs" style={{ color: C.muted }}>
        <LegendDot color={C.vacant} label="Vacant" />
        <LegendDot color={C.occupied} label="Occupied" />
        <LegendDot color={C.due} label="Due / grace period" />
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {filtered.map((s) => (
          <button key={s.number} onClick={() => setActiveSeat(s)} className="rounded-lg p-3 text-left transition hover:opacity-80" style={seatStyle(s.status)}>
            <div className="f-mono text-lg font-medium">#{s.number}</div>
            <div className="text-[11px] mt-1 truncate">{s.studentName || "Vacant"}</div>
          </button>
        ))}
      </div>
      {filtered.length === 0 && <p className="text-sm mt-6" style={{ color: C.muted }}>No seats in this view.</p>}

      {activeSeat && (
        <SeatModal
          seat={seats.find((s) => s.number === activeSeat.number)}
          lib={lib}
          persist={persist}
          showToast={showToast}
          onClose={() => setActiveSeat(null)}
        />
      )}
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} /> {label}
    </div>
  );
}

/* ---------------------------------- seat modal ---------------------------------- */
function SeatModal({ seat, lib, persist, showToast, onClose }) {
  const [mode, setMode] = useState("view"); // view | book | history
  const [studentQuery, setStudentQuery] = useState("");
  const [pickedStudent, setPickedStudent] = useState(null);
  const [newStudent, setNewStudent] = useState({ name: "", phone: "", address: "", whatsapp: "", email: "", guardianPhone: "" });
  const [addingNew, setAddingNew] = useState(false);
  const [planId, setPlanId] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customDays, setCustomDays] = useState(30);
  const [payment, setPayment] = useState({ method: "cash", txnId: "" });

  const matches = (lib.students || []).filter(
    (st) => st.name.toLowerCase().includes(studentQuery.toLowerCase()) || st.id.includes(studentQuery)
  ).slice(0, 6);

  const history = (lib.history || []).filter((h) => h.seatNumber === seat.number);

  const plan = (lib.settings.plans || []).find((p) => p.id === planId);
  const amount = plan ? plan.amount : customAmount;
  const days = plan ? plan.days : customDays;

  const bookSeat = async () => {
    let student = pickedStudent;
    if (addingNew) {
      if (!newStudent.name || !newStudent.phone) { showToast("Name and phone are required", "err"); return; }
      const exists = (lib.students || []).find((s) => s.id === newStudent.phone);
      if (exists) { showToast("A student with this phone already exists — search for them instead", "err"); return; }
      student = { id: newStudent.phone, ...newStudent, registeredBy: "owner", registeredAt: new Date().toISOString() };
    }
    if (!student) { showToast("Select or add a student", "err"); return; }
    if (!amount || !days) { showToast("Choose a plan or enter amount and duration", "err"); return; }

    const start = todayStr();
    const end = addDays(start, days);
    const students = addingNew ? [...(lib.students || []), student] : lib.students;
    const seats = lib.seats.map((s) =>
      s.number === seat.number
        ? { ...s, status: "occupied", studentId: student.id, studentName: student.name, planName: plan ? plan.name : "Custom", amount: Number(amount), startDate: start, endDate: end }
        : s
    );
    const historyEntry = {
      id: uid("h"), seatNumber: seat.number, studentId: student.id, studentName: student.name,
      planName: plan ? plan.name : "Custom", amount: Number(amount), startDate: start, endDate: end,
      action: "booked", paymentMethod: payment.method, transactionId: payment.txnId || null,
      timestamp: new Date().toISOString(),
    };
    await persist({ ...lib, students, seats, history: [historyEntry, ...(lib.history || [])] });
    showToast(`Seat ${seat.number} booked for ${student.name}`);
    onClose();
  };

  const vacateSeat = async () => {
    const seats = lib.seats.map((s) =>
      s.number === seat.number ? { ...s, status: "vacant", studentId: null, studentName: null, planName: null, amount: null, startDate: null, endDate: null } : s
    );
    const historyEntry = {
      id: uid("h"), seatNumber: seat.number, studentId: seat.studentId, studentName: seat.studentName,
      planName: seat.planName, amount: seat.amount, startDate: seat.startDate, endDate: seat.endDate,
      action: "vacated", timestamp: new Date().toISOString(),
    };
    await persist({ ...lib, seats, history: [historyEntry, ...(lib.history || [])] });
    showToast(`Seat ${seat.number} marked vacant`);
    onClose();
  };

  const remind = () => {
    const tpl = lib.settings.reminderTemplate || DEFAULT_TEMPLATE;
    const text = tpl.replace("{name}", seat.studentName).replace("{seat}", seat.number).replace("{dueDate}", fmt(seat.endDate));
    const phone = (lib.students || []).find((s) => s.id === seat.studentId)?.whatsapp || seat.studentId;
    window.open(waLink(phone, text), "_blank");
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: "rgba(28,43,40,.5)" }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl overflow-hidden" style={{ background: C.paperCard }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.line}` }}>
          <div className="f-display text-lg" style={{ color: C.ink }}>Seat #{seat.number}</div>
          <button onClick={onClose}><X size={18} color={C.muted} /></button>
        </div>

        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
          {mode === "view" && (
            <div>
              {seat.status === "vacant" ? (
                <div className="text-center py-6">
                  <p className="text-sm mb-4" style={{ color: C.muted }}>This seat is vacant.</p>
                  <button className="btn-primary" onClick={() => setMode("book")}>Book this seat</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide" style={{ color: C.muted }}>Student</span>
                    <span className="text-sm font-medium" style={{ color: C.ink }}>{seat.studentName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide" style={{ color: C.muted }}>Phone</span>
                    <a href={`tel:${seat.studentId}`} className="text-sm font-medium flex items-center gap-1" style={{ color: C.occupied }}><Phone size={13} /> {seat.studentId}</a>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide" style={{ color: C.muted }}>Plan</span>
                    <span className="text-sm" style={{ color: C.ink }}>{seat.planName} · ₹{seat.amount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide" style={{ color: C.muted }}>Duration</span>
                    <span className="text-sm" style={{ color: C.ink }}>{fmt(seat.startDate)} → {fmt(seat.endDate)}</span>
                  </div>
                  {seat.status === "due" && (
                    <div className="rounded-lg p-3 flex items-center justify-between" style={{ background: C.dueSoft }}>
                      <span className="text-xs font-medium" style={{ color: C.due }}>Overdue — grace period active</span>
                      <button onClick={remind} className="text-xs font-medium flex items-center gap-1 px-2.5 py-1.5 rounded-md" style={{ background: C.due, color: "#fff" }}>
                        <MessageCircle size={13} /> Remind
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <button onClick={vacateSeat} className="btn-secondary flex-1">Mark vacant</button>
                    <button onClick={() => setMode("history")} className="btn-secondary flex-1">History</button>
                  </div>
                </div>
              )}
              {seat.status === "vacant" && history.length > 0 && (
                <button onClick={() => setMode("history")} className="text-xs font-medium mt-2" style={{ color: C.brass }}>View past history →</button>
              )}
            </div>
          )}

          {mode === "book" && (
            <div className="space-y-4">
              <div>
                <span className="text-xs font-medium block mb-1.5" style={{ color: C.muted }}>Student</span>
                {!addingNew ? (
                  <div>
                    <div className="relative mb-2">
                      <Search size={14} className="absolute left-2.5 top-2.5" color={C.muted} />
                      <input className="input pl-8" placeholder="Search by name or phone" value={studentQuery} onChange={(e) => { setStudentQuery(e.target.value); setPickedStudent(null); }} />
                    </div>
                    {studentQuery && !pickedStudent && (
                      <div className="border rounded-lg overflow-hidden" style={{ borderColor: C.line }}>
                        {matches.map((s) => (
                          <button key={s.id} onClick={() => { setPickedStudent(s); setStudentQuery(`${s.name} (${s.id})`); }} className="w-full text-left px-3 py-2 text-sm hover:bg-black/5" style={{ color: C.ink }}>
                            {s.name} · {s.id}
                          </button>
                        ))}
                        {matches.length === 0 && <div className="px-3 py-2 text-sm" style={{ color: C.muted }}>No matches</div>}
                      </div>
                    )}
                    <button onClick={() => setAddingNew(true)} className="text-xs font-medium mt-2 flex items-center gap-1" style={{ color: C.brass }}>
                      <Plus size={13} /> Register a new student instead
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input className="input" placeholder="Full name *" value={newStudent.name} onChange={(e) => setNewStudent((f) => ({ ...f, name: e.target.value }))} />
                    <input className="input" placeholder="Phone (used as ID) *" value={newStudent.phone} onChange={(e) => setNewStudent((f) => ({ ...f, phone: e.target.value }))} />
                    <input className="input" placeholder="WhatsApp number" value={newStudent.whatsapp} onChange={(e) => setNewStudent((f) => ({ ...f, whatsapp: e.target.value }))} />
                    <input className="input" placeholder="Address (as per ID)" value={newStudent.address} onChange={(e) => setNewStudent((f) => ({ ...f, address: e.target.value }))} />
                    <input className="input" placeholder="Guardian number" value={newStudent.guardianPhone} onChange={(e) => setNewStudent((f) => ({ ...f, guardianPhone: e.target.value }))} />
                    <button onClick={() => setAddingNew(false)} className="text-xs font-medium" style={{ color: C.muted }}>← Search existing instead</button>
                  </div>
                )}
              </div>

              <div>
                <span className="text-xs font-medium block mb-1.5" style={{ color: C.muted }}>Plan</span>
                <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">Custom amount / duration</option>
                  {(lib.settings.plans || []).map((p) => <option key={p.id} value={p.id}>{p.name} · ₹{p.amount} / {p.days}d</option>)}
                </select>
                {!plan && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input type="number" className="input" placeholder="Amount ₹" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} />
                    <input type="number" className="input" placeholder="Duration (days)" value={customDays} onChange={(e) => setCustomDays(e.target.value)} />
                  </div>
                )}
              </div>

              <div>
                <span className="text-xs font-medium block mb-1.5" style={{ color: C.muted }}>Payment</span>
                <div className="flex gap-2 mb-2">
                  <button onClick={() => setPayment((p) => ({ ...p, method: "cash" }))} className="flex-1 py-2 rounded-md text-xs font-medium" style={payment.method === "cash" ? { background: C.ink, color: "#fff" } : { background: "#EDEEEA", color: C.muted }}>Cash</button>
                  <button onClick={() => setPayment((p) => ({ ...p, method: "screenshot" }))} className="flex-1 py-2 rounded-md text-xs font-medium" style={payment.method === "screenshot" ? { background: C.ink, color: "#fff" } : { background: "#EDEEEA", color: C.muted }}>Screenshot / UPI</button>
                </div>
                {payment.method === "screenshot" && (
                  <input className="input" placeholder="Transaction ID" value={payment.txnId} onChange={(e) => setPayment((p) => ({ ...p, txnId: e.target.value }))} />
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setMode("view")} className="btn-secondary flex-1">Back</button>
                <button onClick={bookSeat} className="btn-primary flex-1">Confirm booking</button>
              </div>
            </div>
          )}

          {mode === "history" && (
            <div>
              {history.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: C.muted }}>No history for this seat yet.</p>
              ) : (
                <div className="space-y-2">
                  {history.map((h) => (
                    <div key={h.id} className="rounded-lg p-3 text-sm" style={{ background: C.paper }}>
                      <div className="flex justify-between">
                        <span className="font-medium" style={{ color: C.ink }}>{h.studentName || "—"}</span>
                        <span className="text-xs f-mono capitalize" style={{ color: C.muted }}>{h.action.replace("-", " ")}</span>
                      </div>
                      <div className="text-xs mt-1" style={{ color: C.muted }}>
                        {h.planName ? `${h.planName} · ₹${h.amount} · ` : ""}{fmt(h.startDate)} → {fmt(h.endDate)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setMode("view")} className="btn-secondary w-full mt-3">Back</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- students tab ---------------------------------- */
function StudentsTab({ lib, persist, showToast }) {
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "", whatsapp: "", email: "", guardianPhone: "" });

  const students = (lib.students || []).filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) || s.id.includes(q));

  const addStudent = async () => {
    if (!form.name || !form.phone) { showToast("Name and phone are required", "err"); return; }
    if ((lib.students || []).some((s) => s.id === form.phone)) { showToast("Student with this phone already exists", "err"); return; }
    const student = { id: form.phone, ...form, registeredBy: "owner", registeredAt: new Date().toISOString() };
    await persist({ ...lib, students: [...(lib.students || []), student] });
    showToast("Student registered");
    setForm({ name: "", phone: "", address: "", whatsapp: "", email: "", guardianPhone: "" });
    setShowAdd(false);
  };

  const exportExcel = () => {
    const seatByStudent = {};
    (lib.history || []).forEach((h) => {
      if (!h.studentId) return;
      seatByStudent[h.studentId] = seatByStudent[h.studentId] || [];
      seatByStudent[h.studentId].push(h);
    });
    const rows = (lib.students || []).map((s) => {
      const h = seatByStudent[s.id] || [];
      const totalPaid = h.filter((x) => x.action === "booked").reduce((a, b) => a + (b.amount || 0), 0);
      const currentSeat = (lib.seats || []).find((seat) => seat.studentId === s.id);
      return {
        Name: s.name, Phone: s.id, Address: s.address, WhatsApp: s.whatsapp, Email: s.email,
        Guardian: s.guardianPhone, "Registered By": s.registeredBy, "Registered On": s.registeredAt?.slice(0, 10),
        "Current Seat": currentSeat ? currentSeat.number : "—", "Bookings (count)": h.filter((x) => x.action === "booked").length,
        "Total Paid (₹)": totalPaid,
      };
    });
    const historyRows = (lib.history || []).map((h) => ({
      Seat: h.seatNumber, Student: h.studentName, Phone: h.studentId, Plan: h.planName, "Amount (₹)": h.amount,
      From: h.startDate, To: h.endDate, Action: h.action, Payment: h.paymentMethod, "Txn ID": h.transactionId,
      When: h.timestamp?.slice(0, 19).replace("T", " "),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Students");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(historyRows), "Booking History");
    XLSX.writeFile(wb, `${lib.profile.libraryName.replace(/\s+/g, "_")}_students.xlsx`);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="f-display text-2xl" style={{ color: C.ink }}>Students</h1>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={14} /> Export Excel</button>
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1.5 text-xs"><Plus size={14} /> Add student</button>
        </div>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search size={14} className="absolute left-2.5 top-2.5" color={C.muted} />
        <input className="input pl-8" placeholder="Search students…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: C.paper }}>
              {["Name", "Phone", "Seat", "Registered by", ""].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-medium" style={{ color: C.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const seat = (lib.seats || []).find((seat) => seat.studentId === s.id);
              return (
                <tr key={s.id} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: C.ink }}>{s.name}</td>
                  <td className="px-4 py-2.5 f-mono text-xs" style={{ color: C.muted }}>{s.id}</td>
                  <td className="px-4 py-2.5">{seat ? <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: C.occupiedSoft, color: C.occupied }}>#{seat.number}</span> : <span style={{ color: C.muted }}>—</span>}</td>
                  <td className="px-4 py-2.5 text-xs capitalize" style={{ color: C.muted }}>{s.registeredBy}</td>
                  <td className="px-4 py-2.5 text-right"><a href={`tel:${s.id}`}><Phone size={14} color={C.occupied} /></a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {students.length === 0 && <p className="text-sm text-center py-8" style={{ color: C.muted }}>No students yet.</p>}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: "rgba(28,43,40,.5)" }} onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-md rounded-xl p-5" style={{ background: C.paperCard }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="f-display text-lg" style={{ color: C.ink }}>Register student</div>
              <button onClick={() => setShowAdd(false)}><X size={18} color={C.muted} /></button>
            </div>
            <div className="space-y-2">
              <input className="input" placeholder="Full name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <input className="input" placeholder="Phone — used as unique ID *" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              <input className="input" placeholder="WhatsApp number" value={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))} />
              <input className="input" placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              <input className="input" placeholder="Address as per ID proof" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              <input className="input" placeholder="Guardian number" value={form.guardianPhone} onChange={(e) => setForm((f) => ({ ...f, guardianPhone: e.target.value }))} />
            </div>
            <button onClick={addStudent} className="btn-primary w-full mt-4">Save student</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- settings tab ---------------------------------- */
function SettingsTab({ lib, persist, showToast }) {
  const [profile, setProfile] = useState(lib.profile);
  const [grace, setGrace] = useState(lib.settings.gracePeriodDays);
  const [tpl, setTpl] = useState(lib.settings.reminderTemplate);
  const [plans, setPlans] = useState(lib.settings.plans || []);
  const [newPlan, setNewPlan] = useState({ name: "", amount: "", days: "" });
  const [payInfo, setPayInfo] = useState(lib.settings.paymentInfo || { upiId: "", qrImage: "" });
  const [uploading, setUploading] = useState(false);

  const savePayment = async () => {
    await persist({ ...lib, settings: { ...lib.settings, paymentInfo: payInfo } });
    showToast("Payment details saved — students will see this at checkout");
  };
  const handleQrFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file, 420, 0.8);
      setPayInfo((p) => ({ ...p, qrImage: dataUrl }));
    } catch {
      showToast("Couldn't read that image", "err");
    }
    setUploading(false);
  };

  const saveProfile = async () => { await persist({ ...lib, profile }); showToast("Profile updated"); };
  const saveReminder = async () => { await persist({ ...lib, settings: { ...lib.settings, gracePeriodDays: Number(grace), reminderTemplate: tpl } }); showToast("Reminder settings saved"); };

  const addPlan = async () => {
    if (!newPlan.name || !newPlan.amount || !newPlan.days) { showToast("Fill all plan fields", "err"); return; }
    const p = { id: uid("plan_"), name: newPlan.name, amount: Number(newPlan.amount), days: Number(newPlan.days) };
    const updated = [...plans, p];
    setPlans(updated);
    await persist({ ...lib, settings: { ...lib.settings, plans: updated } });
    setNewPlan({ name: "", amount: "", days: "" });
    showToast("Plan added");
  };
  const removePlan = async (id) => {
    const updated = plans.filter((p) => p.id !== id);
    setPlans(updated);
    await persist({ ...lib, settings: { ...lib.settings, plans: updated } });
  };

  const remindAll = () => {
    const due = (lib.seats || []).filter((s) => s.status === "due");
    if (due.length === 0) { showToast("No due seats right now"); return; }
    due.forEach((s, i) => {
      const student = (lib.students || []).find((st) => st.id === s.studentId);
      const phone = student?.whatsapp || s.studentId;
      const text = tpl.replace("{name}", s.studentName).replace("{seat}", s.number).replace("{dueDate}", fmt(s.endDate));
      setTimeout(() => window.open(waLink(phone, text), "_blank"), i * 400);
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="f-display text-2xl" style={{ color: C.ink }}>Settings</h1>

      <Section title="Library profile">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Library name"><input className="input" value={profile.libraryName} onChange={(e) => setProfile((p) => ({ ...p, libraryName: e.target.value }))} /></Field>
          <Field label="Owner name"><input className="input" value={profile.ownerName} onChange={(e) => setProfile((p) => ({ ...p, ownerName: e.target.value }))} /></Field>
          <Field label="Contact phone"><input className="input" value={profile.contactPhone} onChange={(e) => setProfile((p) => ({ ...p, contactPhone: e.target.value }))} /></Field>
          <Field label="Email"><input className="input" value={profile.email} disabled /></Field>
          <div className="sm:col-span-2"><Field label="Address"><input className="input" value={profile.address} onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))} /></Field></div>
        </div>
        <button onClick={saveProfile} className="btn-primary mt-3 text-xs">Save profile</button>
      </Section>

      <Section title="Subscription">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm" style={{ color: C.muted }}>Status</span>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full capitalize" style={
            lib.profile.subscriptionStatus === "approved" ? { background: C.vacantSoft, color: C.vacant }
            : lib.profile.subscriptionStatus === "rejected" ? { background: C.dueSoft, color: C.due }
            : { background: C.brassSoft, color: C.brass }
          }>{(lib.profile.subscriptionStatus || "pending_approval").replace("_", " ")}</span>
        </div>
        {lib.profile.subscriptionPlanName && (
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm" style={{ color: C.muted }}>Plan</span>
            <span className="text-sm" style={{ color: C.ink }}>{lib.profile.subscriptionPlanName} · ₹{lib.profile.subscriptionAmount}</span>
          </div>
        )}
        {lib.profile.subscriptionExpiresAt && (
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: C.muted }}>Renews / expires</span>
            <span className="text-sm" style={{ color: C.ink }}>{fmt(lib.profile.subscriptionExpiresAt)}</span>
          </div>
        )}
      </Section>

      <Section title="Payment details">
        <p className="text-xs mb-3" style={{ color: C.muted }}>Shown to students on the payment step when they book a seat.</p>
        <Field label="UPI ID">
          <input className="input" placeholder="yourlibrary@upi" value={payInfo.upiId} onChange={(e) => setPayInfo((p) => ({ ...p, upiId: e.target.value }))} />
        </Field>
        <div className="mt-3">
          <span className="text-xs font-medium block mb-1.5" style={{ color: C.muted }}>QR code image</span>
          <div className="flex items-center gap-3">
            {payInfo.qrImage ? (
              <img src={payInfo.qrImage} alt="Payment QR" className="w-20 h-20 rounded-lg object-cover" style={{ border: `1px solid ${C.line}` }} />
            ) : (
              <div className="w-20 h-20 rounded-lg flex items-center justify-center" style={{ background: C.paper }}>
                <ImageIcon size={18} color={C.muted} />
              </div>
            )}
            <label className="btn-secondary text-xs flex items-center gap-1.5 cursor-pointer">
              <Upload size={13} /> {uploading ? "Uploading…" : "Upload QR"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleQrFile(e.target.files?.[0])} />
            </label>
          </div>
        </div>
        <button onClick={savePayment} className="btn-primary mt-3 text-xs">Save payment details</button>
      </Section>

      <Section title="Price plans">
        <div className="space-y-2 mb-3">
          {plans.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: C.paper }}>
              <span className="text-sm" style={{ color: C.ink }}>{p.name} · ₹{p.amount} / {p.days} days</span>
              <button onClick={() => removePlan(p.id)}><Trash2 size={14} color={C.due} /></button>
            </div>
          ))}
          {plans.length === 0 && <p className="text-sm" style={{ color: C.muted }}>No plans yet — students and owners will use custom amounts until you add one.</p>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input className="input" placeholder="Plan name" value={newPlan.name} onChange={(e) => setNewPlan((p) => ({ ...p, name: e.target.value }))} />
          <input type="number" className="input" placeholder="₹ Amount" value={newPlan.amount} onChange={(e) => setNewPlan((p) => ({ ...p, amount: e.target.value }))} />
          <input type="number" className="input" placeholder="Days" value={newPlan.days} onChange={(e) => setNewPlan((p) => ({ ...p, days: e.target.value }))} />
        </div>
        <button onClick={addPlan} className="btn-secondary mt-2 text-xs flex items-center gap-1"><Plus size={13} /> Add plan</button>
      </Section>

      <Section title="Reminders & grace period">
        <Field label="Grace period (days before auto-vacate)">
          <input type="number" className="input max-w-[120px]" value={grace} onChange={(e) => setGrace(e.target.value)} />
        </Field>
        <Field label="Reminder message template">
          <textarea className="input" rows={3} value={tpl} onChange={(e) => setTpl(e.target.value)} />
        </Field>
        <p className="text-xs mb-2" style={{ color: C.muted }}>Use {"{name}"}, {"{seat}"}, {"{dueDate}"} as placeholders.</p>
        <div className="flex gap-2">
          <button onClick={saveReminder} className="btn-primary text-xs">Save reminder settings</button>
          <button onClick={remindAll} className="btn-secondary text-xs flex items-center gap-1"><MessageCircle size={13} /> Remind all due seats</button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl p-5" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
      <h2 className="f-display text-base mb-3" style={{ color: C.ink }}>{title}</h2>
      {children}
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
