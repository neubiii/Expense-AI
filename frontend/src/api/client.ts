import type { ExtractResponse, PolicyResponse } from "../types";

const BASE = "http://127.0.0.1:8000/api";

export async function extractReceipt(file: File): Promise<ExtractResponse> {
  const fd = new FormData();
  fd.append("receipt", file);

  const res = await fetch(`${BASE}/extract`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function explain(payload: {
  fields: any;
  issues: any[];
  rule_summaries?: any[];
  user_question: string;
}): Promise<{ explanation: string; clarification_questions: string[] }> {
  const res = await fetch(`${BASE}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function validatePolicy(payload: {
  receipt_id: string;
  fields: any;
  user_context?: any;
}): Promise<PolicyResponse> {
  const res = await fetch(`${BASE}/policy/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createSubmission(payload: any): Promise<any> {
  const res = await fetch(`${BASE}/submission/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
