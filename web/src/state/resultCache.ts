import { useSyncExternalStore } from "react";
import type {
  BandResult,
  ButterflyChunk,
  ButterflyResult,
  GeometryResult,
  LatticeResult,
  TopologyResult,
} from "../compute/contracts";

interface CacheSnapshot {
  revision: number;
  butterfly?: ButterflyResult;
  butterflyKey?: string;
  butterflyStale: boolean;
  bands?: BandResult;
  bandsKey?: string;
  bandsStale: boolean;
  lattice?: LatticeResult;
  latticeKey?: string;
  latticeStale: boolean;
  geometry?: GeometryResult;
  geometryKey?: string;
  geometryStale: boolean;
  topology?: TopologyResult;
  topologyKey?: string;
  topologyStale: boolean;
}

export class ResultCache {
  private snapshot: CacheSnapshot = {
    revision: 0,
    butterflyStale: false,
    bandsStale: false,
    latticeStale: false,
    geometryStale: false,
    topologyStale: false,
  };
  private expectedButterflyKey?: string;
  private expectedBandsKey?: string;
  private expectedLatticeKey?: string;
  private expectedGeometryKey?: string;
  private expectedTopologyKey?: string;
  private readonly butterflyResults = new Map<string, ButterflyResult>();
  private readonly bandResults = new Map<string, BandResult>();
  private readonly latticeResults = new Map<string, LatticeResult>();
  private readonly geometryResults = new Map<string, GeometryResult>();
  private readonly topologyResults = new Map<string, TopologyResult>();
  private readonly butterflyWorking = new Map<
    string,
    { key: string; result: ButterflyResult }
  >();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private publish(next: Partial<Omit<CacheSnapshot, "revision">>) {
    this.snapshot = {
      ...this.snapshot,
      ...next,
      revision: this.snapshot.revision + 1,
    };
    this.listeners.forEach((listener) => listener());
  }

