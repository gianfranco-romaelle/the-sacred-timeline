import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, LibraryBig, Play, Power, TerminalSquare } from "lucide-react";
import backgroundTexture from "@/assets/background.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchBackendBootStatus, launchTextualInterface, startBackendServices } from "./library_api";

function getLibraryLauncherBackgroundStyle() {
  return {
    backgroundColor: "#f1efe7",
    backgroundImage: `linear-gradient(140deg, rgba(255,255,255,0.94), rgba(246,240,228,0.86)), url(${backgroundTexture})`,
    backgroundSize: "100% 100%, 320px 320px",
    backgroundRepeat: "no-repeat, repeat",
    backgroundBlendMode: "normal, multiply",
  };
}

function describeProcess(processState, fallbackLabel) {
  if (!processState) return fallbackLabel;
  const ready = processState.ready ? "ready" : "down";
  const count = Number(processState.process_count || 0);
  return `${ready} · processes=${count}`;
}

export function LibraryTextualLauncherPage() {
  const autoLaunchKey = "sacred_timeline_library_textual_launched";
  const [bootStatus, setBootStatus] = useState(null);
  const [error, setError] = useState("");
  const [launchNote, setLaunchNote] = useState("Opening /library launches the Textual interface, not a browser-only workspace.");
  const [launching, setLaunching] = useState(false);
  const autoLaunchRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      const nextStatus = await fetchBackendBootStatus();
      setBootStatus(nextStatus);
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Backend status is unavailable.");
    }
  }, []);

  const runLaunch = useCallback(async ({ restartBackend = false } = {}) => {
    setLaunching(true);
    try {
      await startBackendServices();
      const result = await launchTextualInterface({ restartBackend });
      window.sessionStorage.setItem(autoLaunchKey, "true");
      setLaunchNote(result?.message || "Textual interface launch requested.");
      await refreshStatus();
    } catch (nextError) {
      setLaunchNote(nextError instanceof Error ? nextError.message : "Failed to launch the Textual interface.");
    } finally {
      setLaunching(false);
    }
  }, [refreshStatus]);

  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 5000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (autoLaunchRef.current) return;
    autoLaunchRef.current = true;
    if (window.sessionStorage.getItem(autoLaunchKey) === "true") {
      setLaunchNote("This /library route is a Textual launcher. Use the button below if you want to open another terminal session.");
      return;
    }
    void runLaunch({ restartBackend: false });
  }, [runLaunch]);

  const bootSummary = useMemo(() => {
    const api = bootStatus?.api || null;
    const worker = bootStatus?.worker || null;
    const health = bootStatus?.health || null;
    return [
      { label: "API", value: describeProcess(api, "unknown") },
      { label: "Worker", value: describeProcess(worker, "unknown") },
      { label: "Health", value: health?.ready ? "healthy" : (health?.error || "waiting") },
    ];
  }, [bootStatus]);

  return (
    <div className="min-h-screen pt-28" style={getLibraryLauncherBackgroundStyle()}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <Card className="rounded-[34px] border-stone-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(143,210,255,0.22),_rgba(255,255,255,0.96)_48%)] shadow-[0_28px_90px_rgba(43,35,22,0.12)]">
          <CardHeader className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full border border-stone-200 bg-white/80 text-stone-700">/library</Badge>
              <Badge className="rounded-full border border-stone-900 bg-stone-900 text-white">Textual interface</Badge>
              <Badge className="rounded-full border border-sky-200 bg-sky-50 text-sky-700">Keyboard-driven</Badge>
            </div>
            <div className="space-y-3">
              <CardTitle className="max-w-4xl font-serif text-5xl leading-[1.02] text-stone-950">
                The library route launches the Textual pipeline console.
              </CardTitle>
              <CardDescription className="max-w-3xl text-base text-stone-600">
                This page is a lightweight launcher and status surface. The actual semantic library operator experience opens in a terminal window as the Textual pipeline console.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="space-y-4">
              <div className="rounded-[26px] border border-stone-200 bg-white/88 px-5 py-5">
                <div className="flex items-center gap-3 text-stone-900">
                  <TerminalSquare className="h-5 w-5" />
                  <div className="font-semibold">Launch note</div>
                </div>
                <p className="mt-3 text-sm leading-6 text-stone-700">{launchNote}</p>
                {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button className="rounded-full bg-stone-900 text-white hover:bg-stone-800" onClick={() => void runLaunch()} disabled={launching}>
                    <Play className="mr-2 h-4 w-4" />
                    {launching ? "Launching…" : "Launch Pipeline Console"}
                  </Button>
                  <Button variant="outline" className="rounded-full border-stone-300 bg-white" onClick={() => void runLaunch({ restartBackend: true })} disabled={launching}>
                    <Power className="mr-2 h-4 w-4" />
                    Restart backend + launch
                  </Button>
                </div>
              </div>

              <div className="rounded-[26px] border border-stone-200 bg-stone-50/85 px-5 py-5">
                <div className="flex items-center gap-3 text-stone-900">
                  <Keyboard className="h-5 w-5" />
                  <div className="font-semibold">What opens</div>
                </div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-stone-700">
                  <li>The Textual pipeline console opens in a terminal window.</li>
                  <li>The backend API and worker are started locally if they are not already up.</li>
                  <li>The web route stays thin on purpose, so the main operator surface stays low-memory.</li>
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <Card className="rounded-[26px] border-stone-200/80 bg-white/92 shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-2xl text-stone-900">
                    <LibraryBig className="h-5 w-5" />
                    Local runtime
                  </CardTitle>
                  <CardDescription>Status comes from the local backend launcher hooks used by the active project.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-stone-700">
                  {bootSummary.map((item) => (
                    <div key={item.label} className="flex items-center justify-between rounded-[18px] border border-stone-200 bg-stone-50/80 px-4 py-3">
                      <span className="font-medium text-stone-900">{item.label}</span>
                      <span>{item.value}</span>
                    </div>
                  ))}
                  <div className="rounded-[18px] border border-dashed border-stone-300 bg-white/80 px-4 py-3 text-xs leading-5 text-stone-600">
                    Shortcut: <span className="font-mono">launch_shortcuts\\Launch Library Textual Interface.cmd</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
