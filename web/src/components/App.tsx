import {
  type ReactNode,
  useEffect,
} from "react";
import { BandView } from "./BandView";
import { ButterflyPlot } from "./ButterflyPlot";
import { HelpTooltip } from "./HelpTooltip";
import { LatticeView } from "./LatticeView";
import { ParameterPanel } from "./ParameterPanel";
import {
  bandResultHelp,
  resultHelp,
  type HelpCopy,
} from "./physicsHelp";
import {
  cancelActiveComputation,
  retryComputeEngine,
  useCompute,
} from "../compute/useCompute";
import type { ResultKind } from "../compute/contracts";
import { useResultCache } from "../state/resultCache";
import { useAppStore } from "../state/store";
import {
  activeTopologyComputationKey,
  baseTopologyGridSufficient,
  topologyRefinementPlan,
} from "../compute/computeKeys";
import { fluxFraction } from "../utils/viewIntegrity";

function RuntimeStatus() {
  const progress = useAppStore((state) => state.progress);
  const busy = [
    "downloading",
    "initializing",
    "loading-package",
    "computing",
    "rendering",
  ].includes(progress.phase);
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
            <button
              className="cancel-button"
              onClick={() => void cancelActiveComputation()}
            >
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
  const parameters = useAppStore((state) => state.parameters);
  if (!point) {
    return (
      <div className="selection-card muted">
        <div>
          <div className="heading-with-help">
            <span className="eyebrow">STATE INSPECTOR</span>
            <HelpTooltip copy={bandResultHelp.inspector} />
          </div>
          <p>Hover over a spectrum, or click a state to choose its flux.</p>
        </div>
      </div>
    );
  }
  const isWannier = point.source === "wannier";
  const isGap = point.source === "gap";
  const fraction = fluxFraction(point.flux, parameters.q);
  return (
    <div className="selection-card">
      <div>
        <div className="heading-with-help">
          <span className="eyebrow">SELECTED STATE</span>
          <HelpTooltip copy={bandResultHelp.inspector} />
        </div>
        <strong>φ = {fraction.numerator}/{fraction.denominator}</strong>
      </div>
      <dl>
        {isWannier ? (
          <>
            <div><dt>IDOS</dt><dd>{point.dos?.toFixed(4)}</dd></div>
            <div><dt>Gap Δ</dt><dd>{point.gap?.toExponential(2)}</dd></div>
          </>
        ) : isGap ? (
          <>
            <div>
              <dt>Energy interval</dt>
              <dd>
                {point.gapEnergyMin?.toFixed(4)} …{" "}
                {point.gapEnergyMax?.toFixed(4)}
              </dd>
            </div>
            <div><dt>Gap Δ</dt><dd>{point.gap?.toExponential(2)}</dd></div>
          </>
        ) : (
          <>
            <div><dt>Energy</dt><dd>{point.energy.toFixed(6)}</dd></div>
            <div><dt>Band index</dt><dd>{point.band ?? 0}</dd></div>
          </>
        )}
        <div>
          <dt>{isWannier || isGap ? "Hall tᵣ" : "Chern"}</dt>
          <dd>{point.topologyAvailable === false ? "N/A" : point.chern}</dd>
        </div>
      </dl>
    </div>
  );
}

function ButterflyTools() {
  const cache = useResultCache();
  const colorMode = useAppStore((state) => state.colorMode);
  const setColorMode = useAppStore((state) => state.setColorMode);
  const topologyAvailable =
    cache.butterfly?.chunks[0]?.topologyAvailable ?? true;
  return (
    <div className="butterfly-tools">
      <div className="segmented" aria-label="Point coloring">
        <button
          className={colorMode === "spectral" ? "active" : ""}
          onClick={() => setColorMode("spectral")}
        >
          Energy
        </button>
        <button
          className={
            colorMode === "chern" && topologyAvailable ? "active" : ""
          }
          onClick={() => setColorMode("chern")}
          disabled={!topologyAvailable}
          title={
            topologyAvailable
              ? "Color states by Diophantine Chern number"
              : "Fast Diophantine coloring is unavailable for this model"
          }
        >
          {topologyAvailable ? "Chern" : "Chern unavailable"}
        </button>
        <button
          className={
            colorMode === "gaps" && topologyAvailable ? "active" : ""
          }
          onClick={() => setColorMode("gaps")}
          disabled={!topologyAvailable}
          title={
            topologyAvailable
              ? "Color open spectral gaps by cumulative Chern number tᵣ"
              : "Gap-plane topology is unavailable for this model"
          }
        >
          Gaps
        </button>
      </div>
    </div>
  );
}

