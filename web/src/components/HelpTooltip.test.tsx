import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HelpTooltip } from "./HelpTooltip";

const copy = {
  label: "Magnetic flux φ = p/q",
  body: "p/q is the number of flux quanta per unit cell.",
};

describe("HelpTooltip", () => {
  it("exposes its explanation to keyboard and pointer users", async () => {
    const user = userEvent.setup();
    render(<HelpTooltip copy={copy} />);
    const trigger = screen.getByRole("button", {
      name: `Explain ${copy.label}`,
    });
    const description = document.getElementById(
      trigger.getAttribute("aria-describedby") ?? "",
    );

    expect(description).toHaveTextContent(copy.body);
    expect(screen.queryByText(copy.label)).not.toBeInTheDocument();

    await user.hover(trigger);
    expect(screen.getByText(copy.label)).toBeVisible();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.unhover(trigger);
    expect(screen.getByText(copy.label)).toBeVisible();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(copy.label)).not.toBeInTheDocument();
  });
});
