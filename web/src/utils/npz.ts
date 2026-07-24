import { unzipSync, zipSync } from "fflate";

export type NpyArray = Float64Array | Int32Array;

export interface NpzArchive {
  arrays: Map<string, NpyArray>;
  metadata?: Record<string, unknown>;
}

export function encodeNpy(array: NpyArray) {
  const descriptor = array instanceof Float64Array ? "<f8" : "<i4";
  const shape = `(${array.length},)`;
  const dictionary = `{'descr': '${descriptor}', 'fortran_order': False, 'shape': ${shape}, }`;
  const prefixLength = 10;
  const padding = (16 - ((prefixLength + dictionary.length + 1) % 16)) % 16;
  const header = new TextEncoder().encode(
    `${dictionary}${" ".repeat(padding)}\n`,
  );
  const output = new Uint8Array(prefixLength + header.length + array.byteLength);
  output.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00], 0);
  output[8] = header.length & 0xff;
  output[9] = (header.length >> 8) & 0xff;
  output.set(header, prefixLength);
  output.set(
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
    prefixLength + header.length,
  );
  return output;
}

export function createNpzArchive(
  arrays: Record<string, NpyArray>,
  metadata: Record<string, unknown>,
) {
  const files: Record<string, Uint8Array> = {
    "metadata.json": Uint8Array.from(
      new TextEncoder().encode(JSON.stringify(metadata)),
    ),
  };
  for (const [name, array] of Object.entries(arrays)) {
    files[`${name}.npy`] = encodeNpy(array);
  }
  return Uint8Array.from(zipSync(files, { level: 6 }));
}

function decodeNpy(bytes: Uint8Array): NpyArray {
  if (
    bytes.length < 10
    || bytes[0] !== 0x93
    || new TextDecoder().decode(bytes.subarray(1, 6)) !== "NUMPY"
  ) {
    throw new Error("The archive contains an invalid NPY array.");
  }
  const version = bytes[6];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = version === 1
    ? view.getUint16(8, true)
    : view.getUint32(8, true);
  const prefixLength = version === 1 ? 10 : 12;
  const headerEnd = prefixLength + headerLength;
  if (headerEnd > bytes.length) {
    throw new Error("The NPY header is truncated.");
  }
  const header = new TextDecoder().decode(
    bytes.subarray(prefixLength, headerEnd),
  );
  const descriptor = header.match(/['"]descr['"]\s*:\s*['"]([^'"]+)['"]/)?.[1];
  const fortran = header.match(/['"]fortran_order['"]\s*:\s*(True|False)/)?.[1];
  const shapeText = header.match(/['"]shape['"]\s*:\s*\(([^)]*)\)/)?.[1];
  if (!descriptor || !shapeText || fortran === "True") {
    throw new Error("Unsupported NPY header.");
  }
  if (descriptor.startsWith(">")) {
    throw new Error("Big-endian NPY arrays are not supported.");
  }
  const dimensions = shapeText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0);
  const count = dimensions.length
    ? dimensions.reduce((product, value) => product * value, 1)
    : 1;
  const data = new DataView(
    bytes.buffer,
    bytes.byteOffset + headerEnd,
    bytes.byteLength - headerEnd,
  );
  if (descriptor.endsWith("f8")) {
    if (data.byteLength < count * 8) throw new Error("Truncated float array.");
    const output = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      output[index] = data.getFloat64(index * 8, true);
    }
    return output;
  }
  if (descriptor.endsWith("f4")) {
    if (data.byteLength < count * 4) throw new Error("Truncated float array.");
    const output = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      output[index] = data.getFloat32(index * 4, true);
    }
    return output;
  }
  if (descriptor.endsWith("i4")) {
    if (data.byteLength < count * 4) throw new Error("Truncated integer array.");
    const output = new Int32Array(count);
    for (let index = 0; index < count; index += 1) {
      output[index] = data.getInt32(index * 4, true);
    }
    return output;
  }
  throw new Error(`Unsupported NPY dtype ${descriptor}.`);
}

export function parseNpzArchive(bytes: Uint8Array): NpzArchive {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Unable to open the NPZ archive.");
  }
  const arrays = new Map<string, NpyArray>();
  let metadata: Record<string, unknown> | undefined;
  for (const [name, contents] of Object.entries(files)) {
    if (name === "metadata.json") {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(contents));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        throw new Error("The NPZ metadata is invalid.");
      }
    } else if (name.endsWith(".npy")) {
      const key = name.slice(0, -4).split("/").at(-1);
      if (key) arrays.set(key, decodeNpy(contents));
    }
  }
  if (!arrays.size) throw new Error("The NPZ archive contains no arrays.");
  return { arrays, metadata };
}
