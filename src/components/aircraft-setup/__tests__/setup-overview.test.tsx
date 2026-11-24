/**
 * @license GPL-3.0-only
 *
 * The Aircraft setup overview on the demo engine, which starts interrupted on
 * the frame step: the interrupted notice, "Continue setup" resuming the run
 * into the guided frame step (picture picker, units, one Apply), and the
 * card states.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IntlWrapper } from "../../../../tests/helpers/intl-wrapper";

vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: false, isHardBlocked: false, lockMessage: "", hardBlockMessage: "" }),
}));
vi.mock("@/stores/node-registry", () => ({
  resolveNodeId: (id: string) => `node:${id}`,
  useNodeRegistryStore: { getState: () => ({ getEntry: () => ({ fc: { armState: "disarmed" } }) }) },
}));

import { AircraftSetupView } from "../AircraftSetupView";
import { fcSetupUrls, type SetupTransport } from "@/lib/fc-setup/client";
import { setupText } from "@/lib/fc-setup/strings";
import { useFcSetup } from "@/lib/fc-setup/use-fc-setup";
import { demoSetupTransport, resetDemoSetup } from "@/mock/mock-fc-setup";

function Harness({ transport }: { transport: SetupTransport }) {
  const setup = useFcSetup(transport);
  return <AircraftSetupView setup={setup} droneId="node:overview-test" />;
}

afterEach(() => resetDemoSetup());

describe("aircraft setup overview", () => {
  it("shows the interrupted notice, progress and the card states", async () => {
    render(<Harness transport={demoSetupTransport("overview-test")} />, { wrapper: IntlWrapper });
    const primary = await screen.findByTestId("setup-start");
    expect(primary.textContent).toBe("Continue setup");
    expect(primary.getAttribute("data-kind")).toBe("resume");
    expect(screen.getByTestId("setup-interrupted").textContent).toBe(setupText("setup.overview.interrupted"));
    expect(screen.getByTestId("setup-progress").textContent).toBe(setupText("setup.overview.progress", { done: 0, total: 9 }));
    expect(screen.getByTestId("setup-card-frame").getAttribute("data-state")).toBe("in_progress");
    expect(screen.getByTestId("setup-card-sensors").getAttribute("data-state")).toBe("not_set");
    expect(screen.getByTestId("setup-card-ados").getAttribute("data-state")).toBe("optional");
  });

  it("Continue setup resumes the run into the guided frame step", async () => {
    const demo = demoSetupTransport("overview-test");
    const posts: string[] = [];
    const transport: SetupTransport = { ...demo, post: (path, body) => (posts.push(path), demo.post(path, body)) };
    render(<Harness transport={transport} />, { wrapper: IntlWrapper });
    fireEvent.click(await screen.findByTestId("setup-start"));
    await screen.findByTestId("setup-guided");
    expect(posts).toEqual([fcSetupUrls.resume("ground")]);
    expect(screen.getByTestId("setup-step-of").textContent).toBe(setupText("setup.overview.step_of", { k: 1, n: 9 }));
    const card = screen.getByTestId("setup-step-card");
    expect(card.getAttribute("data-step")).toBe("frame");
    const picker = within(card).getByTestId("setup-input-frame_class");
    expect(picker.querySelectorAll("img")).toHaveLength(3);
    expect(within(card).getByText("S")).toBeTruthy();
    fireEvent.click(within(picker).getByText("Hexa"));
    fireEvent.click(within(card).getByTestId("setup-action-apply"));
    await waitFor(() => expect(posts.at(-1)).toBe(fcSetupUrls.action("ground", "frame", "apply")));
    await screen.findByText(setupText("setup.overview.step_done", { title: setupText("setup.frame.title") }));
  });

  it("Run again asks for a hold-to-confirm; the cancelled step reads Cancelled, not needing attention", async () => {
    const demo = demoSetupTransport("overview-test");
    await demo.post(fcSetupUrls.resume("ground"), {});
    await demo.post(fcSetupUrls.abort("ground"), {});
    render(<Harness transport={demo} />, { wrapper: IntlWrapper });
    const primary = await screen.findByTestId("setup-start");
    expect(primary.getAttribute("data-kind")).toBe("run_again");
    expect(screen.queryByTestId("setup-interrupted")).toBeNull();
    // The aborted frame step is cancelled: neutral, not "Needs attention".
    expect(screen.getByTestId("setup-card-frame").getAttribute("data-state")).toBe("not_set");
    fireEvent.click(primary);
    const confirm = screen.getByTestId("setup-confirm");
    expect(confirm.textContent).toContain("Start this setup over?");
    expect(within(confirm).getByTestId("setup-confirm-hold")).toBeTruthy();
    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(screen.queryByTestId("setup-confirm")).toBeNull();
  });

  it("a step run on its own after the wizard was filed counts as a run in progress", async () => {
    const demo = demoSetupTransport("overview-test");
    await demo.post(fcSetupUrls.resume("ground"), {});
    await demo.post(fcSetupUrls.abort("ground"), {});
    await demo.post(fcSetupUrls.run("ground", "battery"), {});
    render(<Harness transport={demo} />, { wrapper: IntlWrapper });
    const primary = await screen.findByTestId("setup-start");
    expect(primary.getAttribute("data-kind")).toBe("continue");
    expect(screen.getByTestId("setup-wizard-tab-ground").textContent).toContain("Running");
    fireEvent.click(primary);
    const card = await screen.findByTestId("setup-step-card");
    expect(card.getAttribute("data-step")).toBe("battery");
    // The ground Abort asks first.
    fireEvent.click(screen.getByTestId("setup-abort"));
    expect(screen.getByTestId("setup-confirm").textContent).toContain("Abort setup?");
  });

  it("flight tuning reads After setup until the ground wizard is done; the FC id sits behind Details", async () => {
    render(<Harness transport={demoSetupTransport("overview-test")} />, { wrapper: IntlWrapper });
    const tab = await screen.findByTestId("setup-wizard-tab-air");
    expect(tab.textContent).toContain(setupText("setup.card.state.after_setup"));
    const fc = screen.getByTestId("setup-fc");
    expect(fc.textContent).toContain("ArduCopter 4.5.7");
    expect(within(fc).getByText("Details")).toBeTruthy();
  });
});
