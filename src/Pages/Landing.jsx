import React from "react";
import { Link } from "react-router-dom";
import { BookOpen, Building2, Users, ShieldCheck } from "lucide-react";

const C = { ink: "#1C2B28", paper: "#F4F5F1", paperCard: "#FFFFFF", line: "#E1E1D8", brass: "#B8823D", muted: "#6B7370" };

export default function Landing() {
  const cards = [
    { to: "/owner", icon: Building2, title: "Library Owner", desc: "Manage seats, students, dues and bookings." },
    { to: "/student", icon: Users, title: "Student", desc: "Browse libraries, book a seat, track your bookings." },
    { to: "/admin", icon: ShieldCheck, title: "Admin", desc: "Approve library subscriptions and manage plans." },
  ];
  return (
    <div className="min-h-screen f-body flex items-center justify-center px-4" style={{ background: C.paper }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600&display=swap'); .f-display{font-family:'Fraunces',serif;} .f-body{font-family:'Inter',sans-serif;}`}</style>
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-9 h-9 rounded-md flex items-center justify-center" style={{ background: C.ink }}>
            <BookOpen size={18} color={C.brass} />
          </div>
          <span className="f-display text-2xl" style={{ color: C.ink }}>Readingroom</span>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {cards.map((c) => (
            <Link key={c.to} to={c.to} className="rounded-xl p-5 text-center transition hover:opacity-90" style={{ background: C.paperCard, border: `1px solid ${C.line}` }}>
              <c.icon size={22} color={C.brass} className="mx-auto mb-3" />
              <div className="f-display text-lg" style={{ color: C.ink }}>{c.title}</div>
              <div className="text-xs mt-1" style={{ color: C.muted }}>{c.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
