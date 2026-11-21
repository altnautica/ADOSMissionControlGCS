/**
 * @license GPL-3.0-only
 *
 * The ADOS safety profile step lists the values it will write: each row's
 * parameter and value, and under each obstacle backstop row what it is for,
 * from the demo engine's step as the agent sends it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next-intl", () => {
  const t = Object.assign((k: string) => k, { has: () => false });
  return { useTranslations: () => t };
});

import { StepCard } from "../StepCard";
import { rerunStep } from "@/lib/fc-setup/client";
import { setupText } from "@/lib/fc-setup/strings";
import { demoSetupTransport, resetDemoSetup } from "@/mock/mock-fc-setup";

afterEach(() => resetDemoSetup());

describe("StepCard: ADOS safety profile", () => {
  it("shows the values to write with the backstop rows explained", async () => {
    const step = await rerunStep(demoSetupTransport("profile-test"), "ground", "ados_profile");
    render(<StepCard step={step} busy={false} error={null} onAction={() => {}} />);

    const table = screen.getByTestId("setup-params");
    expect(within(table).getByRole("heading").textContent).toBe("Values to write");
    const rows = Array.from(table.querySelectorAll("dt")).map((dt) => dt.querySelector("span")?.textContent);
    expect(rows).toEqual(step.params.map((p) => p.name));
    expect(rows).toEqual(expect.arrayContaining(["AVOID_ENABLE", "AVOID_MARGIN", "AVOID_BEHAVE", "PRX1_TYPE", "OA_TYPE"]));
    for (const name of ["AVOID_ENABLE", "AVOID_MARGIN", "AVOID_BEHAVE", "PRX1_TYPE", "OA_TYPE"]) {
      expect(within(table).getByText(setupText(`setup.ados_profile.param.${name}`))).toBeTruthy();
    }
    const margin = Array.from(table.querySelectorAll("dt")).find((dt) => dt.textContent?.startsWith("AVOID_MARGIN"));
    expect(margin?.nextElementSibling?.textContent).toBe("1");
  });

  it("shows no table for a step that writes nothing", async () => {
    const step = await rerunStep(demoSetupTransport("profile-test"), "ground", "battery");
    render(<StepCard step={step} busy={false} error={null} onAction={() => {}} />);
    expect(screen.queryByTestId("setup-params")).toBeNull();
  });
});
