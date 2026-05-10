import { Suspense, lazy } from "react";
import "./app-root.css";
import { stripBasePath, withBasePath } from "@/lib/base-path";

const TimelineWorkspace = lazy(async () => {
  console.info("[Sacred Timeline] Loading timeline workspace route modules...");
  const [{ AppShell }, { HistoricalRuntimeProvider }] = await Promise.all([
    import("@/components/shell/app-shell"),
    import("@/historical/runtime-context"),
  ]);
  console.info("[Sacred Timeline] Timeline workspace route modules loaded.");

  return {
    default: function TimelineWorkspaceRoute() {
      return (
        <HistoricalRuntimeProvider>
          <AppShell />
        </HistoricalRuntimeProvider>
      );
    },
  };
});

function SiteLoadingState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="site-switchboard">
      <section className="site-switchboard__panel">
        <p className="site-switchboard__eyebrow">Workspace Routing</p>
        <h1 className="site-switchboard__title">{title}</h1>
        <p className="site-switchboard__subtitle">{detail}</p>
      </section>
    </main>
  );
}

function SiteSwitchboard() {
  return (
    <main className="site-switchboard">
      <section className="site-switchboard__panel">
        <p className="site-switchboard__eyebrow">Workspace Routing</p>
        <h1 className="site-switchboard__title">Active Project Routes</h1>
        <p className="site-switchboard__subtitle">
          The browser surface is focused on the Sacred Timeline. Adjacent pharma, market, citation, and scriptarium projects stay outside this workspace.
        </p>

        <div className="site-switchboard__grid">
          <article className="site-switchboard__card">
            <div className="site-switchboard__meta">
              <span className="site-switchboard__pill">/timeline</span>
              <span className="site-switchboard__pill">Active Project</span>
            </div>
            <h2>Sacred Timeline</h2>
            <p>
              The historical timeline shell remains available on its dedicated route for the current project surface.
            </p>
            <a className="site-switchboard__link" href={withBasePath("/timeline")}>
              Open Timeline Workspace
            </a>
          </article>
        </div>
      </section>
    </main>
  );
}

export default function AppRoot() {
  const path = stripBasePath(window.location.pathname).replace(/\/+$/, "") || "/";

  if (path === "/" || path === "/workspaces" || path === "/timeline") {
    return (
      <Suspense fallback={<SiteLoadingState title="Loading timeline workspace" detail="Preparing the Sacred Timeline shell." />}>
        <TimelineWorkspace />
      </Suspense>
    );
  }

  return <SiteSwitchboard />;
}
