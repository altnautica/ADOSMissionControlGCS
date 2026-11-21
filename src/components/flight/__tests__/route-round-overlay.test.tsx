/**
 * @license GPL-3.0-only
 *
 * The flight map previews the pilot's way round an obstacle: a mission
 * detour draws its planned path and the free point the mission resumes at,
 * labelled with the chip's routing line; a routed return draws its path with
 * the routing-home line at the far end. Nothing without the EKF origin, a
 * fresh pilot frame, or a detour or routed return.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("react-leaflet", () => ({
  Polyline: ({ positions, pathOptions }: { positions: [number, number][]; pathOptions: { dashArray?: string } }) => (
    <div data-testid="path" data-points={positions.length} data-dash={pathOptions.dashArray} />
  ),
  CircleMarker: ({ center, radius, children }: { center: [number, number]; radius: number; children?: ReactNode }) => (
    <div data-testid="point" data-pos={center.join(",")} data-radius={radius}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

import { RouteRoundOverlay } from "../RouteRoundOverlay";
import { parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import { nedToLatLon } from "@/lib/nav/ned-geo";
import { useDroneManager } from "@/stores/drone-manager";
import { useGpsOriginStore } from "@/stores/gps-origin-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import stallFrame from "@/lib/cockpit/layers/fixtures/pilot-frame-stall.json";

const DRONE = "route-round-test";
const ORIGIN = { timestamp: 0, lat: 47.0, lon: 8.0, alt: 400 };
const PLAN: [number, number][] = [
  [0, 0],
  [6, 4],
  [14, 6],
  [20, 2],
];

function pilot(over: Record<string, unknown>): PilotState {
  const raw = stallFrame as Record<string, unknown> & { data?: Record<string, unknown> };
  const p = parsePilotState({ ...(raw.data ?? raw), mission_stall: null, plan_ned: PLAN, ...over });
  if (!p) throw new Error("pilot frame did not parse");
  return p;
}

beforeEach(() => {
  useDroneManager.setState({ selectedDroneId: DRONE });
  useGpsOriginStore.getState().setOrigin(DRONE, ORIGIN);
});
afterEach(() => {
  cleanup();
  useDroneManager.setState({ selectedDroneId: null });
  useNavStreamStore.getState().clear(DRONE);
  useGpsOriginStore.getState().clear(DRONE);
});

describe("RouteRoundOverlay", () => {
  it("draws a detour's planned path and the free point it resumes at", () => {
    useNavStreamStore.getState().setPilot(DRONE, pilot({ mission_detour: { seq: 4, target_ned: [20, 2, -30], since_ms: 1 } }));
    const { container, getByText } = render(<RouteRoundOverlay />);

    const path = container.querySelector('[data-testid="path"]');
    expect(path?.getAttribute("data-points")).toBe("4");
    expect(path?.getAttribute("data-dash")).toBeTruthy();
    const [n, e] = [20, 2];
    const [lat, lon] = nedToLatLon(ORIGIN, n, e);
    const point = container.querySelector('[data-testid="point"]');
    expect(point?.getAttribute("data-pos")).toBe(`${lat},${lon}`);
    expect(point?.getAttribute("data-radius")).toBe("7");
    expect(getByText("Routing round · WP 4")).toBeTruthy();
  });

  it("draws a routed return's path with the routing-home line at its far end", () => {
    useNavStreamStore
      .getState()
      .setPilot(DRONE, pilot({ return_route: { remaining_m: 182.4, straight_m: 121.6, since_ms: 1 } }));
    const { container, getByText } = render(<RouteRoundOverlay />);

    expect(container.querySelector('[data-testid="path"]')?.getAttribute("data-points")).toBe("4");
    const [lat, lon] = nedToLatLon(ORIGIN, 20, 2);
    expect(container.querySelector('[data-testid="point"]')?.getAttribute("data-pos")).toBe(`${lat},${lon}`);
    expect(getByText("Routing home · 182 m (straight 122 m)")).toBeTruthy();
  });

  it("draws nothing while the pilot routes round nothing", () => {
    useNavStreamStore.getState().setPilot(DRONE, pilot({}));
    const { container } = render(<RouteRoundOverlay />);
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing until the EKF origin is known", () => {
    useGpsOriginStore.getState().clear(DRONE);
    useNavStreamStore.getState().setPilot(DRONE, pilot({ mission_detour: { seq: 4, target_ned: [20, 2, -30] } }));
    const { container } = render(<RouteRoundOverlay />);
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing from a stale pilot frame", () => {
    useNavStreamStore
      .getState()
      .setPilot(DRONE, pilot({ mission_detour: { seq: 4, target_ned: [20, 2, -30] } }), Date.now() - 60_000);
    const { container } = render(<RouteRoundOverlay />);
    expect(container.innerHTML).toBe("");
  });
});
