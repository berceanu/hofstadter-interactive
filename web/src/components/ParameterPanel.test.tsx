import { render, screen, waitFor } from "@testing-library/react";
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
    expect(
      screen.queryByLabelText("Momentum samples per axis"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Period")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "General Bravais" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("θ numerator"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("θ denominator"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Band-gap threshold bgt")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Explain Magnetic flux φ = p/q",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Explain Band-gap threshold bgt",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Private by construction")).not.toBeInTheDocument();
  });

  it("commits p and q together before reducing the fraction", async () => {
    useAppStore.setState({
      parameters: {
        ...defaultParameters,
        p: 1,
        q: 12,
      },
    });
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const pInput = screen.getByRole("spinbutton", { name: "p" });
    const qInput = screen.getByRole("spinbutton", { name: "q" });

    await user.clear(pInput);
    await user.type(pInput, "6");
    expect(pInput).toHaveValue(6);
    expect(qInput).toHaveValue(12);
    expect(useAppStore.getState().parameters).toMatchObject({ p: 1, q: 2 });

    await user.clear(qInput);
    await user.type(qInput, "11");

    expect(pInput).toHaveValue(6);
    expect(qInput).toHaveValue(11);
    expect(useAppStore.getState().parameters).toMatchObject({ p: 6, q: 11 });

    await user.tab();
    await waitFor(() => {
      expect(useAppStore.getState().parameters).toMatchObject({ p: 6, q: 11 });
    });
    expect(pInput).toHaveValue(6);
    expect(qInput).toHaveValue(11);
  });
});
