import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSubmission } from "../api/client";
import { loadSession } from "./state";
import type {
  ExtractResponse,
  PolicyResponse,
  ReviewState,
  EditRecord,
  JustificationRecord,
} from "../types";

function badgeClassForState(state?: string) {
  if (state === "GREEN") return "ok";
  if (state === "YELLOW") return "warn";
  if (state === "RED") return "bad";
  return "blue";
}

function clearExpenseSession() {
  const keys = [
    "extract",
    "fields",
    "policy",
    "review_state",
    "edits",
    "justifications",
    "receipt_note",
  ];
  keys.forEach((k) => sessionStorage.removeItem(k));
}

function Modal({
  title,
  children,
  onClose,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        display: "grid",
        placeItems: "center",
        zIndex: 999,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: "min(640px, 100%)",
          padding: 18,
          borderRadius: 14,
          background: "rgba(15, 22, 38, 0.98)",
          border: "1px solid rgba(10,110,209,0.55)",
          boxShadow: "0 18px 60px rgba(0,0,0,0.65)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontWeight: 950, fontSize: 18 }}>{title}</div>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="hr" style={{ marginTop: 12, marginBottom: 12 }} />

        {children}

        {actions ? (
          <>
            <div className="hr" style={{ marginTop: 12, marginBottom: 12 }} />
            <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
              {actions}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function displayValue(v: any) {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return (v ?? "").toString();
}

export default function Summary() {
  const nav = useNavigate();

  const extracted = loadSession<ExtractResponse>("extract");
  const fields = loadSession<any>("fields");
  const policy = loadSession<PolicyResponse>("policy");
  const reviewState = loadSession<ReviewState>("review_state");

  const edits = loadSession<EditRecord[]>("edits") || [];
  const justifications = loadSession<JustificationRecord[]>("justifications") || [];

  // Frontend-only display (NOT sent to backend)
  const receiptNote = loadSession<string>("receipt_note") || "";

  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const [result, setResult] = useState<any>(null);
  const [showSubmittedModal, setShowSubmittedModal] = useState(false);

  const ruleIds = useMemo(() => {
    if (!policy) return [];
    return Array.from(new Set(policy.issues.map((i) => i.rule_id)));
  }, [policy]);

  if (!extracted || !fields || !policy || !reviewState) {
    return (
      <div className="container">
        <div className="card">
          <div style={{ fontWeight: 900, fontSize: 18 }}>Session expired</div>
          <div className="small" style={{ marginTop: 6 }}>
            Please start again from Upload.
          </div>
          <div className="hr" />
          <button
            className="btn btn-primary"
            onClick={() => {
              clearExpenseSession();
              nav("/upload");
            }}
          >
            Start new expense
          </button>
        </div>
      </div>
    );
  }

  const displayKeys = [
    "merchant",
    "date",
    "total",
    "currency",
    "category",
    "description",
    "business_purpose",
    "payment_type",
    "reimbursable",
    "cost_center",
    "project_code",
  ].filter((k) => fields?.[k] !== undefined);

  async function submit() {
    setErr("");
    setSubmitting(true);

    try {
      // ✅ ZERO backend changes: do NOT send receipt_note
      const payload = {
        receipt_id: extracted.receipt_id,
        final_fields: fields,
        user_confirmed: confirmed,
        policy_rule_ids: ruleIds,
        issues: policy.issues,
        review_state: reviewState,
        edits,
        justifications,
      };

      const res = await createSubmission(payload);
      setResult(res);

      if (res?.status === "SUBMITTED") {
        setShowSubmittedModal(true);
      } else {
        setErr(res?.reason || "Submission blocked.");
      }
    } catch (e: any) {
      setErr(e?.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function startNewExpense() {
    clearExpenseSession();
    setConfirmed(false);
    setResult(null);
    setErr("");
    setShowSubmittedModal(false);
    nav("/upload");
  }

  return (
    <div className="container">
      {/* Submitted popup */}
      {showSubmittedModal && (
        <Modal
          title="Submitted successfully"
          onClose={startNewExpense}
          actions={
            <button className="btn btn-primary" onClick={startNewExpense}>
              Start new expense
            </button>
          }
        >
          <div className="muted" style={{ lineHeight: 1.6 }}>
            Your expense was submitted and recorded.
          </div>

          <div className="hr" />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <div
              style={{
                padding: 12,
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <div className="small" style={{ color: "rgba(255,255,255,0.70)" }}>
                Submission ID
              </div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>
                {result?.submission_id ?? "—"}
              </div>
            </div>

            <div
              style={{
                padding: 12,
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <div className="small" style={{ color: "rgba(255,255,255,0.70)" }}>
                Status
              </div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>
                {result?.status ?? "SUBMITTED"}
              </div>
            </div>
          </div>
        </Modal>
      )}

      <div className="header">
        <div>
          <h1 className="h-title">Final approval</h1>
          <p className="h-sub">Check the details below and confirm submission.</p>
        </div>
        <div className={`badge ${badgeClassForState(reviewState)}`}>
          <span className="dot" /> Status: <b>{reviewState}</b>
        </div>
      </div>

      <div className="grid grid-2">
        {/* LEFT */}
        <div className="grid">
          <div className="card">
            <div style={{ fontWeight: 900, fontSize: 16 }}>Summary</div>
            <div className="small">This is what will be submitted.</div>
            <div className="hr" />

            <table className="table">
              <tbody>
                <tr>
                  <td style={{ width: 220, color: "rgba(255,255,255,0.70)", fontWeight: 700 }}>
                    Receipt ID
                  </td>
                  <td style={{ fontWeight: 800 }}>{extracted.receipt_id}</td>
                </tr>
                <tr>
                  <td style={{ color: "rgba(255,255,255,0.70)", fontWeight: 700 }}>
                    Rule references
                  </td>
                  <td style={{ fontWeight: 800 }}>{ruleIds.join(", ") || "None"}</td>
                </tr>
                {receiptNote.trim() && (
                  <tr>
                    <td style={{ color: "rgba(255,255,255,0.70)", fontWeight: 700 }}>
                      Note (optional)
                    </td>
                    <td className="muted" style={{ fontWeight: 700 }}>
                      {receiptNote}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="hr" />

            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => nav("/review")} disabled={submitting}>
                Back
              </button>
              <button className="btn btn-ghost" onClick={startNewExpense} disabled={submitting}>
                Start new expense
              </button>
            </div>
          </div>

          <div className="card">
            <div style={{ fontWeight: 900, fontSize: 16 }}>Final fields</div>
            <div className="small">Final values after your review.</div>
            <div className="hr" />

            <table className="table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {displayKeys.map((k) => (
                  <tr key={k}>
                    <td style={{ fontWeight: 800 }}>{k.replaceAll("_", " ")}</td>
                    <td className="muted">{displayValue(fields[k]?.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(edits.length > 0 || justifications.length > 0) && (
            <div className="card">
              <div style={{ fontWeight: 900, fontSize: 16 }}>Your changes</div>
              <div className="small">Only shown if you changed something.</div>
              <div className="hr" />

              {edits.length > 0 && (
                <>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Edits</div>
                  <ul className="muted" style={{ marginTop: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    {edits.map((e, idx) => (
                      <li key={idx}>
                        <b>{e.field}</b>: {String(e.from)} → {String(e.to)}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {justifications.length > 0 && (
                <>
                  <div style={{ fontWeight: 800, marginTop: 12, marginBottom: 6 }}>
                    Justifications
                  </div>
                  <ul className="muted" style={{ marginTop: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    {justifications.map((j, idx) => (
                      <li key={idx}>
                        <b>{j.field}</b>: {j.text}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="grid">
          <div className="card">
            <div style={{ fontWeight: 950, fontSize: 16 }}>Confirm submission</div>
            <div className="small">Submission happens only after your confirmation.</div>

            <div className="hr" />

            <label className="row" style={{ alignItems: "flex-start", gap: 10 }}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 800 }}>
                  I confirm the information is correct and approve submission.
                </div>
                <div className="small">You remain responsible for the final decision.</div>
              </div>
            </label>

            <div className="hr" />

            <button className="btn btn-primary" disabled={!confirmed || submitting} onClick={submit}>
              {submitting ? "Submitting…" : "Submit expense"}
            </button>

            {!confirmed && (
              <div className="small" style={{ marginTop: 10 }}>
                Tip: Tick the checkbox to enable submission.
              </div>
            )}

            {err && <div style={{ marginTop: 10, color: "#ffb3b3" }}>{err}</div>}
          </div>

          <div className="card">
            <div style={{ fontWeight: 900, fontSize: 16 }}>After submission</div>
            <div className="small">You can immediately start a new expense.</div>
            <div className="hr" />
            <button className="btn btn-ghost" onClick={startNewExpense} disabled={submitting}>
              Start new expense
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}