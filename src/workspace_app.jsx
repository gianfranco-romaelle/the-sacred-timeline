import { Suspense, lazy, useState } from "react";
import { BookOpen, Compass, LibraryBig, Search, Sigma, Sparkles, X } from "lucide-react";
import backgroundTexture from "@/assets/background.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActivityCenterButton, ActivityCenterProvider } from "./features/activity/activity_center";
import { publishInstitutePrompt } from "./features/hungry_topos/institute_bridge";
import { LibraryTextualLauncherPage } from "./features/library/library_textual_launcher";
import { getCurrentPathname, navigateTo, useCurrentPathname } from "./lib/path_router";

const HistoricalTimelineApp = lazy(() => import("./historical_timeline_app"));

function getShellBackgroundStyle() {
  return {
    backgroundColor: "#f4efe4",
    backgroundImage: `linear-gradient(180deg, rgba(245,240,229,0.96), rgba(255,255,255,0.88)), url(${backgroundTexture})`,
    backgroundSize: "100% 100%, 360px 360px",
    backgroundRepeat: "no-repeat, repeat",
    backgroundBlendMode: "normal, multiply",
  };
}

function InstitutePromptLauncher({ pathname }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("research");
  const [query, setQuery] = useState("");
  const modeMeta = {
    ask: {
      label: "Library Ask",
      icon: Search,
      placeholder: "Ask the library a question from anywhere on the site.",
    },
    research: {
      label: "Research",
      icon: Sparkles,
      placeholder: "Run a formal comparison or synthesis immediately in the library research workspace.",
    },
    topos: {
      label: "HungryTopos",
      icon: Sigma,
      placeholder: "Run a website/category-theory prompt immediately in HungryTopos inside /library.",
    },
    lawvere: {
      label: "Lawvere",
      icon: BookOpen,
      placeholder: "Run a Lawvere-scoped category-theory query immediately inside /library.",
    },
  };
  const activeMode = modeMeta[mode];
  const ActiveIcon = activeMode.icon;

  function handleSubmit(event) {
    event.preventDefault();
    const payload = publishInstitutePrompt({
      query,
      mode,
      sourcePathname: pathname,
    });
    if (!payload) return;
    setQuery("");
    setOpen(false);
    navigateTo("/library");
  }

  return (
    <div className="fixed left-4 top-20 z-40 sm:left-6">
      <div className="flex flex-col items-start gap-3">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-stone-200/80 bg-white/92 text-stone-800 shadow-[0_20px_60px_rgba(43,35,22,0.14)] backdrop-blur transition hover:bg-stone-100"
          aria-label={open ? "Close institute prompt" : "Open institute prompt"}
          title="Institute prompt"
        >
          {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </button>

        {open ? (
          <form
            onSubmit={handleSubmit}
            className="flex w-[min(34rem,calc(100vw-2rem))] flex-col gap-3 rounded-[28px] border border-stone-200/80 bg-white/94 px-4 py-4 shadow-[0_24px_70px_rgba(43,35,22,0.12)] backdrop-blur"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full border border-stone-200 bg-stone-900 text-white">Institute prompt</Badge>
              <div className="text-sm text-stone-600">Always-on shell intake that feeds back into the library workspace and runs immediately.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(modeMeta).map(([key, item]) => {
                const Icon = item.icon;
                const active = key === mode;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                      active ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex min-w-0 flex-1 items-center gap-3 rounded-full border border-stone-300 bg-stone-50/80 px-4 py-2">
                <ActiveIcon className="h-4 w-4 shrink-0 text-stone-500" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={activeMode.placeholder}
                  className="h-9 border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
                />
              </label>
              <Button type="submit" className="rounded-full bg-stone-900 text-white hover:bg-stone-800 md:h-auto">
                Run in /library now
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceSwitcher({ pathname }) {
  const items = [
    { path: "/", label: "Overview", icon: Compass },
    { path: "/library", label: "Library", icon: LibraryBig },
    { path: "/timeline", label: "Timeline", icon: BookOpen },
  ];

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 py-4 sm:px-6">
      <div className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full border border-stone-200/80 bg-white/88 px-3 py-2 shadow-[0_20px_60px_rgba(43,35,22,0.12)] backdrop-blur">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.path;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigateTo(item.path)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                active ? "bg-stone-900 text-white" : "bg-white text-stone-700 hover:bg-stone-100"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
        <ActivityCenterButton />
      </div>
    </div>
  );
}

function WorkspaceOverview() {
  return (
    <div className="min-h-screen pt-56" style={getShellBackgroundStyle()}>
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <Card className="rounded-[34px] border-stone-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(201,171,93,0.18),_rgba(255,255,255,0.96)_48%)] shadow-[0_28px_90px_rgba(43,35,22,0.12)]">
            <CardHeader className="space-y-5">
              <Badge className="w-fit rounded-full border border-stone-200 bg-white/80 text-stone-700">
                Dual-workspace repository
              </Badge>
              <div className="space-y-3">
                <CardTitle className="max-w-3xl font-serif text-5xl leading-[1.02] text-stone-950">
                  Semantic library engine and sacred timeline, side by side.
                </CardTitle>
                <CardDescription className="max-w-2xl text-base text-stone-600">
                  The library workspace adds local auth, ingestion, hierarchical retrieval, citations, and saved research trails without disturbing the existing timeline environment.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button className="rounded-full bg-stone-900 text-white hover:bg-stone-800" onClick={() => navigateTo("/library")}>
                Open library
              </Button>
              <Button variant="outline" className="rounded-full border-stone-300 bg-white" onClick={() => navigateTo("/timeline")}>
                Open timeline
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-[30px] border-stone-200/80 bg-white/90 shadow-[0_28px_90px_rgba(43,35,22,0.10)]">
            <CardHeader>
              <CardTitle className="font-serif text-3xl text-stone-900">Current routing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-stone-700">
              <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 px-4 py-4">
                <div className="font-semibold text-stone-900">/library</div>
                <div className="mt-2">Launcher/status route for the Textual semantic library interface. The real operator surface opens in a terminal window.</div>
              </div>
              <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 px-4 py-4">
                <div className="font-semibold text-stone-900">/timeline</div>
                <div className="mt-2">Existing historical workspace preserved intact, now reachable through the shared shell.</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function WorkspaceLoadingCard({ title, detail }) {
  return (
    <div className="min-h-screen pt-56" style={getShellBackgroundStyle()}>
      <div className="mx-auto flex max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="w-full rounded-[30px] border-stone-200/80 bg-white/92 shadow-[0_28px_90px_rgba(43,35,22,0.10)]">
          <CardHeader>
            <CardTitle className="font-serif text-3xl text-stone-900">{title}</CardTitle>
            <CardDescription className="text-base text-stone-600">{detail}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

export default function WorkspaceApp() {
  const pathname = useCurrentPathname();
  const normalizedPath = pathname || getCurrentPathname();
  const timelineFallback = <WorkspaceLoadingCard title="Loading timeline" detail="Preparing the projective timeline module only when you open it." />;
  const libraryFallback = <WorkspaceLoadingCard title="Loading library" detail="Preparing the Textual library launcher only when you open /library." />;

  return (
    <ActivityCenterProvider>
      <WorkspaceSwitcher pathname={normalizedPath} />
      <InstitutePromptLauncher pathname={normalizedPath} />
      {normalizedPath === "/timeline" ? (
        <Suspense fallback={timelineFallback}>
          <HistoricalTimelineApp />
        </Suspense>
      ) : null}
      {normalizedPath === "/library" ? (
        <Suspense fallback={libraryFallback}>
          <LibraryTextualLauncherPage />
        </Suspense>
      ) : null}
      {normalizedPath !== "/timeline" && normalizedPath !== "/library" ? <WorkspaceOverview /> : null}
    </ActivityCenterProvider>
  );
}
