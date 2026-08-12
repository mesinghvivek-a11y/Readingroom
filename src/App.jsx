import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import OwnerPortal from "./pages/OwnerPortal";
import StudentPortal from "./pages/StudentPortal";
import AdminPortal from "./pages/AdminPortal";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/owner/*" element={<OwnerPortal />} />
        <Route path="/student/*" element={<StudentPortal />} />
        <Route path="/admin/*" element={<AdminPortal />} />
      </Routes>
    </BrowserRouter>
  );
}
