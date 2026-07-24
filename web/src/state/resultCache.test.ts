import { describe, expect, it } from "vitest";
import type {
  BandResult,
  ButterflyChunk,
  LatticeResult,
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
});
