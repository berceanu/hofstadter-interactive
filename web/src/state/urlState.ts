import type {
  LatticeKind,
  ScientificParameters,
  ViewKind,
} from "../compute/contracts";
import { defaultParameters } from "./store";

const lattices = new Set<LatticeKind>([
  "square",
  "triangular",
  "honeycomb",
  "kagome",
  "bravais",
]);
const views = new Set<ViewKind>(["butterfly", "wannier", "lattice", "bands"]);

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

export function parseUrlState(search = window.location.search) {
  const query = new URLSearchParams(search);
  const lattice = query.get("lat") as LatticeKind;
  const view = query.get("view") as ViewKind;
  const hoppings = (query.get("t") ?? "1")
    .split(",")
    .map(Number)
    .filter(Number.isFinite)
    .slice(0, 5);
  return {
    view: views.has(view) ? view : "butterfly",
    lattice: lattices.has(lattice) ? lattice : defaultParameters.lattice,
    p: boundedInteger(query, "p", defaultParameters.p, 1, 199),
    q: boundedInteger(query, "q", defaultParameters.q, 3, 199),
    samples: boundedInteger(
      query,
      "samp",
      defaultParameters.samples,
      5,
      41,
    ),
    hoppings: hoppings.length ? hoppings : defaultParameters.hoppings,
    alpha: Number(query.get("alpha")) || defaultParameters.alpha,
    theta: [
      boundedInteger(query, "tn", defaultParameters.theta[0], 1, 180),
      boundedInteger(query, "td", defaultParameters.theta[1], 1, 360),
    ] as [number, number],
    period: boundedInteger(
      query,
      "period",
      defaultParameters.period,
      1,
      16,
    ),
    a: 1,
  } satisfies Partial<ScientificParameters> & { view: ViewKind };
}

export function writeUrlState(parameters: ScientificParameters, view: ViewKind) {
  const query = new URLSearchParams();
  query.set("view", view);
  query.set("lat", parameters.lattice);
  query.set("p", String(parameters.p));
  query.set("q", String(parameters.q));
  query.set("t", parameters.hoppings.join(","));
  query.set("alpha", String(parameters.alpha));
  query.set("tn", String(parameters.theta[0]));
  query.set("td", String(parameters.theta[1]));
  query.set("period", String(parameters.period));
  query.set("samp", String(parameters.samples));
  const next = `${window.location.pathname}?${query.toString()}`;
  window.history.replaceState(null, "", next);
}
