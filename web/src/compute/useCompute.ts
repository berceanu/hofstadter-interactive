import { useEffect } from "react";
import type {
  FocusKind,
  ScientificParameters,
  ViewKind,
} from "./contracts";
import { PyodideWorkerEngine } from "./workerEngine";
import { resultCache } from "../state/resultCache";
import { useAppStore } from "../state/store";
import { writeUrlState } from "../state/urlState";
import {
  bandComputationKey,
  latticeComputationKey,
  sweepComputationKey,
} from "./computeKeys";

export {
  bandComputationKey,
  latticeComputationKey,
  sweepComputationKey,
} from "./computeKeys";

const engine = new PyodideWorkerEngine();

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
}

function desiredComputations(
  parameters: ScientificParameters,
  focus: FocusKind,
  view: ViewKind,
  workspaceWide: boolean,
  geometryRequested: boolean,
): DesiredComputations {
  const workspace = workspaceWide && focus === "workspace";
  const active = focus === "workspace" ? view : focus;
  const needsSweep =
    workspace || active === "butterfly" || active === "wannier";
  const needsBands = workspace || active === "bands";
  const needsLattice = workspace || active === "lattice";
  return {
    parameters,
    ...(needsSweep ? { sweepKey: sweepComputationKey(parameters) } : {}),
    ...(needsBands ? { bandsKey: bandComputationKey(parameters) } : {}),
    ...(needsBands && geometryRequested
      ? { geometryKey: bandComputationKey(parameters) }
      : {}),
    ...(needsLattice
      ? { latticeKey: latticeComputationKey(parameters) }
      : {}),
  };
}

class ComputeScheduler {
  private desired?: DesiredComputations;
  private running = false;
  private active?: {
    kind: "butterfly" | "bands" | "lattice" | "geometry";
    key: string;
    requestId: string;
  };

  schedule(next: DesiredComputations) {
    this.desired = next;
    if (next.latticeKey) resultCache.expectLattice(next.latticeKey);
    if (next.bandsKey) resultCache.expectBands(next.bandsKey);
    if (next.geometryKey) resultCache.expectGeometry(next.geometryKey);
    if (next.sweepKey) resultCache.expectButterfly(next.sweepKey);

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
          if (this.desired) break;
          if (job.cached()) continue;
          if (job.kind === "lattice") {
            await this.computeLattice(job.key, target.parameters);
          } else if (job.kind === "bands") {
            await this.computeBands(job.key, target.parameters);
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
    kind: "butterfly" | "bands" | "lattice" | "geometry",
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
    if (this.active) await engine.cancel(this.active.requestId);
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
    writeUrlState(parameters, focus);
  }, [focus, parameters]);

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
        ),
      );
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [
    focus,
    geometryRequested,
    parameters,
    runtimeReady,
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
