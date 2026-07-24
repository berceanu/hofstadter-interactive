import type {
  BandResult,
  ButterflyColorMode,
  DispersionResult,
  GeometryResult,
  LatticeResult,
  ScientificParameters,
  TopologyResult,
  ViewKind,
} from "../compute/contracts";
import { baseTopologyGridSufficient } from "../compute/computeKeys";
import type { ButterflyArrays } from "./arrays";
import { createNpzArchive, type NpyArray } from "./npz";

function topologyCoversBand(
  topology: TopologyResult | undefined,
  band: number,
) {
  return Boolean(
    topology
    && (
      topology.completeBundle
      || (
        topology.computedGroupStart >= 0
        && band >= topology.computedGroupStart
        && band
          < topology.computedGroupStart + topology.computedGroupSize
      )
    ),
  );
}

function topologyForBand(
  parameters: ScientificParameters,
  bands: BandResult,
  topology: TopologyResult | undefined,
  band: number,
) {
  const source = topologyCoversBand(topology, band) ? topology! : bands;
  return {
    resolved:
      source.topologyGroupingConsistent
      && Boolean(source.topologyGroupResolved[band])
      && (
        source !== bands
        || baseTopologyGridSufficient(parameters, bands.samples)
      ),
    chern: source.chern[band] ?? 0,
    label: source === bands ? "render" : "adaptive",
  };
}

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
  dispersion?: DispersionResult,
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
    const refinedTopology =
      topology?.baseSamples === bands.samples
        && topology.bands === bands.bands
        ? topology
        : undefined;
    const refinedDispersion =
      dispersion?.baseSamples === bands.samples
      && dispersion.bands === bands.bands
        ? dispersion
        : undefined;
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
      const bandTopology = topologyForBand(
        parameters,
        bands,
        refinedTopology,
        row.band,
      );
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
          bandTopology.resolved ? bandTopology.chern : "",
          bandTopology.resolved,
          bandTopology.label,
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
      const bandTopology = topologyForBand(
        parameters,
        bands,
        refinedTopology,
        band,
      );
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
              bandTopology.resolved ? bandTopology.chern : "",
              bandTopology.resolved,
              bandTopology.label,
              bands.groupStart[band],
              bands.groupSize[band],
            ].join(","),
          );
        }
      }
    }
    if (refinedDispersion) {
      rows.push("", "refined_dispersion_surface");
      rows.push("band,k1_index,k2_index,energy");
      for (let band = 0; band < refinedDispersion.bands; band += 1) {
        for (
          let ix = 0;
          ix < refinedDispersion.surfaceSamples;
          ix += 1
        ) {
          for (
            let iy = 0;
            iy < refinedDispersion.surfaceSamples;
            iy += 1
          ) {
            const index =
              band
              * refinedDispersion.surfaceSamples
              * refinedDispersion.surfaceSamples
              + ix * refinedDispersion.surfaceSamples
              + iy;
            rows.push(
              [band, ix, iy, refinedDispersion.energy[index]].join(","),
            );
          }
        }
      }
      rows.push("", "refined_symmetry_path");
      rows.push("band,path_index,path_coordinate,k1,k2,energy");
      for (let band = 0; band < refinedDispersion.bands; band += 1) {
        for (
          let index = 0;
          index < refinedDispersion.pathX.length;
          index += 1
        ) {
          rows.push(
            [
              band,
              index,
              refinedDispersion.pathX[index],
              refinedDispersion.pathK1[index],
              refinedDispersion.pathK2[index],
              refinedDispersion.pathEnergy[
                band * refinedDispersion.pathX.length + index
              ],
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
  dispersion?: DispersionResult,
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
    const refinedTopology =
      topology?.baseSamples === bands.samples
        && topology.bands === bands.bands
        ? topology
        : undefined;
    const refinedDispersion =
      dispersion?.baseSamples === bands.samples
      && dispersion.bands === bands.bands
        ? dispersion
        : undefined;
    Object.assign(files, {
      energy: refinedDispersion?.energy ?? bands.energy,
      dispersion_samples: new Int32Array([
        refinedDispersion?.surfaceSamples ?? bands.samples,
      ]),
      dispersion_path_samples_per_segment: new Int32Array([
        refinedDispersion?.pathSamplesPerSegment
        ?? Math.round(
          bands.pathX.length / Math.max(1, bands.pathLabels.length - 1),
        ),
      ]),
      berry_flux: bands.berry,
      berry_samples: new Int32Array([bands.samples]),
      wilson_phase: bands.wilson,
      chern: bands.chern,
      wilson_winding: bands.wilsonWinding,
      wilson_max_step: bands.wilsonMaxStep,
      topology_group_resolved: new Int32Array(bands.topologyGroupResolved),
      topology_resolved: new Int32Array([
        bands.topologyResolved ? 1 : 0,
      ]),
      topology_samples_x: new Int32Array([bands.samples]),
      topology_samples_y: new Int32Array([bands.samples]),
      group_start: bands.groupStart,
      group_size: bands.groupSize,
      path_x: refinedDispersion?.pathX ?? bands.pathX,
      path_k1: refinedDispersion?.pathK1 ?? bands.pathK1,
      path_k2: refinedDispersion?.pathK2 ?? bands.pathK2,
      path_energy: refinedDispersion?.pathEnergy ?? bands.pathEnergy,
      magnetic_brillouin_zone: bands.bz,
      ordinary_brillouin_zone: bands.ordinaryBz,
    });
    if (refinedTopology) {
      const start = Math.max(0, refinedTopology.computedGroupStart);
      const size = Math.max(1, refinedTopology.computedGroupSize);
      const sampleCount = refinedTopology.samplesY;
      Object.assign(files, {
        adaptive_topology_group_start: new Int32Array([start]),
        adaptive_topology_group_size: new Int32Array([size]),
        adaptive_topology_samples_x: new Int32Array([
          refinedTopology.samplesX,
        ]),
        adaptive_topology_samples_y: new Int32Array([sampleCount]),
        adaptive_topology_wilson_phase: refinedTopology.wilson.slice(
          start * sampleCount,
          (start + size) * sampleCount,
        ),
        adaptive_topology_chern: refinedTopology.chern.slice(
          start,
          start + size,
        ),
        adaptive_topology_winding: refinedTopology.wilsonWinding.slice(
          start,
          start + size,
        ),
        adaptive_topology_resolved: new Int32Array([
          refinedTopology.topologyResolved ? 1 : 0,
        ]),
      });
    }
    if (refinedDispersion) {
      Object.assign(files, {
        render_grid_energy: bands.energy,
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
