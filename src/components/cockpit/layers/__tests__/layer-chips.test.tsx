/**
 * @license GPL-3.0-only
 *
 * The layer status badges: structured chips with their reason, the badge
 * menu's reason line, Turn off (or Close Vision view under the view that
 * forces the layer) and Set up, which opens the drone's Vision settings.
 */

import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

import type { EngineStatus } from "@/lib/agent/vision-client";
import { chipBit, layerChips, VISION_CHIP_MASK } from "@/lib/cockpit/layers/engine-types";
import { useCockpitViewStore } from "@/lib/cockpit/views";
import { useCockpitLayersStore } from "@/stores/cockpit-layers-store";
import { useUiStore } from "@/stores/ui-store";

import { LayerChips } from "../LayerChips";
import { badgeTurnOff, engineCardState, layerLiveState, restartVisionUnit } from "../vision-state";

afterEach(() => {
  useCockpitViewStore.setState({ byDrone: {} });
  useUiStore.getState().setPendingDetailTab(null);
  useUiStore.getState().setPendingAgentPanel(null);
});

describe("structured layer chips", () => {
  it("gives each chip its layer, flags and reason", () => {
    const mask = chipBit("depth") | chipBit("obstacles") | chipBit("arApprox");
    expect(layerChips(mask, false)).toMatchObject([
      { id: "depth", layer: "depth", layers: ["depth"], reason: "engine_off" },
      { id: "obstacles", layer: "obstacles", reason: "no_data" },
      { id: "arApprox", layer: "ar", layers: ["ar_route", "ar_motion"], reason: "degraded" },
    ]);
    expect(layerChips(chipBit("depth"), true)[0].reason).toBe("no_data");
    expect(layerChips(chipBit("depth"), null)[0].reason).toBe("no_data");
    expect(VISION_CHIP_MASK & chipBit("obstacles")).toBe(0);
    expect(VISION_CHIP_MASK & chipBit("surfaces")).not.toBe(0);
  });

  it("turns a layer off, except under the view that forces it", () => {
    const [depth] = layerChips(chipBit("depth"), null);
    const [ar] = layerChips(chipBit("ar"), null);
    expect(badgeTurnOff(depth, "pilot")).toBe("turn_off");
    expect(badgeTurnOff(depth, "vision")).toBe("close_view");
    expect(badgeTurnOff(ar, "vision")).toBe("turn_off");
  });
});

describe("badge menu", () => {
  it("says why the badge shows and switches the layer off", () => {
    render(<LayerChips droneId="d1" mask={chipBit("surfaces")} engineUp={true} view="pilot" />, { wrapper: IntlWrapper });
    const badge = screen.getByTestId("layer-chip");
    expect(badge.getAttribute("data-reason")).toBe("no_data");
    fireEvent.click(badge);
    expect(screen.getByTestId("layer-chip-reason").textContent).toBe("No data from Surfaces for 2 s");
    expect(screen.getByTestId("layer-chip-turn-off").textContent).toBe("Turn off");
    fireEvent.click(screen.getByTestId("layer-chip-turn-off"));
    expect(useCockpitLayersStore.getState().byVehicle.d1?.flips.surfaces).toBe(false);
    expect(screen.queryByTestId("layer-chip-menu")).toBeNull();
  });

  it("closes the Vision view when that view forces the layer", () => {
    useCockpitViewStore.getState().setView("d1", "vision");
    render(<LayerChips droneId="d1" mask={chipBit("depth")} engineUp={false} view="vision" />, { wrapper: IntlWrapper });
    fireEvent.click(screen.getByTestId("layer-chip"));
    expect(screen.getByTestId("layer-chip-reason").textContent).toBe("Vision engine is off");
    const off = screen.getByTestId("layer-chip-turn-off");
    expect(off.textContent).toBe("Close Vision view");
    fireEvent.click(off);
    expect(useCockpitViewStore.getState().byDrone.d1).toBe("pilot");
  });

  it("Set up opens the drone's Vision settings", () => {
    render(<LayerChips droneId="d1" mask={chipBit("depth")} engineUp={false} view="pilot" />, { wrapper: IntlWrapper });
    fireEvent.click(screen.getByTestId("layer-chip"));
    fireEvent.click(screen.getByTestId("layer-chip-set-up"));
    expect(useUiStore.getState().pendingDetailTab).toBe("agent");
    expect(useUiStore.getState().pendingAgentPanel).toBe("vision");
  });

  it("renders nothing with no chips", () => {
    render(<LayerChips droneId="d1" mask={0} engineUp={null} view="pilot" />, { wrapper: IntlWrapper });
    expect(screen.queryByTestId("layer-chips")).toBeNull();
  });
});

describe("vision engine card state", () => {
  const up: Extract<EngineStatus, { known: true }> = {
    known: true,
    models: [],
    npuUtilizationPct: null,
    modelCount: 0,
    backend: "ort",
    backendState: "ready",
    backendReason: null,
  };
  const unknown = { known: false } as const;
  const base = { enabled: true as boolean | null, status: unknown, read: true, pending: null, now: 10_000 };

  it("reads running, off, unreachable, checking and the pending states", () => {
    expect(engineCardState({ ...base, status: up })).toBe("running");
    expect(engineCardState({ ...base, enabled: false })).toBe("off");
    expect(engineCardState(base)).toBe("unreachable");
    expect(engineCardState({ ...base, read: false })).toBe("checking");
    expect(engineCardState({ ...base, status: { ...up, backendState: "unavailable" } })).toBe("unavailable");
    expect(engineCardState({ ...base, pending: { kind: "starting", since: 0 } })).toBe("starting");
    expect(engineCardState({ ...base, pending: { kind: "starting", since: 0 }, now: 31_000 })).toBe("start_timeout");
    expect(engineCardState({ ...base, pending: { kind: "needs_agent_restart" } })).toBe("needs_agent_restart");
  });

  it("treats an agent that will not restart the unit as refused", async () => {
    await expect(restartVisionUnit({ restartService: async () => ({ status: "ok" }) })).resolves.toBe("ok");
    const unknownUnit = { restartService: async () => Promise.reject(new Error("Unknown service: ados-vision")) };
    await expect(restartVisionUnit(unknownUnit)).resolves.toBe("refused");
    const broken = { restartService: async () => Promise.reject(new Error("unit failed")) };
    await expect(restartVisionUnit(broken)).rejects.toThrow("unit failed");
  });

  it("reads a layer's live state", () => {
    expect(layerLiveState(9_500, 10_000, true)).toBe("receiving");
    expect(layerLiveState(5_000, 10_000, true)).toBe("no_data");
    expect(layerLiveState(null, 10_000, null)).toBe("no_data");
    expect(layerLiveState(9_500, 10_000, false)).toBe("engine_off");
  });
});
