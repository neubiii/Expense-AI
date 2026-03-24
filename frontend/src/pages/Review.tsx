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
    "eat out",
    "steak",
    "oyster",
    "ribeye",
    "filet",
    "asparagus",
    "gratin",
  ],
  Lodging: ["hotel", "inn", "motel", "hilton", "marriott", "booking", "airbnb"],
  Travel: ["airline", "flight", "boarding", "train", "bahn", "db", "ticket"],
  "Local Transport": ["uber", "lyft", "taxi", "metro", "bus", "parking", "toll"],
  "Office Supplies": ["office", "stationery", "staples", "paper", "pen", "printer"],
  "Software / Subscriptions": ["subscription", "license", "software", "cloud", "saas", "github"],
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

function suggestCategory(extracted: ExtractResponse) {
  const merchant = normalize(String(extracted.fields?.merchant?.value || ""));
  const raw = normalize(String(extracted.raw_text_preview || ""));
  const text = `${merchant}\n${raw}`;

  let best = { value: "Other", confidence: 0.25 };

  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    let hits = 0;
    for (const kw of kws) if (text.includes(kw)) hits++;
    if (hits > 0) {
      const conf = Math.min(0.9, 0.35 + hits * 0.15);
      if (conf > best.confidence) best = { value: cat, confidence: conf };
    }
  }

  if (best.value === "Other") {
    const mealTerms = ["oyster", "ribeye", "filet", "asparagus", "gratin", "steak"];
    const mealHits = mealTerms.filter((term) => text.includes(term)).length;
    if (mealHits >= 2) {
      return { value: "Meals", confidence: 0.78 };
    }
  }

  return best;
}

