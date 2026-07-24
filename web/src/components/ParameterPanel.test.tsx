import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ParameterPanel } from "./ParameterPanel";
import { defaultParameters, useAppStore } from "../state/store";

describe("ParameterPanel", () => {
  beforeEach(() => {
    useAppStore.setState({ parameters: defaultParameters });
  });

  it("applies lattice-specific defaults", async () => {
    render(<ParameterPanel />);
    await userEvent.selectOptions(screen.getByLabelText("Lattice geometry"), "kagome");
    expect(useAppStore.getState().parameters).toMatchObject({
      lattice: "kagome",
      period: 8,
      theta: [1, 3],
    });
  });

  it("exposes accessible scientific controls", () => {
    render(<ParameterPanel />);
    expect(screen.getByLabelText("Flux denominator q")).toBeInTheDocument();
    expect(screen.getByLabelText("Momentum samples per axis")).toBeInTheDocument();
    expect(screen.getByText("Private by construction")).toBeInTheDocument();
  });
});
