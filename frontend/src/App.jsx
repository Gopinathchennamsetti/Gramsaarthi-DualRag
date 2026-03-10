import { useState, useEffect, useCallback, useRef } from "react";

// ── Config ────────────────────────────────────────────────────────────────────
// In local dev, prefer same-origin so Vite's `/api` proxy forwards to the backend.
// In production builds, keep the historical remote default unless overridden.
const DEFAULT_REMOTE_API = "http://3.235.76.236";
const envApiBase = import.meta.env.VITE_API_BASE_URL;
const API = ((envApiBase !== undefined ? envApiBase : (import.meta.env.DEV ? "" : DEFAULT_REMOTE_API)) || "")
  .replace(/\/$/, "");


// ── Utilities ─────────────────────────────────────────────────────────────────
const api = async (path, opts = {}) => {
  const token = sessionStorage.getItem("dash_token");
  const headers = {
    ...(opts.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

const fmtTime = (ts) =>
  ts ? new Date(ts * 1000).toLocaleString() : "–";

// ── Icons (inline SVG) ────────────────────────────────────────────────────────
const Icon = {
  Search: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{width:18,height:18}}>
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
  ),
  Upload: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{width:18,height:18}}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  File: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{width:18,height:18}}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  Database: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Refresh: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  ),
  Warning: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{width:18,height:18}}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14}}>
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  Index: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  ),
  Download: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
};

// ── CSS-in-JS styles ──────────────────────────────────────────────────────────
const S = {
  // Layout
  app: {
    minHeight: "100vh",
    background: "linear-gradient(145deg, #ecf7ff, #f8f2e8)",
    color: "#1a2333",
    fontFamily: "'Segoe UI', 'Trebuchet MS', 'Helvetica Neue', sans-serif",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    overflow: "hidden",
  },
  bgOrb: {
    position: "absolute",
    borderRadius: 999,
    opacity: 0.5,
    filter: "blur(1px)",
    animation: "drift 8s ease-in-out infinite",
    zIndex: 0,
    pointerEvents: "none",
  },
  orb1: {
    width: 280,
    height: 280,
    top: -40,
    left: -20,
    background: "radial-gradient(circle, #ffd89f 0%, #f4b860 70%, #f4b86000 100%)",
  },
  orb2: {
    width: 320,
    height: 320,
    right: -70,
    bottom: -70,
    background: "radial-gradient(circle, #93e8de 0%, #55c9ba 68%, #55c9ba00 100%)",
    animationDelay: "1s",
  },
  // Header
  header: {
    borderBottom: "1px solid #c7dcd7",
    padding: "0 32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 60,
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(8px)",
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  headerBrand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  logo: {
    width: 32,
    height: 32,
    background: "linear-gradient(135deg, #0f766e, #2aa294)",
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 700,
  },
  brandText: {
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "0.08em",
    color: "#1a2333",
    textTransform: "uppercase",
  },
  brandSub: {
    fontSize: 10,
    color: "#46566c",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  nav: {
    display: "flex",
    gap: 4,
  },
  navBtn: (active) => ({
    padding: "6px 16px",
    borderRadius: 4,
    border: "1px solid",
    borderColor: active ? "#0f766e" : "transparent",
    background: active ? "rgba(15,118,110,0.12)" : "transparent",
    color: active ? "#0f766e" : "#4b617b",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    cursor: "pointer",
    transition: "all 0.15s",
  }),
  statusDot: (ok) => ({
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: ok ? "#056b5a" : "#ef4444",
    boxShadow: ok ? "0 0 8px #056b5a" : "0 0 8px #ef4444",
  }),
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    color: "#46566c",
  },
  // Main content
  main: {
    flex: 1,
    padding: "32px",
    maxWidth: 1100,
    width: "100%",
    margin: "0 auto",
    position: "relative",
    zIndex: 1,
  },
  reportDocWrap: {
    background: "rgba(255,255,255,0.72)",
    border: "1px solid #c7dcd7",
    borderRadius: 14,
    padding: 12,
    boxShadow: "0 10px 30px rgba(27, 43, 67, 0.08)",
  },
  reportDoc: {
    background: "#ffffff",
    border: "1px solid #c7dcd7",
    borderRadius: 10,
    padding: 18,
    maxHeight: "72vh",
    overflowY: "auto",
    scrollBehavior: "smooth",
  },
  // Section titles
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    color: "#46566c",
    marginBottom: 16,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    background: "#c7dcd7",
  },
  // Cards
  card: {
    background: "#ffffff",
    border: "1px solid #c7dcd7",
    borderRadius: 8,
    padding: 24,
    marginBottom: 20,
    boxShadow: "0 10px 30px rgba(27, 43, 67, 0.08)",
  },
  cardAccent: {
    background: "rgba(255,255,255,0.88)",
    border: "1px solid #9ddccf",
    borderLeft: "3px solid #0f766e",
    borderRadius: 8,
    padding: 24,
    marginBottom: 20,
    boxShadow: "0 10px 30px rgba(27, 43, 67, 0.08)",
  },
  // Form elements
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    color: "#46566c",
    marginBottom: 8,
  },
  input: {
    width: "100%",
    background: "#f8f2e8",
    border: "1px solid #c7dcd7",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#1a2333",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
  textarea: {
    width: "100%",
    background: "#f8f2e8",
    border: "1px solid #c7dcd7",
    borderRadius: 6,
    padding: "12px 14px",
    color: "#1a2333",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    resize: "vertical",
    minHeight: 90,
    boxSizing: "border-box",
  },
  select: {
    width: "100%",
    background: "#f8f2e8",
    border: "1px solid #c7dcd7",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#1a2333",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    cursor: "pointer",
    boxSizing: "border-box",
  },
  selectSm: {
    minWidth: 360,
    maxWidth: "100%",
    background: "#ffffff",
    border: "1px solid #c7dcd7",
    borderRadius: 6,
    padding: "8px 12px",
    color: "#1a2333",
    fontSize: 12,
    fontFamily: "inherit",
    outline: "none",
    cursor: "pointer",
  },
  // Buttons
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 22px",
    background: "linear-gradient(135deg, #2aa294, #0f766e)",
    border: "none",
    borderRadius: 6,
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "opacity 0.15s, transform 0.1s",
  },
  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 18px",
    background: "transparent",
    border: "1px solid #9ddccf",
    borderRadius: 6,
    color: "#0f766e",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  },
  btnDanger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 18px",
    background: "transparent",
    border: "1px solid #cfa6a2",
    borderRadius: 6,
    color: "#b43c36",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  // Badges
  badge: (color) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    background: color === "blue" ? "rgba(15,118,110,0.1)" : color === "green" ? "rgba(5,107,90,0.1)" : color === "amber" ? "rgba(181,122,42,0.12)" : "rgba(111,128,146,0.1)",
    color: color === "blue" ? "#0f766e" : color === "green" ? "#056b5a" : color === "amber" ? "#b57a2a" : "#6f8092",
    border: "1px solid",
    borderColor: color === "blue" ? "rgba(15,118,110,0.25)" : color === "green" ? "rgba(5,107,90,0.25)" : color === "amber" ? "rgba(181,122,42,0.3)" : "rgba(111,128,146,0.2)",
  }),
  // Grid
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  },
  grid3: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 12,
  },
  // Report sections
  reportSection: {
    marginBottom: 24,
  },
  reportSectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    color: "#46566c",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: "1px solid #c7dcd7",
  },
  answerText: {
    fontSize: 14,
    lineHeight: 1.8,
    color: "#2e415b",
  },
  listItem: {
    display: "flex",
    gap: 10,
    marginBottom: 8,
    alignItems: "flex-start",
    fontSize: 13,
    color: "#38526f",
    lineHeight: 1.6,
  },
  listBullet: {
    width: 18,
    height: 18,
    minWidth: 18,
    borderRadius: "50%",
    background: "rgba(15,118,110,0.12)",
    border: "1px solid rgba(15,118,110,0.25)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    fontSize: 9,
    color: "#0f766e",
    fontWeight: 700,
  },
  // Index comparison
  indexCol: {
    background: "#f8f2e8",
    border: "1px solid #c7dcd7",
    borderRadius: 8,
    padding: 20,
  },
  indexLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    color: "#0f766e",
    marginBottom: 12,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  // Stat boxes
  statBox: {
    background: "#f8f2e8",
    border: "1px solid #c7dcd7",
    borderRadius: 8,
    padding: 16,
    textAlign: "center",
  },
  statNum: {
    fontSize: 28,
    fontWeight: 700,
    color: "#0f766e",
    lineHeight: 1,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 10,
    color: "#46566c",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  // Dropzone
  dropzone: (drag) => ({
    border: `2px dashed ${drag ? "#0f766e" : "#c7dcd7"}`,
    borderRadius: 8,
    padding: "32px 24px",
    textAlign: "center",
    cursor: "pointer",
    background: drag ? "rgba(15,118,110,0.06)" : "transparent",
    transition: "all 0.2s",
    marginBottom: 16,
  }),
  // Accordion
  accordionBtn: {
    width: "100%",
    background: "transparent",
    border: "none",
    padding: "12px 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: "#4b617b",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "inherit",
    borderTop: "1px solid #c7dcd7",
  },
  // Spinner
  spinner: {
    width: 20,
    height: 20,
    border: "2px solid #c7dcd7",
    borderTop: "2px solid #0f766e",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  // Notification toast
  toast: (type) => ({
    position: "fixed",
    bottom: 24,
    right: 24,
    background: type === "error" ? "#fff1ef" : "#e8f7f1",
    border: `1px solid ${type === "error" ? "#cfa6a2" : "#0f766e"}`,
    borderRadius: 8,
    padding: "12px 18px",
    color: type === "error" ? "#b43c36" : "#0f766e",
    fontSize: 12,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 10,
    zIndex: 9999,
    maxWidth: 360,
    boxShadow: "0 10px 30px rgba(27, 43, 67, 0.15)",
  }),
  // Modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(26, 35, 51, 0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "#ffffff",
    border: "1px solid #9ddccf",
    borderRadius: 10,
    padding: 32,
    maxWidth: 440,
    width: "90%",
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#b57a2a",
    marginBottom: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  modalText: {
    fontSize: 13,
    color: "#38526f",
    lineHeight: 1.7,
    marginBottom: 24,
  },
  modalActions: {
    display: "flex",
    gap: 12,
    justifyContent: "flex-end",
  },
  reportActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
};

// ── Component: Spinner ────────────────────────────────────────────────────────
const Spinner = ({ size = 20 }) => (
  <div style={{
    width: size, height: size,
    border: `2px solid #c7dcd7`,
    borderTop: "2px solid #0f766e",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    flexShrink: 0,
  }} />
);

// ── Component: Toast ──────────────────────────────────────────────────────────
const Toast = ({ msg, type, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div style={S.toast(type)}>
      <span>{type === "error" ? "⚠" : "✓"}</span>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}>
        <Icon.X />
      </button>
    </div>
  );
};