function withDefaults(extracted: ExtractResponse) {
  const base = extracted.fields;
  const catVal = String(base.category?.value || "");
  const needsSuggestion =
    !catVal || normalize(catVal) === "uncategorized" || normalize(catVal) === "other";

  const suggestion = suggestCategory(extracted);

  return {
    ...base,
    category: needsSuggestion
      ? { value: suggestion.value, confidence: suggestion.confidence }
      : base.category,
    description: base.description ?? { value: "", confidence: 1.0 },
    business_purpose: base.business_purpose ?? { value: "", confidence: 1.0 },
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

function ocrCertLabel(conf: number) {
  const pct = Math.round(conf * 100);
  if (pct >= 75) return { label: `High (${pct}%)`, cls: "high" };
  if (pct >= 50) return { label: `Medium (${pct}%)`, cls: "mid" };
  return { label: `Low (${pct}%)`, cls: "low" };
}

function reviewBannerCopy(state?: string) {
  if (state === "GREEN") {
    return {
      title: "✅ Looks good",
      body: "Values were extracted and checked. You can continue to final approval.",
      badge: "ok",
    };
  }
  if (state === "YELLOW") {
    return {
      title: "🟡 Please review highlighted fields",
      body: "Some values are uncertain. Confirm or correct them, then click “Update review” at the bottom.",
      badge: "warn",
    };
  }
  if (state === "RED") {
    return {
      title: "🔴 Action needed before you can continue",
      body: "Some information is missing or needs a short justification. Fix the highlighted fields, then click “Update review” at the bottom.",
      badge: "bad",
    };
  }
  return {
    title: "Checking…",
    body: "We’re running the review.",
    badge: "blue",
  };
}

function ruleSummary(policy: any, ruleId: string) {
  const s = policy?.rule_summaries?.find((r: any) => r.rule_id === ruleId);
  return s?.summary || "";
}

function plainFixHint(ruleId: string, field: string) {
  switch (ruleId) {
    case "POL-REQ-001":
      return `This is required. Please enter a value for ${field}.`;
    case "POL-CONF-100":
      return `OCR certainty is low. Please confirm or correct the ${field}.`;
    case "POL-PARSE-101":
      return "We could not read the amount reliably. Please enter the total manually.";
    case "POL-LIM-010":
      return "This exceeds the usual meal limit. If it’s valid, add a short justification.";
    case "POL-LIM-020":
      return "This exceeds the usual daily limit. Add a justification if it’s valid.";
    case "POL-DATE-030":
      return "The date may be outside the allowed submission window. Confirm the date and justify if needed.";
    case "POL-CAT-050":
      return "Please choose the category that best matches this receipt.";
    default:
      return "Please review this item and update the review.";
  }
}

function Modal({
  title,
  body,
  onClose,
  actions,
}: {
  title: string;
  body: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="card modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontWeight: 950, fontSize: 18 }}>{title}</div>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="hr" style={{ marginTop: 12, marginBottom: 12 }} />
        <div className="muted" style={{ lineHeight: 1.6 }}>
          {body}
        </div>

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

export default function Review() {
  const nav = useNavigate();
  const extracted = loadSession<ExtractResponse>("extract");

  const [fields, setFields] = useState<any>(extracted ? withDefaults(extracted) : null);
  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [err, setErr] = useState("");

  // Audit trail (persisted)
  const [edits, setEdits] = useState<EditRecord[]>(() => loadSession<EditRecord[]>("edits") || []);
  const [justifications, setJustifications] = useState<JustificationRecord[]>(
    () => loadSession<JustificationRecord[]>("justifications") || []
  );

  // Keep original values to compute “edited”
  const originalRef = useRef<any>(extracted ? withDefaults(extracted) : null);

  // “Need help?” explanation
  const [assistantText, setAssistantText] = useState<string>("");
  const [assistantQs, setAssistantQs] = useState<string[]>([]);
  const [assistantLoading, setAssistantLoading] = useState(false);

  // Justification UI
  const [openJustifyKey, setOpenJustifyKey] = useState<string | null>(null);
  const [justifyDraft, setJustifyDraft] = useState<string>("");

  // Dirty state
  const [dirty, setDirty] = useState(false);

  // Popup: user tried continue without updating review
  const [showNeedUpdateModal, setShowNeedUpdateModal] = useState(false);

  // Popup: intro popup when page opens
  const [showIntroModal, setShowIntroModal] = useState(true);

  useEffect(() => {
    if (!extracted) nav("/upload");
  }, [extracted, nav]);

  // Map justifications -> { rule_id: text } for backend
  const justMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const j of justifications) {
      if (j.rule_id && j.text) m[j.rule_id] = j.text;
    }
    return m;
  }, [justifications]);

  // Quick lookup: issues per field
  const issuesByField = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const i of policy?.issues || []) {
      map[i.field] = map[i.field] || [];
      map[i.field].push(i);
    }
    return map;
  }, [policy]);

  const reviewState = useMemo(() => {
    if (!policy || !fields) return null;
    return computeReviewState(fields, policy);
  }, [fields, policy]);

  const evidenceIds = useMemo(() => {
    return policy ? Array.from(new Set(policy.issues.map((i) => i.rule_id))) : [];
  }, [policy]);

  const bannerIssueSummary = useMemo(() => {
    if (!policy?.issues?.length) return "";
    const failCount = policy.issues.filter((i: any) => i.severity === "FAIL").length;
    const warnCount = policy.issues.filter((i: any) => i.severity === "WARN").length;

    const top = policy.issues
      .slice(0, 3)
      .map((i: any) => `${i.field.replaceAll("_", " ")}: ${plainFixHint(i.rule_id, i.field)}`)
      .join(" • ");

    const counts = `${failCount} needs attention • ${warnCount} please review`;
    return `${counts}${top ? " • " + top : ""}`;
  }, [policy]);

  function isEdited(field: string) {
    return edits.some((e) => e.field === field);
  }

  function getJustification(field: string, ruleId: string) {
    return justifications.find((j) => j.field === field && j.rule_id === ruleId);
  }

  function upsertEdit(field: string, fromVal: any, toVal: any) {
    setEdits((prev) => {
      const sameAsOriginal = JSON.stringify(fromVal ?? null) === JSON.stringify(toVal ?? null);

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
    setDirty(true);
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

    setDirty(true);
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
      setDirty(false);

      setAssistantText("");
      setAssistantQs([]);
      if (res.issues?.length) {
        setAssistantLoading(true);
        try {
          const exp = await explain({
            fields: currentFields,
            issues: res.issues,
            rule_summaries: (res as any).rule_summaries ?? [],
            user_question:
              "Explain in simple language what I should fix next and how to proceed.",
          });
          setAssistantText(exp.explanation || "");
          setAssistantQs(exp.clarification_questions || []);
        } finally {
          setAssistantLoading(false);
        }
      }
    } catch (e: any) {
      setErr(e?.message || "Review update failed");
    } finally {
      setLoadingPolicy(false);
    }
  }

  useEffect(() => {
    if (fields) runPolicyCheck(fields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function next() {
    if (!extracted || !policy || !fields || !reviewState) return;

    if (dirty) {
      setShowNeedUpdateModal(true);
      return;
    }

    saveSession("fields", fields);
    saveSession("review_state", reviewState);
    saveSession("edits", edits);
    saveSession("justifications", justifications);
    nav("/summary");
  }

  if (!extracted || !fields) return null;

  const banner = reviewBannerCopy(reviewState ?? "");

  return (
    <div className="container">
      {showIntroModal && (
        <Modal
          title="Before you review"
          body={
            <>
              This form was pre-filled from your receipt using OCR and policy checks.
              Please confirm uncertain values, correct anything that looks wrong, and then click <b>Update review</b>.
            </>
          }
          onClose={() => setShowIntroModal(false)}
          actions={
            <button className="btn btn-primary" onClick={() => setShowIntroModal(false)}>
              Start review
            </button>
          }
        />
      )}

      {showNeedUpdateModal && (
        <Modal
          title="One quick step before continuing"
          body={
            <>
              You changed one or more fields. Please click <b>Update review</b> below the form so the system can
              re-check the latest values.
            </>
          }
          onClose={() => setShowNeedUpdateModal(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setShowNeedUpdateModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowNeedUpdateModal(false);
                  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                }}
              >
                Take me to Update review
              </button>
            </>
          }
        />
      )}

      <div className="header">
        <div>
          <h1 className="h-title">Review and fix highlighted fields</h1>
          <p className="h-sub">
            We pre-filled this form from your receipt. Please confirm uncertain values and fix items marked “Needs attention”.
          </p>
        </div>

        <div className={`badge ${badgeClassForState(reviewState ?? "")}`}>
          <span className="dot" />
          Status: <b>{reviewState ?? "…"}</b>
        </div>
      </div>

      {(assistantLoading || assistantText || assistantQs.length > 0) && (
        <div className="card">
          <div style={{ fontWeight: 900, fontSize: 16 }}>What the system needs from you</div>
          <div className="small">Simple checklist based on the current review.</div>
          <div className="hr" />

          {assistantLoading && <div className="small">Generating guidance…</div>}

          {assistantQs.length > 0 && (
            <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              {assistantQs.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}

          {assistantText && (
            <div className="muted" style={{ marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
              {assistantText}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ borderColor: "rgba(10,110,209,0.40)", marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>{banner.title}</div>
            <div className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
              {banner.body}
            </div>

            {policy && (
              <>
                <div className="small" style={{ marginTop: 10 }}>
                  <b>Company rule check:</b>{" "}
                  <span className="muted">
                    {policy.compliance === "PASS"
                      ? "No issues found."
                      : `${policy.issues.length} item(s) to review.`}
                  </span>

                  {evidenceIds.length ? (
                    <>
                      {" "}
                      • <b>Rule references:</b>{" "}
                      <span className="muted">{evidenceIds.join(", ")}</span>
                    </>
                  ) : null}
                </div>

                {policy.issues?.length > 0 && (
                  <div className="small muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
                    <b>What this means:</b> Rule references are internal policy IDs used as evidence.
                    {bannerIssueSummary ? (
                      <>
                        <br />
                        <b>Summary:</b> {bannerIssueSummary}
                      </>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="row" style={{ gap: 10 }}>
            <button
              className="btn btn-ghost"
              onClick={() => nav("/upload")}
              disabled={loadingPolicy}
            >
              Back
            </button>
          </div>
        </div>

        {err && <div style={{ marginTop: 10, color: "#ffb3b3" }}>{err}</div>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Expense form</div>
            <div className="small">
              Highlighted fields need confirmation. You can edit any value.
              After changes, click <b>Update review</b> below.
            </div>
          </div>
          {dirty ? (
            <span className="badge warn">
              <span className="dot" /> Changes not reviewed
            </span>
          ) : (
            <span className="badge ok">
              <span className="dot" /> Up to date
            </span>
          )}
        </div>

        <div className="hr" />

        <div className="grid review-form-grid">
          {FIELD_ORDER.map((name) => {
            const fv = fields[name];
            if (!fv) return null;

            const conf = typeof fv.confidence === "number" ? fv.confidence : 1.0;

            const isBool = typeof fv.value === "boolean";
            const isCurrency = name === "currency";
            const isCategory = name === "category";
            const isPayment = name === "payment_type";

            const isTextArea = name === "description" || name === "business_purpose";
            const isDate = name === "date";
            const isTotal = name === "total";

            const fieldIssues = issuesByField[name] || [];
            const hasFail = fieldIssues.some((x) => x.severity === "FAIL");
            const hasWarn = fieldIssues.some((x) => x.severity === "WARN");

            const manualSignal = ["description", "business_purpose", "category", "payment_type", "reimbursable"].includes(name);

            const targets = justificationTargetsForField(name);
            const cert = ocrCertLabel(conf);

            const inputClassName = `input ${
              hasFail ? "field-error" : hasWarn ? "field-warn" : ""
            } ${isCategory ? "select-readable" : ""}`;

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
                  ) : isPayment ? (
                    <select className="input select-readable" value={fv.value} onChange={(e) => updateField(name, e.target.value)}>
                      <option>Corporate Card</option>
                      <option>Cash</option>
                      <option>Personal Card</option>
                    </select>
                  ) : isCurrency ? (
                    <select className="input select-readable" value={fv.value} onChange={(e) => updateField(name, e.target.value)}>
                      <option>EUR</option>
                      <option>USD</option>
                      <option>GBP</option>
                      <option>INR</option>
                      <option>$</option>
                      <option>€</option>
                      <option>£</option>
                      <option>₹</option>
                    </select>
                  ) : isCategory ? (
                    <select className={inputClassName} value={fv.value} onChange={(e) => updateField(name, e.target.value)}>
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : isTextArea ? (
                    <textarea
                      className={hasFail ? "field-error" : hasWarn ? "field-warn" : ""}
                      rows={3}
                      value={fv.value ?? ""}
                      onChange={(e) => updateField(name, e.target.value)}
                      placeholder={
                        name === "business_purpose"
                          ? "Optional, but recommended (e.g., Client meeting, travel, workshop)"
                          : "Optional notes"
                      }
                    />
                  ) : isDate ? (
                    <input
                      className={inputClassName}
                      type="date"
                      value={fv.value ?? ""}
                      onChange={(e) => updateField(name, e.target.value)}
                    />
                  ) : isTotal ? (
                    <input
                      className={inputClassName}
                      type="number"
                      step="0.01"
                      value={fv.value ?? ""}
                      onChange={(e) => updateField(name, e.target.value)}
                      placeholder="e.g., 124.53"
                    />
                  ) : (
                    <input
                      className={inputClassName}
                      value={fv.value ?? ""}
                      onChange={(e) => updateField(name, e.target.value)}
                      placeholder="Click to edit"
                    />
                  )}

                  {hasFail && (
                    <div className="small" style={{ marginTop: 6 }}>
                      <span className="badge bad" style={{ marginRight: 8 }}>
                        <span className="dot" /> Needs attention
                      </span>
                      <span className="muted">Please fix this before continuing.</span>
                    </div>
                  )}

                  {hasWarn && !hasFail && (
                    <div className="small" style={{ marginTop: 6 }}>
                      <span className="badge warn" style={{ marginRight: 8 }}>
                        <span className="dot" /> Please review
                      </span>
                      <span className="muted">OCR certainty is low — please confirm this value.</span>
                    </div>
                  )}

                  {targets.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      {targets.map((t) => {
                        const existing = getJustification(name, t.rule_id);
                        const key = `${name}|${t.rule_id}`;

                        return (
                          <div key={t.rule_id} style={{ marginTop: 8 }}>
                            <div className="row" style={{ gap: 10, alignItems: "center" }}>
                              <span className={`badge ${t.severity === "FAIL" ? "bad" : "warn"}`}>
                                <span className="dot" /> Justification
                              </span>

                              <span className="small muted">
                                (Reason: <code>{t.rule_id}</code>)
                                {ruleSummary(policy, t.rule_id) ? (
                                  <> — {ruleSummary(policy, t.rule_id)}</>
                                ) : null}
                              </span>

                              {existing ? (
                                <span className="pill high">Added</span>
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
                                <b>Your note:</b> {existing.text}
                              </div>
                            )}

                            {openJustifyKey === key && (
                              <div style={{ marginTop: 8 }}>
                                <textarea
                                  rows={3}
                                  value={justifyDraft}
                                  onChange={(e) => setJustifyDraft(e.target.value)}
                                  placeholder="Write a short reason (e.g., client dinner, approved exception, business meeting)…"
                                />
                                <div className="row" style={{ marginTop: 8, gap: 10 }}>
                                  <button
                                    className="btn btn-primary"
                                    type="button"
                                    onClick={() => saveJustify(name, t.rule_id)}
                                  >
                                    Save
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
                  {manualSignal ? (
                    <span className="pill high">Manual</span>
                  ) : (
                    <span className={`pill ${cert.cls}`}>OCR certainty: {cert.label}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="hr" />

        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div className="small muted">
            After edits, click <b>Update review</b> to refresh the status.
          </div>

          <div className="row" style={{ gap: 10 }}>
            <button
              className="btn btn-ghost"
              onClick={() => runPolicyCheck(fields)}
              disabled={loadingPolicy}
              title="Re-run the company rule check with your latest edits"
            >
              {loadingPolicy ? "Updating…" : "Update review"}
            </button>

            <button className="btn btn-primary" disabled={!policy || !reviewState || loadingPolicy} onClick={next}>
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}