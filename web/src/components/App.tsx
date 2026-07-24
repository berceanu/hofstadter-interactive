import { useEffect, useMemo, useRef } from "react";
import { BandView } from "./BandView";
import { ButterflyPlot } from "./ButterflyPlot";
import { LatticeView } from "./LatticeView";
import { ParameterPanel } from "./ParameterPanel";
import {
  cancelActiveComputation,
  retryComputeEngine,
  useCompute,
} from "../compute/useCompute";
import type { ViewKind } from "../compute/contracts";
import { useResultCache } from "../state/resultCache";
import { useAppStore } from "../state/store";
import { parseUrlState } from "../state/urlState";
import { flattenButterfly } from "../utils/arrays";
import { exportCsv, exportNpz, exportPng } from "../utils/exports";

const views: { id: ViewKind; label: string; short: string }[] = [
  { id: "butterfly", label: "Butterfly", short: "01" },
  { id: "wannier", label: "Wannier", short: "02" },
  { id: "lattice", label: "Lattice + BZ", short: "03" },
  { id: "bands", label: "Band surfaces", short: "04" },
];

function RuntimeStatus() {
  const progress = useAppStore((state) => state.progress);
  const busy = ["downloading", "initializing", "loading-package", "computing", "rendering"].includes(
    progress.phase,
  );
  return (
    <div className={`runtime-status phase-${progress.phase}`} aria-live="polite">
      <span className="status-light" />
      <span className="status-message">{progress.message}</span>
      {busy && (
        <>
          <div className="progress-track">
            <i style={{ width: `${Math.max(4, progress.fraction * 100)}%` }} />
          </div>
          {progress.phase === "computing" && (
            <button className="cancel-button" onClick={() => void cancelActiveComputation()}>
              cancel
            </button>
          )}
        </>
      )}
      {progress.phase === "error" && (
        <button
          className="cancel-button"
          onClick={() => void retryComputeEngine()}
        >
          retry engine
        </button>
      )}
    </div>
  );
}

