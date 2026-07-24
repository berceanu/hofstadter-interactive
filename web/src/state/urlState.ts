import type {
  FocusKind,
  LatticeKind,
  ScientificParameters,
  ViewKind,
} from "../compute/contracts";
import { defaultParameters, normalizeParameters } from "./store";

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
  return {
    ...parameters,
    focus,
    view: focus === "workspace" ? "butterfly" : focus,
  } satisfies Partial<ScientificParameters> & {
    focus: FocusKind;
    view: ViewKind;
  };
}

export function writeUrlState(
  parameters: ScientificParameters,
  focus: FocusKind,
) {
  const normalized = normalizeParameters(parameters);
  const query = new URLSearchParams();
  query.set("focus", focus);
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
  const next = `${window.location.pathname}?${query.toString()}`;
  window.history.replaceState(null, "", next);
}
