import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { explain, validatePolicy } from "../api/client";
import { loadSession, saveSession } from "./state";
import type {
  ExtractResponse,
  PolicyResponse,
  EditRecord,
  JustificationRecord,
} from "../types";
import { computeReviewState } from "./reviewState";

const CATEGORY_OPTIONS = [
  "Meals",
  "Travel",
  "Lodging",
  "Local Transport",
  "Office Supplies",
  "Software / Subscriptions",
  "Client Entertainment",
  "Training / Education",
  "Other",
];

// deterministic suggestion only (user confirms)
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Meals: [
    "restaurant",
    "cafe",
    "coffee",
    "bar",
    "grill",
    "pizza",
    "starbucks",
    "friscos",
    "del friscos",
    "lunch",
    "dinner",
    "breakfast",
  ],
  Lodging: ["hotel", "inn", "motel", "hilton", "marriott", "booking", "airbnb", "stay"],
  Travel: ["airline", "flight", "boarding", "train", "bahn", "db", "ticket", "airport"],
  "Local Transport": ["uber", "lyft", "taxi", "metro", "bus", "parking", "toll", "tram"],
  "Office Supplies": ["office", "stationery", "staples", "paper", "pen", "printer", "supplies"],
  "Software / Subscriptions": ["subscription", "license", "software", "cloud", "saas", "github"],
  "Client Entertainment": ["client", "customer", "prospect", "entertainment"],
  "Training / Education": ["training", "workshop", "seminar", "conference", "course", "education"],
};

const FIELD_ORDER = [
  "merchant",
  "date",
  "total",
  "currency",
  "category",
  "description",
  "business_purpose",
  "payment_type",
  "reimbursable",
];

// Rules that can be resolved / downgraded deterministically with user justification evidence
const JUSTIFIABLE_RULES = new Set(["POL-LIM-010", "POL-LIM-020", "POL-DATE-030"]);

function nowIso() {
  return new Date().toISOString();
}

function normalize(s: string) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Deterministic category suggestion.
 * We use: merchant + OCR preview + optional user note (voice/text).
 */
function suggestCategory(extracted: ExtractResponse, receiptNote: string) {
  const merchant = normalize(String(extracted.fields?.merchant?.value || ""));
  const raw = normalize(String(extracted.raw_text_preview || ""));
  const note = normalize(String(receiptNote || ""));

  const text = `${merchant}\n${raw}\n${note}`;

  let best = { value: "Other", confidence: 0.25 };

  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    let hits = 0;
    for (const kw of kws) if (text.includes(kw)) hits++;
    if (hits > 0) {
      const conf = Math.min(0.9, 0.35 + hits * 0.12); // bounded deterministic score
      if (conf > best.confidence) best = { value: cat, confidence: conf };
    }
  }
  return best;
}

/**
 * Prefill fields using deterministic logic:
 * - category suggestion if empty / Other / Uncategorized
 * - description + business purpose from receipt note if empty
 */
