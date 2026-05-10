import { Suspense, lazy } from "react";
import { ActivityCenterProvider } from "@/features/activity/activity_center";

const TimelineAppShell = lazy(() => import("@/features/timeline/timeline_app_shell.jsx"));

function TimelineLoadingShell() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
        background:
          "radial-gradient(circle at top, rgba(214,199,160,0.38), transparent 36%), linear-gradient(180deg, #f5f0e7 0%, #fffdf8 100%)",
        color: "#1c1917",
        fontFamily: "'Iowan Old Style','Palatino Linotype','Book Antiqua',Georgia,serif",
      }}
    >
      <div
        style={{
          width: "min(720px, 100%)",
          borderRadius: 28,
          border: "1px solid rgba(214,211,209,0.9)",
          background: "rgba(255,255,255,0.94)",
          padding: 32,
          boxShadow: "0 30px 100px rgba(53,41,18,0.12)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid rgba(214,211,209,0.9)",
            background: "#fafaf9",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#57534e",
          }}
        >
          Timeline workspace
        </div>
        <h1 style={{ margin: "20px 0 10px", fontSize: 40, lineHeight: 1.05 }}>Loading timeline editor...</h1>
        <p style={{ margin: 0, fontSize: 18, lineHeight: 1.7, color: "#57534e" }}>
          The site is focused on the historical timeline only right now.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ActivityCenterProvider>
      <Suspense fallback={<TimelineLoadingShell />}>
        <TimelineAppShell />
      </Suspense>
    </ActivityCenterProvider>
  );
}