function SelectionReadout() {
  const point = useAppStore((state) => state.selectedPoint);
  const view = useAppStore((state) => state.view);
  const parameters = useAppStore((state) => state.parameters);
  if (!point) {
    return (
      <div className="selection-card muted">
        <span className="eyebrow">POINT INSPECTOR</span>
        <p>Hover over the spectrum to read a state.</p>
      </div>
    );
  }
  const numerator = Math.round(point.flux * parameters.q);
  return (
    <div className="selection-card">
      <div>
        <span className="eyebrow">SELECTED STATE</span>
        <strong>φ = {numerator}/{parameters.q}</strong>
      </div>
      <dl>
        {view === "wannier" ? (
          <>
            <div><dt>IDOS</dt><dd>{point.dos?.toFixed(4)}</dd></div>
            <div><dt>Gap Δ</dt><dd>{point.gap?.toExponential(2)}</dd></div>
          </>
        ) : (
          <>
            <div><dt>Energy</dt><dd>{point.energy.toFixed(6)}</dd></div>
            <div><dt>Band</dt><dd>{point.band + 1}</dd></div>
          </>
        )}
        <div>
          <dt>{view === "wannier" ? "Hall tᵣ" : "Chern"}</dt>
          <dd>{point.topologyAvailable === false ? "N/A" : point.chern}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function App() {
  const hydrated = useRef(false);
  if (!hydrated.current) {
    useAppStore.getState().hydrate(parseUrlState());
    hydrated.current = true;
  }
  useCompute();
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const colorMode = useAppStore((state) => state.colorMode);
  const setColorMode = useAppStore((state) => state.setColorMode);
  const surfaceMetric = useAppStore((state) => state.surfaceMetric);
  const setSurfaceMetric = useAppStore((state) => state.setSurfaceMetric);
  const selectedBand = useAppStore((state) => state.selectedBand);
  const setSelectedBand = useAppStore((state) => state.setSelectedBand);
  const parameters = useAppStore((state) => state.parameters);
  const cache = useResultCache();
  const butterflyTopologyAvailable =
    cache.butterfly?.chunks[0]?.topologyAvailable ?? true;
  const exportRoot = useRef<HTMLElement>(null);
  const butterfly = useMemo(
    () => flattenButterfly(cache.butterfly),
    [cache.butterfly],
  );

  useEffect(() => {
    document.title = `${views.find((item) => item.id === view)?.label} · Harper / Hofstadter`;
  }, [view]);

  useEffect(() => {
    if (!butterflyTopologyAvailable && colorMode === "chern") {
      setColorMode("spectral");
    }
  }, [
    butterflyTopologyAvailable,
    colorMode,
    setColorMode,
  ]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Harper Hofstadter home">
          <span className="brand-mark">H/H</span>
          <span>
            <strong>HARPER / HOFSTADTER</strong>
            <small>INTERACTIVE LABORATORY</small>
          </span>
        </a>
        <nav className="view-nav" aria-label="Visualization">
          {views.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              <span>{item.short}</span>{item.label}
            </button>
          ))}
        </nav>
        <a
          className="source-link"
          href="https://github.com/berceanu/hofstadter-interactive"
          target="_blank"
          rel="noreferrer"
        >
          SOURCE ↗
        </a>
      </header>

      <main className="workspace">
        <ParameterPanel />
        <section className="visualization-area" ref={exportRoot}>
          <div className="visualization-header">
            <div>
              <span className="eyebrow">LOCAL QUANTUM SPECTRUM</span>
              <h1>
                {view === "butterfly" && "Hofstadter butterfly"}
                {view === "wannier" && "Wannier diagram"}
                {view === "lattice" && "Lattice geometry"}
                {view === "bands" && "Momentum-space bands"}
              </h1>
              <p>
                {parameters.lattice} lattice · t = [{parameters.hoppings.join(", ")}] ·{" "}
                {view === "butterfly" || view === "wannier"
                  ? `q = ${parameters.q}`
                  : `φ = ${parameters.p}/${parameters.q}`}
              </p>
            </div>
            <div className="view-tools">
              {view === "butterfly" && (
                <div className="segmented" aria-label="Point coloring">
                  <button
                    className={colorMode === "spectral" ? "active" : ""}
                    onClick={() => setColorMode("spectral")}
                  >
                    Energy
                  </button>
                  <button
                    className={
                      colorMode === "chern" && butterflyTopologyAvailable
                        ? "active"
                        : ""
                    }
                    onClick={() => setColorMode("chern")}
                    disabled={!butterflyTopologyAvailable}
                    title={
                      butterflyTopologyAvailable
                        ? "Color states by Diophantine Chern number"
                        : "Fast Diophantine coloring is unavailable for this model"
                    }
                  >
                    {butterflyTopologyAvailable ? "Chern" : "Chern unavailable"}
                  </button>
                </div>
              )}
              {view === "bands" && cache.bands && (
                <>
                  <label className="band-select">
                    Band
                    <select
                      value={selectedBand}
                      onChange={(event) => setSelectedBand(Number(event.target.value))}
                    >
                      {Array.from({ length: cache.bands.bands }, (_, band) => (
                        <option key={band} value={band}>
                          {cache.bands!.groupSize[band] > 1
                            ? `${band + 1} · group ${cache.bands!.groupStart[band] + 1}–${
                                cache.bands!.groupStart[band]
                                + cache.bands!.groupSize[band]
                              } · Cg=${cache.bands!.chern[band]}`
                            : `${band + 1} · C=${cache.bands!.chern[band]}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="segmented" aria-label="Surface quantity">
                    <button
                      className={surfaceMetric === "energy" ? "active" : ""}
                      onClick={() => setSurfaceMetric("energy")}
                    >
                      Energy
                    </button>
                    <button
                      className={surfaceMetric === "berry" ? "active" : ""}
                      onClick={() => setSurfaceMetric("berry")}
                    >
                      Berry
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <RuntimeStatus />

          <div className="visualization-body">
            {view === "butterfly" && <ButterflyPlot />}
            {view === "wannier" && <ButterflyPlot wannier />}
            {view === "lattice" && <LatticeView />}
            {view === "bands" && <BandView />}
          </div>

          <div className="bottom-deck">
            {(view === "butterfly" || view === "wannier") && <SelectionReadout />}
            <div className="export-deck">
              <span className="eyebrow">EXPORT / SHARE</span>
              <div>
                <button
                  onClick={() =>
                    exportCsv(parameters, view, butterfly, cache.bands, cache.lattice)
                  }
                >
                  CSV
                </button>
                <button
                  onClick={() =>
                    exportNpz(parameters, view, butterfly, cache.bands, cache.lattice)
                  }
                >
                  NPZ
                </button>
                <button
                  onClick={() => {
                    if (exportRoot.current) {
                      void exportPng(exportRoot.current, parameters, view);
                    }
                  }}
                >
                  PNG
                </button>
                <button
                  onClick={() => void navigator.clipboard.writeText(window.location.href)}
                >
                  Copy link
                </button>
              </div>
            </div>
            <div className="result-stats">
              <span className="eyebrow">RESULT</span>
              <strong>
                {view === "butterfly"
                  ? `${butterfly.energy.length.toLocaleString()} states`
                  : view === "wannier"
                    ? `${butterfly.gap.length.toLocaleString()} gaps`
                    : view === "bands" && cache.bands
                      ? `${cache.bands.bands} bands`
                      : cache.lattice
                        ? `${cache.lattice.sites.length / 2} sites`
                        : "—"}
              </strong>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <span>GPL-3.0 · Runs entirely in your browser</span>
        <span>
          Numerical core:{" "}
          <a href="https://hofstadter.tools" target="_blank" rel="noreferrer">
            HofstadterTools
          </a>{" "}
          · Andrews, JOSS 2024 ·{" "}
          <a href="https://doi.org/10.21105/joss.06356" target="_blank" rel="noreferrer">
            doi:10.21105/joss.06356
          </a>
        </span>
      </footer>
    </div>
  );
}
