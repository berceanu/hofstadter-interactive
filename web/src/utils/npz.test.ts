import { zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { resultCache } from "../state/resultCache";
import { defaultParameters, useAppStore } from "../state/store";
import { createNpzArchive, encodeNpy, parseNpzArchive } from "./npz";
import { restoreNpzBytes } from "./npzImport";

function npyWithHeader(header: string, payload: Uint8Array) {
  const dictionary = new TextEncoder().encode(`${header}\n`);
  const output = new Uint8Array(10 + dictionary.length + payload.length);
  output.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00], 0);
  output[8] = dictionary.length & 0xff;
  output[9] = (dictionary.length >> 8) & 0xff;
  output.set(dictionary, 10);
  output.set(payload, 10 + dictionary.length);
  return output;
}

describe("NPZ spectrum archives", () => {
  beforeEach(() => {
    useAppStore.setState({
      parameters: { ...defaultParameters },
      view: "butterfly",
      focus: "workspace",
      workspaceWide: false,
    });
  });

  it("round-trips typed NPY arrays and JSON metadata", () => {
    const archive = createNpzArchive(
      {
        values: new Float64Array([1.25, -2.5]),
        labels: new Int32Array([3, -7]),
      },
      { schema: "hofstadter-interactive/1", view: "butterfly" },
    );
    const parsed = parseNpzArchive(archive);
    expect(Array.from(parsed.arrays.get("values")!)).toEqual([1.25, -2.5]);
    expect(Array.from(parsed.arrays.get("labels")!)).toEqual([3, -7]);
    expect(parsed.metadata).toMatchObject({
      schema: "hofstadter-interactive/1",
      view: "butterfly",
    });
  });

  it("reads numpy's native int64 and bool dtypes", () => {
    const int64Payload = new Uint8Array(16);
    new DataView(int64Payload.buffer).setBigInt64(0, -5n, true);
    new DataView(int64Payload.buffer).setBigInt64(8, 7n, true);
    const archive = zipSync({
      "chern.npy": npyWithHeader(
        "{'descr': '<i8', 'fortran_order': False, 'shape': (2,), }",
        int64Payload,
      ),
      "flags.npy": npyWithHeader(
        "{'descr': '|b1', 'fortran_order': False, 'shape': (2,), }",
        new Uint8Array([1, 0]),
      ),
    });
    const parsed = parseNpzArchive(archive);
    expect(Array.from(parsed.arrays.get("chern")!)).toEqual([-5, 7]);
    expect(Array.from(parsed.arrays.get("flags")!)).toEqual([1, 0]);
  });

  it("rejects an int64 value outside the 32-bit range", () => {
    const payload = new Uint8Array(8);
    new DataView(payload.buffer).setBigInt64(0, 2n ** 40n, true);
    const archive = zipSync({
      "big.npy": npyWithHeader(
        "{'descr': '<i8', 'fortran_order': False, 'shape': (1,), }",
        payload,
      ),
    });
    expect(() => parseNpzArchive(archive)).toThrow(/32-bit range/);
  });

  it("rejects an invalid shape header instead of silently flattening it", () => {
    const archive = zipSync({
      "bad.npy": npyWithHeader(
        "{'descr': '<f8', 'fortran_order': False, 'shape': (2, x, 3), }",
        new Uint8Array(48),
      ),
    });
    expect(() => parseNpzArchive(archive)).toThrow(/shape header is invalid/);
  });

  it("rejects duplicate array basenames instead of last-wins", () => {
    const entry = encodeNpy(new Float64Array([1]));
    const archive = zipSync({
      "energy.npy": entry,
      "nested/energy.npy": entry,
    });
    expect(() => parseNpzArchive(archive)).toThrow(/more than one array/);
  });

  it("reports a truncated version-2 header as a domain error", () => {
    const truncated = new Uint8Array([
      0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x02, 0x00, 0xff, 0xff,
    ]);
    const archive = zipSync({ "broken.npy": truncated });
    expect(() => parseNpzArchive(archive)).toThrow(/truncated/);
  });

  it("refuses archives that decompress beyond the import limit", () => {
    const bomb = zipSync(
      { "huge.npy": new Uint8Array(65 * 1024 * 1024) },
      { level: 1 },
    );
    expect(() => parseNpzArchive(bomb)).toThrow(/64 MB import limit/);
    const flood: Record<string, Uint8Array> = {};
    for (let index = 0; index < 300; index += 1) {
      flood[`entry-${index}.npy`] = encodeNpy(new Int32Array([index]));
    }
    expect(() => parseNpzArchive(zipSync(flood))).toThrow(
      /64 MB import limit/,
    );
  });

  it("rejects a mismatched per-state array instead of fabricating C = 0", () => {
    const archive = createNpzArchive(
      {
        state_flux: new Float64Array([1 / 3, 1 / 3, 2 / 3]),
        state_energy: new Float64Array([-1, 0, 1]),
        state_chern: new Int32Array([5, -5]),
      },
      { schema: "hofstadter-interactive/1", view: "butterfly" },
    );
    expect(() => restoreNpzBytes(archive, "spectrum.npz")).toThrow(
      /state_chern/,
    );
  });

  it("rejects metadata whose denominator contradicts the flux data", () => {
    const archive = createNpzArchive(
      {
        state_flux: new Float64Array([1 / 7, 2 / 7]),
        state_energy: new Float64Array([-1, 1]),
      },
      {
        schema: "hofstadter-interactive/1",
        view: "butterfly",
        parameters: { ...defaultParameters, q: 14 },
      },
    );
    expect(() => restoreNpzBytes(archive, "spectrum.npz")).toThrow(
      /declared denominator/,
    );
  });

  it("prefers the data's denominator over a renamed file's hint", () => {
    const archive = createNpzArchive(
      {
        state_flux: new Float64Array([1 / 7, 2 / 7]),
        state_energy: new Float64Array([-1, 1]),
      },
      { schema: "hofstadter-interactive/1", view: "butterfly" },
    );
    const summary = restoreNpzBytes(archive, "renamed-square-q14-butterfly.npz");
    expect(summary.parameters.q).toBe(7);
  });

  it("restores parameters and a cached sweep without recomputing it", () => {
    const parameters = {
      ...defaultParameters,
      lattice: "custom" as const,
      p: 1,
      q: 3,
      customBasis: [
        [0, 0],
        [0.5, 0.25],
      ] as [number, number][],
    };
    const archive = createNpzArchive(
      {
        state_flux: new Float64Array([1 / 3, 1 / 3, 1 / 3]),
        state_energy: new Float64Array([-2, 0, 2]),
        state_band: new Int32Array([0, 1, 2]),
        state_chern: new Int32Array([1, -2, 1]),
        gap_flux: new Float64Array([1 / 3, 1 / 3]),
        gap_energy: new Float64Array([-1, 1]),
        gap: new Float64Array([2, 2]),
        gap_chern: new Int32Array([1, -1]),
        integrated_dos: new Float64Array([1 / 3, 2 / 3]),
        topology_available: new Int32Array([0]),
      },
      {
        schema: "hofstadter-interactive/1",
        view: "butterfly",
        parameters,
      },
    );

    const summary = restoreNpzBytes(
      archive,
      "hofstadter-custom-q3-butterfly.npz",
    );
    expect(summary).toMatchObject({ states: 3, gaps: 2 });
    expect(useAppStore.getState().parameters).toMatchObject({
      lattice: "custom",
      p: 1,
      q: 3,
      customBasis: [
        [0, 0],
        [0.5, 0.25],
      ],
    });
    expect(resultCache.getSnapshot().butterfly).toMatchObject({
      complete: true,
      chunks: [{ topologyAvailable: false }],
    });
  });
});
