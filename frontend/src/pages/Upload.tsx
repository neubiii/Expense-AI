import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { extractReceipt } from "../api/client";
import { saveSession } from "./state";

export default function Upload() {
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function onExtract() {
    if (!file) return;
    setLoading(true);
    setErr("");
    try {
      const res = await extractReceipt(file);
      saveSession("extract", res);
      nav("/review");
    } catch (e: any) {
      setErr(e?.message || "Extraction failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="h-title">AI-Assisted Expense Submission</h1>
          <p className="h-sub">
            General Receipt Expense (MVP). Upload a receipt → review uncertainty → get policy-grounded explanations → submit with human confirmation.
          </p>
        </div>
        <span className="badge blue">
          <span className="dot" /> HITL Prototype
        </span>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="kpi">
            <div className="label">Step 1</div>
            <div className="value">Upload receipt</div>
            <div className="small">
              Supported: JPG / PNG. OCR runs locally (Tesseract). No cloud required.
            </div>
          </div>

          <div className="hr" />

          <div className="drop">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 750 }}>Receipt image</div>
                <div className="small">Choose a file to extract merchant, date, total, and currency.</div>
              </div>
              {file ? (
                <span className="badge ok">
                  <span className="dot" /> Selected
                </span>
              ) : (
                <span className="badge">
                  <span className="dot" /> Not selected
                </span>
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <input
                className="input"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              {file && (
                <div className="small" style={{ marginTop: 8 }}>
                  Selected: <b>{file.name}</b>
                </div>
              )}
            </div>
          </div>

          {err && <div style={{ marginTop: 10, color: "#ffb3b3" }}>{err}</div>}

          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="btn btn-primary"
              onClick={onExtract}
              disabled={!file || loading}
            >
              {loading ? "Extracting…" : "Extract & Continue"}
            </button>

            <button
              className="btn btn-ghost"
              onClick={() => {
                setFile(null);
                setErr("");
              }}
              disabled={loading}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="card">
          <div className="kpi">
            <div className="label">How this demo works</div>
            <div className="value">Seamful, human-in-the-loop</div>
          </div>

          <div className="hr" />

          <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li><b>OCR</b> extracts text only (may be noisy).</li>
            <li><b>Parser</b> proposes fields + confidence.</li>
            <li><b>Policy engine</b> runs deterministic rule checks.</li>
            <li><b>Explain</b> generates rule-grounded explanations (mocked, no API key).</li>
            <li><b>Submit</b> requires explicit human confirmation + audit log.</li>
          </ul>

          <div className="hr" />

          <div className="small">
            Tip: Try a clear, high-contrast receipt for best extraction quality.
          </div>
        </div>
      </div>
    </div>
  );
}
