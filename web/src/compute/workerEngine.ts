import { proxy, wrap, type Remote } from "comlink";
import type {
  BandResult,
  ButterflyChunk,
  ComputeEngine,
  LatticeResult,
  RuntimeProgress,
  ScientificParameters,
} from "./contracts";
import type { WorkerApi } from "./compute.worker";

export class PyodideWorkerEngine implements ComputeEngine {
  private readonly worker: Worker;
  private readonly remote: Remote<WorkerApi>;
  private ready?: Promise<void>;
  private readonly cancelled = new Set<string>();

  constructor() {
    this.worker = new Worker(new URL("./compute.worker.ts", import.meta.url), {
      type: "module",
      name: "hofstadter-compute",
    });
    this.remote = wrap<WorkerApi>(this.worker);
  }

  initialize(onProgress: (progress: RuntimeProgress) => void): Promise<void> {
    this.ready ??= this.remote.initialize(
      import.meta.env.BASE_URL,
      proxy(onProgress),
    );
    return this.ready;
  }

  async computeButterfly(
    requestId: string,
    parameters: ScientificParameters,
    onChunk: (chunk: ButterflyChunk) => void,
  ): Promise<number> {
    await this.ready;
    this.cancelled.delete(requestId);
    await this.remote.clearCancellation(requestId);
    const started = performance.now();
    const batchSize = parameters.q >= 71 ? 3 : 4;
    try {
      for (let pStart = 1; pStart < parameters.q; pStart += batchSize) {
        if (this.cancelled.has(requestId)) {
          throw new Error("cancelled");
        }
        const pEnd = Math.min(parameters.q, pStart + batchSize);
        const progress = (pEnd - 1) / (parameters.q - 1);
        const chunk = await this.remote.computeButterflyBatch(
          requestId,
          parameters,
          pStart,
          pEnd,
          progress,
        );
        if (this.cancelled.has(requestId)) {
          throw new Error("cancelled");
        }
        onChunk(chunk);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      return performance.now() - started;
    } finally {
      this.cancelled.delete(requestId);
      await this.remote.clearCancellation(requestId);
    }
  }

  async computeBands(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<BandResult> {
    await this.ready;
    this.cancelled.delete(requestId);
    await this.remote.clearCancellation(requestId);
    try {
      const result = await this.remote.computeBands(requestId, parameters);
      if (this.cancelled.has(requestId)) throw new Error("cancelled");
      return result;
    } finally {
      this.cancelled.delete(requestId);
      await this.remote.clearCancellation(requestId);
    }
  }

  async computeLattice(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<LatticeResult> {
    await this.ready;
    this.cancelled.delete(requestId);
    await this.remote.clearCancellation(requestId);
    try {
      const result = await this.remote.computeLattice(requestId, parameters);
      if (this.cancelled.has(requestId)) throw new Error("cancelled");
      return result;
    } finally {
      this.cancelled.delete(requestId);
      await this.remote.clearCancellation(requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    this.cancelled.add(requestId);
    await this.remote.cancel(requestId);
  }

  dispose(): void {
    this.worker.terminate();
  }
}
