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
    expect(screen.getByLabelText("Momentum samples per axis")).toBeInTheDocument();
    expect(screen.getByLabelText("Band-gap threshold bgt")).toBeInTheDocument();
    expect(
      screen.getByText("Bands only · the butterfly remains Γ-point sampled."),
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

  it("shows the custom basis editor only for the custom lattice", async () => {
    render(<ParameterPanel />);
    expect(screen.queryByLabelText("Custom basis sites")).not.toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByLabelText("Lattice geometry"),
      "custom",
    );
    const editor = screen.getByLabelText("Custom basis sites");
    expect(editor).toBeInTheDocument();
    await userEvent.clear(editor);
    await userEvent.type(editor, "0, 0\n0.5, 0.25");
    await userEvent.tab();
    expect(useAppStore.getState().parameters.customBasis).toEqual([
      [0, 0],
      [0.5, 0.25],
    ]);
  });
});
