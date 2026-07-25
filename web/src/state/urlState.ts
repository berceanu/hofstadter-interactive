import type {
  ButterflyColorMode,
  FocusKind,
  LatticeKind,
  ScientificParameters,
  SurfaceMetric,
  TopologicalPalette,
  ViewKind,
} from "../compute/contracts";
import {
  defaultParameters,
  normalizeFluxTransform,
  normalizeParameters,
  type SelectedMomentum,
} from "./store";

const lattices = new Set<LatticeKind>([
  "square",
  "triangular",
  "honeycomb",
  "kagome",
  "bravais",
  "custom",
]);
const views = new Set<ViewKind>(["butterfly", "wannier", "lattice", "bands"]);
const focuses = new Set<FocusKind>([
  "workspace",
  "butterfly",
  "wannier",
  "lattice",
  "bands",
]);
const colorModes = new Set<ButterflyColorMode>([
  "spectral",
  "chern",
  "gaps",
]);
const palettes = new Set<TopologicalPalette>([
  "avron",
  "jet",
  "red-blue",
]);
const surfaceMetrics = new Set<SurfaceMetric>([
  "energy",
  "berry",
  "gxx",
  "gxy",
]);

export interface UrlAnalysisState {
  colorMode: ButterflyColorMode;
  topologicalPalette: TopologicalPalette;
  surfaceMetric: SurfaceMetric;
  geometryColumnsExpanded: boolean;
  bandCutZoom: number;
  selectedBand: number;
  selectedMomentum: SelectedMomentum;
  fluxTransform: { zoom: number; pan: number };
}

const defaultAnalysisState: UrlAnalysisState = {
  colorMode: "spectral",
  topologicalPalette: "avron",
  surfaceMetric: "energy",
  geometryColumnsExpanded: false,
  bandCutZoom: 1,
  selectedBand: 0,
  selectedMomentum: { source: "path", fraction: 0 },
  fluxTransform: { zoom: 1, pan: 0 },
};

function boundedInteger(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = Number(params.get(key));
  return Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function parseCustomBasis(value: string | null) {
  if (!value) return defaultParameters.customBasis;
  const points = value
    .split(";")
    .map((entry) => entry.split(":").map(Number))
    .filter(
      (entry): entry is [number, number] =>
        entry.length === 2
        && Number.isFinite(entry[0])
        && Number.isFinite(entry[1]),
    )
    .slice(0, 4);
  return points.length ? points : defaultParameters.customBasis;
}

function boundedFloat(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = Number(params.get(key));
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function parseUrlState(search = window.location.search) {
  const query = new URLSearchParams(search);
  const lattice = query.get("lat") as LatticeKind;
  const legacyView = query.get("view") as ViewKind;
  const requestedFocus = query.get("focus") as FocusKind;
  const focus = focuses.has(requestedFocus)
    ? requestedFocus
    : views.has(legacyView)
      ? legacyView
      : "workspace";
  const parsedLattice = lattices.has(lattice)
    ? lattice
    : defaultParameters.lattice;
  const hoppings = (query.get("t") ?? "1")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(Number)
    .filter(Number.isFinite)
    .slice(0, 5);
  const parameters = normalizeParameters({
    ...defaultParameters,
    lattice: parsedLattice,
    p: boundedInteger(query, "p", defaultParameters.p, 1, 199),
    q: boundedInteger(query, "q", defaultParameters.q, 2, 199),
    hoppings: hoppings.length ? hoppings : defaultParameters.hoppings,
    alpha: Number(query.get("alpha")) || defaultParameters.alpha,
    theta: [
      boundedInteger(query, "tn", defaultParameters.theta[0], 1, 180),
      boundedInteger(query, "td", defaultParameters.theta[1], 1, 360),
    ],
    period: boundedInteger(
      query,
      "period",
      defaultParameters.period,
      1,
      16,
    ),
    bgt: query.has("bgt") && Number.isFinite(Number(query.get("bgt")))
      ? Number(query.get("bgt"))
      : defaultParameters.bgt,
    customBasis: parseCustomBasis(query.get("basis")),
    a: 1,
  });
  const workspaceView = query.get("view") as ViewKind;
  const requestedColorMode = query.get("cm") as ButterflyColorMode;
  const requestedPalette = query.get("pal") as TopologicalPalette;
  const requestedMetric = query.get("metric") as SurfaceMetric;
  const momentumParts = (query.get("mom") ?? "").split(":");
  const momentumSource =
    momentumParts[0] === "wilson" ? "wilson" : "path";
  const momentumFraction = Number(momentumParts[1]);
  return {
    ...parameters,
    focus,
    view: focus === "workspace"
      ? views.has(workspaceView)
        ? workspaceView
        : "butterfly"
      : focus,
    colorMode: colorModes.has(requestedColorMode)
      ? requestedColorMode
      : defaultAnalysisState.colorMode,
    topologicalPalette: palettes.has(requestedPalette)
      ? requestedPalette
      : defaultAnalysisState.topologicalPalette,
    surfaceMetric: surfaceMetrics.has(requestedMetric)
      ? requestedMetric
      : defaultAnalysisState.surfaceMetric,
    geometryColumnsExpanded: query.get("geom") === "1",
    bandCutZoom: boundedFloat(query, "cutz", 1, 1, 64),
    selectedBand: boundedInteger(query, "band", 0, 0, 10_000),
    selectedMomentum: {
      source: momentumSource,
      fraction: Number.isFinite(momentumFraction)
        ? Math.max(0, Math.min(1, momentumFraction))
        : 0,
    },
    fluxTransform: normalizeFluxTransform({
      zoom: boundedFloat(query, "fxz", 1, 1, 18),
      pan: boundedFloat(query, "fxp", 0, -1, 1),
    }),
  } satisfies Partial<ScientificParameters> & {
    focus: FocusKind;
    view: ViewKind;
  } & UrlAnalysisState;
}

export function writeUrlState(
  parameters: ScientificParameters,
  focus: FocusKind,
  view?: ViewKind,
  analysis: UrlAnalysisState = defaultAnalysisState,
) {
  const normalized = normalizeParameters(parameters);
  const query = new URLSearchParams();
  query.set("focus", focus);
  if (focus === "workspace" && view && views.has(view)) {
    query.set("view", view);
  }
  query.set("lat", normalized.lattice);
  query.set("p", String(normalized.p));
  query.set("q", String(normalized.q));
  query.set("t", normalized.hoppings.join(","));
  query.set("alpha", String(normalized.alpha));
  query.set("tn", String(normalized.theta[0]));
  query.set("td", String(normalized.theta[1]));
  query.set("period", String(normalized.period));
  query.set("bgt", String(normalized.bgt));
  if (normalized.lattice === "custom") {
    query.set(
      "basis",
      normalized.customBasis
        .map(([x, y]) => `${x}:${y}`)
        .join(";"),
    );
  }
  query.set("ui", "1");
  query.set("cm", analysis.colorMode);
  query.set("pal", analysis.topologicalPalette);
  query.set("metric", analysis.surfaceMetric);
  query.set("geom", analysis.geometryColumnsExpanded ? "1" : "0");
  query.set("band", String(Math.max(0, Math.trunc(analysis.selectedBand))));
  query.set("cutz", String(analysis.bandCutZoom));
  query.set(
    "mom",
    `${analysis.selectedMomentum.source}:${analysis.selectedMomentum.fraction}`,
  );
  query.set("fxz", String(analysis.fluxTransform.zoom));
  query.set("fxp", String(analysis.fluxTransform.pan));
  const next = `${window.location.pathname}?${query.toString()}`;
  window.history.replaceState(null, "", next);
}
