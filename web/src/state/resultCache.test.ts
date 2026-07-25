import { describe, expect, it } from "vitest";
import type {
  BandResult,
  ButterflyChunk,
  DispersionResult,
  LatticeResult,
  TopologyResult,
} from "../compute/contracts";
import { ResultCache } from "./resultCache";

function butterflyChunk(requestId: string, flux: number): ButterflyChunk {
  return {
    requestId,
    topologyAvailable: true,
    flux: new Float64Array([flux]),
    energy: new Float64Array([0]),
    band: new Int32Array([0]),
    chern: new Int32Array([1]),
    dos: new Float64Array(),
    gap: new Float64Array(),
    gapChern: new Int32Array(),
    gapFlux: new Float64Array(),
    gapEnergy: new Float64Array(),
    progress: 0.5,
  };
}

describe("ResultCache stale-result behavior", () => {
  it("keeps the previous butterfly until the replacement streams its first chunk", () => {
    const cache = new ResultCache();
    cache.expectButterfly("old-key");
    cache.beginButterfly("old", "old-key");
    cache.appendButterfly(butterflyChunk("old", 1 / 5));
    cache.completeButterfly("old", 12);

    cache.expectButterfly("new-key");
    cache.beginButterfly("new", "new-key");
    expect(cache.getSnapshot().butterfly?.requestId).toBe("old");
    expect(cache.getSnapshot().butterfly?.complete).toBe(true);
    expect(cache.getSnapshot().butterflyStale).toBe(true);

    cache.appendButterfly(butterflyChunk("new", 1 / 7));
    expect(cache.getSnapshot().butterfly?.requestId).toBe("new");
    expect(cache.getSnapshot().butterfly?.complete).toBe(false);
    expect(cache.getSnapshot().butterfly?.chunks).toHaveLength(1);
    expect(cache.getSnapshot().butterflyStale).toBe(false);
  });

  it("does not erase completed band or lattice results while recomputing", () => {
    const cache = new ResultCache();
    cache.expectBands("bands-old-key");
    cache.setBands({ requestId: "bands-old" } as BandResult, "bands-old-key");
    cache.expectLattice("lattice-old-key");
    cache.setLattice(
      { requestId: "lattice-old" } as LatticeResult,
      "lattice-old-key",
    );

    cache.expectBands("bands-new-key");
    cache.expectLattice("lattice-new-key");
    cache.beginBands("bands-new-key");
    cache.beginLattice("lattice-new-key");

    expect(cache.getSnapshot().bands?.requestId).toBe("bands-old");
    expect(cache.getSnapshot().lattice?.requestId).toBe("lattice-old");
    expect(cache.getSnapshot().bandsStale).toBe(true);
    expect(cache.getSnapshot().latticeStale).toBe(true);
  });

  it("restores a keyed result without recomputing it", () => {
    const cache = new ResultCache();
    cache.expectBands("a");
    cache.setBands({ requestId: "bands-a" } as BandResult, "a");
    cache.expectBands("b");
    cache.setBands({ requestId: "bands-b" } as BandResult, "b");

    expect(cache.expectBands("a")).toBe(true);
    expect(cache.getSnapshot().bands?.requestId).toBe("bands-a");
    expect(cache.getSnapshot().bandsStale).toBe(false);
  });

  it("keeps refined topology keyed separately from the render band grid", () => {
    const cache = new ResultCache();
    cache.expectTopology("topology-a");
    cache.setTopology(
      { requestId: "topology-result-a" } as TopologyResult,
      "topology-a",
    );

    cache.expectTopology("topology-b");
    cache.beginTopology("topology-b");
    expect(cache.getSnapshot().topology?.requestId).toBe(
      "topology-result-a",
    );
    expect(cache.getSnapshot().topologyStale).toBe(true);

    expect(cache.expectTopology("topology-a")).toBe(true);
    expect(cache.getSnapshot().topologyStale).toBe(false);
  });

  it("drops the working entry of an abandoned butterfly sweep", () => {
    const cache = new ResultCache();
    cache.expectButterfly("sweep-key");
    cache.beginButterfly("sweep", "sweep-key");
    cache.appendButterfly(butterflyChunk("sweep", 1 / 3));

    cache.abandonButterfly("sweep");
    cache.appendButterfly(butterflyChunk("sweep", 2 / 3));
    expect(cache.getSnapshot().butterfly?.chunks).toHaveLength(1);

    cache.completeButterfly("sweep", 5);
    expect(cache.getSnapshot().butterfly?.complete).toBe(false);
  });

  it("evicts the least recently used entry, refreshing recency on reads", () => {
    const cache = new ResultCache();
    for (let index = 0; index < 6; index += 1) {
      cache.expectBands(`key-${index}`);
      cache.setBands(
        { requestId: `bands-${index}` } as BandResult,
        `key-${index}`,
      );
    }
    // Reads refresh recency, so key-0 must survive the next insertion.
    expect(cache.hasBands("key-0")).toBe(true);
    cache.expectBands("key-6");
    cache.setBands({ requestId: "bands-6" } as BandResult, "key-6");

    expect(cache.hasBands("key-0")).toBe(true);
    expect(cache.hasBands("key-1")).toBe(false);
  });

  it("keeps a stale dispersion visible until its keyed replacement arrives", () => {
    const cache = new ResultCache();
    cache.expectDispersion("dispersion-a");
    cache.setDispersion(
      { requestId: "dispersion-result-a" } as DispersionResult,
      "dispersion-a",
    );

    cache.expectDispersion("dispersion-b");
    cache.beginDispersion("dispersion-b");
    expect(cache.getSnapshot().dispersion?.requestId).toBe(
      "dispersion-result-a",
    );
    expect(cache.getSnapshot().dispersionStale).toBe(true);

    cache.setDispersion(
      { requestId: "dispersion-result-b" } as DispersionResult,
      "dispersion-b",
    );
    expect(cache.getSnapshot().dispersion?.requestId).toBe(
      "dispersion-result-b",
    );
    expect(cache.getSnapshot().dispersionStale).toBe(false);
  });

  it("clears a stale geometry expectation when geometry is no longer requested", () => {
    const cache = new ResultCache();
    cache.expectGeometry("geometry-a");
    cache.setGeometry(
      { requestId: "geometry-result-a" } as never,
      "geometry-a",
    );
    cache.expectGeometry("geometry-b");
    expect(cache.getSnapshot().geometryStale).toBe(true);

    cache.clearGeometryExpectation();
    expect(cache.getSnapshot().geometryStale).toBe(false);
    expect(cache.isExpected("geometry", "geometry-b")).toBe(false);
  });
});
