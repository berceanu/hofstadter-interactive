import { unzipSync, zipSync, type UnzipFileInfo } from "fflate";

export type NpyArray = Float64Array | Int32Array;

export interface NpzArchive {
  arrays: Map<string, NpyArray>;
  metadata?: Record<string, unknown>;
}

// Untrusted archives are expanded synchronously, so bound the amplification a
// crafted zip can request before any allocation happens.
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 256;

export function encodeNpy(array: NpyArray | Uint8Array) {
  const descriptor = array instanceof Float64Array
    ? "<f8"
    : array instanceof Int32Array
      ? "<i4"
      : "|u1";
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
  // Metadata rides along as a plain uint8 .npy payload so `np.load` users can
  // iterate every key without tripping over a non-array zip entry.
  const files: Record<string, Uint8Array> = {
    "metadata.npy": encodeNpy(
      Uint8Array.from(new TextEncoder().encode(JSON.stringify(metadata))),
    ),
  };
  for (const [name, array] of Object.entries(arrays)) {
    files[`${name}.npy`] = encodeNpy(array);
  }
  return Uint8Array.from(zipSync(files, { level: 6 }));
}

interface NpyPayload {
  descriptor: string;
  count: number;
  data: DataView;
  bytes: Uint8Array;
}

function parseNpyPayload(bytes: Uint8Array): NpyPayload {
  if (
    bytes.length < 10
    || bytes[0] !== 0x93
    || new TextDecoder().decode(bytes.subarray(1, 6)) !== "NUMPY"
  ) {
    throw new Error("The archive contains an invalid NPY array.");
  }
  const version = bytes[6];
  const prefixLength = version === 1 ? 10 : 12;
  if (bytes.length < prefixLength) {
    throw new Error("The NPY header is truncated.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = version === 1
    ? view.getUint16(8, true)
    : view.getUint32(8, true);
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
  if (descriptor === undefined || shapeText === undefined) {
    throw new Error("Unsupported NPY header.");
  }
  if (fortran === "True") {
    throw new Error("Fortran-ordered NPY arrays are not supported.");
  }
  if (descriptor.startsWith(">")) {
    throw new Error("Big-endian NPY arrays are not supported.");
  }
  const parts = shapeText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const dimensions = parts.map(Number);
  if (
    dimensions.some((value) => !Number.isInteger(value) || value < 0)
  ) {
    throw new Error("The NPY shape header is invalid.");
  }
  const count = dimensions.length
    ? dimensions.reduce((product, value) => product * value, 1)
    : 1;
  return {
    descriptor,
    count,
    data: new DataView(
      bytes.buffer,
      bytes.byteOffset + headerEnd,
      bytes.byteLength - headerEnd,
    ),
    bytes: bytes.subarray(headerEnd),
  };
}

function decodeIntegers(
  payload: NpyPayload,
  itemSize: number,
  read: (data: DataView, offset: number) => number,
) {
  const { count, data, descriptor } = payload;
  if (data.byteLength < count * itemSize) {
    throw new Error("Truncated integer array.");
  }
  const output = new Int32Array(count);
  for (let index = 0; index < count; index += 1) {
    const value = read(data, index * itemSize);
    if (value < -2147483648 || value > 2147483647) {
      throw new Error(
        `NPY dtype ${descriptor} holds a value outside the 32-bit range.`,
      );
    }
    output[index] = value;
  }
  return output;
}

function decodeNpy(bytes: Uint8Array): NpyArray {
  const payload = parseNpyPayload(bytes);
  const { descriptor, count, data } = payload;
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
  if (descriptor.endsWith("i8")) {
    if (data.byteLength < count * 8) {
      throw new Error("Truncated integer array.");
    }
    const output = new Int32Array(count);
    for (let index = 0; index < count; index += 1) {
      const value = data.getBigInt64(index * 8, true);
      if (value < -2147483648n || value > 2147483647n) {
        throw new Error(
          "NPY dtype <i8 holds a value outside the 32-bit range.",
        );
      }
      output[index] = Number(value);
    }
    return output;
  }
  if (descriptor.endsWith("i4")) {
    return decodeIntegers(payload, 4, (view, offset) =>
      view.getInt32(offset, true),
    );
  }
  if (descriptor.endsWith("u4")) {
    return decodeIntegers(payload, 4, (view, offset) =>
      view.getUint32(offset, true),
    );
  }
  if (descriptor.endsWith("i2")) {
    return decodeIntegers(payload, 2, (view, offset) =>
      view.getInt16(offset, true),
    );
  }
  if (descriptor.endsWith("u2")) {
    return decodeIntegers(payload, 2, (view, offset) =>
      view.getUint16(offset, true),
    );
  }
  if (
    descriptor.endsWith("b1")
    || descriptor.endsWith("i1")
    || descriptor.endsWith("u1")
  ) {
    return decodeIntegers(payload, 1, (view, offset) =>
      descriptor.endsWith("i1")
        ? view.getInt8(offset)
        : view.getUint8(offset),
    );
  }
  throw new Error(`Unsupported NPY dtype ${descriptor}.`);
}

function parseMetadataJson(bytes: Uint8Array) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    throw new Error("The NPZ metadata is invalid.");
  }
  throw new Error("The NPZ metadata is invalid.");
}

export function parseNpzArchive(bytes: Uint8Array): NpzArchive {
  let files: Record<string, Uint8Array>;
  let declaredBytes = 0;
  let declaredEntries = 0;
  let oversized = false;
  try {
    files = unzipSync(bytes, {
      filter: (file: UnzipFileInfo) => {
        declaredEntries += 1;
        declaredBytes += file.originalSize ?? 0;
        if (
          declaredBytes > MAX_DECOMPRESSED_BYTES
          || declaredEntries > MAX_ARCHIVE_ENTRIES
        ) {
          oversized = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new Error("Unable to open the NPZ archive.");
  }
  if (oversized) {
    throw new Error(
      "The NPZ archive is larger than the 64 MB import limit.",
    );
  }
  const arrays = new Map<string, NpyArray>();
  let metadata: Record<string, unknown> | undefined;
  for (const [name, contents] of Object.entries(files)) {
    if (name === "metadata.json") {
      metadata = parseMetadataJson(contents);
    } else if (name === "metadata.npy") {
      const payload = parseNpyPayload(contents);
      metadata = parseMetadataJson(payload.bytes.subarray(0, payload.count));
    } else if (name.endsWith(".npy")) {
      const key = name.slice(0, -4).split("/").at(-1);
      if (!key) continue;
      if (arrays.has(key)) {
        throw new Error(
          `The NPZ archive holds more than one array named ${key}.`,
        );
      }
      arrays.set(key, decodeNpy(contents));
    }
  }
  if (!arrays.size) throw new Error("The NPZ archive contains no arrays.");
  return { arrays, metadata };
}
