import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import backgroundTexture from "@/assets/background.png";
import {
  fetchDossierAssertions,
  fetchDossierSignalWindows,
  fetchPharmaCycles,
  fetchPharmaEvents,
  fetchPharmaHomologations,
  fetchPharmaLeaderboard,
  fetchSystemStatus,
  runMarketAnalysis,
  runPharmaCycle,
  syncDossiers,
  syncPharmaEvents,
} from "@/features/library/library_api";
import { buildMarketTimelineRows } from "@/market_timeline_bridge";

function getBackgroundStyle() {
  return {
    backgroundColor: "#f4efe4",
    backgroundImage: `linear-gradient(180deg, rgba(245,240,229,0.96), rgba(255,255,255,0.92)), url(${backgroundTexture})`,
    backgroundSize: "100% 100%, 360px 360px",
    backgroundRepeat: "no-repeat, repeat",
    backgroundBlendMode: "normal, multiply",
  };
}

function formatDecimal(value, digits = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "n/a";
}

function formatDate(value) {
  if (!value) return "Pending";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : String(value);
}

function StatusBadge({ ready, label }) {
  return (
    <Badge className={`rounded-full border ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
      {label}
    </Badge>
  );
}

function MetricCard({ label, value, hint }) {
  return (
    <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-stone-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-stone-900">{value}</div>
      {hint ? <div className="mt-2 text-sm text-stone-500">{hint}</div> : null}
    </div>
  );
}

export default function MarketHandoffPage() {
  const [systemStatus, setSystemStatus] = useState(null);
  const [marketResult, setMarketResult] = useState(null);
  const [pharmaEvents, setPharmaEvents] = useState([]);
  const [pharmaCycles, setPharmaCycles] = useState([]);
  const [pharmaLeaderboard, setPharmaLeaderboard] = useState([]);
  const [pharmaHomologations, setPharmaHomologations] = useState([]);
  const [dossierAssertions, setDossierAssertions] = useState([]);
  const [dossierSignalWindows, setDossierSignalWindows] = useState([]);
  const [marketSymbols, setMarketSymbols] = useState("SPY, QQQ");
  const [pharmaSymbols, setPharmaSymbols] = useState("VRTX, MRNA, ALNY");
  const [includeDossierSignals, setIncludeDossierSignals] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [nextStatus, nextEvents, nextCycles, nextLeaderboard, nextHomologations, nextAssertions, nextWindows] = await Promise.all([
        fetchSystemStatus(),
        fetchPharmaEvents({ limit: 12 }),
        fetchPharmaCycles(),
        fetchPharmaLeaderboard(),
        fetchPharmaHomologations(),
        fetchDossierAssertions({ limit: 12 }),
        fetchDossierSignalWindows({ limit: 24 }),
      ]);
      setSystemStatus(nextStatus);
      setPharmaEvents(nextEvents.items || []);
      setPharmaCycles(nextCycles.items || []);
      setPharmaLeaderboard(nextLeaderboard.items || []);
      setPharmaHomologations(nextHomologations.items || []);
      setDossierAssertions(nextAssertions.items || []);
      setDossierSignalWindows(nextWindows.items || []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load handoff data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleRunMarket() {
    setLoading(true);
    setError("");
    try {
      const symbols = marketSymbols.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
      const result = await runMarketAnalysis({
        symbols,
        benchmark_symbol: symbols[0] || "SPY",
        period: "6mo",
        interval: "1d",
        mode: "auto",
        max_expiries: 2,
        max_strikes_per_expiry: 7,
        rolling_window: 20,
        k_neighbors: 4,
        risk_free_rate: 0,
      });
      setMarketResult(result);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Market analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncPharma() {
    setLoading(true);
    setError("");
    try {
      const symbols = pharmaSymbols.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
      const result = await syncPharmaEvents({ symbols, limit: 25 });
      setPharmaEvents(result.items || []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Pharma sync failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRunPharmaCycle() {
    setLoading(true);
    setError("");
    try {
      const symbols = pharmaSymbols.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
      const result = await runPharmaCycle({
        symbols,
        benchmark_symbol: "XBI",
        period: "1y",
        interval: "1d",
        train_window: 60,
        test_window: 20,
        step_size: 20,
        pre_window: 20,
        post_window: 1,
        max_events: 25,
        max_expiries: 2,
        max_strikes_per_expiry: 7,
        rolling_window: 20,
        k_neighbors: 4,
        risk_free_rate: 0,
        include_dossier_signals: includeDossierSignals,
      });
      setPharmaCycles((current) => [result.cycle, ...current.filter((item) => item.id !== result.cycle?.id)]);
      setPharmaLeaderboard(result.leaderboard || []);
      const refreshedHomologations = await fetchPharmaHomologations();
      setPharmaHomologations(refreshedHomologations.items || []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Pharma cycle failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncDossiers() {
    setLoading(true);
    setError("");
    try {
      const result = await syncDossiers({ document_limit: 100, assertion_limit_per_document: 24 });
      setDossierAssertions(result.assertions || []);
      setDossierSignalWindows(result.signal_windows || []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Dossier sync failed.");
    } finally {
      setLoading(false);
    }
  }

  const latestCycle = pharmaCycles[0] || null;
  const timelineRows = useMemo(
    () => buildMarketTimelineRows({ marketAnalysis: marketResult, pharmaCycle: latestCycle ? { cycle: latestCycle, leaderboard: pharmaLeaderboard } : null, dossierWindows: dossierSignalWindows }),
    [dossierSignalWindows, latestCycle, marketResult, pharmaLeaderboard]
  );

  const marketProvider = systemStatus?.providers?.market_data;
  const pharmaProvider = systemStatus?.providers?.pharma_news;
  const dossierProvider = systemStatus?.providers?.dossier_news;

  return (
    <div className="min-h-screen pt-28" style={getBackgroundStyle()}>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <Card className="rounded-[34px] border-stone-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.15),_rgba(255,255,255,0.96)_48%)] shadow-[0_28px_90px_rgba(43,35,22,0.12)]">
          <CardHeader className="space-y-4">
            <Badge className="w-fit rounded-full border border-stone-200 bg-white/80 text-stone-700">Handoff surface</Badge>
            <CardTitle className="max-w-4xl font-serif text-5xl leading-[1.02] text-stone-950">
              Market, pharma, dossier, and timeline projection in one stable package.
            </CardTitle>
            <CardDescription className="max-w-3xl text-base text-stone-600">
              This route freezes the v1 frontend surface Zach needs: market Green-triad analysis, pharma cycle controls, dossier overlays as attributed assertions, and timeline-compatible projections with sample contracts.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button className="rounded-full bg-stone-900 text-white hover:bg-stone-800" onClick={() => void refresh()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh handoff data"}
            </Button>
            <a className="inline-flex items-center rounded-full border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700" href="/handoff/zach-market-v1/samples/market_analysis.json" target="_blank" rel="noreferrer">
              Sample market JSON
            </a>
            <a className="inline-flex items-center rounded-full border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700" href="/handoff/zach-market-v1/samples/pharma_cycle.json" target="_blank" rel="noreferrer">
              Sample pharma JSON
            </a>
            <a className="inline-flex items-center rounded-full border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700" href="/handoff/zach-market-v1/samples/dossier_sync.json" target="_blank" rel="noreferrer">
              Sample dossier JSON
            </a>
            <a className="inline-flex items-center rounded-full border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700" href="/handoff/zach-market-v1/samples/timeline_rows.json" target="_blank" rel="noreferrer">
              Sample timeline rows
            </a>
          </CardContent>
        </Card>

        {error ? <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card className="rounded-[28px] border-stone-200/80 bg-white/90">
              <CardHeader>
                <CardTitle className="font-serif text-3xl text-stone-900">Providers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-stone-900">{marketProvider?.name || "market_data"}</div>
                    <StatusBadge ready={Boolean(marketProvider?.ready)} label={marketProvider?.ready ? "ready" : "offline"} />
                  </div>
                  <div className="mt-2 text-sm text-stone-600">{marketProvider?.detail || "No market provider detail available."}</div>
                </div>
                <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-stone-900">{pharmaProvider?.name || "pharma_news"}</div>
                    <StatusBadge ready={Boolean(pharmaProvider?.ready)} label={pharmaProvider?.ready ? "ready" : "offline"} />
                  </div>
                  <div className="mt-2 text-sm text-stone-600">{pharmaProvider?.detail || "No pharma provider detail available."}</div>
                </div>
                <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-stone-900">{dossierProvider?.name || "dossier_news"}</div>
                    <StatusBadge ready={Boolean(dossierProvider?.ready)} label={dossierProvider?.ready ? "ready" : "offline"} />
                  </div>
                  <div className="mt-2 text-sm text-stone-600">{dossierProvider?.detail || "No dossier provider detail available."}</div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-stone-200/80 bg-white/90">
              <CardHeader>
                <CardTitle className="font-serif text-3xl text-stone-900">Controls</CardTitle>
                <CardDescription>Only the handoff-facing controls stay here: no imports, notes, or research bundle tooling.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-stone-700">Market symbols</div>
                  <Input value={marketSymbols} onChange={(event) => setMarketSymbols(event.target.value)} className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                </div>
                <Button className="w-full rounded-full bg-stone-900 text-white hover:bg-stone-800" onClick={() => void handleRunMarket()} disabled={loading}>
                  Run market analysis
                </Button>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-stone-700">Pharma symbols</div>
                  <Input value={pharmaSymbols} onChange={(event) => setPharmaSymbols(event.target.value)} className="h-12 rounded-full border-stone-300 bg-stone-50/80 px-5" />
                </div>
                <Button variant="outline" className="w-full rounded-full border-stone-300 bg-white" onClick={() => void handleSyncPharma()} disabled={loading}>
                  Sync pharma events
                </Button>
                <label className="flex items-center gap-3 rounded-[22px] border border-stone-200 bg-stone-50/70 px-4 py-3 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    checked={includeDossierSignals}
                    onChange={(event) => setIncludeDossierSignals(event.target.checked)}
                    className="h-4 w-4 rounded border-stone-300 text-stone-900"
                  />
                  <span>Include dossier overlays with primary-backing gating.</span>
                </label>
                <Button className="w-full rounded-full bg-stone-900 text-white hover:bg-stone-800" onClick={() => void handleRunPharmaCycle()} disabled={loading}>
                  Run pharma cycle
                </Button>
                <Button variant="outline" className="w-full rounded-full border-stone-300 bg-white" onClick={() => void handleSyncDossiers()} disabled={loading}>
                  Sync dossier assertions
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Pharma events" value={pharmaEvents.length} />
              <MetricCard label="Cycles" value={pharmaCycles.length} />
              <MetricCard label="Dossier assertions" value={dossierAssertions.length} />
              <MetricCard label="Timeline rows" value={timelineRows.length} />
            </div>

            <Card className="rounded-[28px] border-stone-200/80 bg-white/90">
              <CardHeader>
                <CardTitle className="font-serif text-3xl text-stone-900">Current summaries</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-4">
                  <div className="font-semibold text-stone-900">Market triad</div>
                  <div className="mt-2 text-sm text-stone-600">Partition {formatDecimal(marketResult?.thermodynamics?.aggregate?.partition_function)} · Free energy {formatDecimal(marketResult?.thermodynamics?.aggregate?.free_energy)} · Divergence {formatDecimal(marketResult?.signals?.aggregate?.divergence_stress)}</div>
                </div>
                <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-4">
                  <div className="font-semibold text-stone-900">Latest pharma cycle</div>
                  <div className="mt-2 text-sm text-stone-600">
                    {latestCycle ? `${latestCycle.id} · rows ${latestCycle?.dataset_summary?.row_count || 0} · leader ${pharmaLeaderboard[0]?.candidate_key || "n/a"}` : "No pharma cycle has been run yet."}
                  </div>
                </div>
                <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-4">
                  <div className="font-semibold text-stone-900">Dossier layer</div>
                  <div className="mt-2 text-sm text-stone-600">
                    {dossierAssertions.length ? `Latest backing ${formatDecimal(dossierAssertions[0]?.payload?.primary_backing_score)} · ${dossierSignalWindows.length} signal windows` : "No dossier assertions synced yet."}
                  </div>
                </div>
                <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-4">
                  <div className="font-semibold text-stone-900">Homologation</div>
                  <div className="mt-2 text-sm text-stone-600">
                    {pharmaHomologations[0]?.candidate_key ? `${pharmaHomologations[0].candidate_key} · ${pharmaHomologations[0].status}` : "No homologation rows yet."}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card className="rounded-[28px] border-stone-200/80 bg-white/90">
                <CardHeader>
                  <CardTitle className="font-serif text-3xl text-stone-900">Timeline projection</CardTitle>
                  <CardDescription>These rows are already in the same shape the timeline app consumes.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {timelineRows.map((item) => (
                    <div key={item.id} className="rounded-[20px] border border-stone-200 bg-stone-50/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-stone-900">{item.name}</div>
                        <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">{item.startYear}</Badge>
                      </div>
                      <div className="mt-2 text-sm text-stone-600">{item.description}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="rounded-[28px] border-stone-200/80 bg-white/90">
                <CardHeader>
                  <CardTitle className="font-serif text-3xl text-stone-900">Live rows</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(pharmaEvents.slice(0, 3)).map((item) => (
                    <div key={item.id} className="rounded-[20px] border border-stone-200 bg-stone-50/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-stone-900">{item.ticker} · {item.title}</div>
                        <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">{formatDate(item.event_at)}</Badge>
                      </div>
                      <div className="mt-2 text-sm text-stone-600">{item.summary}</div>
                    </div>
                  ))}
                  {(dossierAssertions.slice(0, 2)).map((item) => (
                    <div key={item.id} className="rounded-[20px] border border-stone-200 bg-stone-50/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-stone-900">{item.actor || item.institution || "Attributed assertion"}</div>
                        <Badge className="rounded-full border border-stone-200 bg-white text-stone-700">backing {formatDecimal(item?.payload?.primary_backing_score)}</Badge>
                      </div>
                      <div className="mt-2 text-sm text-stone-600">{item.summary}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
