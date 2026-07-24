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

export class ResultCache {
  private snapshot: CacheSnapshot = { revision: 0 };
  private pendingButterflyRequestId?: string;
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
    this.pendingButterflyRequestId = requestId;
  }

  appendButterfly(chunk: ButterflyChunk) {
    const current = this.snapshot.butterfly;
    if (this.pendingButterflyRequestId === chunk.requestId) {
      this.pendingButterflyRequestId = undefined;
      this.publish({
        ...this.snapshot,
        butterfly: {
          requestId: chunk.requestId,
          chunks: [chunk],
          complete: false,
          elapsedMs: 0,
        },
      });
      return;
    }
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

  beginBands() {
    // Keep the last valid result visible until its replacement succeeds.
  }

  setBands(result: BandResult) {
    this.publish({ ...this.snapshot, bands: result });
  }

  beginLattice() {
    // Keep the last valid result visible until its replacement succeeds.
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