function withDefaults(extracted: ExtractResponse, receiptNote: string) {
  const base = extracted.fields;

  const catVal = String(base.category?.value || "");
  const needsSuggestion =
    !catVal || normalize(catVal) === "uncategorized" || normalize(catVal) === "other";

  const suggestion = suggestCategory(extracted, receiptNote);

  // Description + business purpose: prefill only if empty
  const note = (receiptNote || "").trim();
  const firstLine = note ? note.split("\n").map((x) => x.trim()).filter(Boolean)[0] : "";

  const existingDesc = String(base.description?.value || "").trim();
  const existingBP = String(base.business_purpose?.value || "").trim();

  const descPrefill = existingDesc || (firstLine ? firstLine.slice(0, 140) : "");
  const bpPrefill =
    existingBP ||
    (note
      ? "Business expense (note provided)"
      : "");

  return {
    ...base,
    category: needsSuggestion
      ? { value: suggestion.value, confidence: suggestion.confidence }
      : base.category,
    description: base.description ?? { value: descPrefill, confidence: 1.0 },
    business_purpose: base.business_purpose ?? { value: bpPrefill, confidence: 1.0 },
    payment_type: base.payment_type ?? { value: "Corporate Card", confidence: 1.0 },
    reimbursable: base.reimbursable ?? { value: true, confidence: 1.0 },
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
  const label =
    pct >= 75 ? `High (${pct}%)` : pct >= 50 ? `Medium (${pct}%)` : `Low (${pct}%)`;
  const cls = pct >= 75 ? "high" : pct >= 50 ? "mid" : "low";
  return <span className={`pill ${cls}`}>{label}</span>;
}

function ruleSummary(policy: PolicyResponse | null, ruleId: string) {
  const s = policy?.rule_summaries?.find((r) => r.rule_id === ruleId);
  return s?.summary || "";
}

function fixHint(ruleId: string, field: string) {
  switch (ruleId) {
    case "POL-REQ-001":
      return `Fill the required field: ${field}.`;
    case "POL-CONF-100":
      return `Verify and correct the ${field} value (OCR is uncertain).`;
    case "POL-PARSE-101":
      return "Enter the amount manually using a valid number format.";
    case "POL-LIM-010":
      return "If this was a valid business meal above the limit, add a justification (business purpose / attendees).";
    case "POL-LIM-020":
      return "Add justification for exceeding the daily limit or split if allowed by policy.";
    case "POL-DATE-030":
      return "Confirm date correctness and justify late/out-of-range submission if policy allows.";
    case "POL-CAT-050":
      return "Choose a more suitable category from the dropdown.";
    default:
      return "Review the field and re-check policy after making changes.";
  }
}

export default function Review() {
  const nav = useNavigate();
  const extracted = loadSession<ExtractResponse>("extract");

  // ✅ New: receipt note from Upload step (text/voice transcript)
  const receiptNote = (loadSession<string>("receipt_note") || "").trim();

  const [fields, setFields] = useState<any>(
    extracted ? withDefaults(extracted, receiptNote) : null
  );
  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [err, setErr] = useState("");

  // Audit trail (persisted)
  const [edits, setEdits] = useState<EditRecord[]>(
    () => loadSession<EditRecord[]>("edits") || []
  );
  const [justifications, setJustifications] = useState<JustificationRecord[]>(
    () => loadSession<JustificationRecord[]>("justifications") || []
  );

  // Keep original values to compute “edited”
  const originalRef = useRef<any>(extracted ? withDefaults(extracted, receiptNote) : null);

  // Explain panel
  const [ask, setAsk] = useState("What should I do next?");
  const [loadingExplain, setLoadingExplain] = useState(false);
  const [explainText, setExplainText] = useState<string>("");
  const [clarQs, setClarQs] = useState<string[]>([]);
  const [explainErr, setExplainErr] = useState<string>("");

  // Justification UI
  const [openJustifyKey, setOpenJustifyKey] = useState<string | null>(null); // `${field}|${rule}`
  const [justifyDraft, setJustifyDraft] = useState<string>("");

  useEffect(() => {
    if (!extracted) nav("/upload");
  }, [extracted, nav]);

  const reviewState = useMemo(() => {
    if (!policy || !fields) return null;
    return computeReviewState(fields, policy);
  }, [fields, policy]);

  // Map justifications -> { rule_id: text } for backend
  const justMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const j of justifications) {
      if (j.rule_id && j.text) m[j.rule_id] = j.text;
    }
    return m;
  }, [justifications]);

  function isEdited(field: string) {
    return edits.some((e) => e.field === field);
  }

  function getJustification(field: string, ruleId: string) {
    return justifications.find((j) => j.field === field && j.rule_id === ruleId);
  }

  function upsertEdit(field: string, fromVal: any, toVal: any) {
    setEdits((prev) => {
      const sameAsOriginal =
        JSON.stringify(fromVal ?? null) === JSON.stringify(toVal ?? null);

      // If reverted back to original → remove edit record
      if (sameAsOriginal) {
        const next = prev.filter((e) => e.field !== field);
        saveSession("edits", next);
        return next;
      }

      const existing = prev.find((e) => e.field === field);
      const next: EditRecord[] = existing
        ? prev.map((e) => (e.field === field ? { ...e, to: toVal, at: nowIso() } : e))
        : [...prev, { field, from: fromVal, to: toVal, at: nowIso() }];

      saveSession("edits", next);
      return next;
    });
  }

  function updateField(name: string, value: any) {
    setFields((prev: any) => {
      const next = {
        ...prev,
        [name]: {
          ...(prev?.[name] ?? { confidence: 1.0 }),
          value,
        },
      };

      const originalVal = originalRef.current?.[name]?.value;
      upsertEdit(name, originalVal, value);

      return next;
    });
  }

  function justificationTargetsForField(fieldName: string) {
    const targets: { rule_id: string; severity: "WARN" | "FAIL" }[] = [];
    for (const i of policy?.issues || []) {
      if (i.field === fieldName && JUSTIFIABLE_RULES.has(i.rule_id)) {
        targets.push({ rule_id: i.rule_id, severity: i.severity });
      }
    }
    return targets;
  }

  function openJustify(fieldName: string, ruleId: string) {
    const key = `${fieldName}|${ruleId}`;
    setOpenJustifyKey(key);
    const existing = getJustification(fieldName, ruleId);
    setJustifyDraft(existing?.text || "");
  }

  function saveJustify(fieldName: string, ruleId: string) {
    const text = (justifyDraft || "").trim();
    if (!text) return;

    setJustifications((prev) => {
      const existing = prev.find((j) => j.field === fieldName && j.rule_id === ruleId);
      const next: JustificationRecord[] = existing
        ? prev.map((j) =>
            j.field === fieldName && j.rule_id === ruleId ? { ...j, text, at: nowIso() } : j
          )
        : [...prev, { field: fieldName, rule_id: ruleId, text, at: nowIso() }];

      saveSession("justifications", next);
      return next;
    });

    setOpenJustifyKey(null);
    setJustifyDraft("");
  }

  async function runPolicyCheck(currentFields = fields) {
    if (!extracted || !currentFields) return;
    setLoadingPolicy(true);
    setErr("");

    try {
      const res = await validatePolicy({
        receipt_id: extracted.receipt_id,
        fields: currentFields,
        user_context: {
          country: "DE",
          role: "Employee",
          justifications: justMap,
        },
      });

      setPolicy(res);
      saveSession("policy", res);

      // Auto explain if issues exist
      setExplainText("");
      setClarQs([]);
      setExplainErr("");

      if (res.issues?.length) {
        setLoadingExplain(true);
        try {
          const exp = await explain({
            fields: currentFields,
            issues: res.issues,
            rule_summaries: res.rule_summaries ?? [],
            user_question: "Explain what is flagged and what I should do next.",
          });
          setExplainText(exp.explanation || "");
          setClarQs(exp.clarification_questions || []);
        } catch (e: any) {
          setExplainErr(e?.message || "Auto-explain failed");
        } finally {
          setLoadingExplain(false);
        }
      }
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

  async function onExplain() {
    if (!policy || !fields) return;
    setLoadingExplain(true);
    setExplainErr("");
    try {
      const res = await explain({
        fields,
        issues: policy.issues,
        rule_summaries: policy.rule_summaries ?? [],
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
    saveSession("edits", edits);
    saveSession("justifications", justifications);
    nav("/summary");
  }

  if (!extracted || !fields) return null;

  const evidenceIds = policy ? Array.from(new Set(policy.issues.map((i) => i.rule_id))) : [];

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="h-title">Review flagged fields</h1>
          <p className="h-sub">
            OCR extracted the fields. The policy engine checked compliance using deterministic rules.
            Your edits and justifications are captured as an audit trail.
          </p>
        </div>

        <div className={`badge ${badgeClassForState(reviewState ?? "")}`}>
          <span className="dot" />
          Status: <b>{reviewState ?? "…"}</b>
        </div>
      </div>

      <div className="grid grid-2">
        {/* LEFT */}
        <div className="grid">
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="kpi">
                <div className="label">Receipt</div>
                <div className="value" style={{ fontSize: 16 }}>
                  ID: <span className="muted">{extracted.receipt_id}</span>
                </div>
                <div className="small">
                  {policy ? (
                    <>
                      <b>Compliance:</b> {policy.compliance} • <b>Evidence:</b>{" "}
                      {evidenceIds.length ? evidenceIds.join(", ") : "None"}
                    </>
                  ) : (
                    "Running policy check…"
                  )}
                </div>
              </div>

              <div className="row">
                <button className="btn btn-ghost" onClick={() => nav("/upload")} disabled={loadingPolicy}>
                  Back
                </button>
                <button className="btn btn-primary" disabled={loadingPolicy} onClick={() => runPolicyCheck(fields)}>
                  {loadingPolicy ? "Checking…" : "Re-check Policy"}
                </button>
              </div>
            </div>

            {err && <div style={{ marginTop: 12, color: "#ffb3b3" }}>{err}</div>}
          </div>

          {/* ✅ New: Receipt note card (voice/text)
          {receiptNote && (
            <div className="card">
              <div style={{ fontWeight: 900, fontSize: 16 }}>Receipt note (optional)</div>
              <div className="small">
                This note was provided by the user (typed or voice transcript). It is used only to prefill fields and add context.
              </div>
              <div className="hr" />
              <pre style={{ whiteSpace: "pre-wrap", margin: 0, color: "rgba(255,255,255,0.80)" }}>
                {receiptNote}
              </pre>
            </div>
          )} */}

          {/* Issues */}
          {policy && policy.issues?.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 900, fontSize: 16 }}>What needs your attention</div>
              <div className="small">Rule ID = evidence. Summary = human-readable policy meaning.</div>
              <div className="hr" />

              <div className="grid" style={{ gap: 10 }}>
                {policy.issues.map((i, idx) => (
                  <div
                    key={idx}
                    className="card"
                    style={{ padding: 12, background: "rgba(255,255,255,0.04)" }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 900 }}>
                          {i.severity} • <span className="muted">{i.field}</span>
                        </div>
                        <div className="small" style={{ marginTop: 6 }}>
                          <b>Rule:</b> <code>{i.rule_id}</code>
                          {ruleSummary(policy, i.rule_id) ? (
                            <> — <span className="muted">{ruleSummary(policy, i.rule_id)}</span></>
                          ) : null}
                        </div>
                      </div>

                      <span className={`badge ${i.severity === "FAIL" ? "bad" : "warn"}`}>
                        <span className="dot" /> {i.severity}
                      </span>
                    </div>

                    <div className="hr" />

                    <div className="small">
                      <b>System message:</b> <span className="muted">{i.message}</span>
                    </div>
                    <div className="small" style={{ marginTop: 6 }}>
                      <b>What to do:</b> <span className="muted">{fixHint(i.rule_id, i.field)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Form */}
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Expense form</div>
                <div className="small">
                  Confidence is an OCR signal. “Edited/Justified” are human verification signals.
                </div>
              </div>
              <span className="badge blue">
                <span className="dot" /> Editable
              </span>
            </div>

            <div className="hr" />

            <div className="grid" style={{ gridTemplateColumns: "220px 1fr 220px", gap: 10 }}>
              {FIELD_ORDER.map((name) => {
                const fv = fields[name];
                if (!fv) return null;

                const conf = typeof fv.confidence === "number" ? fv.confidence : 1.0;
                const isBool = typeof fv.value === "boolean";
                const isSelect = name === "payment_type";
                const isCurrency = name === "currency";
                const isCategory = name === "category";
                const isTextArea = name === "description" || name === "business_purpose";

                const manualSignal = ["description", "business_purpose", "category", "payment_type", "reimbursable"].includes(name);

                const targets = justificationTargetsForField(name);

                return (
                  <div key={name} style={{ display: "contents" }}>
                    <div style={{ paddingTop: 10, fontWeight: 800 }}>
                      {name.replaceAll("_", " ")}
                      {isEdited(name) && (
                        <span className="pill high" style={{ marginLeft: 10 }}>
                          Edited
                        </span>
                      )}
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
                      ) : isCategory ? (
                        <select value={fv.value} onChange={(e) => updateField(name, e.target.value)}>
                          {CATEGORY_OPTIONS.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : isTextArea ? (
                        <textarea
                          rows={3}
                          value={fv.value ?? ""}
                          onChange={(e) => updateField(name, e.target.value)}
                          placeholder={name === "business_purpose" ? "e.g., Client lunch / workshop / travel" : "Optional notes"}
                        />
                      ) : (
                        <input
                          className="input"
                          value={fv.value ?? ""}
                          onChange={(e) => updateField(name, e.target.value)}
                        />
                      )}

                      {/* Justification UI */}
                      {targets.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          {targets.map((t) => {
                            const existing = getJustification(name, t.rule_id);
                            const key = `${name}|${t.rule_id}`;

                            return (
                              <div key={t.rule_id} style={{ marginTop: 6 }}>
                                <div className="row" style={{ gap: 10, alignItems: "center" }}>
                                  <span className={`badge ${t.severity === "FAIL" ? "bad" : "warn"}`}>
                                    <span className="dot" /> {t.rule_id}
                                  </span>

                                  {existing ? (
                                    <span className="pill high">Justified</span>
                                  ) : (
                                    <button
                                      className="btn btn-ghost"
                                      type="button"
                                      onClick={() => openJustify(name, t.rule_id)}
                                    >
                                      Add justification
                                    </button>
                                  )}
                                </div>

                                {existing && (
                                  <div className="small muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                                    <b>Justification:</b> {existing.text}
                                  </div>
                                )}

                                {openJustifyKey === key && (
                                  <div style={{ marginTop: 8 }}>
                                    <textarea
                                      rows={3}
                                      value={justifyDraft}
                                      onChange={(e) => setJustifyDraft(e.target.value)}
                                      placeholder="Write a short business justification..."
                                    />
                                    <div className="row" style={{ marginTop: 8, gap: 10 }}>
                                      <button
                                        className="btn btn-primary"
                                        type="button"
                                        onClick={() => saveJustify(name, t.rule_id)}
                                      >
                                        Save justification
                                      </button>
                                      <button
                                        className="btn btn-ghost"
                                        type="button"
                                        onClick={() => {
                                          setOpenJustifyKey(null);
                                          setJustifyDraft("");
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div style={{ paddingTop: 8 }}>
                      {manualSignal ? <span className="pill high">Manual</span> : pillForConfidence(conf)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hr" />
            <div className="small">
              After edits/justification, click <b>Re-check Policy</b> to recompute compliance.
            </div>
          </div>

          {extracted.raw_text_preview && (
            <div className="card">
              <div style={{ fontWeight: 900, fontSize: 16 }}>OCR preview (transparency)</div>
              <div className="small">Raw OCR output used to extract fields.</div>
              <div className="hr" />
              <pre style={{ whiteSpace: "pre-wrap", margin: 0, color: "rgba(255,255,255,0.78)" }}>
                {extracted.raw_text_preview}
              </pre>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="grid">
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Clarifications & explanation</div>
                <div className="small">Generated from issues + rule summaries (mock explainer).</div>
              </div>
              <span className="badge blue">
                <span className="dot" /> Assistive
              </span>
            </div>

            <div className="hr" />

            {loadingExplain && <div className="small">Generating clarifications…</div>}
            {explainErr && <div style={{ marginTop: 10, color: "#ffb3b3" }}>{explainErr}</div>}

            {clarQs.length > 0 && (
              <>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>What I need from you</div>
                <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                  {clarQs.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
                <div className="hr" />
              </>
            )}

            {explainText && (
              <>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Why it was flagged</div>
                <div className="muted" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {explainText}
                </div>
                <div className="hr" />
              </>
            )}

            <div style={{ fontWeight: 900, marginBottom: 6 }}>Ask a question (optional)</div>
            <input className="input" value={ask} onChange={(e) => setAsk(e.target.value)} />

            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" disabled={!policy || loadingExplain} onClick={onExplain}>
                {loadingExplain ? "Working…" : "Ask"}
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
          </div>

          <div className="card">
            <div style={{ fontWeight: 900, fontSize: 16 }}>Continue</div>
            <div className="small">Proceed to final summary and explicit human confirmation.</div>
            <div className="hr" />

            <button className="btn btn-primary" disabled={!policy || !reviewState} onClick={next}>
              Continue to Summary
            </button>

            <div className="small" style={{ marginTop: 10 }}>
              Submission is blocked until you confirm on the Summary step.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
