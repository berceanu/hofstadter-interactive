import { proxy, wrap, type Remote } from "comlink";
import type {
  BandResult,
  ButterflyChunk,
  ComputeEngine,
  DispersionResult,
  GeometryResult,
  LatticeResult,
  RuntimeProgress,
  ScientificParameters,
  TopologyResult,
} from "./contracts";
import type { WorkerApi } from "./compute.worker";

export interface WorkerEndpoint {
  worker: Pick<Worker, "terminate">;
  remote: Remote<WorkerApi>;
}

function createBrowserWorkerEndpoint(): WorkerEndpoint {
  const worker = new Worker(new URL("./compute.worker.ts", import.meta.url), {
    type: "module",
    name: "hofstadter-compute",
  });
  return {
    worker,
    remote: wrap<WorkerApi>(worker),
  };
}

export class PyodideWorkerEngine implements ComputeEngine {
  private worker!: Pick<Worker, "terminate">;
  private remote!: Remote<WorkerApi>;
  private ready?: Promise<void>;
  private restarting?: Promise<void>;
  private progressCallback: (progress: RuntimeProgress) => void = () => undefined;
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly endpointFactory: () => WorkerEndpoint =
      createBrowserWorkerEndpoint,
  ) {
    this.createWorker();
  }

  private createWorker() {
    const endpoint = this.endpointFactory();
    this.worker = endpoint.worker;
    this.remote = endpoint.remote;
  }

  initialize(onProgress: (progress: RuntimeProgress) => void): Promise<void> {
    this.progressCallback = onProgress;
    return this.ensureReady();
  }

  private ensureReady(): Promise<void> {
    this.ready ??= this.remote.initialize(
      import.meta.env.BASE_URL,
      proxy(this.progressCallback),
    );
    return this.ready.catch((error: unknown) => {
      // Recreate the worker so the next attempt starts from a clean module
      // (a half-initialized Pyodide cannot be loaded twice in one worker).
      this.ready = undefined;
      this.worker.terminate();
      this.createWorker();
      throw error;
    });
  }

  private isRecoverable(error: unknown) {
    // Python exceptions travel over a healthy transport; restarting the
    // worker for them doubles the compute and drops the Python-side caches.
    if (error instanceof Error && error.name === "PythonError") return false;
    const message = String(error).toLowerCase();
    return [
      "python runtime is not initialized",
      "endpoint",
      "message port",
      "worker",
      "terminated",
      "connection",
      "closed",
    ].some((fragment) => message.includes(fragment));
  }

  private restart(): Promise<void> {
    this.restarting ??= (async () => {
      this.worker.terminate();
      this.ready = undefined;
      this.createWorker();
      await this.ensureReady();
    })().finally(() => {
      this.restarting = undefined;
    });
    return this.restarting;
  }

  recover(): Promise<void> {
    return this.restart();
  }

  private async withRecovery<T>(
    operation: () => Promise<T>,
    requestId?: string,
  ): Promise<T> {
    await this.ensureReady();
    try {
      return await operation();
    } catch (error: unknown) {
      if (requestId && this.cancelled.has(requestId)) {
        throw new Error("cancelled");
      }
      if (!this.isRecoverable(error)) throw error;
      await this.restart();
      if (requestId && this.cancelled.has(requestId)) {
        throw new Error("cancelled");
      }
      return operation();
    }
  }

  async computeButterfly(
    requestId: string,
    parameters: ScientificParameters,
    onChunk: (chunk: ButterflyChunk) => void,
  ): Promise<number> {
    await this.ensureReady();
    this.cancelled.delete(requestId);
    await this.withRecovery(
      () => this.remote.clearCancellation(requestId),
      requestId,
    );
    const started = performance.now();
    const batchSize = parameters.q >= 71 ? 3 : 4;
    try {
      for (let pStart = 1; pStart < parameters.q; pStart += batchSize) {
        if (this.cancelled.has(requestId)) {
          throw new Error("cancelled");
        }
        const pEnd = Math.min(parameters.q, pStart + batchSize);
        const progress = (pEnd - 1) / (parameters.q - 1);
        const chunk = await this.withRecovery(
          () =>
            this.remote.computeButterflyBatch(
              requestId,
              parameters,
              pStart,
              pEnd,
              progress,
            ),
          requestId,
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
      try {
        await this.remote.clearCancellation(requestId);
      } catch {
        // A failed worker will be recreated by the next computation.
      }
    }
  }

  async computeBands(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<BandResult> {
    await this.ensureReady();
    this.cancelled.delete(requestId);
    await this.withRecovery(
      () => this.remote.clearCancellation(requestId),
      requestId,
    );
    try {
      const result = await this.withRecovery(
        () => this.remote.computeBands(requestId, parameters),
        requestId,
      );
      if (this.cancelled.has(requestId)) throw new Error("cancelled");
      return result;
    } finally {
      this.cancelled.delete(requestId);
      try {
        await this.remote.clearCancellation(requestId);
      } catch {
        // A failed worker will be recreated by the next computation.
      }
    }
  }

  async computeTopology(
    requestId: string,
    parameters: ScientificParameters,
    groups: [number, number][],
    samplesX: number,
    samplesY: number,
  ): Promise<TopologyResult> {
    await this.ensureReady();
    this.cancelled.delete(requestId);
    await this.withRecovery(
      () => this.remote.clearCancellation(requestId),
      requestId,
    );
    try {
      const result = await this.withRecovery(
        () =>
          this.remote.computeTopology(
            requestId,
            parameters,
            groups,
            samplesX,
            samplesY,
          ),
        requestId,
      );
      if (this.cancelled.has(requestId)) throw new Error("cancelled");
      return result;
    } finally {
      this.cancelled.delete(requestId);
      try {
        await this.remote.clearCancellation(requestId);
      } catch {
        // A failed worker will be recreated by the next computation.
      }
    }
  }

  async computeDispersion(
    requestId: string,
    parameters: ScientificParameters,
    surfaceSamples: number,
    pathSamplesPerSegment: number,
  ): Promise<DispersionResult> {
    await this.ensureReady();
    this.cancelled.delete(requestId);
    await this.withRecovery(
      () => this.remote.clearCancellation(requestId),
      requestId,
    );
    try {
      const result = await this.withRecovery(
        () =>
          this.remote.computeDispersion(
            requestId,
            parameters,
            surfaceSamples,
            pathSamplesPerSegment,
          ),
        requestId,
      );
      if (this.cancelled.has(requestId)) throw new Error("cancelled");
      return result;
    } finally {
      this.cancelled.delete(requestId);
      try {
        await this.remote.clearCancellation(requestId);
      } catch {
        // A failed worker will be recreated by the next computation.
      }
    }
  }

  async computeLattice(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<LatticeResult> {
    await this.ensureReady();
    this.cancelled.delete(requestId);
    await this.withRecovery(
      () => this.remote.clearCancellation(requestId),
      requestId,
    );
    try {
      const result = await this.withRecovery(
        () => this.remote.computeLattice(requestId, parameters),
        requestId,
      );
      if (this.cancelled.has(requestId)) throw new Error("cancelled");
      return result;
    } finally {
      this.cancelled.delete(requestId);
      try {
        await this.remote.clearCancellation(requestId);
      } catch {
        // A failed worker will be recreated by the next computation.
      }
    }
  }

  async computeGeometry(
    requestId: string,
    parameters: ScientificParameters,
  ): Promise<GeometryResult> {
    await this.ensureReady();
    this.cancelled.delete(requestId);
    await this.withRecovery(
      () => this.remote.clearCancellation(requestId),
      requestId,
    );
    try {
      const result = await this.withRecovery(
        () => this.remote.computeGeometry(requestId, parameters),
        requestId,
      );
      if (this.cancelled.has(requestId)) throw new Error("cancelled");
      return result;
    } finally {
      this.cancelled.delete(requestId);
      try {
        await this.remote.clearCancellation(requestId);
      } catch {
        // A failed worker will be recreated by the next computation.
      }
    }
  }

  async cancel(requestId: string): Promise<void> {
    this.cancelled.add(requestId);
    try {
      await this.remote.cancel(requestId);
    } catch {
      // Cancellation is already terminal locally if the worker disappeared.
    }
  }

  async abort(requestId: string): Promise<void> {
    this.cancelled.add(requestId);
    try {
      await this.restart();
    } catch {
      // A failed restart leaves a fresh, uninitialized endpoint. The next
      // computation will retry initialization and report any persistent
      // runtime failure through the normal scheduler path.
    }
  }

  dispose(): void {
    this.worker.terminate();
  }
}
