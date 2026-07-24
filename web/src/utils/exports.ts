import type {
  BandResult,
  ButterflyColorMode,
  GeometryResult,
  LatticeResult,
  ScientificParameters,
  TopologyResult,
  ViewKind,
} from "../compute/contracts";
import type { ButterflyArrays } from "./arrays";
import { createNpzArchive, type NpyArray } from "./npz";

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
  view: ViewKind | "workspace",
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
  geometry?: GeometryResult,
  topology?: TopologyResult,
) {
  const rows: string[] = [];
  if ((view === "butterfly" || view === "wannier") && butterfly) {
    if (view === "wannier") {
      rows.push(
        "flux,integrated_dos,gap,midgap_energy,cumulative_chern,topology_available",
      );
      for (let index = 0; index < butterfly.dos.length; index += 1) {
        rows.push(
          [
            butterfly.gapFlux[index],
            butterfly.dos[index],
            butterfly.gap[index],
            butterfly.gapEnergy[index],
            butterfly.topologyAvailable ? butterfly.gapChern[index] : "",
            butterfly.topologyAvailable,
          ].join(","),
        );
      }
    } else {
      rows.push("flux,energy,band,chern,topology_available");
      for (let index = 0; index < butterfly.energy.length; index += 1) {
        rows.push(
          [
            butterfly.flux[index],
            butterfly.energy[index],
            butterfly.band[index],
            butterfly.topologyAvailable ? butterfly.chern[index] : "",
            butterfly.topologyAvailable,
          ].join(","),
        );
      }
    }
  } else if (view === "bands" && bands) {
    rows.push("band_properties");
    const effectiveTopology =
      topology?.baseSamples === bands.samples
        && topology.bands === bands.bands
        ? topology
        : bands;
    const topologySource = effectiveTopology === bands ? "render" : "refined";
    const includeGeometry =
      geometry?.samples === bands.samples && geometry.bands === bands.bands;
    const geometryByBand = new Map(
      includeGeometry
        ? geometry.rows.map((row) => [row.band, row] as const)
        : [],
    );
    rows.push(
      [
        "band",
        "band_end",
        "group",
        "isolated",
        "width",
        "gap",
        "gap_width",
        "std_B",
        "C",
        "topology_resolved",
        "topology_source",
        "bgt",
        ...(includeGeometry
          ? [
              "std_g",
              "av_gxx",
              "std_gxx",
              "av_gxy",
              "std_gxy",
              "T",
              "D",
            ]
          : []),
      ].join(","),
    );
    for (const row of [...bands.groupRows].reverse()) {
      const geometryRow = geometryByBand.get(row.band);
      rows.push(
        [
          row.band,
          row.bandEnd,
          row.group,
          row.isolated,
          row.width,
          row.gap ?? "",
          row.gapWidth ?? "",
          row.stdB,
          effectiveTopology.chern[row.band],
          effectiveTopology.topologyResolved,
          topologySource,
          bands.bgt,
          ...(geometryRow
            ? [
                geometryRow.stdG,
                geometryRow.averageGxx,
                geometryRow.stdGxx,
                geometryRow.averageGxy,
                geometryRow.stdGxy,
                geometryRow.averageT,
                geometryRow.averageD,
              ]
            : []),
        ].join(","),
      );
    }
    rows.push("", "surface_data");
    rows.push(
      "band,k1_index,k2_index,energy,berry_flux,chern,topology_resolved,topology_source,group_start,group_size",
    );
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
              effectiveTopology.chern[band],
              effectiveTopology.topologyResolved,
              topologySource,
              bands.groupStart[band],
              bands.groupSize[band],
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

export function exportNpz(
  parameters: ScientificParameters,
  view: ViewKind,
  butterfly?: ButterflyArrays,
  bands?: BandResult,
  lattice?: LatticeResult,
  geometry?: GeometryResult,
  topology?: TopologyResult,
) {
  const files: Record<string, NpyArray> = {};
  if ((view === "butterfly" || view === "wannier") && butterfly) {
    Object.assign(files, {
      flux: view === "wannier" ? butterfly.gapFlux : butterfly.flux,
      energy: view === "wannier" ? butterfly.gapEnergy : butterfly.energy,
      band: butterfly.band,
      chern: view === "wannier" ? butterfly.gapChern : butterfly.chern,
      integrated_dos: butterfly.dos,
      gap: butterfly.gap,
      state_flux: butterfly.flux,
      state_energy: butterfly.energy,
      state_band: butterfly.band,
      state_chern: butterfly.chern,
      gap_flux: butterfly.gapFlux,
      gap_energy: butterfly.gapEnergy,
      gap_chern: butterfly.gapChern,
      topology_available: new Int32Array([
        butterfly.topologyAvailable ? 1 : 0,
      ]),
    });
  } else if (view === "bands" && bands) {
    const effectiveTopology =
      topology?.baseSamples === bands.samples
        && topology.bands === bands.bands
        ? topology
        : bands;
    Object.assign(files, {
      energy: bands.energy,
      berry_flux: bands.berry,
      wilson_phase: effectiveTopology.wilson,
      chern: effectiveTopology.chern,
      wilson_winding: effectiveTopology.wilsonWinding,
      wilson_max_step: effectiveTopology.wilsonMaxStep,
      topology_group_resolved: new Int32Array(
        effectiveTopology.topologyGroupResolved,
      ),
      topology_resolved: new Int32Array([
        effectiveTopology.topologyResolved ? 1 : 0,
      ]),
      topology_samples_x: new Int32Array([
        effectiveTopology === bands ? bands.samples : topology!.samplesX,
      ]),
      topology_samples_y: new Int32Array([
        effectiveTopology === bands ? bands.samples : topology!.samplesY,
      ]),
      group_start: bands.groupStart,
      group_size: bands.groupSize,
      path_x: bands.pathX,
      path_k1: bands.pathK1,
      path_k2: bands.pathK2,
      path_energy: bands.pathEnergy,
      magnetic_brillouin_zone: bands.bz,
      ordinary_brillouin_zone: bands.ordinaryBz,
    });
    if (effectiveTopology !== bands) {
      Object.assign(files, {
        render_grid_wilson_phase: bands.wilson,
        render_grid_chern: bands.chern,
      });
    }
    if (
      geometry?.samples === bands.samples
      && geometry.bands === bands.bands
    ) {
      Object.assign(files, {
        quantum_metric_gxx: geometry.gxx,
        quantum_metric_gxy: geometry.gxy,
      });
    }
  } else if (view === "lattice" && lattice) {
    Object.assign(files, {
      sites: lattice.sites,
      site_basis: lattice.siteBasis,
      links: lattice.links,
      unit_cell: lattice.unitCell,
      magnetic_brillouin_zone: lattice.bz,
      ordinary_brillouin_zone: lattice.ordinaryBz,
    });
  } else {
    return;
  }
  const archiveBytes = createNpzArchive(files, {
    schema: "hofstadter-interactive/1",
    view,
    parameters,
  });
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
  view: ViewKind | "workspace",
  options: {
    scale?: number;
    transparent?: boolean;
    art?: boolean;
    filename?: string;
  } = {},
) {
  const rect = root.getBoundingClientRect();
  const scale =
    options.scale ?? Math.min(2, window.devicePixelRatio || 1);
  const output = document.createElement("canvas");
  output.width = Math.round(rect.width * scale);
  output.height = Math.round(rect.height * scale);
  const context = output.getContext("2d");
  if (!context) return;
  context.scale(scale, scale);
  if (!options.transparent) {
    context.fillStyle = "#08111d";
    context.fillRect(0, 0, rect.width, rect.height);
  }

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
    if (options.art) continue;
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
    if (blob) {
      download(
        blob,
        options.filename ?? exportFilename(parameters, view, "png"),
      );
    }
  }, "image/png");
}

export function exportArtPng(
  plot: HTMLElement,
  parameters: ScientificParameters,
  view: "butterfly" | "wannier",
  colorMode: ButterflyColorMode,
  transparent: boolean,
) {
  const upstreamMode =
    view === "wannier"
      ? "chern"
      : colorMode === "gaps"
        ? "plane"
        : colorMode === "chern"
          ? "point"
          : "spectral";
  const filename = [
    view,
    parameters.lattice,
    "q",
    parameters.q,
    upstreamMode,
    "art.png",
  ].join("_");
  return exportPng(plot, parameters, view, {
    art: true,
    filename,
    scale: 3,
    transparent,
  });
}
