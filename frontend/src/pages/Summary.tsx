import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSubmission } from "../api/client";
import { loadSession } from "./state";
import type { ExtractResponse, PolicyResponse, ReviewState } from "../types";

function renderConfidence(
  fieldKey: string,
  fields: any,
  extractedFields: any
) {
  const f = fields[fieldKey];

  // If the field was NOT extracted by OCR → manual
  if (!extractedFields?.[fieldKey]) {
    return <span className="pill high">Manual</span>;
  }

  // If confidence missing → manual
  if (typeof f?.confidence !== "number") {
    return <span className="pill high">Manual</span>;
  }

  return (
    <span className="pill high">
      {Math.round(f.confidence * 100)}%
    </span>
  );
}
function badgeClassForState(state?: string) {
  if (state === "GREEN") return "ok";
  if (state === "YELLOW") return "warn";
  if (state === "RED") return "bad";
  return "blue";
}

export default function Summary() {
  const nav = useNavigate();
  const extracted = loadSession<ExtractResponse>("extract");
  const fields = loadSession<any>("fields");
  const policy = loadSession<PolicyResponse>("policy");
  const reviewState = loadSession<ReviewState>("review_state");

  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");
  const [showRaw, setShowRaw] = useState(false);

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
          <button className="btn btn-primary" onClick={() => nav("/upload")}>
            Go to Upload
          </button>
        </div>
      </div>
    );
  }

  const finalSummaryRows = [
    { label: "Receipt ID", value: extracted.receipt_id },
    { label: "Review State", value: reviewState },
    { label: "Compliance", value: policy.compliance },
    { label: "Policy evidence (Rule IDs)", value: ruleIds.join(", ") || "None" },
  ];

  // Pick a friendly subset to show (core + extra)
  const displayKeys = [
    "merchant",
    "date",
    "total",
    "currency",
    "category",
    "business_purpose",
    "cost_center",
    "project_code",
    "payment_type",
    "reimbursable",
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
        edits: [], // optional later
      };

      const res = await createSubmission(payload);
      setResult(res);
    } catch (e: any) {
      setErr(e?.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="h-title">Final Summary & Confirmation</h1>
          <p className="h-sub">
            Review the final expense data and explicitly approve submission. This step enforces human authority (HITL).
          </p>
        </div>
        <div className={`badge ${badgeClassForState(reviewState)}`}>
          <span className="dot" /> Decision: <b>{reviewState}</b>
        </div>
      </div>

      <div className="grid grid-2">
        {/* LEFT */}
        <div className="grid">
          {/* Summary card */}
          <div className="card">
            <div style={{ fontWeight: 800, fontSize: 16 }}>Submission overview</div>
            <div className="small">Key system outputs + policy evidence.</div>
            <div className="hr" />

            <table className="table">
              <tbody>
                {finalSummaryRows.map((r) => (
                  <tr key={r.label}>
                    <td style={{ width: 220, color: "rgba(255,255,255,0.70)", fontWeight: 700 }}>
                      {r.label}
                    </td>
                    <td style={{ fontWeight: 700 }}>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="hr" />

            <div className="row">
              <button className="btn btn-ghost" onClick={() => nav("/review")} disabled={submitting}>
                Back to Review
              </button>
              <button className="btn btn-ghost" onClick={() => nav("/upload")} disabled={submitting}>
                Start New Upload
              </button>
            </div>
          </div>

          {/* Final fields */}
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Final fields</div>
                <div className="small">The values that will be stored in the submission record.</div>
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
                    <td style={{ fontWeight: 750 }}>{k.replaceAll("_", " ")}</td>
                    <td className="muted">
                      {typeof fields[k]?.value === "boolean"
                        ? fields[k].value ? "Yes" : "No"
                        : (fields[k]?.value ?? "").toString()}
                    </td>
                    <td>
                      {renderConfidence(k, fields, extracted.fields)}
                    </td>
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

          {/* Issues */}
          {policy.issues.length > 0 && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>Issues & evidence</div>
                  <div className="small">These items justify the review state and policy evidence.</div>
                </div>
                <span className={`badge ${policy.compliance === "FAIL" ? "bad" : "warn"}`}>
                  <span className="dot" /> {policy.issues.length} item(s)
                </span>
              </div>

              <div className="hr" />

              <table className="table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Field</th>
                    <th>Rule</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {policy.issues.map((i, idx) => (
                    <tr key={idx}>
                      <td>
                        <span className={`pill ${i.severity === "FAIL" ? "low" : "mid"}`}>
                          {i.severity}
                        </span>
                      </td>
                      <td style={{ fontWeight: 750 }}>{i.field}</td>
                      <td>
                        <code>{i.rule_id}</code>
                      </td>
                      <td className="muted">{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="grid">
          {/* Human confirmation */}
          <div className="card">
            <div style={{ fontWeight: 900, fontSize: 16 }}>Human authority</div>
            <div className="small">
              Submission is blocked until the user explicitly confirms the final summary.
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
                <div style={{ fontWeight: 750 }}>
                  I confirm the information above is correct and approve submission.
                </div>
                <div className="small">
                  This action represents the human-in-the-loop control point.
                </div>
              </div>
            </label>

            <div className="hr" />

            <button
              className="btn btn-primary"
              disabled={!confirmed || submitting || Boolean(result)}
              onClick={submit}
            >
              {submitting ? "Submitting…" : "Submit Final Expense"}
            </button>

            {!confirmed && (
              <div className="small" style={{ marginTop: 10 }}>
                ✅ Tip: Tick the confirmation checkbox to enable submission.
              </div>
            )}

            {err && <div style={{ marginTop: 10, color: "#ffb3b3" }}>{err}</div>}
          </div>

          {/* Result */}
          {result && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>Submission result</div>
                  <div className="small">The backend created a submission record.</div>
                </div>
                <span className="badge ok">
                  <span className="dot" /> Submitted
                </span>
              </div>

              <div className="hr" />

              <table className="table">
                <tbody>
                  <tr>
                    <td style={{ width: 180, color: "rgba(255,255,255,0.70)", fontWeight: 700 }}>
                      Status
                    </td>
                    <td style={{ fontWeight: 800 }}>{result.status}</td>
                  </tr>
                  {"submission_id" in result && (
                    <tr>
                      <td style={{ color: "rgba(255,255,255,0.70)", fontWeight: 700 }}>
                        Submission ID
                      </td>
                      <td style={{ fontWeight: 800 }}>{result.submission_id}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="hr" />

              <div className="small">
                You can verify this in <b>expense_ai.db</b> (submissions + audit events).
              </div>
            </div>
          )}

          {/* Optional note */}
          <div className="card">
            <div style={{ fontWeight: 800, fontSize: 16 }}>What’s stored</div>
            <div className="small">A traceable submission record with policy evidence and audit log.</div>
            <div className="hr" />
            <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Final fields (corrected by the user)</li>
              <li>Review state (GREEN / YELLOW / RED)</li>
              <li>Triggered policy rule IDs</li>
              <li>Issues (evidence) and timestamps</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
