import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BandView } from "./BandView";
import { ButterflyPlot } from "./ButterflyPlot";
import { LatticeView } from "./LatticeView";
import { ParameterPanel } from "./ParameterPanel";
import {
  cancelActiveComputation,
  retryComputeEngine,
  useCompute,
} from "../compute/useCompute";
import type { FocusKind, ViewKind } from "../compute/contracts";
import { useResultCache } from "../state/resultCache";
import { useAppStore } from "../state/store";
import { parseUrlState } from "../state/urlState";
import { flattenButterfly } from "../utils/arrays";
import {
  exportArtPng,
  exportCsv,
  exportNpz,
  exportPng,
} from "../utils/exports";
import { restoreNpzFile } from "../utils/npzImport";

const views: { id: ViewKind; label: string; short: string }[] = [
  { id: "butterfly", label: "Butterfly", short: "01" },
  { id: "wannier", label: "Wannier", short: "02" },
  { id: "lattice", label: "Lattice + BZ", short: "03" },
  { id: "bands", label: "Band surfaces", short: "04" },
];

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
  const view = useAppStore((state) => state.view);
  const parameters = useAppStore((state) => state.parameters);
  const colorMode = useAppStore((state) => state.colorMode);
  if (!point) {
    return (
      <div className="selection-card muted">
        <span className="eyebrow">STATE INSPECTOR</span>
        <p>Hover over a spectrum, or click a state to choose its flux.</p>
      </div>
    );
  }
  const isWannier = point.source === "wannier"
    || (!point.source && view === "wannier");
  const isGap = point.source === "gap"
    || (!point.source && colorMode === "gaps" && point.gap !== undefined);
  const numerator = Math.round(point.flux * parameters.q);
  return (
    <div className="selection-card">
      <div>
        <span className="eyebrow">SELECTED STATE</span>
        <strong>φ = {numerator}/{parameters.q}</strong>
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

function ButterflyTools({ paletteOnly = false }: { paletteOnly?: boolean }) {
  const cache = useResultCache();
  const colorMode = useAppStore((state) => state.colorMode);
  const setColorMode = useAppStore((state) => state.setColorMode);
  const topologicalPalette = useAppStore(
    (state) => state.topologicalPalette,
  );
  const setTopologicalPalette = useAppStore(
    (state) => state.setTopologicalPalette,
  );
  const topologyAvailable =
    cache.butterfly?.chunks[0]?.topologyAvailable ?? true;
  return (
    <div className="butterfly-tools">
      {!paletteOnly && (
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
      )}
      <label className="palette-select">
        <span>palette</span>
        <select
          aria-label="Topology palette"
          value={topologicalPalette}
          disabled={!topologyAvailable}
          onChange={(event) =>
            setTopologicalPalette(
              event.target.value as "avron" | "jet" | "red-blue",
            )
          }
        >
          <option value="avron">Avron</option>
          <option value="jet">Jet</option>
          <option value="red-blue">Red–blue</option>
        </select>
      </label>
    </div>
  );
}

function BandTools() {
  const { bands } = useResultCache();
  const selectedBand = useAppStore((state) => state.selectedBand);
  const setSelectedBand = useAppStore((state) => state.setSelectedBand);
  const surfaceMetric = useAppStore((state) => state.surfaceMetric);
  const setSurfaceMetric = useAppStore((state) => state.setSurfaceMetric);
  if (!bands) return null;
  return (
    <>
      <label className="band-select">
        Band index
        <select
          aria-label="Band"
          value={Math.min(selectedBand, bands.bands - 1)}
          onChange={(event) => setSelectedBand(Number(event.target.value))}
        >
          {Array.from({ length: bands.bands }, (_, band) => (
            <option key={band} value={band}>
              {bands.groupSize[band] > 1
                ? `${band} · group ${bands.groupStart[band]}–${
                    bands.groupStart[band] + bands.groupSize[band] - 1
                  } · Cg=${bands.chern[band]}`
                : `${band} · C=${bands.chern[band]}`}
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

function viewTitle(view: ViewKind) {
  if (view === "butterfly") return "Hofstadter butterfly";
  if (view === "wannier") return "Wannier diagram";
  if (view === "lattice") return "Lattice geometry";
  return "Momentum-space bands";
}

function ViewTools({ view }: { view: ViewKind }) {
  if (view === "butterfly") return <ButterflyTools />;
  if (view === "wannier") return <ButterflyTools paletteOnly />;
  if (view === "bands") return <BandTools />;
  return null;
}

function WorkspacePanel({
  id,
  title,
  kicker,
  className,
  tools,
  children,
}: {
  id: ViewKind;
  title: string;
  kicker: string;
  className?: string;
  tools?: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const parameters = useAppStore((state) => state.parameters);
  const setFocus = useAppStore((state) => state.setFocus);
  const colorMode = useAppStore((state) => state.colorMode);
  const cache = useResultCache();
  const [transparentArt, setTransparentArt] = useState(false);

  return (
    <section
      ref={root}
      className={`workspace-panel ${className ?? ""}`}
      data-panel-id={id}
    >
      <header className="workspace-panel-heading">
        <div>
          <span className="eyebrow">{kicker}</span>
          <h2>{title}</h2>
        </div>
        <div className="workspace-panel-tools">
          {tools}
          <button
            className="maximize-button"
            aria-label={`Maximize ${title} panel`}
            title="Open focus mode"
            onClick={() => setFocus(id)}
          >
            ↗
          </button>
        </div>
      </header>
      <div className="workspace-panel-body">{children}</div>
      <div className="panel-export-tools" aria-label={`${title} exports`}>
        <button
          aria-label={`Export ${title} CSV`}
          onClick={() =>
            exportCsv(
              parameters,
              id,
              flattenButterfly(cache.butterfly),
              cache.bands,
              cache.lattice,
              cache.geometry,
            )
          }
        >
          CSV
        </button>
        <button
          aria-label={`Export ${title} NPZ`}
          onClick={() =>
            exportNpz(
              parameters,
              id,
              flattenButterfly(cache.butterfly),
              cache.bands,
              cache.lattice,
              cache.geometry,
            )
          }
        >
          NPZ
        </button>
        <button
          aria-label={`Export ${title} PNG`}
          onClick={() => {
            if (root.current) void exportPng(root.current, parameters, id);
          }}
        >
          PNG
        </button>
        {(id === "butterfly" || id === "wannier") && (
          <>
            <button
              aria-label={`Export ${title} Art PNG`}
              onClick={() => {
                const stage = root.current?.querySelector<HTMLElement>(
                  ".plot-stage",
                );
                if (stage) {
                  void exportArtPng(
                    stage,
                    parameters,
                    id,
                    colorMode,
                    transparentArt,
                  );
                }
              }}
            >
              Art PNG
            </button>
            <label className="transparent-art-toggle">
              <input
                type="checkbox"
                checked={transparentArt}
                onChange={(event) =>
                  setTransparentArt(event.target.checked)
                }
              />
              alpha
            </label>
          </>
        )}
      </div>
    </section>
  );
}

function WorkspaceDashboard() {
  const root = useRef<HTMLElement>(null);
  const parameters = useAppStore((state) => state.parameters);
  return (
    <main className="single-workspace" ref={root} data-workspace>
      <div className="workspace-commandbar">
        <div>
          <span className="eyebrow">SINGLE SCIENTIFIC WORKSPACE</span>
          <strong>
            {parameters.lattice} · φ = {parameters.p}/{parameters.q}
          </strong>
        </div>
        <RuntimeStatus />
        <div className="workspace-share-tools">
          <button
            onClick={() => {
              if (root.current) {
                void exportPng(root.current, parameters, "workspace");
              }
            }}
          >
            PNG workspace
          </button>
          <button
            onClick={() =>
              void navigator.clipboard.writeText(window.location.href)
            }
          >
            Copy link
          </button>
        </div>
      </div>

      <aside className="workspace-sidebar">
        <ParameterPanel />
        <WorkspacePanel
          id="lattice"
          title="Lattice / BZ"
          kicker="GEOMETRY"
          className="mini-lattice-panel"
        >
          <LatticeView compact />
        </WorkspacePanel>
      </aside>

      <div className="workspace-spectrum-column">
        <WorkspacePanel
          id="butterfly"
          title="Hofstadter butterfly"
          kicker="SPECTRAL HERO"
          className="hero-panel"
          tools={<ButterflyTools />}
        >
          <ButterflyPlot compact />
        </WorkspacePanel>
        <WorkspacePanel
          id="wannier"
          title="Wannier diagram"
          kicker="SHARED FLUX AXIS"
          className="wannier-panel"
        >
          <ButterflyPlot wannier compact />
        </WorkspacePanel>
      </div>

      <div className="workspace-band-column">
        <WorkspacePanel
          id="bands"
          title="At current φ"
          kicker="BANDS · WILSON · PROPERTIES"
          className="current-flux-panel"
          tools={<BandTools />}
        >
          <BandView compact />
        </WorkspacePanel>
        <SelectionReadout />
      </div>
    </main>
  );
}

function FocusedView({ view }: { view: ViewKind }) {
  const exportRoot = useRef<HTMLElement>(null);
  const parameters = useAppStore((state) => state.parameters);
  const cache = useResultCache();
  const colorMode = useAppStore((state) => state.colorMode);
  const [transparentArt, setTransparentArt] = useState(false);
  const butterfly = useMemo(
    () => flattenButterfly(cache.butterfly),
    [cache.butterfly],
  );

  return (
    <main className="workspace focused-workspace">
      <ParameterPanel />
      <section className="visualization-area" ref={exportRoot}>
        <div className="visualization-header">
          <div>
            <span className="eyebrow">LOCAL QUANTUM SPECTRUM</span>
            <h1>{viewTitle(view)}</h1>
            <p>
              {parameters.lattice} lattice · t = [
              {parameters.hoppings.join(", ")}] ·{" "}
              {view === "butterfly" || view === "wannier"
                ? `q = ${parameters.q}`
                : `φ = ${parameters.p}/${parameters.q}`}
            </p>
          </div>
          <div className="view-tools">
            <ViewTools view={view} />
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
          {(view === "butterfly" || view === "wannier") && (
            <SelectionReadout />
          )}
          <div className="export-deck">
            <span className="eyebrow">EXPORT / SHARE</span>
            <div>
              <button
                onClick={() =>
                  exportCsv(
                    parameters,
                    view,
                    butterfly,
                    cache.bands,
                    cache.lattice,
                    cache.geometry,
                  )
                }
              >
                CSV
              </button>
              <button
                onClick={() =>
                  exportNpz(
                    parameters,
                    view,
                    butterfly,
                    cache.bands,
                    cache.lattice,
                    cache.geometry,
                  )
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
              {(view === "butterfly" || view === "wannier") && (
                <>
                  <button
                    onClick={() => {
                      const stage =
                        exportRoot.current?.querySelector<HTMLElement>(
                          ".plot-stage",
                        );
                      if (stage) {
                        void exportArtPng(
                          stage,
                          parameters,
                          view,
                          colorMode,
                          transparentArt,
                        );
                      }
                    }}
                  >
                    Art PNG
                  </button>
                  <label className="transparent-art-toggle">
                    <input
                      type="checkbox"
                      checked={transparentArt}
                      onChange={(event) =>
                        setTransparentArt(event.target.checked)
                      }
                    />
                    transparent
                  </label>
                </>
              )}
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(window.location.href)
                }
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
  );
}

export default function App() {
  const hydrated = useRef(false);
  const npzInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [npzDragActive, setNpzDragActive] = useState(false);
  const [npzMessage, setNpzMessage] = useState<
    { kind: "success" | "error"; text: string } | undefined
  >(undefined);
  if (!hydrated.current) {
    useAppStore.getState().hydrate(parseUrlState());
    hydrated.current = true;
  }
  useCompute();
  const view = useAppStore((state) => state.view);
  const focus = useAppStore((state) => state.focus);
  const workspaceWide = useAppStore((state) => state.workspaceWide);
  const setView = useAppStore((state) => state.setView);
  const setFocus = useAppStore((state) => state.setFocus);
  const setWorkspaceWide = useAppStore((state) => state.setWorkspaceWide);
  const colorMode = useAppStore((state) => state.colorMode);
  const setColorMode = useAppStore((state) => state.setColorMode);
  const counters = useAppStore((state) => state.computeCounters);
  const cache = useResultCache();
  const topologyAvailable =
    cache.butterfly?.chunks[0]?.topologyAvailable ?? true;
  const showWorkspace = workspaceWide && focus === "workspace";
  const activeNavigation: FocusKind = workspaceWide ? focus : view;

  async function loadNpz(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".npz")) {
      setNpzMessage({
        kind: "error",
        text: "Choose a .npz butterfly or Wannier archive.",
      });
      return;
    }
    try {
      await cancelActiveComputation();
      const summary = await restoreNpzFile(file);
      setNpzMessage({
        kind: "success",
        text: `Loaded ${summary.states.toLocaleString()} states and ${summary.gaps.toLocaleString()} gaps from ${file.name}.`,
      });
    } catch (error: unknown) {
      setNpzMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Unable to load NPZ.",
      });
    } finally {
      if (npzInput.current) npzInput.current.value = "";
    }
  }

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1100px)");
    const update = () => setWorkspaceWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [setWorkspaceWide]);

  useEffect(() => {
    document.title = `${
      showWorkspace
        ? "Workspace"
        : views.find((item) => item.id === view)?.label
    } · Harper / Hofstadter`;
  }, [showWorkspace, view]);

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
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        setNpzDragActive(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setNpzDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setNpzDragActive(false);
        void loadNpz(event.dataTransfer.files[0]);
      }}
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
            <small>INTERACTIVE LABORATORY</small>
          </span>
        </a>
        <nav className="view-nav" aria-label="Visualization">
          <button
            className={`workspace-nav-button ${
              activeNavigation === "workspace" ? "active" : ""
            }`}
            onClick={() => setFocus("workspace")}
            aria-current={
              activeNavigation === "workspace" ? "page" : undefined
            }
          >
            <span>00</span>Workspace
          </button>
          {views.map((item) => (
            <button
              key={item.id}
              className={activeNavigation === item.id ? "active" : ""}
              onClick={() => {
                if (workspaceWide) setFocus(item.id);
                else setView(item.id);
              }}
              aria-current={
                activeNavigation === item.id ? "page" : undefined
              }
            >
              <span>{item.short}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <button
            className="npz-load-button"
            onClick={() => npzInput.current?.click()}
          >
            LOAD NPZ
          </button>
          <input
            ref={npzInput}
            className="visually-hidden"
            aria-label="Load NPZ archive"
            type="file"
            accept=".npz,application/octet-stream"
            onChange={(event) => void loadNpz(event.target.files?.[0])}
          />
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

      {npzDragActive && (
        <div className="npz-drop-overlay" role="status">
          <div>
            <strong>DROP NPZ TO RESTORE</strong>
            <span>parameters + butterfly / Wannier arrays stay local</span>
          </div>
        </div>
      )}
      {npzMessage && (
        <div
          className={`npz-import-toast ${npzMessage.kind}`}
          role={npzMessage.kind === "error" ? "alert" : "status"}
        >
          <span>{npzMessage.text}</span>
          <button
            aria-label="Dismiss NPZ message"
            onClick={() => setNpzMessage(undefined)}
          >
            ×
          </button>
        </div>
      )}

      {showWorkspace ? <WorkspaceDashboard /> : <FocusedView view={view} />}

      <footer>
        <span>GPL-3.0 · Runs entirely in your browser</span>
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
