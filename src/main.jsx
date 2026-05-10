import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

function renderFatalScreen(title, detail) {
  const rootElement = document.getElementById("root");
  if (!rootElement) return;

  rootElement.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;background:#f4efe4;color:#1c1917;font-family:'Iowan Old Style','Palatino Linotype','Book Antiqua',Georgia,serif;">
      <div style="width:min(920px,100%);background:rgba(255,255,255,0.94);border:1px solid rgba(214,211,209,0.9);border-radius:28px;padding:32px;box-shadow:0 30px 100px rgba(53,41,18,0.12);">
        <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;border:1px solid rgba(214,211,209,0.9);background:#fafaf9;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#57534e;">
          Frontend runtime
        </div>
        <h1 style="margin:20px 0 10px;font-size:40px;line-height:1.05;">${title}</h1>
        <p style="margin:0 0 16px;font-size:18px;line-height:1.7;color:#57534e;">
          ${detail}
        </p>
        <div style="font-size:14px;color:#78716c;">
          Reload the page after the current frontend patch completes. The backend and your source files are unaffected.
        </div>
      </div>
    </div>
  `;
}

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Sacred Timeline root render failed.", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px", background: "#f4efe4", color: "#1c1917", fontFamily: "'Iowan Old Style','Palatino Linotype','Book Antiqua',Georgia,serif" }}>
          <div style={{ width: "min(920px, 100%)", background: "rgba(255,255,255,0.94)", border: "1px solid rgba(214,211,209,0.9)", borderRadius: "28px", padding: "32px", boxShadow: "0 30px 100px rgba(53,41,18,0.12)" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 14px", borderRadius: "999px", border: "1px solid rgba(214,211,209,0.9)", background: "#fafaf9", fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase", color: "#57534e" }}>
              Frontend runtime
            </div>
            <h1 style={{ margin: "20px 0 10px", fontSize: "40px", lineHeight: 1.05 }}>Sacred Timeline interface hit a client-side error.</h1>
            <p style={{ margin: "0 0 16px", fontSize: "18px", lineHeight: 1.7, color: "#57534e" }}>
              The app failed during render, but the backend and your source files are still safe.
            </p>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", borderRadius: "20px", background: "#1c1917", color: "#f5f5f4", padding: "18px", fontSize: "13px", lineHeight: 1.6, overflowX: "auto" }}>
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

window.addEventListener("error", (event) => {
  const error = event?.error;
  if (!error) return;
  console.error("Uncaught window error.", error);
  renderFatalScreen("Sacred Timeline interface hit a startup error.", String(error.stack || error.message || error));
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  console.error("Unhandled promise rejection.", reason);
  renderFatalScreen(
    "Sacred Timeline interface hit an async startup error.",
    String(reason?.stack || reason?.message || reason || "Unknown promise rejection.")
  );
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("The #root element is missing from index.html.");
}

createRoot(rootElement).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
