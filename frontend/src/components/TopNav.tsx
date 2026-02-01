import { Link, useLocation } from "react-router-dom";

type Step = {
  path: string;
  label: string;
  desc: string;
};

const steps: Step[] = [
  { path: "/upload", label: "Upload", desc: "Add receipt image" },
  { path: "/review", label: "Review", desc: "Correct & explain" },
  { path: "/summary", label: "Summary", desc: "Confirm & submit" },
];

function isActive(current: string, path: string) {
  return current === path || current.startsWith(path + "/");
}

export default function TopNav() {
  const loc = useLocation();
  const current = loc.pathname;

  return (
    <div style={{ position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(10px)" }}>
      <div
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(11,18,32,0.72)",
        }}
      >
        <div className="container" style={{ paddingTop: 14, paddingBottom: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="row" style={{ gap: 12 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: "rgba(10,110,209,0.18)",
                  border: "1px solid rgba(10,110,209,0.40)",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 900,
                  color: "rgba(255,255,255,0.92)",
                }}
                title="Expense AI (HITL)"
              >
                AI
              </div>
              <div>
                <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>
                  Expense AI — Human-in-the-Loop
                </div>
                <div className="small">Deterministic policy checks • Transparent evidence • User confirmation</div>
              </div>
            </div>

            <span className="badge blue">
              <span className="dot" /> MVP Demo
            </span>
          </div>

          <div style={{ marginTop: 12 }} />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            {steps.map((s, idx) => {
              const active = isActive(current, s.path);
              const done = steps.findIndex((x) => isActive(current, x.path)) > idx;

              return (
                <Link
                  key={s.path}
                  to={s.path}
                  className="card"
                  style={{
                    padding: 12,
                    textDecoration: "none",
                    cursor: "pointer",
                    background: active
                      ? "linear-gradient(180deg, rgba(10,110,209,0.20), rgba(255,255,255,0.03))"
                      : done
                      ? "rgba(255,255,255,0.04)"
                      : "rgba(255,255,255,0.03)",
                    borderColor: active ? "rgba(10,110,209,0.55)" : "rgba(255,255,255,0.12)",
                  }}
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div style={{ fontWeight: 900 }}>
                      {idx + 1}. {s.label}
                    </div>

                    <span className={`badge ${active ? "blue" : done ? "ok" : ""}`}>
                      <span className="dot" />
                      {active ? "Current" : done ? "Done" : "Next"}
                    </span>
                  </div>

                  <div className="small" style={{ marginTop: 6 }}>
                    {s.desc}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
