export type FieldValue = { value: any; confidence: number };

export type ExtractResponse = {
  receipt_id: string;
  fields: Record<string, FieldValue>;
  raw_text_preview?: string;
};

export type PolicyIssue = {
  field: string;
  severity: "WARN" | "FAIL";
  rule_id: string;
  message: string;
};

export type RuleSummary = {
  rule_id: string;
  summary: string;
};

export type PolicyResponse = {
  receipt_id: string;
  compliance: "PASS" | "WARN" | "FAIL";
  issues: PolicyIssue[];
  rule_summaries?: RuleSummary[];
  metadata?: {
    confidence_threshold?: number;
    rules_triggered?: string[];
  };
};

export type ReviewState = "GREEN" | "YELLOW" | "RED";

// --- Audit trail (for thesis transparency) ---
export type EditRecord = {
  field: string;
  from: any;
  to: any;
  at: string; // ISO datetime
};

export type JustificationRecord = {
  rule_id: string;
  field: string;
  text: string;
  at: string; // ISO datetime
};
