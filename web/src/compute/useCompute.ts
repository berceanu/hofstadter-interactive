import { useEffect } from "react";
import type {
  FocusKind,
  ScientificParameters,
  TopologyResult,
  ViewKind,
} from "./contracts";
import { PyodideWorkerEngine } from "./workerEngine";
import { resultCache } from "../state/resultCache";
import { useAppStore } from "../state/store";
import { writeUrlState } from "../state/urlState";
import {
  baseTopologyGridSufficient,
  bandComputationKey,
  dispersionComputationKey,
  dispersionRefinementGrid,
  latticeComputationKey,
  sweepComputationKey,
  topologyComputationKey,
  topologyRefinementGrid,
  topologyRefinementPlan,
  topologyTargetLabel,
  type DispersionRefinementGrid,
  type TopologyRefinementPlan,
} from "./computeKeys";

export {
  bandComputationKey,
  dispersionComputationKey,
  dispersionRefinementGrid,
  latticeComputationKey,
  sweepComputationKey,
  topologyComputationKey,
  topologyRefinementGrid,
  topologyRefinementPlan,
} from "./computeKeys";

const engine = new PyodideWorkerEngine();
const ADAPTIVE_WILSON_STEP_LIMIT = 0.8 * Math.PI;

function requestId(kind: string) {
  return `${kind}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function computationError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const finalLine = error.message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return finalLine ? `Computation failed · ${finalLine}` : fallback;
}

interface DesiredComputations {
  parameters: ScientificParameters;
  sweepKey?: string;
  bandsKey?: string;
  latticeKey?: string;
  geometryKey?: string;
  topologyKey?: string;
  topologyPlan?: TopologyRefinementPlan;
  selectedBand?: number;
  dispersionKey?: string;
  dispersionGrid?: DispersionRefinementGrid;
}

function desiredComputations(
  parameters: ScientificParameters,
  focus: FocusKind,
  view: ViewKind,
  workspaceWide: boolean,
  geometryRequested: boolean,
  selectedBand: number,
  bandCutZoom: number,
): DesiredComputations {
  const workspace = workspaceWide && focus === "workspace";
  const active = focus === "workspace" ? view : focus;
  const needsSweep =
    workspace || active === "butterfly" || active === "wannier";
  const needsBands = workspace || active === "bands";
  const needsLattice = workspace || active === "lattice";
  const bandsKey = needsBands ? bandComputationKey(parameters) : undefined;
  const snapshot = resultCache.getSnapshot();
  const knownBands =
    bandsKey && snapshot.bandsKey === bandsKey ? snapshot.bands : undefined;
  const clampedBand = knownBands
    ? Math.max(0, Math.min(knownBands.bands - 1, selectedBand))
    : Math.max(0, selectedBand);
  const topologyPlan = topologyRefinementPlan(parameters);
  const dispersionGrid = dispersionRefinementGrid(
    parameters,
    bandCutZoom,
  );
  const basePathSamples = Math.max(24, parameters.samples);
  const dispersionCanRefine =
    dispersionGrid.surfaceSamples > parameters.samples
    || dispersionGrid.pathSamplesPerSegment > basePathSamples;
  return {
    parameters,
    ...(needsSweep ? { sweepKey: sweepComputationKey(parameters) } : {}),
    ...(bandsKey ? { bandsKey } : {}),
    ...(needsBands && geometryRequested
      ? { geometryKey: bandComputationKey(parameters) }
      : {}),
    ...(bandsKey && topologyPlan.levels.length
      ? {
          topologyKey: topologyComputationKey(
            parameters,
            topologyTargetLabel(knownBands, clampedBand),
            topologyPlan,
          ),
          topologyPlan,
          selectedBand: clampedBand,
        }
      : {}),
    ...(bandsKey && dispersionCanRefine
      ? {
          dispersionKey: dispersionComputationKey(
            parameters,
            dispersionGrid,
          ),
          dispersionGrid,
        }
      : {}),
    ...(needsLattice
      ? { latticeKey: latticeComputationKey(parameters) }
      : {}),
  };
}

class ComputeScheduler {
  private desired?: DesiredComputations;
  private running = false;
  private cancelRequested = false;
  private active?: {
    kind:
      | "butterfly"
      | "bands"
      | "lattice"
      | "geometry"
      | "topology"
      | "dispersion";
    key: string;
    requestId: string;
  };

  schedule(next: DesiredComputations) {
    this.desired = next;
    this.cancelRequested = false;
    if (next.latticeKey) resultCache.expectLattice(next.latticeKey);
    if (next.bandsKey) resultCache.expectBands(next.bandsKey);
    if (next.geometryKey) resultCache.expectGeometry(next.geometryKey);
    if (next.topologyKey) resultCache.expectTopology(next.topologyKey);
    if (next.dispersionKey) {
      resultCache.expectDispersion(next.dispersionKey);
    }
    if (next.sweepKey) resultCache.expectButterfly(next.sweepKey);

    const snapshot = resultCache.getSnapshot();
    if (
      next.bandsKey
      && snapshot.bandsKey === next.bandsKey
      && snapshot.bands
    ) {
      const store = useAppStore.getState();
      const clamped = Math.max(
        0,
        Math.min(snapshot.bands.bands - 1, store.selectedBand),
      );
      if (clamped !== store.selectedBand) store.setSelectedBand(clamped);
    }

    if (
      this.active?.kind === "butterfly"
      && this.active.key !== next.sweepKey
    ) {
      void engine.cancel(this.active.requestId);
    }
    void this.pump();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.desired) {
        const target = this.desired;
        this.desired = undefined;
        const jobs = [
          target.latticeKey
            ? {
                kind: "lattice" as const,
                key: target.latticeKey,
                cached: () => resultCache.hasLattice(target.latticeKey!),
              }
            : undefined,
          target.bandsKey
            ? {
                kind: "bands" as const,
                key: target.bandsKey,
                cached: () => resultCache.hasBands(target.bandsKey!),
              }
            : undefined,
          target.dispersionKey && target.dispersionGrid && target.bandsKey
            ? {
                kind: "dispersion" as const,
                key: target.dispersionKey,
                bandKey: target.bandsKey,
                grid: target.dispersionGrid,
                cached: () =>
                  resultCache.hasDispersion(target.dispersionKey!),
              }
            : undefined,
          target.topologyKey
            && target.topologyPlan
            && target.selectedBand !== undefined
            && target.bandsKey
            ? {
                kind: "topology" as const,
                key: target.topologyKey,
                bandKey: target.bandsKey,
                plan: target.topologyPlan,
                selectedBand: target.selectedBand,
                cached: () =>
                  resultCache.hasTopology(target.topologyKey!),
              }
            : undefined,
          target.geometryKey
            ? {
                kind: "geometry" as const,
                key: target.geometryKey,
                cached: () =>
                  resultCache.hasGeometry(target.geometryKey!),
              }
            : undefined,
          target.sweepKey
            ? {
                kind: "butterfly" as const,
                key: target.sweepKey,
                cached: () => resultCache.hasButterfly(target.sweepKey!),
              }
            : undefined,
        ].filter((job) => job !== undefined);

        for (const job of jobs) {
          if (this.desired || this.cancelRequested) break;
          if (job.cached()) continue;
          if (job.kind === "lattice") {
            await this.computeLattice(job.key, target.parameters);
          } else if (job.kind === "bands") {
            await this.computeBands(job.key, target.parameters);
          } else if (job.kind === "topology") {
            // A bands result computed earlier in this pass can refine the
            // provisional band-indexed key into its group-canonical form.
            const snapshot = resultCache.getSnapshot();
            const bands =
              snapshot.bandsKey === job.bandKey ? snapshot.bands : undefined;
            const resolvedKey = topologyComputationKey(
              target.parameters,
              topologyTargetLabel(bands, job.selectedBand),
              job.plan,
            );
            if (resolvedKey !== job.key && resultCache.expectTopology(resolvedKey)) {
              continue;
            }
            await this.computeTopology(
              resolvedKey,
              job.bandKey,
              job.plan,
              job.selectedBand,
              target.parameters,
            );
          } else if (job.kind === "dispersion") {
            await this.computeDispersion(
              job.key,
              job.bandKey,
              job.grid,
              target.parameters,
            );
          } else if (job.kind === "geometry") {
            await this.computeGeometry(job.key, target.parameters);
          } else {
            await this.computeButterfly(job.key, target.parameters);
          }
        }
      }
    } finally {
      this.running = false;
      if (this.desired) void this.pump();
    }
  }

  private setActive(
    kind:
      | "butterfly"
      | "bands"
      | "lattice"
      | "geometry"
      | "topology"
      | "dispersion",
    key: string,
    id: string,
  ) {
    this.active = { kind, key, requestId: id };
    useAppStore.getState().setActiveRequest(id);
  }

  private clearActive(id: string) {
    if (this.active?.requestId !== id) return;
    this.active = undefined;
    useAppStore.getState().setActiveRequest(undefined);
  }

  private async computeLattice(
    key: string,
    parameters: ScientificParameters,
  ) {
    const id = requestId("lattice");
    const store = useAppStore.getState();
    resultCache.beginLattice(key);
    store.incrementComputeCounter("lattice");
    this.setActive("lattice", key, id);
    store.setProgress({
      phase: "computing",
      fraction: 0.05,
      message: "Constructing lattice geometry",
    });
    try {
      const result = await engine.computeLattice(id, parameters);
      resultCache.setLattice(result, key);
      if (resultCache.isExpected("lattice", key)) {
        store.setProgress({
          phase: "complete",
          fraction: 1,
          message: "Lattice geometry ready",
        });
      }
    } catch (error: unknown) {
      if (!String(error).includes("cancelled")) {
        resultCache.fail("lattice", key);
        if (resultCache.isExpected("lattice", key)) {
          store.setProgress({
            phase: "error",
            fraction: 0,
            message: computationError(error, "Lattice construction failed."),
          });
        }
      }
    } finally {
      this.clearActive(id);
    }
  }

  private async computeBands(key: string, parameters: ScientificParameters) {
    const id = requestId("bands");
    const store = useAppStore.getState();
    resultCache.beginBands(key);
    store.incrementComputeCounter("bands");
    this.setActive("bands", key, id);
    store.setProgress({
      phase: "computing",
      fraction: 0.08,
      message: "Diagonalizing the momentum grid",
    });
    try {
      const result = await engine.computeBands(id, parameters);
      resultCache.setBands(result, key);
      if (resultCache.isExpected("bands", key)) {
        useAppStore
          .getState()
          .setSelectedBand(
            Math.min(useAppStore.getState().selectedBand, result.bands - 1),
          );
        store.setProgress({
          phase: "complete",
          fraction: 1,
          message: `Band grid complete in ${(result.elapsedMs / 1000).toFixed(2)} s`,
        });
      }
    } catch (error: unknown) {
      if (!String(error).includes("cancelled")) {
        resultCache.fail("bands", key);
        if (resultCache.isExpected("bands", key)) {
          store.setProgress({
            phase: "error",
            fraction: 0,
            message: computationError(error, "Band computation failed."),
          });
        }
      }
    } finally {
      this.clearActive(id);
    }
  }

  private async computeButterfly(
    key: string,
    parameters: ScientificParameters,
  ) {
    const id = requestId("butterfly");
    const store = useAppStore.getState();
    resultCache.beginButterfly(id, key);
    store.incrementComputeCounter("sweeps");
    this.setActive("butterfly", key, id);
    store.setProgress({
      phase: "computing",
      fraction: 0,
      message: "Starting the flux sweep",
    });
    try {
      const elapsedMs = await engine.computeButterfly(
        id,
        parameters,
        (chunk) => {
          resultCache.appendButterfly(chunk);
          if (!resultCache.isExpected("butterfly", key)) return;
          store.setProgress({
            phase: chunk.progress < 1 ? "computing" : "rendering",
            fraction: chunk.progress,
            message:
              chunk.progress < 1
                ? `Computing flux batches · ${Math.round(chunk.progress * 100)}%`
                : "Rendering the completed spectrum",
          });
        },
      );
      resultCache.completeButterfly(id, elapsedMs);
      if (resultCache.isExpected("butterfly", key)) {
        store.setProgress({
          phase: "complete",
          fraction: 1,
          message: `Computed locally in ${(elapsedMs / 1000).toFixed(2)} s`,
        });
      }
    } catch (error: unknown) {
      if (!String(error).includes("cancelled")) {
        resultCache.fail("butterfly", key);
        if (resultCache.isExpected("butterfly", key)) {
          store.setProgress({
            phase: "error",
            fraction: 0,
            message: computationError(error, "Spectrum computation failed."),
          });
        }
      }
    } finally {
      resultCache.abandonButterfly(id);
      this.clearActive(id);
    }
  }

  private async computeTopology(
    key: string,
    bandKey: string,
    plan: TopologyRefinementPlan,
    selectedBand: number,
    parameters: ScientificParameters,
  ) {
    const snapshot = resultCache.getSnapshot();
    const bands = snapshot.bandsKey === bandKey ? snapshot.bands : undefined;
    if (!bands) {
      resultCache.clearTopologyExpectation(key);
      return;
    }
    const safeBand = Math.max(0, Math.min(bands.bands - 1, selectedBand));
    const groupStart = bands.groupStart[safeBand] ?? safeBand;
    const groupSize = bands.groupSize[groupStart] ?? 1;
    if (
      baseTopologyGridSufficient(parameters, bands.samples)
      && bands.topologyGroupResolved[groupStart]
    ) {
      resultCache.clearTopologyExpectation(key);
      return;
    }
    const groups: [number, number][] = [[groupStart, groupSize]];

    const id = requestId("topology");
    const store = useAppStore.getState();
    resultCache.beginTopology(key);
    store.incrementComputeCounter("topology");
    this.setActive("topology", key, id);
    try {
      let finalResult: TopologyResult | undefined;
      let totalElapsedMs = 0;
      for (let pass = 0; pass < plan.levels.length; pass += 1) {
        const grid = plan.levels[pass];
        store.setProgress({
          phase: "computing",
          fraction: 0.1 + 0.75 * (pass / plan.levels.length),
          message:
            `Resolving selected-band topology automatically`
            + (plan.levels.length > 1
              ? ` · pass ${pass + 1}/${plan.levels.length}`
              : ""),
        });
        const result = await engine.computeTopology(
          id,
          parameters,
          groups,
          grid.samplesX,
          grid.samplesY,
        );
        totalElapsedMs += result.elapsedMs;
        const certified =
          result.topologyResolved
          && Boolean(result.topologyGroupResolved[groupStart])
          && (result.wilsonMaxStep[groupStart] ?? Number.POSITIVE_INFINITY)
            < ADAPTIVE_WILSON_STEP_LIMIT;
        const resolvedGroups = new Uint8Array(
          result.topologyGroupResolved,
        );
        resolvedGroups.fill(
          certified ? 1 : 0,
          groupStart,
          groupStart + groupSize,
        );
        finalResult = {
          ...result,
          topologyResolved: certified,
          topologyGroupResolved: resolvedGroups,
          elapsedMs: totalElapsedMs,
        };
        if (certified) {
          break;
        }
      }
      if (!finalResult) {
        resultCache.clearTopologyExpectation(key);
        return;
      }
      resultCache.setTopology(finalResult, key);
      if (resultCache.isExpected("topology", key)) {
        store.setProgress({
          phase: "complete",
          fraction: 1,
          message: finalResult.topologyResolved
            ? `Selected-band topology verified in ${(finalResult.elapsedMs / 1000).toFixed(2)} s`
            : "Best available selected-band topology estimate ready",
        });
      }
    } catch (error: unknown) {
      if (!String(error).includes("cancelled")) {
        resultCache.fail("topology", key);
        if (resultCache.isExpected("topology", key)) {
          store.setProgress({
            phase: "error",
            fraction: 0,
            message: computationError(error, "Topology refinement failed."),
          });
        }
      }
    } finally {
      this.clearActive(id);
    }
  }

  private async computeDispersion(
    key: string,
    bandKey: string,
    grid: DispersionRefinementGrid,
    parameters: ScientificParameters,
  ) {
    const snapshot = resultCache.getSnapshot();
    const bands = snapshot.bandsKey === bandKey ? snapshot.bands : undefined;
    if (!bands) {
      resultCache.clearDispersionExpectation(key);
      return;
    }

    const id = requestId("dispersion");
    const store = useAppStore.getState();
    resultCache.beginDispersion(key);
    store.incrementComputeCounter("dispersion");
    this.setActive("dispersion", key, id);
    store.setProgress({
      phase: "computing",
      fraction: 0.1,
      message: "Optimizing energy detail for the current view",
    });
    try {
      const result = await engine.computeDispersion(
        id,
        parameters,
        grid.surfaceSamples,
        grid.pathSamplesPerSegment,
      );
      resultCache.setDispersion(result, key);
      if (resultCache.isExpected("dispersion", key)) {
        store.setProgress({
          phase: "complete",
          fraction: 1,
          message:
            `Energy detail optimized in ${(result.elapsedMs / 1000).toFixed(2)} s`,
        });
      }
    } catch (error: unknown) {
      if (!String(error).includes("cancelled")) {
        resultCache.fail("dispersion", key);
        if (resultCache.isExpected("dispersion", key)) {
          store.setProgress({
            phase: "error",
            fraction: 0,
            message: computationError(error, "Dispersion refinement failed."),
          });
        }
      }
    } finally {
      this.clearActive(id);
    }
  }

  private async computeGeometry(
    key: string,
    parameters: ScientificParameters,
  ) {
    const id = requestId("geometry");
    const store = useAppStore.getState();
    resultCache.beginGeometry(key);
    store.incrementComputeCounter("geometry");
    this.setActive("geometry", key, id);
    store.setProgress({
      phase: "computing",
      fraction: 0.1,
      message: "Computing two offset quantum-geometry grids",
    });
    try {
      const result = await engine.computeGeometry(id, parameters);
      resultCache.setGeometry(result, key);
      if (resultCache.isExpected("geometry", key)) {
        store.setProgress({
          phase: "complete",
          fraction: 1,
          message: `Quantum geometry ready in ${(result.elapsedMs / 1000).toFixed(2)} s`,
        });
      }
    } catch (error: unknown) {
      if (!String(error).includes("cancelled")) {
        resultCache.fail("geometry", key);
        if (resultCache.isExpected("geometry", key)) {
          store.setProgress({
            phase: "error",
            fraction: 0,
            message: computationError(error, "Quantum geometry failed."),
          });
        }
      }
    } finally {
      this.clearActive(id);
    }
  }

  async cancelActive() {
    this.desired = undefined;
    this.cancelRequested = true;
    const activeKind = this.active?.kind;
    if (this.active) await engine.cancel(this.active.requestId);
    return activeKind;
  }
}

const scheduler = new ComputeScheduler();

export function useCompute() {
  const parameters = useAppStore((state) => state.parameters);
  const view = useAppStore((state) => state.view);
  const focus = useAppStore((state) => state.focus);
  const workspaceWide = useAppStore((state) => state.workspaceWide);
  const runtimeReady = useAppStore((state) => state.runtimeReady);
  const surfaceMetric = useAppStore((state) => state.surfaceMetric);
  const geometryColumnsExpanded = useAppStore(
    (state) => state.geometryColumnsExpanded,
  );
  const selectedBand = useAppStore((state) => state.selectedBand);
  const bandCutZoom = useAppStore((state) => state.bandCutZoom);
  const geometryRequested =
    surfaceMetric === "gxx"
    || surfaceMetric === "gxy"
    || geometryColumnsExpanded;

  useEffect(() => {
    let mounted = true;
    const store = useAppStore.getState();
    engine
      .initialize((progress) => {
        if (mounted) store.setProgress(progress);
      })
      .then(() => {
        if (mounted) useAppStore.getState().setRuntimeReady(true);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        useAppStore.getState().setProgress({
          phase: "error",
          fraction: 0,
          message:
            error instanceof Error
              ? error.message
              : "Unable to initialize the local compute engine.",
        });
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    writeUrlState(parameters, focus, view);
  }, [focus, parameters, view]);

  useEffect(() => {
    if (!runtimeReady) return;
    const timeout = window.setTimeout(() => {
      scheduler.schedule(
        desiredComputations(
          parameters,
          focus,
          view,
          workspaceWide,
          geometryRequested,
          selectedBand,
          bandCutZoom,
        ),
      );
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [
    bandCutZoom,
    focus,
    geometryRequested,
    parameters,
    runtimeReady,
    selectedBand,
    view,
    workspaceWide,
  ]);
}

export async function cancelActiveComputation() {
  await scheduler.cancelActive();
  useAppStore.getState().setProgress({
    phase: "idle",
    fraction: 0,
    message: "Computation cancelled",
  });
}

export async function retryComputeEngine() {
  const store = useAppStore.getState();
  store.setRuntimeReady(false);
  store.setProgress({
    phase: "initializing",
    fraction: 0.05,
    message: "Restarting the local compute engine",
  });
  try {
    await engine.recover();
    store.setRuntimeReady(true);
  } catch (error: unknown) {
    store.setProgress({
      phase: "error",
      fraction: 0,
      message: computationError(error, "Unable to restart the compute engine."),
    });
  }
}
