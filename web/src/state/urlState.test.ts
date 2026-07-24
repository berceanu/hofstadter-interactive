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
    expect(query.get("view")).toBe("lattice");
  });
});
