import { useSyncExternalStore } from "react";
import type {
  BandResult,
  ButterflyChunk,
  ButterflyResult,
  LatticeResult,
} from "../compute/contracts";

interface CacheSnapshot {
  revision: number;
  butterfly?: ButterflyResult;
  bands?: BandResult;
  lattice?: LatticeResult;
}

class ResultCache {
  private snapshot: CacheSnapshot = { revision: 0 };
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private publish(next: Omit<CacheSnapshot, "revision">) {
    this.snapshot = { ...next, revision: this.snapshot.revision + 1 };
    this.listeners.forEach((listener) => listener());
  }

  beginButterfly(requestId: string) {
    this.publish({
      ...this.snapshot,
      butterfly: { requestId, chunks: [], complete: false, elapsedMs: 0 },
    });
  }

  appendButterfly(chunk: ButterflyChunk) {
    const current = this.snapshot.butterfly;
    if (!current || current.requestId !== chunk.requestId) return;
    this.publish({
      ...this.snapshot,
      butterfly: { ...current, chunks: [...current.chunks, chunk] },
    });
  }

  completeButterfly(requestId: string, elapsedMs: number) {
    const current = this.snapshot.butterfly;
    if (!current || current.requestId !== requestId) return;
    this.publish({
      ...this.snapshot,
      butterfly: { ...current, complete: true, elapsedMs },
    });
  }

  setBands(result: BandResult) {
    this.publish({ ...this.snapshot, bands: result });
  }

  setLattice(result: LatticeResult) {
    this.publish({ ...this.snapshot, lattice: result });
  }
}

export const resultCache = new ResultCache();

export function useResultCache() {
  return useSyncExternalStore(
    resultCache.subscribe,
    resultCache.getSnapshot,
    resultCache.getSnapshot,
  );
}
