import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { explain, validatePolicy } from "../api/client";
import { loadSession, saveSession } from "./state";
import type { ExtractResponse, PolicyResponse } from "../types";
import { computeReviewState } from "./reviewState";

const FIELD_ORDER = [
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
];

function defaultExtraFields(fields: any) {
  return {
    ...fields,
    business_purpose: fields.business_purpose ?? { value: "", confidence: 1.0 },
    cost_center: fields.cost_center ?? { value: "", confidence: 1.0 },
    project_code: fields.project_code ?? { value: "", confidence: 1.0 },
    payment_type: fields.payment_type ?? { value: "Corporate Card", confidence: 1.0 },
    reimbursable: fields.reimbursable ?? { value: true, confidence: 1.0 },
  };
}

function badgeClassForState(state?: string) {
  if (state === "GREEN") return "ok";
  if (state === "YELLOW") return "warn";
  if (state === "RED") return "bad";
  return "blue";
}

function pillForConfidence(conf: number) {
  const pct = Math.round(conf * 100);
  const label = pct >= 75 ? `High (${pct}%)` : pct >= 50 ? `Medium (${pct}%)` : `Low (${pct}%)`;
  const cls = pct >= 75 ? "high" : pct >= 50 ? "mid" : "low";
  return <span className={`pill ${cls}`}>{label}</span>;
}

