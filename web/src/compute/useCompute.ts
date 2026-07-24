import { useEffect, useRef } from "react";
import { PyodideWorkerEngine } from "./workerEngine";
import { resultCache } from "../state/resultCache";
import { useAppStore } from "../state/store";
import { writeUrlState } from "../state/urlState";

const engine = new PyodideWorkerEngine();

function requestId(view: string) {
  return `${view}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

export function useCompute() {
  const parameters = useAppStore((state) => state.parameters);
  const view = useAppStore((state) => state.view);
  const runtimeReady = useAppStore((state) => state.runtimeReady);
  const activeRequest = useRef<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    const store = useAppStore.getState();
    engine
      .initialize((progress) => {
        if (mounted) store.setProgress(progress);
      })
      .then(() => {
        if (mounted) {
          useAppStore.getState().setRuntimeReady(true);
        }
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
    writeUrlState(parameters, view);
  }, [parameters, view]);

  useEffect(() => {
    if (!runtimeReady) return;
    const timeout = window.setTimeout(() => {
      const previous = activeRequest.current;
      if (previous) void engine.cancel(previous);

      const id = requestId(view);
      activeRequest.current = id;
      const store = useAppStore.getState();
      store.setActiveRequest(id);
      store.setProgress({
        phase: "computing",
        fraction: 0,
        message:
          view === "bands"
            ? "Diagonalizing the momentum grid"
            : view === "lattice"
              ? "Constructing lattice geometry"
              : "Starting the flux sweep",
      });

      const isCurrent = () =>
        activeRequest.current === id &&
        useAppStore.getState().activeRequestId === id;

      if (view === "butterfly" || view === "wannier") {
        resultCache.beginButterfly(id);
        void engine
          .computeButterfly(id, parameters, (chunk) => {
            if (!isCurrent()) return;
            resultCache.appendButterfly(chunk);
            store.setProgress({
              phase: chunk.progress < 1 ? "computing" : "rendering",
              fraction: chunk.progress,
              message:
                chunk.progress < 1
                  ? `Computing flux batches · ${Math.round(chunk.progress * 100)}%`
                  : "Rendering the completed spectrum",
            });
          })
          .then((elapsedMs) => {
            if (!isCurrent()) return;
            resultCache.completeButterfly(id, elapsedMs);
            store.setProgress({
              phase: "complete",
              fraction: 1,
              message: `Computed locally in ${(elapsedMs / 1000).toFixed(2)} s`,
            });
          })
          .catch((error: unknown) => {
            if (!isCurrent() || String(error).includes("cancelled")) return;
            store.setProgress({
              phase: "error",
              fraction: 0,
              message:
                error instanceof Error ? error.message : "Computation failed.",
            });
          });
      } else if (view === "bands") {
        void engine
          .computeBands(id, parameters)
          .then((result) => {
            if (!isCurrent()) return;
            resultCache.setBands(result);
            store.setSelectedBand(Math.min(store.selectedBand, result.bands - 1));
            store.setProgress({
              phase: "complete",
              fraction: 1,
              message: `Band grid complete in ${(result.elapsedMs / 1000).toFixed(2)} s`,
            });
          })
          .catch((error: unknown) => {
            if (!isCurrent() || String(error).includes("cancelled")) return;
            store.setProgress({
              phase: "error",
              fraction: 0,
              message:
                error instanceof Error ? error.message : "Computation failed.",
            });
          });
      } else {
        void engine
          .computeLattice(id, parameters)
          .then((result) => {
            if (!isCurrent()) return;
            resultCache.setLattice(result);
            store.setProgress({
              phase: "complete",
              fraction: 1,
              message: "Lattice geometry ready",
            });
          })
          .catch((error: unknown) => {
            if (!isCurrent() || String(error).includes("cancelled")) return;
            store.setProgress({
              phase: "error",
              fraction: 0,
              message:
                error instanceof Error ? error.message : "Computation failed.",
            });
          });
      }
    }, 180);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [parameters, runtimeReady, view]);
}

export async function cancelActiveComputation() {
  const id = useAppStore.getState().activeRequestId;
  if (!id) return;
  await engine.cancel(id);
  useAppStore.getState().setProgress({
    phase: "idle",
    fraction: 0,
    message: "Computation cancelled",
  });
}