// ── Component: Modal ──────────────────────────────────────────────────────────
const RegenerateModal = ({ question, onConfirm, onCancel }) => (
  <div style={S.modalOverlay}>
    <div style={S.modal}>
      <div style={S.modalTitle}><Icon.Warning /> Report Already Cached</div>
      <div style={S.modalText}>
        A report for this query is already cached with hash key. Do you want to regenerate it by running a fresh query? This will overwrite the existing cached report.
        <br /><br />
        <span style={{ color: "#46566c", fontSize: 11, fontStyle: "italic" }}>"{question}"</span>
      </div>
      <div style={S.modalActions}>
        <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
        <button style={{ ...S.btnPrimary, background: "linear-gradient(135deg, #9a5f10, #b57a2a)" }} onClick={onConfirm}>
          <Icon.Refresh /> Regenerate
        </button>
      </div>
    </div>
  </div>
);

// ── Component: ReportView ─────────────────────────────────────────────────────
const ReportView = ({ report }) => {
  const [showIntermediate, setShowIntermediate] = useState(false);
  const inter = report.intermediate || {};

  return (
    <div style={S.reportDocWrap}>
      <div style={S.reportDoc}>
      {/* Header strip */}
      <div style={{ ...S.cardAccent, marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, color: "#46566c", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>Query Result</div>
          <div style={{ fontSize: 14, color: "#1a2333", lineHeight: 1.5, maxWidth: 700 }}>{report.question}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 20, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {report._cached && <span style={S.badge("amber")}>Cached</span>}
          <span style={S.badge("green")}>{(report.confidence_score * 100).toFixed(0)}% confidence</span>
          {report.schemes_covered?.map((s, i) => (
            <span key={i} style={S.badge("blue")}>{s}</span>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ ...S.grid3, marginBottom: 20 }}>
        <div style={S.statBox}>
          <div style={S.statNum}>{inter.scheme_docs_retrieved ?? "–"}</div>
          <div style={S.statLabel}>Scheme Docs</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statNum}>{inter.citizen_docs_retrieved ?? "–"}</div>
          <div style={S.statLabel}>FAQ Docs</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statNum}>{inter.processing_time_seconds ?? "–"}s</div>
          <div style={S.statLabel}>Process Time</div>
        </div>
      </div>

      {/* Final Answer */}
      <div style={S.card}>
        <div style={S.reportSectionTitle}>Final Synthesized Answer</div>
        <div style={S.answerText}>{report.final_answer}</div>
      </div>

      {/* Dual index results side-by-side */}
      <div style={{ ...S.grid2, marginBottom: 20 }}>
        <div style={S.indexCol}>
          <div style={S.indexLabel}><Icon.Index /> schemes_index</div>
          <div style={{ fontSize: 11, color: "#46566c", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>Official Guidelines</div>
          <div style={{ fontSize: 13, color: "#38526f", lineHeight: 1.7, marginBottom: 12 }}>
            {inter.scheme_answer?.answer || "No data"}
          </div>
          {inter.scheme_answer?.key_benefits?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "#46566c", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>Key Benefits</div>
              {inter.scheme_answer.key_benefits.map((b, i) => (
                <div key={i} style={S.listItem}>
                  <div style={S.listBullet}>{i + 1}</div>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          )}
          {inter.scheme_answer?.sources?.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #c7dcd7" }}>
              <div style={{ fontSize: 10, color: "#46566c", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>Sources</div>
              {inter.scheme_answer.sources.map((s, i) => (
                <div key={i} style={{ fontSize: 11, color: "#38526f", marginBottom: 3 }}>↗ {s}</div>
              ))}
            </div>
          )}
        </div>

        <div style={S.indexCol}>
          <div style={{ ...S.indexLabel, color: "#056b5a" }}><Icon.Index /> citizen_faq_index</div>
          <div style={{ fontSize: 11, color: "#46566c", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>Citizen FAQs</div>
          <div style={{ fontSize: 13, color: "#38526f", lineHeight: 1.7, marginBottom: 12 }}>
            {inter.citizen_answer?.answer || "No FAQ data ingested"}
          </div>
          {inter.citizen_answer?.common_confusions?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#46566c", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>Common Confusions</div>
              {inter.citizen_answer.common_confusions.map((c, i) => (
                <div key={i} style={S.listItem}>
                  <div style={{ ...S.listBullet, background: "rgba(5,107,90,0.1)", borderColor: "rgba(5,107,90,0.25)", color: "#056b5a" }}>!</div>
                  <span>{c}</span>
                </div>
              ))}
            </div>
          )}
          {inter.citizen_answer?.practical_tips?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "#46566c", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>Practical Tips</div>
              {inter.citizen_answer.practical_tips.map((t, i) => (
                <div key={i} style={S.listItem}>
                  <div style={{ ...S.listBullet, background: "rgba(5,107,90,0.1)", borderColor: "rgba(5,107,90,0.25)", color: "#056b5a" }}>✓</div>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Eligibility, Benefits, How to Apply, Docs Required, Tips */}
      <div style={{ ...S.grid2, marginBottom: 20 }}>
        <div style={S.card}>
          <div style={S.reportSectionTitle}>Eligibility</div>
          <div style={{ fontSize: 13, color: "#38526f", lineHeight: 1.7 }}>{report.eligibility || "–"}</div>
        </div>
        <div style={S.card}>
          <div style={S.reportSectionTitle}>Helpline</div>
          <div style={{ fontSize: 14, color: "#0f766e", lineHeight: 1.7 }}>{report.helpline || "–"}</div>
        </div>
      </div>

      <div style={{ ...S.grid2, marginBottom: 20 }}>
        <div style={S.card}>
          <div style={S.reportSectionTitle}>Benefits</div>
          {(report.benefits || []).map((b, i) => (
            <div key={i} style={S.listItem}>
              <div style={S.listBullet}>{i + 1}</div>
              <span>{b}</span>
            </div>
          ))}
        </div>
        <div style={S.card}>
          <div style={S.reportSectionTitle}>How to Apply</div>
          {(report.how_to_apply || []).map((s, i) => (
            <div key={i} style={S.listItem}>
              <div style={S.listBullet}>{i + 1}</div>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...S.grid2, marginBottom: 8 }}>
        <div style={S.card}>
          <div style={S.reportSectionTitle}>Documents Required</div>
          {(report.documents_required || []).map((d, i) => (
            <div key={i} style={S.listItem}>
              <div style={{ ...S.listBullet, background: "rgba(181,122,42,0.12)", borderColor: "rgba(181,122,42,0.3)", color: "#b57a2a" }}>◈</div>
              <span>{d}</span>
            </div>
          ))}
        </div>
        <div style={S.card}>
          <div style={S.reportSectionTitle}>Practical Tips</div>
          {(report.practical_tips || []).map((t, i) => (
            <div key={i} style={S.listItem}>
              <div style={{ ...S.listBullet, background: "rgba(181,122,42,0.12)", borderColor: "rgba(181,122,42,0.3)", color: "#b57a2a" }}>★</div>
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Accordion: raw intermediate */}
      <button style={S.accordionBtn} onClick={() => setShowIntermediate(v => !v)}>
        <span>Raw Intermediate Data</span>
        <span style={{ transform: showIntermediate ? "rotate(180deg)" : "none", transition: "transform 0.2s", display: "inline-flex" }}><Icon.ChevronDown /></span>
      </button>
      {showIntermediate && (
        <pre style={{
          background: "#f8f2e8",
          border: "1px solid #c7dcd7",
          borderRadius: 6,
          padding: 16,
          fontSize: 11,
          color: "#32526a",
          overflow: "auto",
          maxHeight: 400,
          marginTop: 8,
        }}>
          {JSON.stringify(inter, null, 2)}
        </pre>
      )}
      </div>
    </div>
  );
};

// ── Page: Execution ───────────────────────────────────────────────────────────
const ExecutionPage = ({ toast }) => {
  const [question, setQuestion] = useState("");
  const [schemeType, setSchemeType] = useState("");
  const [kVal, setKVal] = useState(8);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState(null);
  const [modal, setModal] = useState(null); // {question, hashKey}
  const [hashKey, setHashKey] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedHistory, setSelectedHistory] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await api("/api/cache/list");
      const queryEntries = (data.entries || []).filter((e) => e.type === "query");
      setHistory(queryEntries);
    } catch (e) {
      toast("Failed to load report history: " + e.message, "error");
    } finally {
      setLoadingHistory(false);
    }
  }, [toast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const buildPayload = (force = false) => ({
    question,
    filters: schemeType ? { schemes_index: { scheme_type: schemeType }, citizen_faq_index: { scheme_type: schemeType } } : {},
    options: { k: Number(kVal) },
    force,
  });

  const runQuery = async (force = false) => {
    setLoading(true);
    setReport(null);
    try {
      const res = await api("/api/report/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(force)),
      });
      setReport(res);
      setHashKey(res.hash_key);
      setQuestion(res.question || question);
      toast(res._cached ? "Loaded from cache" : "Report generated", "ok");
      await loadHistory();
    } catch (e) {
      toast("Query failed: " + e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadReportFromHistory = async (key) => {
    if (!key) return;
    try {
      const res = await api(`/api/report/cache/${encodeURIComponent(key)}`);
      setReport(res);
      setHashKey(res.hash_key);
      setQuestion(res.question || "");
      toast("Loaded report from history", "ok");
    } catch (e) {
      toast("Failed to load report: " + e.message, "error");
    }
  };

  const downloadReport = async (format = "html") => {
    if (!report) return;
    try {
      const token = sessionStorage.getItem("dash_token");
      const res = await fetch(`${API}/api/report/download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ report, format }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const hash = report?.hash_key || "report";
      const a = document.createElement("a");
      a.href = url;
      a.download = `dualrag_report_${hash}.${format === "txt" ? "txt" : format === "json" ? "json" : format === "pdf" ? "pdf" : "html"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("Report download started", "ok");
    } catch (e) {
      toast("Download failed: " + e.message, "error");
    }
  };

  const handleSubmit = async () => {
    if (!question.trim()) return;
    setChecking(true);
    try {
      const check = await api("/api/report/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, filters: schemeType ? { schemes_index: { scheme_type: schemeType } } : {}, options: { k: Number(kVal) } }),
      });
      if (check.exists) {
        // Show cached report immediately
        setReport(check.report);
        setHashKey(check.hash_key);
        // Also show modal asking if user wants to regenerate
        setModal({ question, hashKey: check.hash_key });
      } else {
        await runQuery(false);
      }
    } catch (e) {
      toast("Check failed: " + e.message, "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      {modal && (
        <RegenerateModal
          question={modal.question}
          onConfirm={async () => { setModal(null); await runQuery(true); }}
          onCancel={() => setModal(null)}
        />
      )}

      {/* Query builder */}
      <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={S.sectionTitle}>
          <Icon.Search />
          <span>Query Builder</span>
          <div style={S.sectionLine} />
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ ...S.label, marginBottom: 10 }}>Report History (Previously Asked Questions)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            style={S.selectSm}
            value={selectedHistory}
            onChange={async (e) => {
              const key = e.target.value;
              setSelectedHistory(key);
              await loadReportFromHistory(key);
            }}
          >
            <option value="">Select a past question/report...</option>
            {history.map((h) => (
              <option key={h.hash_key} value={h.hash_key}>
                {(h.label || "Untitled question").slice(0, 100)}
              </option>
            ))}
          </select>
          <button style={S.btnSecondary} onClick={loadHistory} disabled={loadingHistory}>
            <Icon.Refresh /> {loadingHistory ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#46566c", marginTop: 8 }}>
          {history.length} cached report(s) available
        </div>
      </div>

      <div style={S.card}>
        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Question</label>
          <textarea
            style={S.textarea}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="e.g. Am I eligible for Ayushman Bharat if my family income is 2 lakh per year?"
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit(); }}
          />
          <div style={{ fontSize: 10, color: "#5f7488", marginTop: 4 }}>Ctrl+Enter to submit</div>
        </div>

        <div style={{ ...S.grid2, marginBottom: 16 }}>
          <div>
            <label style={S.label}>Scheme Type Filter</label>
            <select style={S.select} value={schemeType} onChange={e => setSchemeType(e.target.value)}>
              <option value="">All schemes</option>
              <option value="health">Health</option>
              <option value="agriculture">Agriculture</option>
              <option value="housing">Housing</option>
              <option value="education">Education</option>
              <option value="energy">Energy / LPG</option>
              <option value="employment">Employment</option>
              <option value="social">Social Welfare</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Retrieve Top K Docs</label>
            <input
              type="number"
              style={S.input}
              value={kVal}
              onChange={e => setKVal(e.target.value)}
              min={1} max={20}
            />
          </div>
        </div>

        <button
          style={{ ...S.btnPrimary, opacity: loading || checking || !question.trim() ? 0.5 : 1 }}
          disabled={loading || checking || !question.trim()}
          onClick={handleSubmit}
        >
          {(loading || checking) ? <Spinner size={16} /> : <Icon.Search />}
          {checking ? "Checking cache…" : loading ? "Generating report…" : "Run Query"}
        </button>

        {hashKey && (
          <span style={{ marginLeft: 16, fontSize: 10, color: "#5f7488" }}>
            hash: <span style={{ color: "#46566c" }}>{hashKey}</span>
          </span>
        )}
      </div>

      {/* Report output */}
      {report && (
        <>
          <div style={{ ...S.sectionTitle, marginTop: 8 }}>
            <Icon.File />
            <span>Report</span>
            {report._cached && <span style={S.badge("amber")}>Cached</span>}
            <div style={S.sectionLine} />
            <div style={S.reportActions}>
              <button
                style={{ ...S.btnSecondary, padding: "5px 14px", fontSize: 10 }}
                onClick={() => downloadReport("html")}
              >
                <Icon.File /> Download HTML
              </button>
              <button
                style={{ ...S.btnSecondary, padding: "5px 14px", fontSize: 10 }}
                onClick={() => downloadReport("txt")}
              >
                <Icon.File /> Download TXT
              </button>
              <button
                style={{ ...S.btnSecondary, padding: "5px 14px", fontSize: 10 }}
                onClick={() => downloadReport("pdf")}
              >
                <Icon.File /> Download PDF
              </button>
              <button
                style={{ ...S.btnSecondary, padding: "5px 14px", fontSize: 10 }}
                onClick={() => { setModal({ question: report.question, hashKey: report.hash_key }); }}
              >
                <Icon.Refresh /> Regenerate
              </button>
            </div>
          </div>
          <ReportView report={report} />
        </>
      )}
    </div>
  );
};

// ── Page: Ingestion ───────────────────────────────────────────────────────────
const IngestionPage = ({ toast }) => {
  const [file, setFile] = useState(null);
  const [indexName, setIndexName] = useState("schemes_index");
  const [docType, setDocType] = useState("official_guidelines");
  const [schemeName, setSchemeName] = useState("");
  const [schemeType, setSchemeType] = useState("health");
  const [ministry, setMinistry] = useState("");
  const [state, setState] = useState("Central");
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [modal, setModal] = useState(null);
  const fileRef = useRef();

  const handleFileDrop = (f) => {
    if (f?.type === "application/pdf" || f?.name?.endsWith(".pdf")) {
      setFile(f);
      if (!schemeName) setSchemeName(f.name.replace(".pdf", "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
    } else {
      toast("Only PDF files are supported", "error");
    }
  };

  const buildMeta = () => ({
    scheme_name: schemeName,
    scheme_type: schemeType,
    ministry,
    state,
    content_type: docType,
  });

  const doIngest = async (force = false) => {
    if (!file) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("index_name", indexName);
      fd.append("document_type", docType);
      fd.append("metadata_json", JSON.stringify(buildMeta()));
      fd.append("force", force ? "true" : "false");

      const token = sessionStorage.getItem("dash_token");
      const res = await fetch(`${API}/api/ingest`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `${res.status} ${res.statusText}`);
      setResult(data);
      toast(data._cached ? "Document already ingested (cached)" : "Ingestion complete!", "ok");
    } catch (e) {
      toast("Ingestion failed: " + e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!file) return;
    // Check first
    try {
      const check = await api("/api/ingest/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, index_name: indexName, document_type: docType, metadata: buildMeta() }),
      });
      if (check.exists) {
        setResult(check.result);
        setModal({ filename: file.name });
        return;
      }
    } catch (_) {}
    await doIngest(false);
  };

  return (
    <div>
      {modal && (
        <div style={S.modalOverlay}>
          <div style={S.modal}>
            <div style={S.modalTitle}><Icon.Warning /> Already Ingested</div>
            <div style={S.modalText}>
              <strong style={{ color: "#1a2333" }}>{modal.filename}</strong> has already been ingested with these settings. The existing cached result is shown below. Do you want to re-ingest and overwrite?
            </div>
            <div style={S.modalActions}>
              <button style={S.btnSecondary} onClick={() => setModal(null)}>Keep Existing</button>
              <button style={{ ...S.btnPrimary, background: "linear-gradient(135deg, #9a5f10, #b57a2a)" }} onClick={async () => { setModal(null); await doIngest(true); }}>
                <Icon.Refresh /> Re-ingest
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ ...S.sectionTitle, marginBottom: 16 }}>
        <Icon.Upload />
        <span>Document Ingestion</span>
        <div style={S.sectionLine} />
      </div>

      <div style={S.card}>
        {/* Dropzone */}
        <div
          style={S.dropzone(drag)}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFileDrop(f); }}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) handleFileDrop(e.target.files[0]); }} />
          {file ? (
            <div>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 14, color: "#0f766e", marginBottom: 4 }}>{file.name}</div>
              <div style={{ fontSize: 11, color: "#46566c" }}>{(file.size / 1024).toFixed(1)} KB · Click to change</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⊕</div>
              <div style={{ fontSize: 13, color: "#46566c", marginBottom: 4 }}>Drop PDF here or click to browse</div>
              <div style={{ fontSize: 11, color: "#5f7488" }}>Supports: PDF files only</div>
            </div>
          )}
        </div>

        {/* Index selection */}
        <div style={S.grid2}>
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>Target Index</label>
            <select style={S.select} value={indexName} onChange={e => setIndexName(e.target.value)}>
              <option value="schemes_index">schemes_index — Official Guidelines</option>
              <option value="citizen_faq_index">citizen_faq_index — Citizen FAQs</option>
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>Document Type</label>
            <select style={S.select} value={docType} onChange={e => setDocType(e.target.value)}>
              <option value="official_guidelines">Official Guidelines</option>
              <option value="citizen_faq">Citizen FAQ</option>
              <option value="citizen_guide">Citizen Guide</option>
              <option value="ministry_circular">Ministry Circular</option>
              <option value="state_implementation">State Implementation</option>
            </select>
          </div>
        </div>

        {/* Metadata filters */}
        <div style={{ paddingTop: 16, borderTop: "1px solid #c7dcd7", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#46566c", marginBottom: 12 }}>
            Metadata / Filters
          </div>
          <div style={S.grid2}>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Scheme Name</label>
              <input style={S.input} value={schemeName} onChange={e => setSchemeName(e.target.value)} placeholder="e.g. Ayushman Bharat PM-JAY" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Scheme Type</label>
              <select style={S.select} value={schemeType} onChange={e => setSchemeType(e.target.value)}>
                <option value="health">Health</option>
                <option value="agriculture">Agriculture</option>
                <option value="housing">Housing</option>
                <option value="education">Education</option>
                <option value="energy">Energy / LPG</option>
                <option value="employment">Employment</option>
                <option value="social">Social Welfare</option>
                <option value="financial">Financial Inclusion</option>
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Ministry</label>
              <input style={S.input} value={ministry} onChange={e => setMinistry(e.target.value)} placeholder="e.g. Ministry of Health and Family Welfare" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>State / Scope</label>
              <select style={S.select} value={state} onChange={e => setState(e.target.value)}>
                <option value="Central">Central (All India)</option>
                <option value="Andhra Pradesh">Andhra Pradesh</option>
                <option value="Delhi">Delhi</option>
                <option value="Gujarat">Gujarat</option>
                <option value="Karnataka">Karnataka</option>
                <option value="Kerala">Kerala</option>
                <option value="Maharashtra">Maharashtra</option>
                <option value="Rajasthan">Rajasthan</option>
                <option value="Tamil Nadu">Tamil Nadu</option>
                <option value="Telangana">Telangana</option>
                <option value="Uttar Pradesh">Uttar Pradesh</option>
                <option value="West Bengal">West Bengal</option>
              </select>
            </div>
          </div>
        </div>

        <button
          style={{ ...S.btnPrimary, opacity: loading || !file ? 0.5 : 1 }}
          disabled={loading || !file}
          onClick={handleSubmit}
        >
          {loading ? <Spinner size={16} /> : <Icon.Upload />}
          {loading ? "Ingesting…" : "Ingest Document"}
        </button>
      </div>

      {/* Result */}
      {result && (
        <>
          <div style={S.sectionTitle}>
            <Icon.Database />
            <span>Ingestion Result</span>
            <div style={S.sectionLine} />
          </div>
          <div style={S.cardAccent}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span style={S.badge(result.status === "success" ? "green" : "amber")}>{result.status}</span>
              {result._cached && <span style={S.badge("amber")}>Cached</span>}
              <span style={{ fontSize: 11, color: "#46566c" }}>Index: {result.index_name}</span>
            </div>
            {result.results?.map((r, i) => (
              <div key={i} style={{ ...S.card, marginBottom: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 13, color: "#1a2333" }}>{r.document_name}</div>
                  <span style={S.badge(r.status === "success" ? "green" : "amber")}>{r.status}</span>
                </div>
                <div style={S.grid3}>
                  <div style={S.statBox}>
                    <div style={{ ...S.statNum, fontSize: 22 }}>{r.chunks_created}</div>
                    <div style={S.statLabel}>Chunks Created</div>
                  </div>
                  <div style={S.statBox}>
                    <div style={{ ...S.statNum, fontSize: 22 }}>{r.chunks_inserted}</div>
                    <div style={S.statLabel}>Inserted</div>
                  </div>
                  <div style={S.statBox}>
                    <div style={{ ...S.statNum, fontSize: 22 }}>{r.validation_passed ? "✓" : "✗"}</div>
                    <div style={S.statLabel}>Validated</div>
                  </div>
                </div>
                {r.error && <div style={{ fontSize: 12, color: "#b43c36", marginTop: 10 }}>{r.error}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const ResourcesPage = () => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/sample-docs/manifest.json");
        const data = await res.json();
        if (mounted) setDocs(Array.isArray(data.documents) ? data.documents : []);
      } catch (_) {
        if (mounted) setDocs([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const groups = docs.reduce((acc, d) => {
    const key = d.indexName || "other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});

  return (
    <div>
      <div style={{ ...S.sectionTitle, marginBottom: 16 }}>
        <Icon.File />
        <span>Resources</span>
        <div style={S.sectionLine} />
      </div>

      <div style={S.cardAccent}>
        <div style={{ fontSize: 12, color: "#46566c", marginBottom: 12 }}>
          Download sample scheme documents and use them for testing ingestion/query workflows.
        </div>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#5f7488", fontSize: 12 }}>
            <Spinner size={14} /> Loading resources...
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {Object.entries(groups).map(([indexName, list]) => (
              <div key={indexName}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#46566c", marginBottom: 8 }}>
                  {indexName}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {list.map((d) => (
                    <div key={d.href} style={{ ...S.card, marginBottom: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2333" }}>{d.title}</div>
                          <div style={{ fontSize: 11, color: "#5f7488", marginTop: 4 }}>
                            Index: {d.indexName} | Type: {d.docType}
                          </div>
                        </div>
                        <a href={d.href} target="_blank" rel="noreferrer" style={{ ...S.btnSecondary, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Icon.Download /> Open PDF
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};


// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD EXTENSION — Auth + Role-based pages
// ══════════════════════════════════════════════════════════════════════════════

const DASH_API = API;  // same server, same port

const dash = async (path, opts = {}) => {
  const token = sessionStorage.getItem("dash_token");
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) };
  const res = await fetch(`${DASH_API}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
};

// ── Role config ────────────────────────────────────────────────────────────────
const ROLES = {
  district_officer:  { label: "District Officer",  color: "#0f766e", bg: "rgba(15,118,110,0.1)",  icon: "🏛", desc: "Full district-wide access, all GPs, ML metrics, ingestion" },
  panchayat_officer: { label: "Panchayat Officer", color: "#b57a2a", bg: "rgba(181,122,42,0.1)",  icon: "🏘", desc: "Your GP's detailed schemes, funds, activities" },
  citizen:           { label: "Citizen",            color: "#46566c", bg: "rgba(70,86,108,0.1)",   icon: "👤", desc: "Your village's alerts, scheme eligibility, weather outlook" },
};

const NAV_BY_ROLE = {
  district_officer:  ["prediction","recommend","analysis","execution","ingestion","resources"],
  panchayat_officer: ["prediction","recommend","analysis","execution","ingestion","resources"],
  citizen:           ["alerts","schemes","weather","resources"],
};

const NAV_LABELS = {
  prediction: "🌧 Prediction", recommend: "📋 Recommend", analysis: "📊 Analysis",
  execution: "⟡ Query", ingestion: "⊕ Ingest",
  alerts: "🚨 Alerts", schemes: "📋 Schemes", weather: "🌤 Weather", resources: "📚 Resources",
};

const PAGE_HELP_LABELS = {
  prediction: "Climate Predictions",
  recommend: "Scheme Recommendations",
  analysis: "Analysis & Insights",
  execution: "Query Assistant",
  ingestion: "Document Ingestion",
  alerts: "Drought Alerts",
  schemes: "Village Schemes",
  weather: "Weather Outlook",
  resources: "Resources",
};

// ── Auth context (simple — no React context, just props) ───────────────────────

// ── Component: RoleBadge ───────────────────────────────────────────────────────
const RoleBadge = ({ role }) => {
  const r = ROLES[role] || {};
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
      background: r.bg, color: r.color, border: `1px solid ${r.color}44` }}>
      {r.icon} {r.label}
    </span>
  );
};

// ── Component: LoginPage ───────────────────────────────────────────────────────
const LoginPage = ({ onLogin }) => {
  const [mode, setMode] = useState("login");  // login | register
  const [form, setForm] = useState({ username:"", password:"", name:"", role:"citizen", district:"", mandal:"", gp:"" });
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  // Jurisdiction dropdowns for register
  const [regDistricts, setRegDistricts] = useState([]);
  const [regMandals,   setRegMandals]   = useState([]);
  const [regGps,       setRegGps]       = useState([]);

  useEffect(() => {
    fetch(`${DASH_API}/api/public/districts`).then(r => r.json()).then(setRegDistricts).catch(() => {});
  }, []);

  const pickRegDistrict = async (d) => {
    setForm(p => ({ ...p, district: d, mandal: "", gp: "" }));
    setRegMandals([]); setRegGps([]);
    if (d) {
      const ms = await fetch(`${DASH_API}/api/public/mandals?district=${encodeURIComponent(d)}`).then(r=>r.json()).catch(()=>[]);
      setRegMandals(ms);
    }
  };
  const pickRegMandal = async (m) => {
    setForm(p => ({ ...p, mandal: m, gp: "" }));
    setRegGps([]);
    if (m && form.district) {
      const gs = await fetch(`${DASH_API}/api/public/gps?district=${encodeURIComponent(form.district)}&mandal=${encodeURIComponent(m)}`).then(r=>r.json()).catch(()=>[]);
      setRegGps(gs);
    }
  };

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    setError(""); setLoading(true);
    try {
      let data;
      if (mode === "login") {
        const fd = new FormData();
        fd.append("username", form.username); fd.append("password", form.password);
        const res = await fetch(`${DASH_API}/api/auth/login`, { method: "POST", body: fd });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || "Login failed"); }
        data = await res.json();
      } else {
        data = await dash("/api/auth/register", { method: "POST", body: JSON.stringify(form) });
      }
      sessionStorage.setItem("dash_token", data.access_token);
      onLogin(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const needsJurisdiction = mode === "register" && form.role !== "";
  const isPanchayat = form.role === "panchayat_officer";
  const isCitizen   = form.role === "citizen";

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(145deg, #ecf7ff, #f8f2e8)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" , position: "relative", overflow: "hidden" }}>
      {/* Background orbs */}
      <div style={{ ...S.bgOrb, ...S.orb1 }} /><div style={{ ...S.bgOrb, ...S.orb2 }} />
      <div style={{ width: "100%", maxWidth: 1200, position: "relative", zIndex: 1 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ width: 52, height: 52, background: "linear-gradient(135deg,#0f766e,#2aa294)", borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, margin: "0 auto 14px" }}>⟁</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a2333", letterSpacing: "0.08em" }}>Gramsaarthi</div>
          <div style={{ fontSize: 11, color: "#46566c", letterSpacing: "0.18em", textTransform: "uppercase", marginTop: 4 }}>Gram Panchayat Dashboard</div>
        </div>

        <div style={S.card}>
          {/* Mode toggle */}
          <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #c7dcd7", marginBottom: 30 }}>
            {["login","register"].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(""); }}
                style={{ flex: 1, padding: "9px 0", border: "none", cursor: "pointer", fontFamily: "inherit",
                  fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", transition: "all 0.15s",
                  background: mode === m ? "linear-gradient(135deg,#2aa294,#0f766e)" : "#f8f2e8",
                  color: mode === m ? "#fff" : "#46566c" }}>
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          {/* Demo credentials hint */}
          {mode === "login" && (
            <div style={{ background: "#f8f2e8", border: "1px solid #c7dcd7", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 11, color: "#46566c", lineHeight: 1.8 }}>
              <strong style={{ color: "#1a2333" }}>Demo accounts</strong><br />
              🏛 <code>district_demo</code> / <code>demo1234</code> — District Officer<br />
              🏘 <code>panchayat_demo</code> / <code>demo1234</code> — Panchayat Officer<br />
              👤 <code>citizen_demo</code> / <code>demo1234</code> — Citizen
            </div>
          )}

          {/* Fields */}
          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Username</label>
            <input style={S.input} value={form.username} onChange={e => set("username", e.target.value)} placeholder="Enter username" autoFocus />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" value={form.password} onChange={e => set("password", e.target.value)} placeholder="Enter password"
              onKeyDown={e => { if (e.key === "Enter") submit(); }} />
          </div>

          {mode === "register" && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={S.label}>Full Name</label>
                <input style={S.input} value={form.name} onChange={e => set("name", e.target.value)} placeholder="Your full name" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={S.label}>Role</label>
                <select style={S.select} value={form.role} onChange={e => {
                  setForm(p => ({ ...p, role: e.target.value, mandal: "", gp: "" }));
                  setRegMandals([]); setRegGps([]);
                }}>
                  {Object.entries(ROLES).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
                <div style={{ fontSize: 11, color: "#46566c", marginTop: 6 }}>{ROLES[form.role]?.desc}</div>
              </div>
              {/* Jurisdiction */}
              <div style={{ paddingTop: 12, borderTop: "1px solid #c7dcd7", marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#46566c", marginBottom: 12 }}>Jurisdiction</div>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>District</label>
                  <select style={S.select} value={form.district} onChange={e => pickRegDistrict(e.target.value)}>
                    <option value="">— Select District —</option>
                    {regDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                {(isPanchayat || isCitizen) && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={S.label}>Mandal</label>
                    <select style={{ ...S.select, opacity: !form.district ? 0.6 : 1 }} value={form.mandal} onChange={e => pickRegMandal(e.target.value)} disabled={!form.district}>
                      <option value="">— Select Mandal —</option>
                      {regMandals.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                )}
                {(isPanchayat || isCitizen) && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={S.label}>Gram Panchayat</label>
                    <select style={{ ...S.select, opacity: !form.mandal ? 0.6 : 1 }} value={form.gp} onChange={e => setForm(p => ({ ...p, gp: e.target.value }))} disabled={!form.mandal}>
                      <option value="">— Select GP —</option>
                      {regGps.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                )}
                {/* District officer only needs district, no mandal/GP */}
                {form.role === "district_officer" && form.district && (
                  <div style={{ fontSize: 11, color: "#0f766e", padding: "6px 10px", background: "rgba(15,118,110,0.06)", borderRadius: 6 }}>
                    ✓ You will have access to all mandals and GPs in <strong>{form.district}</strong>
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <div style={{ background: "#fff1ef", border: "1px solid #cfa6a2", borderRadius: 6, padding: "10px 14px", color: "#b43c36", fontSize: 12, marginBottom: 14 }}>
              ⚠ {error}
            </div>
          )}

          <button style={{ ...S.btnPrimary, width: "100%", justifyContent: "center", opacity: loading ? 0.6 : 1 }}
            disabled={loading} onClick={submit}>
            {loading ? <Spinner size={16} /> : null}
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Component: HierarchySelector ──────────────────────────────────────────────
const HierarchySelector = ({ user, onChange }) => {
  const [districts, setDistricts] = useState([]);
  const [mandals, setMandals]     = useState([]);
  const [gps, setGps]             = useState([]);
  const [sel, setSel]             = useState({ district: user.district || "", mandal: user.mandal || "", gp: user.gp || "" });
  const locked = user.role !== "district_officer";  // panchayat/citizen locked to their jurisdiction

  useEffect(() => {
    dash("/api/hierarchy/districts").then(d => {
      setDistricts(d);
      if (d.length === 1) {
        const auto = { district: d[0], mandal: user.mandal || "", gp: user.gp || "" };
        setSel(auto);
        onChange(auto);
        dash(`/api/hierarchy/mandals?district=${encodeURIComponent(d[0])}`).then(ms => {
          setMandals(ms);
          if (ms.length === 1) {
            const auto2 = { ...auto, mandal: ms[0] };
            setSel(auto2); onChange(auto2);
            dash(`/api/hierarchy/gps?district=${encodeURIComponent(d[0])}&mandal=${encodeURIComponent(ms[0])}`).then(gs => {
              setGps(gs);
              if (gs.length === 1) { const a3 = { ...auto2, gp: gs[0] }; setSel(a3); onChange(a3); }
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const pickDistrict = async (d) => {
    const next = { district: d, mandal: "", gp: "" }; setSel(next); setMandals([]); setGps([]); onChange(next);
    if (d) { const ms = await dash(`/api/hierarchy/mandals?district=${encodeURIComponent(d)}`).catch(()=>[]); setMandals(ms); }
  };
  const pickMandal = async (m) => {
    const next = { ...sel, mandal: m, gp: "" }; setSel(next); setGps([]); onChange(next);
    if (m) { const gs = await dash(`/api/hierarchy/gps?district=${encodeURIComponent(sel.district)}&mandal=${encodeURIComponent(m)}`).catch(()=>[]); setGps(gs); }
  };
  const pickGp = (g) => { const next = { ...sel, gp: g }; setSel(next); onChange(next); };

  const ss = { ...S.select, fontSize: 12, opacity: locked ? 0.85 : 1 };
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 20 }}>
      <div style={{ minWidth: 180 }}>
        <label style={S.label}>District</label>
        <select style={ss} value={sel.district} onChange={e => pickDistrict(e.target.value)} disabled={locked && districts.length === 1}>
          <option value="">All Districts</option>
          {districts.map(d => <option key={d}>{d}</option>)}
        </select>
      </div>
      <div style={{ minWidth: 180 }}>
        <label style={S.label}>Mandal</label>
        <select style={ss} value={sel.mandal} onChange={e => pickMandal(e.target.value)} disabled={!sel.district || (locked && mandals.length === 1)}>
          <option value="">All Mandals</option>
          {mandals.map(m => <option key={m}>{m}</option>)}
        </select>
      </div>
      <div style={{ minWidth: 180 }}>
        <label style={S.label}>Gram Panchayat</label>
        <select style={ss} value={sel.gp} onChange={e => pickGp(e.target.value)} disabled={!sel.mandal || (locked && gps.length === 1)}>
          <option value="">All GPs</option>
          {gps.map(g => <option key={g}>{g}</option>)}
        </select>
      </div>
      {locked && (
        <div style={{ fontSize: 10, color: "#46566c", padding: "6px 10px", background: "#f8f2e8", borderRadius: 6, border: "1px solid #c7dcd7" }}>
          🔒 Scoped to your jurisdiction
        </div>
      )}
    </div>
  );
};

// ── MiniBar helper ─────────────────────────────────────────────────────────────
const MiniBar = ({ value, max, color = "#0f766e" }) => (
  <div style={{ width: "100%", height: 8, background: "#edf2f0", borderRadius: 4, overflow: "hidden" }}>
    <div style={{ width: `${Math.min(100, (value / Math.max(max, 1)) * 100)}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s" }} />
  </div>
);

// ══════════════════════════════════════════════════════════════════════════════
// ROLE-BASED PAGES
// ══════════════════════════════════════════════════════════════════════════════

// ── Page: Prediction (District Officer + Panchayat Officer) ───────────────────
const PredictionPage = ({ user, toast }) => {
  const [sel, setSel] = useState({ district: user.district || "", mandal: user.mandal || "", gp: user.gp || "" });
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (s) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (s.district) qs.set("district", s.district);
      if (s.mandal)   qs.set("mandal",   s.mandal);
      if (s.gp)       qs.set("gp",       s.gp);
      setData(await dash(`/api/prediction?${qs}`));
    } catch (e) { toast(e.message, "error"); } finally { setLoading(false); }
  };

  useEffect(() => { load(sel); }, []);

  const isPanchayat = user.role === "panchayat_officer";

  return (
    <div>
      <div style={S.sectionTitle}><span>🌧</span><span>Climate Predictions</span><div style={S.sectionLine} /></div>
      <div style={S.card}>
        <HierarchySelector user={user} onChange={s => { setSel(s); load(s); }} />
        {loading && <div style={{ display: "flex", gap: 10, alignItems: "center", color: "#46566c", fontSize: 13 }}><Spinner size={16} /> Loading…</div>}
        {data && !loading && (
          <>
            <div style={{ ...S.grid3, marginBottom: 20 }}>
              {[
                { label: "Mandals", val: data.predictions.length },
                { label: "Drought Forecast", val: data.predictions.filter(p => p.predicted_drought_flag === "DROUGHT").length },
                { label: "Avg Rainfall (mm)", val: data.predictions.length ? (data.predictions.reduce((a, p) => a + (p.predicted_rainfall_mm || 0), 0) / data.predictions.length).toFixed(1) : "–" },
              ].map(({ label, val }) => <div key={label} style={S.statBox}><div style={S.statNum}>{val}</div><div style={S.statLabel}>{label}</div></div>)}
            </div>

            {/* Panchayat officer: show GP detail card */}
            {isPanchayat && data.gp_context?.length > 0 && (
              <div style={{ ...S.cardAccent, marginBottom: 20 }}>
                <div style={S.reportSectionTitle}>Your GP — Detailed Context</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                  {[
                    { k: "water_activities", l: "Water Activities" },
                    { k: "livelihood_activities", l: "Livelihood Activities" },
                    { k: "total_estimated_cost_lakhs", l: "Est. Cost (Lakhs)" },
                    { k: "sc_st_fund_share_pct", l: "SC/ST Fund %" },
                    { k: "priority_score", l: "Priority Score" },
                    { k: "priority_tier", l: "Priority Tier" },
                  ].map(({ k, l }) => (
                    <div key={k} style={S.statBox}>
                      <div style={{ ...S.statNum, fontSize: 18 }}>{data.gp_context[0]?.[k] ?? "–"}</div>
                      <div style={S.statLabel}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8f2e8" }}>
                    {["District","Mandal","Month","Rainfall (mm)","Drought %","Forecast",
                      ...(isPanchayat ? [] : ["Drought Score"])
                    ].map(h => <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#46566c", borderBottom: "1px solid #c7dcd7" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.predictions.map((p, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #edf2f0" }}>
                      <td style={{ padding: "8px 12px", color: "#1a2333" }}>{p.District}</td>
                      <td style={{ padding: "8px 12px", color: "#38526f" }}>{p.Mandal}</td>
                      <td style={{ padding: "8px 12px", color: "#46566c" }}>{p.forecast_year}-{String(p.forecast_month||"").padStart(2,"0")}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 600, color: "#0f766e" }}>{p.predicted_rainfall_mm}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 50, height: 6, background: "#edf2f0", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${p.drought_probability_pct||0}%`, height: "100%", background: (p.drought_probability_pct||0) > 50 ? "#ef4444" : "#0f766e", borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 11 }}>{p.drought_probability_pct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: "8px 12px" }}><span style={{ ...S.badge(p.predicted_drought_flag === "DROUGHT" ? "amber" : "green"), fontSize: 9 }}>{p.predicted_drought_flag}</span></td>
                      {!isPanchayat && <td style={{ padding: "8px 12px", color: "#46566c", fontSize: 11 }}>{p.drought_risk_score ?? "–"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.predictions.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#46566c", fontSize: 13 }}>No data for this selection.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Page: Recommend (District + Panchayat) ────────────────────────────────────
const RecommendPage = ({ user, toast }) => {
  const [sel, setSel]       = useState({ district: user.district||"", mandal: user.mandal||"", gp: user.gp||"" });
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (s) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (s.district) qs.set("district", s.district);
      if (s.mandal)   qs.set("mandal",   s.mandal);
      if (s.gp)       qs.set("gp",       s.gp);
      qs.set("top_k", "20");
      setData(await dash(`/api/recommend?${qs}`));
    } catch (e) { toast(e.message, "error"); } finally { setLoading(false); }
  };

  useEffect(() => { load(sel); }, []);

  const isPanchayat = user.role === "panchayat_officer";
  const tierColor = { CRITICAL: "amber", HIGH: "blue", MEDIUM: "green", LOW: "gray" };

  return (
    <div>
      <div style={S.sectionTitle}><span>📋</span><span>Scheme Recommendations</span><div style={S.sectionLine} /></div>
      <div style={S.card}>
        <HierarchySelector user={user} onChange={s => { setSel(s); load(s); }} />
        {loading && <div style={{ display: "flex", gap: 10, alignItems: "center", color: "#46566c", fontSize: 13 }}><Spinner size={16} /> Loading…</div>}
        {data && !loading && (
          <>
            <div style={{ fontSize: 11, color: "#46566c", marginBottom: 16 }}>Showing <strong>{data.total}</strong> recommendation(s)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.recommendations.map((r, i) => (
                <div key={i} style={{ ...S.cardAccent, marginBottom: 0, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2333", marginBottom: 4 }}>{r["Scheme Name"]}</div>
                      <div style={{ fontSize: 11, color: "#46566c" }}>{r.District && `${r.District} › `}{r.Mandal && `${r.Mandal} › `}{r.GP_Name}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {r.priority_tier && <span style={S.badge(tierColor[r.priority_tier]||"gray")}>{r.priority_tier}</span>}
                      {r.recommendation_score && <span style={S.badge("blue")}>Score: {r.recommendation_score}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
                    {r.theme    && <span style={{ fontSize: 11, color: "#38526f" }}>🏷 {r.theme}</span>}
                    {r.sector   && <span style={{ fontSize: 11, color: "#38526f" }}>📂 {r.sector}</span>}
                    {r.rationale && <span style={{ fontSize: 11, color: "#0f766e", fontStyle: "italic" }}>✦ {r.rationale}</span>}
                  </div>
                  {/* Panchayat officer sees activity count + cost */}
                  {isPanchayat && (r.activity_count != null || r.avg_estimated_cost != null) && (
                    <div style={{ display: "flex", gap: 20, marginTop: 10, paddingTop: 10, borderTop: "1px solid #edf2f0" }}>
                      {r.activity_count  != null && <span style={{ fontSize: 11, color: "#46566c" }}>Activities: <strong>{r.activity_count}</strong></span>}
                      {r.avg_estimated_cost != null && <span style={{ fontSize: 11, color: "#46566c" }}>Avg Cost: <strong>₹{(r.avg_estimated_cost/1000).toFixed(1)}K</strong></span>}
                      {r.water_relevance    === 1 && <span style={S.badge("blue")}>💧 Water</span>}
                      {r.drought_relevance  === 1 && <span style={S.badge("amber")}>🌵 Drought</span>}
                      {r.livelihood_relevance===1 && <span style={S.badge("green")}>🌾 Livelihood</span>}
                      {r.inclusion_relevance===1 && <span style={S.badge("gray")}>👥 Inclusion</span>}
                    </div>
                  )}
                </div>
              ))}
              {data.recommendations.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#46566c", fontSize: 13 }}>No recommendations for this selection.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Page: Analysis (District + Panchayat) ─────────────────────────────────────
const AnalysisPage = ({ user, toast }) => {
  const [sel, setSel]       = useState({ district: user.district||"", mandal: user.mandal||"", gp: user.gp||"" });
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (s) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (s.district) qs.set("district", s.district);
      if (s.mandal)   qs.set("mandal",   s.mandal);
      if (s.gp)       qs.set("gp",       s.gp);
      setData(await dash(`/api/analysis?${qs}`));
    } catch (e) { toast(e.message, "error"); } finally { setLoading(false); }
  };

  useEffect(() => { load(sel); }, []);

  const tierColors = { CRITICAL:"#b43c36", HIGH:"#b57a2a", MEDIUM:"#0f766e", LOW:"#6f8092" };
  const riskColors = { Critical:"#b43c36", High:"#b57a2a", Medium:"#0f766e", Low:"#6f8092" };
  const isDistrict  = user.role === "district_officer";
  const isPanchayat = user.role === "panchayat_officer";

  return (
    <div>
      <div style={S.sectionTitle}><span>📊</span><span>Analysis & Insights</span><div style={S.sectionLine} /></div>
      <div style={{ ...S.card, marginBottom: 16 }}>
        <HierarchySelector user={user} onChange={s => { setSel(s); load(s); }} />
      </div>
      {loading && <div style={{ display: "flex", gap: 10, alignItems: "center", color: "#46566c", fontSize: 13, padding: 24 }}><Spinner size={16} /> Loading…</div>}
      {data && !loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
            {[{ label: "Total GPs", val: data.summary.total_gps }, { label: "Critical GPs", val: data.summary.critical_gps },
              { label: "Drought Mandals", val: data.summary.drought_mandals }, { label: "Avg Rainfall mm", val: data.summary.avg_rainfall_mm }
            ].map(({ label, val }) => <div key={label} style={S.statBox}><div style={S.statNum}>{val}</div><div style={S.statLabel}>{label}</div></div>)}
          </div>

          <div style={{ ...S.grid2, marginBottom: 20 }}>
            <div style={S.card}>
              <div style={S.reportSectionTitle}>GP Priority Tier Distribution</div>
              {data.tier_distribution.map(({ tier, count }) => (
                <div key={tier} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: tierColors[tier]||"#46566c", fontWeight: 600 }}>{tier}</span>
                    <span style={{ color: "#46566c" }}>{count}</span>
                  </div>
                  <MiniBar value={count} max={Math.max(...data.tier_distribution.map(t=>t.count))} color={tierColors[tier]||"#0f766e"} />
                </div>
              ))}
            </div>
            <div style={S.card}>
              <div style={S.reportSectionTitle}>Drought Risk Distribution</div>
              {data.risk_distribution.map(({ bucket, count }) => (
                <div key={bucket} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: riskColors[bucket]||"#46566c", fontWeight: 600 }}>{bucket}</span>
                    <span style={{ color: "#46566c" }}>{count}</span>
                  </div>
                  <MiniBar value={count} max={Math.max(...data.risk_distribution.map(r=>r.count))} color={riskColors[bucket]||"#0f766e"} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...S.grid2, marginBottom: 20 }}>
            <div style={S.card}>
              <div style={S.reportSectionTitle}>Monthly Rainfall Trend (Last 24 months)</div>
              {data.monthly_rainfall_trend.length > 0 ? (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 100 }}>
                  {(() => {
                    const vals = data.monthly_rainfall_trend.map(t=>t.total_rain_mm||0);
                    const maxV = Math.max(...vals, 1);
                    return data.monthly_rainfall_trend.map((t, i) => (
                      <div key={i} title={`${t.label}: ${(t.total_rain_mm||0).toFixed(1)} mm`}
                        style={{ flex:1, background:"#0f766e", opacity:0.5+0.5*((t.total_rain_mm||0)/maxV), borderRadius:"2px 2px 0 0",
                          height:`${Math.max(2,((t.total_rain_mm||0)/maxV)*90)}px`, transition:"height 0.3s" }} />
                    ));
                  })()}
                </div>
              ) : <div style={{ color: "#46566c", fontSize: 12 }}>No trend data.</div>}
              <div style={{ fontSize: 10, color: "#46566c", marginTop: 6 }}>Hover bars for values</div>
            </div>
            <div style={S.card}>
              <div style={S.reportSectionTitle}>Top Mandals by Priority Score</div>
              {data.top_mandals_by_priority.map(({ Mandal, priority_score }, i) => (
                <div key={Mandal} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: "#1a2333" }}>{i+1}. {Mandal}</span>
                    <span style={{ color: "#0f766e", fontWeight: 600 }}>{(priority_score||0).toFixed(1)}</span>
                  </div>
                  <MiniBar value={priority_score||0} max={100} />
                </div>
              ))}
            </div>
          </div>

          {/* District officer: cross-mandal comparison table */}
          {isDistrict && data.mandal_comparison?.length > 0 && (
            <div style={S.card}>
              <div style={S.reportSectionTitle}>Cross-Mandal Comparison</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "#f8f2e8" }}>
                    {["Mandal","GPs","Critical GPs","Avg Priority Score","Total Budget (Lakhs)"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#46566c", borderBottom: "1px solid #c7dcd7" }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {data.mandal_comparison.map((m, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #edf2f0" }}>
                        <td style={{ padding: "8px 12px", fontWeight: 600, color: "#1a2333" }}>{m.Mandal}</td>
                        <td style={{ padding: "8px 12px", color: "#46566c" }}>{m.gps}</td>
                        <td style={{ padding: "8px 12px" }}><span style={{ color: m.critical > 0 ? "#b43c36" : "#056b5a", fontWeight: 600 }}>{m.critical}</span></td>
                        <td style={{ padding: "8px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 60, height: 6, background: "#edf2f0", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${m.avg_score||0}%`, height: "100%", background: "#0f766e", borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 11 }}>{(m.avg_score||0).toFixed(1)}</span>
                          </div>
                        </td>
                        <td style={{ padding: "8px 12px", color: "#46566c" }}>{(m.total_cost_lakhs||0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Panchayat officer: GP activity breakdown */}
          {isPanchayat && data.gp_activity_detail?.length > 0 && (
            <div style={S.card}>
              <div style={S.reportSectionTitle}>GP Activity Breakdown</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                {[
                  { k:"total_activities", l:"Total Activities" }, { k:"water_activities", l:"Water Activities" },
                  { k:"livelihood_activities", l:"Livelihood Activities" }, { k:"total_estimated_cost_lakhs", l:"Est. Cost (Lakhs)" },
                  { k:"sc_st_fund_share_pct", l:"SC/ST Fund %" }, { k:"priority_score", l:"Priority Score" },
                ].map(({ k, l }) => (
                  <div key={k} style={S.statBox}>
                    <div style={{ ...S.statNum, fontSize: 20 }}>{data.gp_activity_detail[0]?.[k] ?? "–"}</div>
                    <div style={S.statLabel}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── Page: Citizen — Alerts ─────────────────────────────────────────────────────
const CitizenAlertsPage = ({ user, toast }) => {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dash("/api/alerts").then(setData).catch(e => toast(e.message, "error")).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 40, color: "#46566c" }}><Spinner /> Loading alerts for your area…</div>;

  return (
    <div>
      <div style={S.sectionTitle}><span>🚨</span><span>Drought Alerts — Your Area</span><div style={S.sectionLine} /></div>
      <div style={{ ...S.card, marginBottom: 20, background: "rgba(255,249,240,0.9)", borderColor: "#e8c88a" }}>
        <div style={{ fontSize: 12, color: "#5a4010", lineHeight: 1.8 }}>
          <strong>📍 Your location:</strong> {user.gp || user.mandal || user.district || "—"}<br />
          These alerts are based on ML predictions using rainfall and humidity data from your region.
        </div>
      </div>
      {data?.alerts?.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 15, color: "#056b5a", fontWeight: 600 }}>No drought alerts for your area</div>
          <div style={{ fontSize: 12, color: "#46566c", marginTop: 6 }}>Rainfall is expected to be normal next month.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(data?.alerts || []).map((a, i) => (
            <div key={i} style={{ ...S.card, borderLeft: "3px solid #b57a2a", background: "rgba(255,249,240,0.95)", marginBottom: 0, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2333", marginBottom: 6 }}>⚠ {a.alert_message}</div>
                  <div style={{ fontSize: 11, color: "#46566c" }}>Expected rainfall: <strong>{a.predicted_rainfall_mm} mm</strong></div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#b43c36" }}>{a.drought_probability_pct}%</div>
                  <div style={{ fontSize: 10, color: "#46566c", textTransform: "uppercase", letterSpacing: "0.1em" }}>Drought risk</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Page: Citizen — Schemes ────────────────────────────────────────────────────
const CitizenSchemesPage = ({ user, toast }) => {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (user.district) qs.set("district", user.district);
    if (user.mandal)   qs.set("mandal",   user.mandal);
    if (user.gp)       qs.set("gp",       user.gp);
    qs.set("top_k", "20");
    dash(`/api/recommend?${qs}`).then(setData).catch(e => toast(e.message, "error")).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 40, color: "#46566c" }}><Spinner /> Loading schemes…</div>;

  return (
    <div>
      <div style={S.sectionTitle}><span>📋</span><span>Schemes for Your Village</span><div style={S.sectionLine} /></div>
      <div style={{ ...S.card, marginBottom: 20, background: "rgba(240,250,245,0.9)", borderColor: "#9ddccf" }}>
        <div style={{ fontSize: 12, color: "#1a3a2a", lineHeight: 1.8 }}>
          These schemes are recommended for <strong>{user.gp || user.mandal || user.district}</strong> based on current climate conditions and local needs.
          Contact your Gram Panchayat office to apply.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(data?.recommendations || []).map((r, i) => (
          <div key={i} style={{ ...S.card, marginBottom: 0, padding: 18, borderLeft: "3px solid #0f766e" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2333", marginBottom: 6 }}>{r["Scheme Name"]}</div>
            {r.theme    && <div style={{ fontSize: 12, color: "#46566c", marginBottom: 4 }}>🏷 Category: {r.theme}</div>}
            {r.rationale && <div style={{ fontSize: 12, color: "#0f766e" }}>✦ Why recommended: {r.rationale}</div>}
          </div>
        ))}
        {!data?.recommendations?.length && <div style={{ padding: 40, textAlign: "center", color: "#46566c" }}>No schemes found for your area.</div>}
      </div>
    </div>
  );
};

// ── Page: Citizen — Weather ────────────────────────────────────────────────────
const CitizenWeatherPage = ({ user, toast }) => {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (user.district) qs.set("district", user.district);
    if (user.mandal)   qs.set("mandal",   user.mandal);
    dash(`/api/prediction?${qs}`).then(setData).catch(e => toast(e.message, "error")).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 40, color: "#46566c" }}><Spinner /> Loading weather outlook…</div>;

  const preds = data?.predictions || [];

  return (
    <div>
      <div style={S.sectionTitle}><span>🌤</span><span>Weather Outlook — Next Month</span><div style={S.sectionLine} /></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {preds.map((p, i) => {
          const isDrought = p.predicted_drought_flag === "DROUGHT";
          return (
            <div key={i} style={{ ...S.card, marginBottom: 0, padding: 20, background: isDrought ? "rgba(255,249,235,0.95)" : "rgba(240,252,246,0.95)", borderLeft: `3px solid ${isDrought ? "#b57a2a" : "#0f766e"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2333", marginBottom: 4 }}>{p.Mandal}</div>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>{isDrought ? "☀️ Dry conditions expected" : "🌧 Rainfall expected"}</div>
                  <div style={{ fontSize: 12, color: "#38526f", lineHeight: 1.8 }}>{p.advice}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#0f766e" }}>{p.predicted_rainfall_mm}<span style={{ fontSize: 13, fontWeight: 400 }}>mm</span></div>
                  <div style={{ fontSize: 10, color: "#46566c" }}>Expected rainfall</div>
                </div>
              </div>
            </div>
          );
        })}
        {preds.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#46566c" }}>No weather data available.</div>}
      </div>
    </div>
  );
};

const PageAssistant = ({ activePage, toast }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const intro = `Ask me anything about ${PAGE_HELP_LABELS[activePage] || "this page"}.`;
  const [messages, setMessages] = useState([{ role: "assistant", text: intro }]);

  useEffect(() => {
    setMessages([{ role: "assistant", text: `You are now on ${PAGE_HELP_LABELS[activePage] || activePage}. Ask page-specific questions.` }]);
    setInput("");
  }, [activePage]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: q }]);
    setLoading(true);
    try {
      const data = await dash("/api/page-chat", {
        method: "POST",
        body: JSON.stringify({ page: activePage, question: q }),
      });
      setMessages(prev => [...prev, { role: "assistant", text: data.answer || "No response." }]);
    } catch (e) {
      const msg = e.message || "Chat failed";
      setMessages(prev => [...prev, { role: "assistant", text: `Error: ${msg}` }]);
      if (toast) toast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed", right: 18, bottom: 18, zIndex: 50, border: "none", cursor: "pointer",
          background: "linear-gradient(135deg,#2aa294,#0f766e)", color: "#fff", borderRadius: 999,
          padding: "10px 14px", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em",
          boxShadow: "0 10px 28px rgba(15,118,110,0.3)"
        }}
      >
        Ask AI
      </button>
    );
  }

  return (
    <div style={{
      position: "fixed", right: 18, bottom: 18, zIndex: 50, width: "min(380px, calc(100vw - 24px))",
      background: "#ffffff", border: "1px solid #c7dcd7", borderRadius: 12, boxShadow: "0 16px 36px rgba(27,43,67,0.2)",
      display: "flex", flexDirection: "column", overflow: "hidden"
    }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #edf2f0", background: "#f8f2e8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: "#1a2333", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Gramsaarthi Assistant</div>
          <div style={{ fontSize: 10, color: "#46566c" }}>{PAGE_HELP_LABELS[activePage] || activePage}</div>
        </div>
        <button onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#46566c", fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ maxHeight: 300, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "#fcfdfd" }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "90%", padding: "8px 10px", borderRadius: 10,
            background: m.role === "user" ? "#0f766e" : "#eef5f4",
            color: m.role === "user" ? "#fff" : "#1a2333", fontSize: 12, lineHeight: 1.5,
            whiteSpace: "pre-wrap"
          }}>
            {m.text}
          </div>
        ))}
        {loading && <div style={{ fontSize: 11, color: "#46566c" }}>Thinking...</div>}
      </div>

      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #edf2f0", background: "#fff" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send(); }}
          placeholder="Ask about this page..."
          style={{ flex: 1, border: "1px solid #c7dcd7", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}
        />
        <button onClick={send} disabled={loading || !input.trim()} style={{
          border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer",
          background: loading || !input.trim() ? "#9ccfc7" : "#0f766e", color: "#fff", fontSize: 12, fontWeight: 700
        }}>
          Send
        </button>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser]   = useState(() => {
    try { const t = sessionStorage.getItem("dash_token"); const u = sessionStorage.getItem("dash_user"); return t && u ? JSON.parse(u) : null; } catch { return null; }
  });
  const [page, setPage]   = useState(null);  // null = auto-select first nav item
  const [health, setHealth]     = useState(null);
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg, type = "ok") => setToast({ msg, type, id: Date.now() }), []);

  const handleLogin = (u) => {
    sessionStorage.setItem("dash_user", JSON.stringify(u));
    setUser(u);
    setPage(null);
  };
  const handleLogout = () => {
    sessionStorage.removeItem("dash_token");
    sessionStorage.removeItem("dash_user");
    setUser(null); setPage(null);
  };

  useEffect(() => {
    api("/api/health").then(setHealth).catch(() => setHealth({ status: "unreachable" }));
  }, []);

  if (!user) return <LoginPage onLogin={handleLogin} />;

  const navItems = NAV_BY_ROLE[user.role] || [];
  const activePage = page || navItems[0];
  const isOk = health?.status === "healthy";
  const roleInfo = ROLES[user.role] || {};

  return (
    <div style={S.app}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: linear-gradient(145deg, #ecf7ff, #f8f2e8); font-family: "Segoe UI","Trebuchet MS","Helvetica Neue",sans-serif; }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes drift { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(10px)} }
        input:focus,textarea:focus,select:focus{border-color:#0f766e!important}
        button:hover{opacity:0.88}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:#f8f2e8}
        ::-webkit-scrollbar-thumb{background:#c7dcd7;border-radius:3px}
        select option{background:#ffffff}
      `}</style>
      <div style={{ ...S.bgOrb, ...S.orb1 }} /><div style={{ ...S.bgOrb, ...S.orb2 }} />

      <header style={S.header}>
        <div style={S.headerBrand}>
          <div style={S.logo}>⟁</div>
          <div>
            <div style={S.brandText}>DualRAG</div>
            <div style={S.brandSub}>Govt Schemes Intelligence</div>
          </div>
        </div>

        <nav style={S.nav}>
          {navItems.map(id => (
            <button key={id} style={S.navBtn(activePage === id)} onClick={() => setPage(id)}>{NAV_LABELS[id]}</button>
          ))}
        </nav>

        <div style={S.statusRow}>

          {/* User info pill */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px",
            background: roleInfo.bg, border: `1px solid ${roleInfo.color}44`, borderRadius: 20 }}>
            <span style={{ fontSize: 13 }}>{roleInfo.icon}</span>
            <span style={{ fontSize: 11, color: roleInfo.color, fontWeight: 600 }}>{user.name || user.username}</span>
          </div>
          <div style={S.statusDot(isOk)} />
          <button onClick={handleLogout} style={{ ...S.btnSecondary, padding: "4px 10px", fontSize: 10 }}>Sign Out</button>
        </div>
      </header>

      <main style={S.main}>
        {/* District Officer pages */}
        {user.role === "district_officer" && activePage === "prediction" && <PredictionPage user={user} toast={showToast} />}
        {user.role === "district_officer" && activePage === "recommend"  && <RecommendPage  user={user} toast={showToast} />}
        {user.role === "district_officer" && activePage === "analysis"   && <AnalysisPage   user={user} toast={showToast} />}
        {user.role === "district_officer" && activePage === "execution"  && <ExecutionPage  toast={showToast} />}
        {user.role === "district_officer" && activePage === "ingestion"  && <IngestionPage  toast={showToast} />}
        {user.role === "district_officer" && activePage === "resources"  && <ResourcesPage />}

        {/* Panchayat Officer pages */}
        {user.role === "panchayat_officer" && activePage === "prediction" && <PredictionPage user={user} toast={showToast} />}
        {user.role === "panchayat_officer" && activePage === "recommend"  && <RecommendPage  user={user} toast={showToast} />}
        {user.role === "panchayat_officer" && activePage === "analysis"   && <AnalysisPage   user={user} toast={showToast} />}
        {/* ADD THESE */}
        {user.role === "panchayat_officer" && activePage === "execution"  && <ExecutionPage  toast={showToast} />}
        {user.role === "panchayat_officer" && activePage === "ingestion"  && <IngestionPage  toast={showToast} />}
        {user.role === "panchayat_officer" && activePage === "resources"  && <ResourcesPage />}
        {/* Citizen pages */}
        {user.role === "citizen" && activePage === "alerts"  && <CitizenAlertsPage  user={user} toast={showToast} />}
        {user.role === "citizen" && activePage === "schemes" && <CitizenSchemesPage user={user} toast={showToast} />}
        {user.role === "citizen" && activePage === "weather" && <CitizenWeatherPage user={user} toast={showToast} />}
        {user.role === "citizen" && activePage === "resources" && <ResourcesPage />}
      </main>

      <PageAssistant activePage={activePage} toast={showToast} />
      {toast && <Toast key={toast.id} msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
