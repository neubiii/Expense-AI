import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { extractReceipt } from "../api/client";
import { saveSession } from "./state";

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

type SpeechRecognitionType = any;

function getSpeechRecognition(): SpeechRecognitionType | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
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
          width: "min(620px, 100%)",
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

export default function Upload() {
  useEffect(() => {
    clearExpenseSession();
  }, []);

  const nav = useNavigate();

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  // popups
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Optional note (frontend-only)
  const [note, setNote] = useState<string>("");
  const [listening, setListening] = useState(false);

  const SpeechRecognition = useMemo(() => getSpeechRecognition(), []);
  const speechSupported = Boolean(SpeechRecognition);

  async function onExtract() {
    if (!file) {
      setErrorMsg("Please select a receipt image to continue.");
      return;
    }

    setLoading(true);
    try {
      const res = await extractReceipt(file);

      // Save OCR extract (used by Review page)
      saveSession("extract", res);

      // Save optional note (frontend only, safe)
      saveSession("receipt_note", (note || "").trim());

      nav("/review");
    } catch (e: any) {
      setErrorMsg(e?.message || "We couldn’t read this receipt. Please try a clearer image.");
    } finally {
      setLoading(false);
    }
  }

  function startVoice() {
    if (!SpeechRecognition) return;

    try {
      const rec = new SpeechRecognition();
      rec.lang = "en-US";
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

      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);

      rec.start();
    } catch {
      setListening(false);
    }
  }

  function resetAllConfirmed() {
    setFile(null);
    setNote("");
    setListening(false);
    clearExpenseSession();
    setShowResetConfirm(false);
  }

  return (
    <div className="container">
      {/* Error popup */}
      {errorMsg && (
        <Modal
          title="Something went wrong"
          onClose={() => setErrorMsg("")}
          actions={<button className="btn btn-primary" onClick={() => setErrorMsg("")}>OK</button>}
        >
          <div className="muted" style={{ lineHeight: 1.6 }}>
            {errorMsg}
          </div>
        </Modal>
      )}

      {/* Note popup */}
      {showNoteModal && (
        <Modal
          title="Add note (optional)"
          onClose={() => setShowNoteModal(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setNote("")}>
                Clear
              </button>
              <button className="btn btn-primary" onClick={() => setShowNoteModal(false)}>
                Save note
              </button>
            </>
          }
        >
          <div className="small" style={{ color: "rgba(255,255,255,0.78)", lineHeight: 1.6 }}>
            Optional: Add context like business purpose, attendees, or trip details. This only helps you later—it does not submit anything automatically.
          </div>

          <div style={{ marginTop: 10 }} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
            <textarea
              rows={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Example: Client dinner. Project Alpha. Attendees: John, Maria."
              style={{ flex: 1 }}
            />

            <button
              type="button"
              className="btn btn-primary"
              onClick={startVoice}
              disabled={!speechSupported || listening || loading}
              title={speechSupported ? "Record voice note (speech-to-text)" : "Voice not supported in this browser"}
              style={{ whiteSpace: "nowrap" }}
            >
              {listening ? "Listening…" : "🎤 Voice"}
            </button>
          </div>

          {!speechSupported && (
            <div className="small" style={{ marginTop: 10, color: "rgba(255,255,255,0.70)" }}>
              Voice input isn’t supported in this browser. You can still type your note.
            </div>
          )}
        </Modal>
      )}

      {/* Reset confirmation popup */}
      {showResetConfirm && (
        <Modal
          title="Reset this expense?"
          onClose={() => setShowResetConfirm(false)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setShowResetConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={resetAllConfirmed}>
                Yes, reset
              </button>
            </>
          }
        >
          <div className="muted" style={{ lineHeight: 1.6 }}>
            This will clear the selected receipt and any notes.
          </div>
        </Modal>
      )}

      <div className="header">
        <div>
          <h1 className="h-title">Submit an expense</h1>
          <p className="h-sub">
            Upload a receipt, review highlighted fields, and confirm before submitting.
          </p>
        </div>
        <span className="badge blue">
          <span className="dot" /> Prototype
        </span>
      </div>

      <div className="grid grid-2">
        {/* LEFT */}
        <div className="card">
          <div className="kpi">
            <div className="label">Step 1</div>
            <div className="value">Upload receipt</div>
            <div className="small">Supported: JPG / PNG.</div>
          </div>

          <div className="hr" />

          <div className="drop">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 800 }}>Receipt file</div>
                <div className="small">Select an image of your receipt to continue.</div>
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

            <div className="hr" />

            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 800 }}>Add note (optional)</div>
                <div className="small">Add quick context like purpose or attendees.</div>
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowNoteModal(true)}
                disabled={loading}
              >
                {note.trim() ? "Edit note" : "Add note"}
              </button>
            </div>

            {note.trim() && (
              <div className="small" style={{ marginTop: 10, color: "rgba(255,255,255,0.75)" }}>
                <b>Note saved:</b> {note.length > 90 ? note.slice(0, 90) + "…" : note}
              </div>
            )}
          </div>

          <div className="row" style={{ marginTop: 14, gap: 10 }}>
            <button className="btn btn-primary" onClick={onExtract} disabled={!file || loading}>
              {loading ? "Reading receipt…" : "Continue"}
            </button>

            <button className="btn btn-ghost" onClick={() => setShowResetConfirm(true)} disabled={loading}>
              Reset
            </button>
          </div>
        </div>

        {/* RIGHT */}
        <div className="card">
          <div style={{ fontWeight: 900, fontSize: 16 }}>What happens next?</div>
          <div className="small" style={{ marginTop: 6 }}>
            After upload, you will:
          </div>
          <div className="hr" />

          <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Review highlighted fields (missing or uncertain)</li>
            <li>Edit values if needed</li>
            <li>Add short justifications when required</li>
            <li>Confirm and submit</li>
          </ul>

          <div className="hr" />

          <div className="small">
            Tip: Use a clear, high-contrast receipt image for best results.
          </div>
        </div>
      </div>
    </div>
  );
}