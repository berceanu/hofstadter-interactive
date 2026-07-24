import type { Remote } from "comlink";
import { describe, expect, it, vi } from "vitest";
import type { LatticeResult, ScientificParameters } from "./contracts";
import type { WorkerApi } from "./compute.worker";
import {
  PyodideWorkerEngine,
  type WorkerEndpoint,
} from "./workerEngine";

const parameters: ScientificParameters = {
  lattice: "square",
  p: 1,
  q: 5,
  a: 1,
  hoppings: [1],
  alpha: 1,
  theta: [1, 2],
  period: 1,
  samples: 7,
  bgt: 0.01,
  customBasis: [
    [0, 0],
    [0.5, 0],
    [0, 0.5],
  ],
};

function latticeResult(requestId: string): LatticeResult {
  return {
    requestId,
    sites: new Float64Array(),
    siteBasis: new Int32Array(),
    links: new Float64Array(),
    unitCell: new Float64Array(),
    magneticCell: new Float64Array(),
    latticeVectors: new Float64Array(),
    reciprocalVectors: new Float64Array(),
    ordinaryReciprocalVectors: new Float64Array(),
    bz: new Float64Array(),
    ordinaryBz: new Float64Array(),
    symPoints: [],
    basisCount: 1,
  };
}

function endpoint(remote: Partial<WorkerApi>) {
  return {
    worker: { terminate: vi.fn() },
    remote: remote as Remote<WorkerApi>,
  } satisfies WorkerEndpoint;
}

describe("PyodideWorkerEngine recovery", () => {
  it("recreates, reinitializes, and retries once after a lost Python runtime", async () => {
    const first = endpoint({
      initialize: vi.fn().mockResolvedValue(undefined),
      clearCancellation: vi.fn().mockResolvedValue(undefined),
      computeLattice: vi
        .fn()
        .mockRejectedValue(new Error("The Python runtime is not initialized.")),
    });
    const recoveredResult = latticeResult("lattice-1");
    const second = endpoint({
      initialize: vi.fn().mockResolvedValue(undefined),
      clearCancellation: vi.fn().mockResolvedValue(undefined),
      computeLattice: vi.fn().mockResolvedValue(recoveredResult),
    });
    const endpoints = [first, second];
    const engine = new PyodideWorkerEngine(() => {
      const next = endpoints.shift();
      if (!next) throw new Error("Unexpected extra worker restart");
      return next;
    });

    await engine.initialize(() => undefined);
    await expect(
      engine.computeLattice("lattice-1", parameters),
    ).resolves.toBe(recoveredResult);

    expect(first.worker.terminate).toHaveBeenCalledOnce();
    expect(second.remote.initialize).toHaveBeenCalledOnce();
    expect(second.remote.computeLattice).toHaveBeenCalledOnce();
  });
});
