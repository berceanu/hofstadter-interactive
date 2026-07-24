import { beforeEach, describe, expect, it } from "vitest";
import { parseUrlState, writeUrlState } from "./urlState";
import { defaultParameters } from "./store";

describe("URL scientific state", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("parses a complete shared configuration", () => {
    const state = parseUrlState(
      "?view=bands&lat=bravais&p=2&q=11&t=1,0,-0.25&alpha=1.2&tn=67&td=180&period=2&samp=21",
    );
    expect(state).toMatchObject({
      focus: "bands",
      view: "bands",
      lattice: "bravais",
      p: 2,
      q: 11,
      hoppings: [1, 0, -0.25],
      alpha: 1.2,
      theta: [67, 180],
      period: 2,
      samples: 21,
    });
  });

  it("writes all scientifically meaningful parameters", () => {
    writeUrlState(
      {
        ...defaultParameters,
        lattice: "honeycomb",
        p: 2,
        q: 13,
        hoppings: [1, 0.1],
      },
      "lattice",
    );
    const query = new URLSearchParams(window.location.search);
    expect(query.get("lat")).toBe("honeycomb");
    expect(query.get("p")).toBe("2");
    expect(query.get("q")).toBe("13");
    expect(query.get("t")).toBe("1,0.1");
    expect(query.get("focus")).toBe("lattice");
    expect(query.has("view")).toBe(false);
    expect(query.has("samp")).toBe(false);
  });

  it("repairs a malicious named-lattice angle and reducible flux", () => {
    const state = parseUrlState(
      "?view=butterfly&lat=honeycomb&p=2&q=4&tn=1&td=2",
    );
    expect(state).toMatchObject({
      focus: "butterfly",
      lattice: "honeycomb",
      p: 1,
      q: 2,
      theta: [1, 3],
    });
  });

  it("defaults to the workspace and accepts legacy view links", () => {
    expect(parseUrlState("")).toMatchObject({ focus: "workspace" });
    expect(parseUrlState("?view=wannier")).toMatchObject({
      focus: "wannier",
      view: "wannier",
    });
  });

  it("ignores empty hopping entries instead of inventing zero shells", () => {
    expect(parseUrlState("?t=")).toMatchObject({
      hoppings: defaultParameters.hoppings,
    });
    expect(parseUrlState("?t=,,")).toMatchObject({
      hoppings: defaultParameters.hoppings,
    });
    expect(parseUrlState("?t=1,")).toMatchObject({ hoppings: [1] });
    expect(parseUrlState("?t=1,,0.5")).toMatchObject({ hoppings: [1, 0.5] });
  });

  it("round-trips the workspace's active view", () => {
    writeUrlState(defaultParameters, "workspace", "wannier");
    const parsed = parseUrlState(window.location.search);
    expect(parsed).toMatchObject({ focus: "workspace", view: "wannier" });
  });

  it("round-trips a custom basis in the shared URL", () => {
    writeUrlState(
      {
        ...defaultParameters,
        lattice: "custom",
        customBasis: [
          [0, 0],
          [0.5, 0.25],
        ],
      },
      "lattice",
    );
    const parsed = parseUrlState(window.location.search);
    expect(parsed).toMatchObject({
      lattice: "custom",
      customBasis: [
        [0, 0],
        [0.5, 0.25],
      ],
    });
  });
});