function BandTools() {
  const { bands, bandsKey, topology, topologyKey } = useResultCache();
  const parameters = useAppStore((state) => state.parameters);
  const selectedBand = useAppStore((state) => state.selectedBand);
  const setSelectedBand = useAppStore((state) => state.setSelectedBand);
  const surfaceMetric = useAppStore((state) => state.surfaceMetric);
  const setSurfaceMetric = useAppStore((state) => state.setSurfaceMetric);
  if (!bands) return null;
  const topologyPlan = topologyRefinementPlan(parameters);
  const expectedTopologyKey = activeTopologyComputationKey(
    parameters,
    selectedBand,
    bands,
    bandsKey,
    topologyPlan,
  );
  const refinedTopology =
    topologyKey === expectedTopologyKey
      && topology?.baseSamples === bands.samples
      && topology.bands === bands.bands
      ? topology
      : undefined;
  const topologyForBand = (band: number) => {
    const covered =
      refinedTopology
      && (
        refinedTopology.completeBundle
        || (
          refinedTopology.computedGroupStart >= 0
          && band >= refinedTopology.computedGroupStart
          && band
            < refinedTopology.computedGroupStart
              + refinedTopology.computedGroupSize
        )
      );
    const source = covered ? refinedTopology! : bands;
    return {
      chern: source.chern[band] ?? 0,
      trusted:
        source.topologyGroupingConsistent
        && Boolean(source.topologyGroupResolved[band])
        && (
          Boolean(covered)
          || baseTopologyGridSufficient(parameters, bands.samples)
        ),
    };
  };
  return (
    <>
      <label className="band-select">
        Band index
        <select
          aria-label="Band"
          value={Math.min(selectedBand, bands.bands - 1)}
          onChange={(event) => setSelectedBand(Number(event.target.value))}
        >
          {Array.from({ length: bands.bands }, (_, band) => {
            const bandTopology = topologyForBand(band);
            const chern = bandTopology.trusted ? bandTopology.chern : "…";
            return (
              <option key={band} value={band}>
                {bands.groupSize[band] > 1
                  ? `${band} · group ${bands.groupStart[band]}–${
                      bands.groupStart[band] + bands.groupSize[band] - 1
                    } · Cg=${chern}`
                  : `${band} · C=${chern}`}
              </option>
            );
          })}
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
        <button
          className={surfaceMetric === "gxx" ? "active" : ""}
          onClick={() => setSurfaceMetric("gxx")}
          title="Lazy quantum metric · runs two offset grids"
        >
          gxx
        </button>
        <button
          className={surfaceMetric === "gxy" ? "active" : ""}
          onClick={() => setSurfaceMetric("gxy")}
          title="Lazy quantum metric · runs two offset grids"
        >
          gxy
        </button>
      </div>
    </>
  );
}

function WorkspacePanel({
  id,
  title,
  kicker,
  className,
  tools,
  help,
  children,
}: {
  id: ResultKind;
  title: string;
  kicker?: string;
  className?: string;
  tools?: ReactNode;
  help: HelpCopy;
  children: ReactNode;
}) {
  return (
    <section
      className={`workspace-panel ${className ?? ""}`}
      data-panel-id={id}
    >
      <header className="workspace-panel-heading">
        <div>
          {kicker && <span className="eyebrow">{kicker}</span>}
          <div className="result-heading-title">
            <h2>{title}</h2>
            <HelpTooltip copy={help} />
          </div>
        </div>
        <div className="workspace-panel-tools">
          {tools}
        </div>
      </header>
      <div className="workspace-panel-body">{children}</div>
    </section>
  );
}

