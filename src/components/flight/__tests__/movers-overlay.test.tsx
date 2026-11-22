/**
 * @license GPL-3.0-only
 *
 * The flight map shows the moving obstacles the pilot tracks: per mover its
 * sigma ring (metres), a 2 s velocity arrow and a kind mark, placed about the
 * EKF origin, faded once unmeasured for over a second. Nothing without the
 * origin, a fresh pilot frame, or a mover.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("react-leaflet", () => ({
  Circle: ({ center, radius }: { center: [number, number]; radius: number }) => (
    <div data-testid="ring" data-pos={center.join(",")} data-radius={radius} />
  ),
  Polyline: ({ positions }: { positions: [number, number][][] }) => (
    <div data-testid="arrow" data-parts={positions.length} data-tip={positions[0][1].join(",")} />
  ),
  Marker: ({ position, icon, children }: { position: [number, number]; icon: { options: { html: string } }; children?: ReactNode }) => (
    <div data-testid="mark" data-pos={position.join(",")} data-html={icon.options.html}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

import { MoversOverlay } from "../MoversOverlay";
import { parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import { nedToLatLon } from "@/lib/nav/ned-geo";
import { useDroneManager } from "@/stores/drone-manager";
import { useGpsOriginStore } from "@/stores/gps-origin-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "movers-test";
const ORIGIN = { timestamp: 0, lat: 47.0, lon: 8.0, alt: 400 };

function pilot(movers: unknown[]): PilotState {
  const p = parsePilotState({ owner: "goto", fc_mode: 4, armed: true, movers });
  if (!p) throw new Error("pilot frame did not parse");
  return p;
}

const WALKER = { id: 3, kind: "person", source: "vision", ne: [10, 0], vel_ne: [0, 1.5], sigma_m: 0.6, age_ms: 100 };
const STALE_CLUSTER = { id: 9, kind: "unknown", source: "scan", ne: [-4, 2], vel_ne: [0, 0], sigma_m: 0.2, age_ms: 1500 };

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

describe("MoversOverlay", () => {
  it("draws each mover's ring, arrow and kind mark about the EKF origin", () => {
    useNavStreamStore.getState().setPilot(DRONE, pilot([WALKER, STALE_CLUSTER]));
    const { container, getByText } = render(<MoversOverlay />);

    const marks = container.querySelectorAll('[data-testid="mark"]');
    expect(marks).toHaveLength(2);
    expect(marks[0].getAttribute("data-pos")).toBe(nedToLatLon(ORIGIN, 10, 0).join(","));
    expect(marks[0].getAttribute("data-html")).toContain('data-mover-kind="person"');
    expect(marks[0].getAttribute("data-html")).toContain("opacity:1");
    // The cluster was last measured 1.5 s ago: faded.
    expect(marks[1].getAttribute("data-html")).toContain('data-mover-kind="unknown"');
    expect(marks[1].getAttribute("data-html")).toContain("opacity:0.4");
    expect(getByText("Person")).toBeTruthy();
    expect(getByText("Moving object")).toBeTruthy();

    const rings = container.querySelectorAll('[data-testid="ring"]');
    expect(rings[0].getAttribute("data-radius")).toBe("0.6");
    // Only the walker moves: its arrow tips 3 m east (2 s at 1.5 m/s), with barbs.
    const arrows = container.querySelectorAll('[data-testid="arrow"]');
    expect(arrows).toHaveLength(1);
    expect(arrows[0].getAttribute("data-tip")).toBe(nedToLatLon(ORIGIN, 10, 3).join(","));
    expect(arrows[0].getAttribute("data-parts")).toBe("2");
  });

  it("draws nothing while the pilot tracks none", () => {
    useNavStreamStore.getState().setPilot(DRONE, pilot([]));
    const { container } = render(<MoversOverlay />);
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing until the EKF origin is known", () => {
    useGpsOriginStore.getState().clear(DRONE);
    useNavStreamStore.getState().setPilot(DRONE, pilot([WALKER]));
    const { container } = render(<MoversOverlay />);
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing from a stale pilot frame", () => {
    useNavStreamStore.getState().setPilot(DRONE, pilot([WALKER]), Date.now() - 60_000);
    const { container } = render(<MoversOverlay />);
    expect(container.innerHTML).toBe("");
  });
});
