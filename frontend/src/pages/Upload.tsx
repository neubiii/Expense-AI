import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { extractReceipt } from "../api/client";
import { saveSession } from "./state";

function clearExpenseSession() {
  const keys = ["extract", "fields", "policy", "review_state", "edits", "justifications", "receipt_note"];
  keys.forEach((k) => sessionStorage.removeItem(k));
}

type SpeechRecognitionType = any;

function getSpeechRecognition(): SpeechRecognitionType | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function Upload() {
  useEffect(() => {
    clearExpenseSession();
  }, []);

  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Optional note UI
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState<string>("");
  const [listening, setListening] = useState(false);

  const SpeechRecognition = useMemo(() => getSpeechRecognition(), []);
  const speechSupported = Boolean(SpeechRecognition);

  async function onExtract() {
    if (!file) return;
    setLoading(true);
    setErr("");
    try {
      const res = await extractReceipt(file);

      // Save OCR extract
      saveSession("extract", res);

      // Save optional note (even if empty - harmless)
      saveSession("receipt_note", (note || "").trim());

      nav("/review");
    } catch (e: any) {
      setErr(e?.message || "Extraction failed");
    } finally {
      setLoading(false);
    }
  }

  function startVoice() {
    if (!SpeechRecognition) return;

    try {
      const rec = new SpeechRecognition();
      rec.lang = "en-US"; // keep simple for demo; can be "de-DE" if you prefer
      rec.interimResults = true;
      rec.continuous = false;

      setListening(true);

      rec.onresult = (event: any) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setNote((prev) => {
          const base = prev ? prev.trimEnd() + " " : "";
          return (base + transcript).trim();
        });
      };

      rec.onerror = () => {
        setListening(false);
      };

      rec.onend = () => {
        setListening(false);
      };

      rec.start();
    } catch {
      setListening(false);
    }
  }

  function resetAll() {
    setFile(null);
    setErr("");
    setNote("");
    setShowNote(false);
    setListening(false);
    // also clear session for safety
    clearExpenseSession();
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
        {/* LEFT: Upload + Optional note */}
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
                <div className="small">
                  Choose a file to extract merchant, date, total, and currency.
                </div>
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

            {/* Optional note trigger */}
            <div className="hr" />

            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 750 }}>Optional note</div>
                <div className="small">
                  Add quick context (e.g., purpose, attendees, trip) to reduce manual edits later.
                </div>
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowNote((s) => !s)}
                disabled={loading}
              >
                {showNote ? "Hide note" : "Add note (optional)"}
              </button>
            </div>

            {showNote && (
              <div style={{ marginTop: 10 }}>
                <div className="small" style={{ marginBottom: 6 }}>
                  Optional — you can type or use voice. This will not auto-submit anything; it only helps prefilling fields.
                </div>

                <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                  <textarea
                    rows={4}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Example: Client dinner with SAP partner. Project: Alpha. Attendees: John, Maria."
                    style={{ flex: 1 }}
                  />

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={startVoice}
                    disabled={!speechSupported || listening || loading}
                    title={
                      speechSupported
                        ? "Record voice note (speech-to-text)"
                        : "Voice not supported in this browser"
                    }
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {listening ? "Listening…" : "🎤 Voice"}
                  </button>
                </div>

                {!speechSupported && (
                  <div className="small" style={{ marginTop: 8 }}>
                    Voice input isn’t supported in this browser. You can still type your note.
                  </div>
                )}
              </div>
            )}
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

            <button className="btn btn-ghost" onClick={resetAll} disabled={loading}>
              Reset
            </button>
          </div>
        </div>

        {/* RIGHT: How demo works */}
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
