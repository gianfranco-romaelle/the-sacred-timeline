import React from "react";
import ReactDOM from "react-dom/client";
import AppRoot from "./app-root";
import "./index.css";

type RootErrorBoundaryState = {
  error?: Error;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, RootErrorBoundaryState> {
  override state: RootErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <main
          style={{
            minHeight: "100vh",
            padding: "2rem",
            background:
              "linear-gradient(180deg, rgba(247, 242, 233, 0.98), rgba(238, 230, 217, 0.94))",
            color: "#2d241b",
            fontFamily: '"Iowan Old Style", "Palatino Linotype", serif',
          }}
        >
          <div
            style={{
              maxWidth: "860px",
              margin: "0 auto",
              padding: "1.5rem",
              borderRadius: "24px",
              border: "1px solid rgba(120, 96, 64, 0.18)",
              background: "rgba(255, 255, 255, 0.82)",
              boxShadow: "0 20px 48px rgba(48, 34, 18, 0.08)",
            }}
          >
            <p style={{ margin: 0, letterSpacing: "0.16em", textTransform: "uppercase", fontSize: "0.76rem" }}>
              Sacred Timeline Boot Error
            </p>
            <h1 style={{ margin: "0.6rem 0 0", fontSize: "2rem" }}>The timeline failed during startup.</h1>
            <p style={{ margin: "0.9rem 0 0", color: "#5d5042", lineHeight: 1.65 }}>
              The app hit a runtime error before the interface finished mounting. The details
              below are shown to make debugging visible instead of leaving a blank page.
            </p>
            <pre
              style={{
                margin: "1.25rem 0 0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                padding: "1rem",
                borderRadius: "18px",
                background: "#f5eee3",
                color: "#3b2c1c",
                overflowX: "auto",
              }}
            >
              {this.state.error.stack ?? this.state.error.message}
            </pre>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AppRoot />
    </RootErrorBoundary>
  </React.StrictMode>,
);