export default function Review() {
  const nav = useNavigate();
  const extracted = loadSession<ExtractResponse>("extract");

  const [fields, setFields] = useState<any>(
    extracted ? defaultExtraFields(extracted.fields) : null
  );

  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [err, setErr] = useState("");

  // Explain panel
  const [ask, setAsk] = useState("Why is this flagged?");
  const [loadingExplain, setLoadingExplain] = useState(false);
  const [explainText, setExplainText] = useState<string>("");
  const [clarQs, setClarQs] = useState<string[]>([]);
  const [explainErr, setExplainErr] = useState<string>("");

  useEffect(() => {
    if (!extracted) nav("/upload");
  }, [extracted, nav]);

  async function runPolicyCheck(currentFields = fields) {
    if (!extracted || !currentFields) return;
    setLoadingPolicy(true);
    setErr("");
    try {
      const res = await validatePolicy({
        receipt_id: extracted.receipt_id,
        fields: currentFields,
        user_context: { country: "DE", role: "Employee" },
      });

      setPolicy(res);
      saveSession("policy", res);

      // reset explain panel on new validation
      setExplainText("");
      setClarQs([]);
      setExplainErr("");
    } catch (e: any) {
      setErr(e?.message || "Policy validation failed");
    } finally {
      setLoadingPolicy(false);
    }
  }

  useEffect(() => {
    if (fields) runPolicyCheck(fields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reviewState = useMemo(() => {
    if (!policy || !fields) return null;
    return computeReviewState(fields, policy);
  }, [fields, policy]);

  function updateField(name: string, value: any) {
    setFields((prev: any) => ({
      ...prev,
      [name]: { ...(prev?.[name] ?? { confidence: 1.0 }), value },
    }));
  }

  async function onExplain() {
    if (!policy || !fields) return;
    setLoadingExplain(true);
    setExplainErr("");

    try {
      const ruleSummaries = (policy as any).rule_summaries ?? [];

      const res = await explain({
        fields,
        issues: policy.issues,
        rule_summaries: ruleSummaries,
        user_question: ask,
      });

      setExplainText(res.explanation || "");
      setClarQs(res.clarification_questions || []);
    } catch (e: any) {
      setExplainErr(e?.message || "Explain call failed");
    } finally {
      setLoadingExplain(false);
    }
  }

  function next() {
    if (!extracted || !policy || !fields || !reviewState) return;
    saveSession("fields", fields);
    saveSession("review_state", reviewState);
    nav("/summary");
  }

  if (!extracted || !fields) return null;

  const evidenceIds = policy ? Array.from(new Set(policy.issues.map((i) => i.rule_id))) : [];

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="h-title">Review & Confirm</h1>
          <p className="h-sub">
            Review extracted fields, correct uncertain values, and submit with explicit confirmation.
          </p>
        </div>

        <div className={`badge ${badgeClassForState(reviewState ?? "")}`}>
          <span className="dot" />
          Review State: <b>{reviewState ?? "…"}</b>
        </div>
      </div>

      <div className="grid grid-2">
        {/* LEFT: Main review */}
        <div className="grid">
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="kpi">
                <div className="label">Receipt</div>
                <div className="value" style={{ fontSize: 16 }}>
                  ID: <span className="muted">{extracted.receipt_id}</span>
                </div>
              </div>

              <div className="row">
                <button
                  className="btn btn-ghost"
                  onClick={() => nav("/upload")}
                  disabled={loadingPolicy}
                >
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  disabled={loadingPolicy}
                  onClick={() => runPolicyCheck(fields)}
                >
                  {loadingPolicy ? "Checking…" : "Re-check Policy"}
                </button>
              </div>
            </div>

            {policy && (
              <>
                <div className="hr" />
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="card" style={{ padding: 12, background: "rgba(255,255,255,0.04)" }}>
                    <div className="kpi">
                      <div className="label">Compliance</div>
                      <div className="value">{policy.compliance}</div>
                      <div className="small">Deterministic rule-based check (policy engine).</div>
                    </div>
                  </div>

                  <div className="card" style={{ padding: 12, background: "rgba(255,255,255,0.04)" }}>
                    <div className="kpi">
                      <div className="label">Policy evidence</div>
                      <div className="value" style={{ fontSize: 16 }}>
                        {evidenceIds.length ? evidenceIds.join(", ") : "None"}
                      </div>
                      <div className="small">Rule IDs returned for transparency & traceability.</div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {err && <div style={{ marginTop: 12, color: "#ffb3b3" }}>{err}</div>}
          </div>

          {/* Issues */}
          {policy && policy.issues?.length > 0 && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>Issues</div>
                  <div className="small">Address WARN/FAIL items before submission.</div>
                </div>
                <span className="badge warn">
                  <span className="dot" />
                  {policy.issues.length} item(s)
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
                      <td><span className={`pill ${i.severity === "FAIL" ? "low" : "mid"}`}>{i.severity}</span></td>
                      <td><b>{i.field}</b></td>
                      <td><code>{i.rule_id}</code></td>
                      <td className="muted">{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Expense form */}
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Expense Form</div>
                <div className="small">Low confidence fields should be reviewed and corrected.</div>
              </div>
              <span className="badge blue">
                <span className="dot" />
                Editable fields
              </span>
            </div>

            <div className="hr" />

            <div className="grid" style={{ gridTemplateColumns: "220px 1fr 170px", gap: 10 }}>
              {FIELD_ORDER.map((name) => {
                const fv = fields[name];
                if (!fv) return null;

                const conf = typeof fv.confidence === "number" ? fv.confidence : 1.0;

                const isBool = typeof fv.value === "boolean";
                const isSelect = name === "payment_type";
                const isCurrency = name === "currency";
                const isManual =
                  name === "business_purpose" ||
                  name === "cost_center" ||
                  name === "project_code" ||
                  name === "payment_type" ||
                  name === "reimbursable";

                return (
                  <div key={name} style={{ display: "contents" }}>
                    <div style={{ paddingTop: 10, fontWeight: 700 }}>
                      {name.replaceAll("_", " ")}
                    </div>

                    <div>
                      {isBool ? (
                        <label className="row" style={{ gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(fv.value)}
                            onChange={(e) => updateField(name, e.target.checked)}
                          />
                          <span className="muted">{fv.value ? "Yes" : "No"}</span>
                        </label>
                      ) : isSelect ? (
                        <select value={fv.value} onChange={(e) => updateField(name, e.target.value)}>
                          <option>Corporate Card</option>
                          <option>Cash</option>
                          <option>Personal Card</option>
                        </select>
                      ) : isCurrency ? (
                        <select value={fv.value} onChange={(e) => updateField(name, e.target.value)}>
                          <option>EUR</option>
                          <option>USD</option>
                          <option>GBP</option>
                          <option>INR</option>
                          <option>$</option>
                        </select>
                      ) : (
                        <input
                          className="input"
                          value={fv.value ?? ""}
                          onChange={(e) => updateField(name, e.target.value)}
                          placeholder={name === "business_purpose" ? "e.g., Client lunch" : ""}
                        />
                      )}
                    </div>

                    <div style={{ paddingTop: 8 }}>
                      {isManual ? <span className="pill high">Manual</span> : pillForConfidence(conf)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* OCR preview (collapsible-ish) */}
          {extracted.raw_text_preview && (
            <div className="card">
              <div style={{ fontWeight: 800, fontSize: 16 }}>OCR Text Preview</div>
              <div className="small">Used for transparency and debugging extraction.</div>
              <div className="hr" />
              <pre style={{ whiteSpace: "pre-wrap", margin: 0, color: "rgba(255,255,255,0.78)" }}>
                {extracted.raw_text_preview}
              </pre>
            </div>
          )}
        </div>

        {/* RIGHT: Explain & Actions */}
        <div className="grid">
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Explain & Clarify</div>
                <div className="small">Mocked explanation agent (no API key).</div>
              </div>
              <span className="badge blue">
                <span className="dot" />
                Policy-grounded
              </span>
            </div>

            <div className="hr" />

            <label className="small">Ask a question</label>
            <input className="input" value={ask} onChange={(e) => setAsk(e.target.value)} />

            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" disabled={!policy || loadingExplain} onClick={onExplain}>
                {loadingExplain ? "Explaining…" : "Explain"}
              </button>
              <button
                className="btn btn-ghost"
                disabled={loadingExplain}
                onClick={() => {
                  setExplainText("");
                  setClarQs([]);
                  setExplainErr("");
                }}
              >
                Clear
              </button>
            </div>

            {explainErr && <div style={{ marginTop: 10, color: "#ffb3b3" }}>{explainErr}</div>}

            {explainText && (
              <>
                <div className="hr" />
                <div style={{ fontWeight: 750, marginBottom: 6 }}>Explanation</div>
                <div className="muted" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {explainText}
                </div>
              </>
            )}

            {clarQs.length > 0 && (
              <>
                <div className="hr" />
                <div style={{ fontWeight: 750, marginBottom: 6 }}>Clarification questions</div>
                <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                  {clarQs.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </>
            )}
          </div>

          <div className="card">
            <div style={{ fontWeight: 800, fontSize: 16 }}>Next</div>
            <div className="small">Proceed to final summary and explicit human confirmation.</div>
            <div className="hr" />

            <button className="btn btn-primary" disabled={!policy || !reviewState} onClick={next}>
              Continue to Summary
            </button>

            <div className="small" style={{ marginTop: 10 }}>
              Submission is blocked unless the user confirms on the summary step.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