function ScientificWorkspace() {
  const parameters = useAppStore((state) => state.parameters);
  return (
    <main className="single-workspace" data-workspace>
      <div className="workspace-commandbar">
        <div>
          <strong>
            {parameters.lattice} · φ = {parameters.p}/{parameters.q}
          </strong>
        </div>
        <RuntimeStatus />
      </div>

      <aside className="workspace-sidebar">
        <ParameterPanel />
        <WorkspacePanel
          id="lattice"
          title="Lattice / BZ"
          kicker="GEOMETRY"
          className="mini-lattice-panel"
          help={resultHelp.lattice}
        >
          <LatticeView />
        </WorkspacePanel>
      </aside>

      <div className="workspace-spectrum-column">
        <WorkspacePanel
          id="butterfly"
          title="Hofstadter butterfly"
          className="hero-panel"
          tools={<ButterflyTools />}
          help={resultHelp.butterfly}
        >
          <ButterflyPlot />
        </WorkspacePanel>
        <WorkspacePanel
          id="wannier"
          title="Wannier diagram"
          className="wannier-panel"
          help={resultHelp.wannier}
        >
          <ButterflyPlot wannier />
        </WorkspacePanel>
      </div>

      <div className="workspace-band-column">
        <WorkspacePanel
          id="bands"
          title="At current φ"
          kicker="BANDS · WILSON · PROPERTIES"
          className="current-flux-panel"
          tools={<BandTools />}
          help={resultHelp.bands}
        >
          <BandView />
        </WorkspacePanel>
        <SelectionReadout />
      </div>
    </main>
  );
}

export default function App() {
  useCompute();
  const colorMode = useAppStore((state) => state.colorMode);
  const setColorMode = useAppStore((state) => state.setColorMode);
  const counters = useAppStore((state) => state.computeCounters);
  const cache = useResultCache();
  const topologyAvailable =
    cache.butterfly?.chunks[0]?.topologyAvailable ?? true;

  useEffect(() => {
    document.title = "Workspace · Harper / Hofstadter";
  }, []);

  useEffect(() => {
    if (
      !topologyAvailable
      && (colorMode === "chern" || colorMode === "gaps")
    ) {
      setColorMode("spectral");
    }
  }, [colorMode, setColorMode, topologyAvailable]);

  return (
    <div
      className="app-shell"
      data-sweep-count={counters.sweeps}
      data-band-request-count={counters.bands}
      data-lattice-request-count={counters.lattice}
      data-geometry-request-count={counters.geometry}
      data-topology-request-count={counters.topology}
      data-dispersion-request-count={counters.dispersion}
    >
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="Harper Hofstadter home"
        >
          <span className="brand-mark">H/H</span>
          <span>
            <strong>HARPER / HOFSTADTER</strong>
            <small>TOOLS</small>
          </span>
        </a>
        <div className="topbar-actions">
          <a
            className="source-link"
            href="https://github.com/berceanu/hofstadter-interactive"
            target="_blank"
            rel="noreferrer"
          >
            SOURCE ↗
          </a>
        </div>
      </header>

      <div className="desktop-required" role="status">
        This scientific workspace requires a desktop-sized window.
      </div>
      <ScientificWorkspace />

      <footer>
        <span>GPL-3.0</span>
        <span>
          Numerical core:{" "}
          <a href="https://hofstadter.tools" target="_blank" rel="noreferrer">
            HofstadterTools
          </a>{" "}
          · Andrews, JOSS 2024 ·{" "}
          <a
            href="https://doi.org/10.21105/joss.06356"
            target="_blank"
            rel="noreferrer"
          >
            doi:10.21105/joss.06356
          </a>
        </span>
      </footer>
    </div>
  );
}
