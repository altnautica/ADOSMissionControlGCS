/**
 * @license GPL-3.0-only
 *
 * The Vision view panel: the close button and Esc go back to the Pilot view,
 * the engine card offers Turn on vision while vision is off and runs the
 * flag write then the unit restart, a refused restart offers the agent
 * restart, and the detections list has its empty state.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

import type { DroneVision } from "../use-drone-vision";

const vision: { current: DroneVision } = { current: null as unknown as DroneVision };

vi.mock("../use-drone-vision", () => ({ useDroneVision: () => vision.current }));
vi.mock("@/components/vision/ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("@/hooks/use-detection-batch", () => ({ useDisplayedDetectionBatch: () => null }));
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: false, isHardBlocked: false, lockMessage: "", hardBlockMessage: "" }),
}));

import { useCockpitViewStore } from "@/lib/cockpit/views";
import { VisionViewPanel } from "../VisionViewPanel";

function offVision(restart: DroneVision["restart"]): DroneVision {
  return {
    status: { known: false },
    read: true,
    engineUp: false,
    enabled: false,
    canWrite: true,
    setEnabled: vi.fn(async () => {}),
    restart: vi.fn(restart),
    restartAgent: vi.fn(async () => {}),
  };
}

afterEach(() => useCockpitViewStore.setState({ byDrone: {} }));

describe("Vision view panel", () => {
  it("closes back to the Pilot view with the X and with Esc", () => {
    vision.current = offVision(async () => "ok");
    useCockpitViewStore.getState().setView("d1", "vision");
    render(<VisionViewPanel droneId="d1" />, { wrapper: IntlWrapper });
    fireEvent.click(screen.getByTestId("vision-close"));
    expect(useCockpitViewStore.getState().byDrone.d1).toBe("pilot");
    useCockpitViewStore.getState().setView("d1", "vision");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useCockpitViewStore.getState().byDrone.d1).toBe("pilot");
    expect(screen.getByTestId("vision-detections-empty").textContent).toBe("No detections. Point the camera at people or vehicles.");
    expect(screen.getByTestId("vision-layer-depth").getAttribute("data-live")).toBe("engine_off");
  });

  it("Turn on vision writes the flag, then restarts the unit", async () => {
    vision.current = offVision(async () => "ok");
    render(<VisionViewPanel droneId="d1" />, { wrapper: IntlWrapper });
    expect(screen.getByTestId("vision-engine-card").getAttribute("data-state")).toBe("off");
    fireEvent.click(screen.getByTestId("vision-turn-on"));
    await waitFor(() => expect(vision.current.restart).toHaveBeenCalled());
    expect(vision.current.setEnabled).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("vision-engine-card").getAttribute("data-state")).toBe("starting");
  });

  it("offers the agent restart when the agent will not restart the unit", async () => {
    vision.current = offVision(async () => "refused");
    render(<VisionViewPanel droneId="d1" />, { wrapper: IntlWrapper });
    fireEvent.click(screen.getByTestId("vision-turn-on"));
    fireEvent.click(await screen.findByTestId("vision-restart-agent"));
    await waitFor(() => expect(vision.current.restartAgent).toHaveBeenCalled());
  });
});
