import { zipSync } from "fflate";
import type {
  BandResult,
  LatticeResult,
  ScientificParameters,
  ViewKind,
} from "../compute/contracts";
import type { ButterflyArrays } from "./arrays";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFilename(
  parameters: ScientificParameters,
  view: ViewKind,
  extension: string,
) {
  const flux = view === "butterfly" || view === "wannier"
    ? `q${parameters.q}`
    : `p${parameters.p}-q${parameters.q}`;
  return `hofstadter-${parameters.lattice}-${flux}-${view}.${extension}`;
}

export function exportCsv(
  parameters: ScientificParameters,
  view: ViewKind,
  butterfly?: ButterflyArrays,
  bands?: BandResult,
  lattice?: LatticeResult,
) {
  const rows: string[] = [];
  if ((view === "butterfly" || view === "wannier") && butterfly) {
    if (view === "wannier") {
      rows.push("flux,integrated_dos,gap,midgap_energy,cumulative_chern");
      for (let index = 0; index < butterfly.dos.length; index += 1) {
        rows.push(
          [
            butterfly.gapFlux[index],
            butterfly.dos[index],
            butterfly.gap[index],
            butterfly.gapEnergy[index],
            butterfly.gapChern[index],
          ].join(","),
        );
      }
    } else {
      rows.push("flux,energy,band,chern");
      for (let index = 0; index < butterfly.energy.length; index += 1) {
        rows.push(
          [
            butterfly.flux[index],
            butterfly.energy[index],
            butterfly.band[index],
            butterfly.chern[index],
          ].join(","),
        );
      }
    }
  } else if (view === "bands" && bands) {
    rows.push("band,k1_index,k2_index,energy,berry_flux,chern");
    for (let band = 0; band < bands.bands; band += 1) {
      for (let ix = 0; ix < bands.samples; ix += 1) {
        for (let iy = 0; iy < bands.samples; iy += 1) {
          const index =
            band * bands.samples * bands.samples + ix * bands.samples + iy;
          rows.push(
            [
              band,
              ix,
              iy,
              bands.energy[index],
              bands.berry[index],
              bands.chern[band],
            ].join(","),
          );
        }
      }
    }
  } else if (view === "lattice" && lattice) {
    rows.push("site,x,y,basis");
    for (let index = 0; index < lattice.sites.length / 2; index += 1) {
      rows.push(
        [
          index,
          lattice.sites[index * 2],
          lattice.sites[index * 2 + 1],
          lattice.siteBasis[index],
        ].join(","),
      );
    }
  } else {
    return;
  }
  download(
    new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }),
    exportFilename(parameters, view, "csv"),
  );
}

function npy(array: Float64Array | Int32Array) {
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

export function exportNpz(
  parameters: ScientificParameters,
  view: ViewKind,
  butterfly?: ButterflyArrays,
  bands?: BandResult,
  lattice?: LatticeResult,
) {
  const files: Record<string, Uint8Array> = {};
  if ((view === "butterfly" || view === "wannier") && butterfly) {
    Object.assign(files, {
      flux: npy(view === "wannier" ? butterfly.gapFlux : butterfly.flux),
      energy: npy(view === "wannier" ? butterfly.gapEnergy : butterfly.energy),
      band: npy(butterfly.band),
      chern: npy(view === "wannier" ? butterfly.gapChern : butterfly.chern),
      integrated_dos: npy(butterfly.dos),
      gap: npy(butterfly.gap),
    });
  } else if (view === "bands" && bands) {
    Object.assign(files, {
      energy: npy(bands.energy),
      berry_flux: npy(bands.berry),
      chern: npy(bands.chern),
      path_x: npy(bands.pathX),
      path_energy: npy(bands.pathEnergy),
    });
  } else if (view === "lattice" && lattice) {
    Object.assign(files, {
      sites: npy(lattice.sites),
      site_basis: npy(lattice.siteBasis),
      links: npy(lattice.links),
      unit_cell: npy(lattice.unitCell),
      brillouin_zone: npy(lattice.bz),
    });
  } else {
    return;
  }
  const archive = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [`${name}.npy`, bytes]),
    ),
    { level: 6 },
  );
  const archiveBytes = Uint8Array.from(archive);
  download(
    new Blob([archiveBytes.buffer], { type: "application/octet-stream" }),
    exportFilename(parameters, view, "npz"),
  );
}

function imageFromSvg(svg: SVGSVGElement) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml",
    });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to render the SVG overlay."));
    };
    image.src = url;
  });
}

export async function exportPng(
  root: HTMLElement,
  parameters: ScientificParameters,
  view: ViewKind,
) {
  const rect = root.getBoundingClientRect();
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const output = document.createElement("canvas");
  output.width = Math.round(rect.width * scale);
  output.height = Math.round(rect.height * scale);
  const context = output.getContext("2d");
  if (!context) return;
  context.scale(scale, scale);
  context.fillStyle = "#08111d";
  context.fillRect(0, 0, rect.width, rect.height);

  root.querySelectorAll("canvas").forEach((canvas) => {
    const child = canvas.getBoundingClientRect();
    context.drawImage(
      canvas,
      child.left - rect.left,
      child.top - rect.top,
      child.width,
      child.height,
    );
  });
  for (const svg of root.querySelectorAll<SVGSVGElement>("svg[data-export-layer]")) {
    const child = svg.getBoundingClientRect();
    const image = await imageFromSvg(svg);
    context.drawImage(
      image,
      child.left - rect.left,
      child.top - rect.top,
      child.width,
      child.height,
    );
  }
  output.toBlob((blob) => {
    if (blob) download(blob, exportFilename(parameters, view, "png"));
  }, "image/png");
}
