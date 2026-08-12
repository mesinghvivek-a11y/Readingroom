import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  BookOpen, LayoutGrid, Building2, ClipboardList, LogOut, Plus, Trash2,
  Check, X, MessageCircle, CheckCircle2, AlertTriangle, MapPin, Phone
} from "lucide-react";

/* ---------------------------------- theme (matches other portals) ---------------------------------- */
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

// Keeps the student/owner-facing directory in sync after admin actions
async function syncPublicAfterAdminChange(ownerId, library) {
  const pub = {
    id: ownerId,
    libraryName: library.profile.libraryName,
    address: library.profile.address,
    contactPhone: library.profile.contactPhone,
    subscriptionStatus: library.profile.subscriptionStatus,
    seats: (library.seats || []).map((s) => ({ number: s.number, status: s.status })),
    plans: library.settings?.plans || [],
    paymentInfo: library.settings?.paymentInfo || {},
  };
  await setShared(`public:${ownerId}`, pub);
}

const DEFAULT_ADMIN_REMINDER = "Hi {owner}, your Readingroom subscription for {library} is due on {expiry}. Please renew to keep the system active.";

/* ---------------------------------- root ---------------------------------- */
export default function AdminPortal() {
  const [booting, setBooting] = useState(true);
  const [adminExists, setAdminExists] = useState(null);
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("overview");
  const [toast, setToast] = useState(null);

  const showToast = (msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    (async () => {
      const admin = await getShared("admin_account", null);
      setAdminExists(!!admin);
      const last = await getPersonal("last_admin_session", null);
      if (last && admin && last.email === admin.email) setSession(last);
      setBooting(false);
    })();
  }, []);

  const logout = async () => {
    setSession(null);
    await setPersonal("last_admin_session", null);
  };

  if (booting) {
    return (
      <div className="f-body min-h-screen flex items-center justify-center" style={{ background: C.paper }}>
        {FONTS}
        <div style={{ color: C.muted }}>Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ background: C.paper }} className="min-h-screen f-body">
        {FONTS}
        <AdminAuth
          adminExists={adminExists}
          setAdminExists={setAdminExists}
          onLogin={async (s) => { setSession(s); await setPersonal("last_admin_session", s); }}
          showToast={showToast}
        />
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  return (
    <div style={{ background: C.paper, minHeight: "100vh" }} className="f-body">
      {FONTS}
      <style>{styleSheet}</style>
      <Shell session={session} tab={tab} setTab={setTab} onLogout={logout} showToast={showToast} />
      {toast && <Toast toast={toast} />}
    </div>
  );
}