  private remember<T>(cache: Map<string, T>, key: string, value: T) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > 6) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  expectButterfly(key: string) {
    this.expectedButterflyKey = key;
    const cached = this.butterflyResults.get(key);
    this.publish({
      ...(cached ? { butterfly: cached, butterflyKey: key } : {}),
      butterflyStale: !cached && Boolean(this.snapshot.butterfly),
    });
    return Boolean(cached);
  }

  expectBands(key: string) {
    this.expectedBandsKey = key;
    const cached = this.bandResults.get(key);
    this.publish({
      ...(cached ? { bands: cached, bandsKey: key } : {}),
      bandsStale: !cached && Boolean(this.snapshot.bands),
    });
    return Boolean(cached);
  }

  expectLattice(key: string) {
    this.expectedLatticeKey = key;
    const cached = this.latticeResults.get(key);
    this.publish({
      ...(cached ? { lattice: cached, latticeKey: key } : {}),
      latticeStale: !cached && Boolean(this.snapshot.lattice),
    });
    return Boolean(cached);
  }

  expectGeometry(key: string) {
    this.expectedGeometryKey = key;
    const cached = this.geometryResults.get(key);
    this.publish({
      ...(cached ? { geometry: cached, geometryKey: key } : {}),
      geometryStale: !cached && Boolean(this.snapshot.geometry),
    });
    return Boolean(cached);
  }

  expectTopology(key: string) {
    this.expectedTopologyKey = key;
    const cached = this.topologyResults.get(key);
    this.publish({
      ...(cached ? { topology: cached, topologyKey: key } : {}),
      topologyStale: !cached && Boolean(this.snapshot.topology),
    });
    return Boolean(cached);
  }

  hasButterfly(key: string) {
    return this.butterflyResults.has(key);
  }

  hasBands(key: string) {
    return this.bandResults.has(key);
  }

  hasLattice(key: string) {
    return this.latticeResults.has(key);
  }

  hasGeometry(key: string) {
    return this.geometryResults.has(key);
  }

  hasTopology(key: string) {
    return this.topologyResults.has(key);
  }

  isExpected(
    kind: "butterfly" | "bands" | "lattice" | "geometry" | "topology",
    key: string,
  ) {
    if (kind === "butterfly") return this.expectedButterflyKey === key;
    if (kind === "bands") return this.expectedBandsKey === key;
    if (kind === "lattice") return this.expectedLatticeKey === key;
    if (kind === "geometry") return this.expectedGeometryKey === key;
    return this.expectedTopologyKey === key;
  }

  beginButterfly(requestId: string, key = requestId) {
    this.expectedButterflyKey ??= key;
    this.butterflyWorking.set(requestId, {
      key,
      result: {
        requestId,
        chunks: [],
        complete: false,
        elapsedMs: 0,
      },
    });
  }

  appendButterfly(chunk: ButterflyChunk) {
    const working = this.butterflyWorking.get(chunk.requestId);
    if (!working) return;
    working.result = {
      ...working.result,
      chunks: [...working.result.chunks, chunk],
    };
    this.butterflyWorking.set(chunk.requestId, working);
    if (this.expectedButterflyKey !== working.key) return;
    this.publish({
      butterfly: working.result,
      butterflyKey: working.key,
      butterflyStale: false,
    });
  }

  completeButterfly(requestId: string, elapsedMs: number) {
    const working = this.butterflyWorking.get(requestId);
    if (!working) return;
    const result = { ...working.result, complete: true, elapsedMs };
    this.butterflyWorking.delete(requestId);
    this.remember(this.butterflyResults, working.key, result);
    if (this.expectedButterflyKey !== working.key) return;
    this.publish({
      butterfly: result,
      butterflyKey: working.key,
      butterflyStale: false,
    });
  }

  restoreButterfly(result: ButterflyResult, key: string) {
    this.expectedButterflyKey = key;
    this.remember(this.butterflyResults, key, result);
    this.publish({
      butterfly: result,
      butterflyKey: key,
      butterflyStale: false,
    });
  }

  beginBands(key: string) {
    this.expectedBandsKey ??= key;
  }

  setBands(result: BandResult, key = result.requestId) {
    this.remember(this.bandResults, key, result);
    if (this.expectedBandsKey !== key) return;
    this.publish({
      bands: result,
      bandsKey: key,
      bandsStale: false,
    });
  }

  beginLattice(key: string) {
    this.expectedLatticeKey ??= key;
  }

  setLattice(result: LatticeResult, key = result.requestId) {
    this.remember(this.latticeResults, key, result);
    if (this.expectedLatticeKey !== key) return;
    this.publish({
      lattice: result,
      latticeKey: key,
      latticeStale: false,
    });
  }

  beginGeometry(key: string) {
    this.expectedGeometryKey ??= key;
  }

  setGeometry(result: GeometryResult, key = result.requestId) {
    this.remember(this.geometryResults, key, result);
    if (this.expectedGeometryKey !== key) return;
    this.publish({
      geometry: result,
      geometryKey: key,
      geometryStale: false,
    });
  }

  beginTopology(key: string) {
    this.expectedTopologyKey ??= key;
  }

  setTopology(result: TopologyResult, key = result.requestId) {
    this.remember(this.topologyResults, key, result);
    if (this.expectedTopologyKey !== key) return;
    this.publish({
      topology: result,
      topologyKey: key,
      topologyStale: false,
    });
  }

  fail(
    kind: "butterfly" | "bands" | "lattice" | "geometry" | "topology",
    key: string,
  ) {
    if (!this.isExpected(kind, key)) return;
    if (kind === "butterfly") {
      this.publish({ butterflyStale: Boolean(this.snapshot.butterfly) });
    } else if (kind === "bands") {
      this.publish({ bandsStale: Boolean(this.snapshot.bands) });
    } else if (kind === "lattice") {
      this.publish({ latticeStale: Boolean(this.snapshot.lattice) });
    } else if (kind === "geometry") {
      this.publish({ geometryStale: Boolean(this.snapshot.geometry) });
    } else {
      this.publish({ topologyStale: Boolean(this.snapshot.topology) });
    }
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
