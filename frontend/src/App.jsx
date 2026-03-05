import { useState, useEffect, useCallback, useRef } from "react";

// ── Config ────────────────────────────────────────────────────────────────────
// Empty string = use Vite proxy (vite.config.js proxies /api → localhost:8080)
// Change to "http://localhost:8080" if running frontend without Vite dev server
const API = "";

// ── Utilities ─────────────────────────────────────────────────────────────────
const api = async (path, opts = {}) => {
  const res = await fetch(`${API}${path}`, opts);
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
      const res = await fetch(`${API}/api/report/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  const [pendingSubmit, setPendingSubmit] = useState(false);
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

      const res = await fetch(`${API}/api/ingest`, { method: "POST", body: fd });
      const data = await res.json();
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
        body: JSON.stringify({ filename: file.name, index_name: indexName, document_type: docType, filters: buildMeta() }),
      });
      if (check.exists && !pendingSubmit) {
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

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("execution");
  const [health, setHealth] = useState(null);
  const [indexStats, setIndexStats] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = "ok") => setToast({ msg, type, id: Date.now() }), []);

  useEffect(() => {
    api("/api/health").then(setHealth).catch(() => setHealth({ status: "unreachable" }));
    api("/api/indexes/stats").then(setIndexStats).catch(() => {});
  }, []);

  const isOk = health?.status === "healthy";

  return (
    <div style={S.app}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: linear-gradient(145deg, #ecf7ff, #f8f2e8);
          font-family: "Segoe UI", "Trebuchet MS", "Helvetica Neue", sans-serif;
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes drift {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(10px); }
        }
        input:focus, textarea:focus, select:focus { border-color: #0f766e !important; }
        button:hover { opacity: 0.88; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #f8f2e8; }
        ::-webkit-scrollbar-thumb { background: #c7dcd7; border-radius: 3px; }
        select option { background: #ffffff; }
      `}</style>
      <div style={{ ...S.bgOrb, ...S.orb1 }} />
      <div style={{ ...S.bgOrb, ...S.orb2 }} />

      {/* Header */}
      <header style={S.header}>
        <div style={S.headerBrand}>
          <div style={S.logo}>⟁</div>
          <div>
            <div style={S.brandText}>DualRAG</div>
            <div style={S.brandSub}>Govt Schemes Intelligence</div>
          </div>
        </div>

        <nav style={S.nav}>
          {["execution", "ingestion"].map(p => (
            <button key={p} style={S.navBtn(page === p)} onClick={() => setPage(p)}>
              {p === "execution" ? "⟡ Query" : "⊕ Ingest"}
            </button>
          ))}
        </nav>

        <div style={S.statusRow}>
          {indexStats && (
            <>
              <span style={S.badge("blue")}><Icon.Database />{indexStats.schemes_index_count} schemes</span>
              <span style={S.badge("green")}><Icon.Database />{indexStats.citizen_faq_index_count} faqs</span>
            </>
          )}
          <div style={S.statusDot(isOk)} />
          <span style={{ fontSize: 10 }}>{isOk ? "API Online" : "API Offline"}</span>
        </div>
      </header>

      {/* Main */}
      <main style={S.main}>
        {page === "execution" && <ExecutionPage toast={showToast} />}
        {page === "ingestion" && <IngestionPage toast={showToast} />}
      </main>

      {/* Toast */}
      {toast && <Toast key={toast.id} msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