function Toast({ toast }) {
  const good = toast.kind === "ok";
  return (
    <div className="fixed bottom-5 right-5 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50 text-sm" style={{ background: good ? C.ink : C.due, color: "#fff" }}>
      {good ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      {toast.msg}
    </div>
  );
}

/* ---------------------------------- admin auth (single seeded account) ---------------------------------- */
function AdminAuth({ adminExists, setAdminExists, onLogin, showToast }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  const setup = async () => {
    if (!form.name || !form.email || !form.password) { showToast("Fill all fields", "err"); return; }
    setBusy(true);
    const account = { name: form.name, email: form.email, password: form.password, createdAt: new Date().toISOString() };
    await setShared("admin_account", account);
    setAdminExists(true);
    setBusy(false);
    onLogin({ email: account.email, name: account.name });
  };

  const login = async () => {
    if (!form.email || !form.password) { showToast("Enter email and password", "err"); return; }
    setBusy(true);
    const admin = await getShared("admin_account", null);
    if (!admin || admin.email !== form.email || admin.password !== form.password) {
      showToast("Invalid credentials", "err");
      setBusy(false);
      return;
    }
    setBusy(false);
    onLogin({ email: admin.email, name: admin.name });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-9 h-9 rounded-md flex items-center justify-center" style={{ background: C.ink }}>
            <BookOpen size={18} color={C.brass} />
          </div>
          <span className="f-display text-2xl" style={{ color: C.ink }}>Readingroom Admin</span>
        </div>

        <div className="rounded-xl p-7 shadow-sm" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
          {adminExists === false ? (
            <div className="space-y-3">
              <p className="text-xs mb-2" style={{ color: C.muted }}>No admin account exists yet — set one up now (one-time).</p>
              <input className="input" placeholder="Your name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <input className="input" placeholder="Admin email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              <input type="password" className="input" placeholder="Password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
              <button disabled={busy} onClick={setup} className="btn-primary w-full mt-2">{busy ? "Please wait…" : "Create admin account"}</button>
            </div>
          ) : (
            <div className="space-y-3">
              <input className="input" placeholder="Admin email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              <input type="password" className="input" placeholder="Password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
              <button disabled={busy} onClick={login} className="btn-primary w-full mt-2">{busy ? "Please wait…" : "Log in"}</button>
            </div>
          )}
        </div>
      </div>
      <style>{styleSheet}</style>
    </div>
  );
}

/* ---------------------------------- shell ---------------------------------- */
function Shell({ session, tab, setTab, onLogout, showToast }) {
  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "libraries", label: "Libraries", icon: Building2 },
    { id: "plans", label: "Subscription plans", icon: ClipboardList },
  ];
  return (
    <div className="flex min-h-screen">
      <div className="w-60 shrink-0 hidden md:flex flex-col" style={{ background: C.ink }}>
        <div className="flex items-center gap-2 px-5 py-5">
          <BookOpen size={18} color={C.brass} />
          <span className="f-display text-lg text-white">Readingroom</span>
        </div>
        <div className="px-5 pb-3 text-xs" style={{ color: "#B8C0BC" }}>{session.name} · Admin</div>
        <nav className="flex-1 px-3 space-y-1 mt-2">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm" style={tab === t.id ? { background: C.inkSoft, color: "#fff" } : { color: "#B8C0BC" }}>
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </nav>
        <button onClick={onLogout} className="flex items-center gap-3 px-3 py-2.5 mx-3 mb-5 rounded-lg text-sm" style={{ color: "#B8C0BC" }}>
          <LogOut size={16} /> Log out
        </button>
      </div>

      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3" style={{ background: C.ink }}>
        <span className="f-display text-white text-sm">Readingroom Admin</span>
        <button onClick={onLogout}><LogOut size={16} color="#B8C0BC" /></button>
      </div>
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex justify-around py-2" style={{ background: C.ink, borderTop: `1px solid ${C.inkSoft}` }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="flex flex-col items-center gap-0.5 px-3 py-1" style={{ color: tab === t.id ? "#fff" : "#8A928E" }}>
            <t.icon size={17} /><span className="text-[10px]">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 pt-14 md:pt-0 pb-16 md:pb-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-8">
          {tab === "overview" && <Overview setTab={setTab} />}
          {tab === "libraries" && <Libraries showToast={showToast} />}
          {tab === "plans" && <Plans showToast={showToast} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- overview ---------------------------------- */
function Overview({ setTab }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      const idx = await getShared("public_libraries_index", []);
      let pending = 0, active = 0, totalSeats = 0;
      for (const l of idx) {
        const lib = await getShared(`library:${l.id}`, null);
        if (!lib) continue;
        totalSeats += (lib.seats || []).length;
        if (lib.profile.subscriptionStatus === "approved") active++;
        else if (lib.profile.subscriptionStatus === "pending_approval") pending++;
      }
      setStats({ total: idx.length, pending, active, totalSeats });
    })();
  }, []);

  if (!stats) return <p className="text-sm" style={{ color: C.muted }}>Loading…</p>;

  return (
    <div>
      <h1 className="f-display text-2xl mb-1" style={{ color: C.ink }}>Overview</h1>
      <p className="text-sm mb-6" style={{ color: C.muted }}>{fmt(todayStr())}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total libraries" value={stats.total} color={C.ink} bg="#EDEEEA" onClick={() => setTab("libraries")} />
        <StatCard label="Pending approval" value={stats.pending} color={C.brass} bg={C.brassSoft} onClick={() => setTab("libraries")} />
        <StatCard label="Active subscriptions" value={stats.active} color={C.vacant} bg={C.vacantSoft} onClick={() => setTab("libraries")} />
        <StatCard label="Seats under management" value={stats.totalSeats} color={C.ink} bg="#EDEEEA" onClick={() => setTab("libraries")} />
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

/* ---------------------------------- libraries ---------------------------------- */
function Libraries({ showToast }) {
  const [libs, setLibs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending_approval");
  const [preview, setPreview] = useState(null);
  const [reminderTpl, setReminderTpl] = useState(DEFAULT_ADMIN_REMINDER);

  const load = useCallback(async () => {
    setLoading(true);
    const idx = await getShared("public_libraries_index", []);
    const full = [];
    for (const l of idx) {
      const lib = await getShared(`library:${l.id}`, null);
      if (lib) full.push({ ownerId: l.id, lib });
    }
    setLibs(full);
    const rt = await getShared("admin_reminder_template", DEFAULT_ADMIN_REMINDER);
    setReminderTpl(rt);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (ownerId, lib) => {
    const days = lib.profile.subscriptionDays || 30;
    const nextLib = {
      ...lib,
      profile: { ...lib.profile, subscriptionStatus: "approved", subscriptionApprovedAt: new Date().toISOString(), subscriptionExpiresAt: addDays(todayStr(), days) },
    };
    await setShared(`library:${ownerId}`, nextLib);
    await syncPublicAfterAdminChange(ownerId, nextLib);
    showToast(`${lib.profile.libraryName} approved`);
    load();
  };
  const reject = async (ownerId, lib) => {
    const nextLib = { ...lib, profile: { ...lib.profile, subscriptionStatus: "rejected" } };
    await setShared(`library:${ownerId}`, nextLib);
    await syncPublicAfterAdminChange(ownerId, nextLib);
    showToast(`${lib.profile.libraryName} rejected`);
    load();
  };
  const remind = (lib) => {
    const text = reminderTpl
      .replace("{owner}", lib.profile.ownerName || "")
      .replace("{library}", lib.profile.libraryName || "")
      .replace("{expiry}", fmt(lib.profile.subscriptionExpiresAt));
    window.open(waLink(lib.profile.contactPhone, text), "_blank");
  };

  const filtered = libs.filter(({ lib }) => {
    if (filter === "expiring") {
      if (lib.profile.subscriptionStatus !== "approved" || !lib.profile.subscriptionExpiresAt) return false;
      const d = daysBetween(todayStr(), lib.profile.subscriptionExpiresAt);
      return d <= 7;
    }
    return (lib.profile.subscriptionStatus || "pending_approval") === filter;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="f-display text-2xl" style={{ color: C.ink }}>Libraries</h1>
        <div className="flex gap-1 p-1 rounded-lg flex-wrap" style={{ background: "#EDEEEA" }}>
          {[
            { id: "pending_approval", label: "Pending" },
            { id: "approved", label: "Active" },
            { id: "expiring", label: "Renewal due" },
            { id: "rejected", label: "Rejected" },
          ].map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className="px-3 py-1.5 rounded-md text-xs font-medium" style={filter === f.id ? { background: C.ink, color: "#fff" } : { color: C.muted }}>{f.label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: C.muted }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm" style={{ color: C.muted }}>Nothing here.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(({ ownerId, lib }) => (
            <div key={ownerId} className="rounded-xl p-4" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {lib.profile.subscriptionScreenshot ? (
                    <img src={lib.profile.subscriptionScreenshot} onClick={() => setPreview(lib.profile.subscriptionScreenshot)} className="w-12 h-12 rounded-lg object-cover cursor-pointer" style={{ border: `1px solid ${C.line}` }} />
                  ) : (
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: C.paper }}><Building2 size={16} color={C.muted} /></div>
                  )}
                  <div>
                    <div className="f-display text-base" style={{ color: C.ink }}>{lib.profile.libraryName}</div>
                    <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                      {lib.profile.ownerName} · {(lib.seats || []).length} seats
                      {lib.profile.subscriptionPlanName ? ` · ${lib.profile.subscriptionPlanName} (₹${lib.profile.subscriptionAmount})` : " · no plan chosen"}
                    </div>
                    {lib.profile.address && <div className="text-xs flex items-center gap-1 mt-0.5" style={{ color: C.muted }}><MapPin size={11} /> {lib.profile.address}</div>}
                    {lib.profile.subscriptionExpiresAt && <div className="text-xs mt-0.5" style={{ color: C.muted }}>Expires {fmt(lib.profile.subscriptionExpiresAt)}</div>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {filter === "pending_approval" && (
                    <>
                      <button onClick={() => reject(ownerId, lib)} className="btn-secondary text-xs px-3">Reject</button>
                      <button onClick={() => approve(ownerId, lib)} className="btn-primary text-xs px-3 flex items-center gap-1"><Check size={13} /> Approve</button>
                    </>
                  )}
                  {(filter === "expiring" || filter === "approved") && (
                    <button onClick={() => remind(lib)} className="btn-secondary text-xs px-3 flex items-center gap-1"><MessageCircle size={13} /> Remind</button>
                  )}
                  {filter === "rejected" && (
                    <button onClick={() => approve(ownerId, lib)} className="btn-secondary text-xs px-3">Reconsider</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.7)" }} onClick={() => setPreview(null)}>
          <img src={preview} className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- plans ---------------------------------- */
function Plans({ showToast }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", seatsMin: "", seatsMax: "", amount: "", days: 30 });
  const [tpl, setTpl] = useState(DEFAULT_ADMIN_REMINDER);

  const load = useCallback(async () => {
    setPlans(await getShared("admin_subscription_plans", []));
    setTpl(await getShared("admin_reminder_template", DEFAULT_ADMIN_REMINDER));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const addPlan = async () => {
    if (!form.name || !form.seatsMin || !form.seatsMax || !form.amount) { showToast("Fill all fields", "err"); return; }
    const p = { id: uid("subplan_"), name: form.name, seatsMin: Number(form.seatsMin), seatsMax: Number(form.seatsMax), amount: Number(form.amount), days: Number(form.days) || 30 };
    const updated = [...plans, p];
    setPlans(updated);
    await setShared("admin_subscription_plans", updated);
    setForm({ name: "", seatsMin: "", seatsMax: "", amount: "", days: 30 });
    showToast("Plan added");
  };
  const removePlan = async (id) => {
    const updated = plans.filter((p) => p.id !== id);
    setPlans(updated);
    await setShared("admin_subscription_plans", updated);
  };
  const saveTpl = async () => {
    await setShared("admin_reminder_template", tpl);
    showToast("Reminder template saved");
  };

  if (loading) return <p className="text-sm" style={{ color: C.muted }}>Loading…</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="f-display text-2xl" style={{ color: C.ink }}>Subscription plans</h1>

      <div className="rounded-xl p-5" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
        <h2 className="f-display text-base mb-3" style={{ color: C.ink }}>Plans by seat count</h2>
        <div className="space-y-2 mb-4">
          {plans.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: C.paper }}>
              <span className="text-sm" style={{ color: C.ink }}>{p.name} · {p.seatsMin}–{p.seatsMax} seats · ₹{p.amount} / {p.days}d</span>
              <button onClick={() => removePlan(p.id)}><Trash2 size={14} color={C.due} /></button>
            </div>
          ))}
          {plans.length === 0 && <p className="text-sm" style={{ color: C.muted }}>No plans yet — owners can't select one at registration until you add plans here.</p>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <input className="input" placeholder="Plan name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <input type="number" className="input" placeholder="Min seats" value={form.seatsMin} onChange={(e) => setForm((f) => ({ ...f, seatsMin: e.target.value }))} />
          <input type="number" className="input" placeholder="Max seats" value={form.seatsMax} onChange={(e) => setForm((f) => ({ ...f, seatsMax: e.target.value }))} />
          <input type="number" className="input" placeholder="₹ Amount" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          <input type="number" className="input" placeholder="Days" value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />
        </div>
        <button onClick={addPlan} className="btn-secondary mt-2 text-xs flex items-center gap-1"><Plus size={13} /> Add plan</button>
      </div>

      <div className="rounded-xl p-5" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
        <h2 className="f-display text-base mb-3" style={{ color: C.ink }}>Renewal reminder template</h2>
        <textarea className="input" rows={3} value={tpl} onChange={(e) => setTpl(e.target.value)} />
        <p className="text-xs mt-1.5 mb-2" style={{ color: C.muted }}>Use {"{owner}"}, {"{library}"}, {"{expiry}"} as placeholders.</p>
        <button onClick={saveTpl} className="btn-primary text-xs">Save template</button>
      </div>
    </div>
  );
}

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
