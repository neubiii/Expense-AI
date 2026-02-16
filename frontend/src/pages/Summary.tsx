import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSubmission } from "../api/client";
import { loadSession, saveSession } from "./state";
import type {
  ExtractResponse,
  PolicyResponse,
  ReviewState,
  EditRecord,
  JustificationRecord,
} from "../types";

function renderConfidence(fieldKey: string, fields: any, extractedFields: any) {
  const f = fields[fieldKey];

  // If the field was NOT extracted by OCR → manual
  if (!extractedFields?.[fieldKey]) {
    return <span className="pill high">Manual</span>;
  }

  // If confidence missing → manual
  if (typeof f?.confidence !== "number") {
    return <span className="pill high">Manual</span>;
  }

  return <span className="pill high">{Math.round(f.confidence * 100)}%</span>;
}

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
  ];
  keys.forEach((k) => sessionStorage.removeItem(k));
}

export default function Summary() {
  const nav = useNavigate();
  const extracted = loadSession<ExtractResponse>("extract");
  const fields = loadSession<any>("fields");
  const policy = loadSession<PolicyResponse>("policy");
  const reviewState = loadSession<ReviewState>("review_state");

  const edits = loadSession<EditRecord[]>("edits") || [];
  const justifications = loadSession<JustificationRecord[]>("justifications") || [];

  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  // Modal
  const [showSubmittedModal, setShowSubmittedModal] = useState(false);

  const ruleIds = useMemo(() => {
    if (!policy) return [];
    return Array.from(new Set(policy.issues.map((i) => i.rule_id)));
  }, [policy]);

  if (!extracted || !fields || !policy || !reviewState) {
    return (
      <div className="container">
        <div className="card">
          <div style={{ fontWeight: 800, fontSize: 18 }}>Missing session data</div>
          <div className="small" style={{ marginTop: 6 }}>
            Please restart from Upload.
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

  const finalSummaryRows = [
    { label: "Receipt ID", value: extracted.receipt_id },
    { label: "Decision state", value: reviewState },
    { label: "Compliance", value: policy.compliance },
    { label: "Policy evidence", value: ruleIds.join(", ") || "None" },
  ];

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
      {/*Submitted Modal */}
      {showSubmittedModal && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.78)", // darker backdrop
      display: "grid",
      placeItems: "center",
      zIndex: 999,
      padding: 16,
    }}
    onClick={() => startNewExpense()}
  >
    <div
      className="card"
      style={{
        width: "min(600px, 100%)",
        padding: 18,
        borderRadius: 14,
        background: "rgba(15, 22, 38, 0.98)", // almost solid
        border: "1px solid rgba(10,110,209,0.55)",
        boxShadow: "0 18px 60px rgba(0,0,0,0.65)", // strong shadow
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 950, fontSize: 20, lineHeight: 1.2 }}>
            Submitted successfully
          </div>
          <div className="small" style={{ marginTop: 8, color: "rgba(255,255,255,0.80)" }}>
            Your expense was submitted and recorded.
          </div>
        </div>
        <button className="btn btn-ghost" onClick={() => startNewExpense()}>
          Close
        </button>
      </div>

      <div className="hr" style={{ marginTop: 14, marginBottom: 14 }} />

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

      <div className="hr" style={{ marginTop: 14, marginBottom: 14 }} />

      <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
        <button className="btn btn-primary" onClick={startNewExpense}>
          Start new expense
        </button>
      </div>

      <div className="small" style={{ marginTop: 10, color: "rgba(255,255,255,0.65)" }}>
        Tip: click outside the popup to start a new expense immediately.
      </div>
    </div>
  </div>
)}

      <div className="header">
        <div>
          <h1 className="h-title">Final Summary</h1>
          <p className="h-sub">
            Review the final values and confirm submission.
          </p>
        </div>
        <div className={`badge ${badgeClassForState(reviewState)}`}>
          <span className="dot" /> Decision: <b>{reviewState}</b>
        </div>
      </div>

      <div className="grid grid-2">
        {/* LEFT */}
        <div className="grid">
          {/* Overview */}
          <div className="card">
            <div style={{ fontWeight: 900, fontSize: 16 }}>Overview</div>
            <div className="small">System outputs and policy evidence.</div>
            <div className="hr" />

            <table className="table">
              <tbody>
                {finalSummaryRows.map((r) => (
                  <tr key={r.label}>
                    <td style={{ width: 220, color: "rgba(255,255,255,0.70)", fontWeight: 700 }}>
                      {r.label}
                    </td>
                    <td style={{ fontWeight: 800 }}>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="hr" />

            <div className="row">
              <button className="btn btn-ghost" onClick={() => nav("/review")} disabled={submitting}>
                Back to Review
              </button>
              <button className="btn btn-ghost" onClick={startNewExpense} disabled={submitting}>
                Start new expense
              </button>
            </div>
          </div>

          {/* Final fields */}
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Final fields</div>
                <div className="small">These values will be submitted.</div>
              </div>
              <button className="btn btn-ghost" onClick={() => setShowRaw((s) => !s)}>
                {showRaw ? "Hide raw JSON" : "Show raw JSON"}
              </button>
            </div>

            <div className="hr" />

            <table className="table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {displayKeys.map((k) => (
                  <tr key={k}>
                    <td style={{ fontWeight: 800 }}>{k.replaceAll("_", " ")}</td>
                    <td className="muted">
                      {typeof fields[k]?.value === "boolean"
                        ? fields[k].value
                          ? "Yes"
                          : "No"
                        : (fields[k]?.value ?? "").toString()}
                    </td>
                    <td>{renderConfidence(k, fields, extracted.fields)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {showRaw && (
              <>
                <div className="hr" />
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "rgba(255,255,255,0.78)" }}>
                  {JSON.stringify(fields, null, 2)}
                </pre>
              </>
            )}
          </div>

          {/* Audit trail (optional, but user-friendly labels) */}
          {(edits.length > 0 || justifications.length > 0) && (
            <div className="card">
              <div style={{ fontWeight: 900, fontSize: 16 }}>Your changes</div>
              <div className="small">Edits and justifications added during review.</div>
              <div className="hr" />

              {edits.length > 0 && (
                <>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Edited fields</div>
                  <ul className="muted" style={{ marginTop: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    {edits.map((e, idx) => (
                      <li key={idx}>
                        <b>{e.field}</b>: <span className="muted">{String(e.from)}</span> →{" "}
                        <span>{String(e.to)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {justifications.length > 0 && (
                <>
                  <div style={{ fontWeight: 800, marginTop: 12, marginBottom: 6 }}>Justifications</div>
                  <ul className="muted" style={{ marginTop: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    {justifications.map((j, idx) => (
                      <li key={idx}>
                        <b>{j.field}</b> — <code>{j.rule_id}</code>:{" "}
                        <span style={{ whiteSpace: "pre-wrap" }}>{j.text}</span>
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
          {/* Confirmation */}
          <div className="card">
            <div style={{ fontWeight: 950, fontSize: 16 }}>Confirm submission</div>
            <div className="small">
              Submission happens only after you confirm.
            </div>

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
                  I confirm the information above is correct and approve submission.
                </div>
                <div className="small">This is the human-in-the-loop control point.</div>
              </div>
            </label>

            <div className="hr" />

            <button
              className="btn btn-primary"
              disabled={!confirmed || submitting || Boolean(result)}
              onClick={submit}
            >
              {submitting ? "Submitting…" : "Submit expense"}
            </button>

            {!confirmed && (
              <div className="small" style={{ marginTop: 10 }}>
                Tip: Tick the checkbox to enable submission.
              </div>
            )}

            {err && <div style={{ marginTop: 10, color: "#ffb3b3" }}>{err}</div>}
          </div>

          {/* Light helper card */}
          <div className="card">
            <div style={{ fontWeight: 900, fontSize: 16 }}>What happens next?</div>
            <div className="small">After submission you can start a new expense immediately.</div>
            <div className="hr" />
            <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>System records final values + evidence</li>
              <li>Submission is confirmed by the user</li>
              <li>You can upload a new receipt and repeat</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
