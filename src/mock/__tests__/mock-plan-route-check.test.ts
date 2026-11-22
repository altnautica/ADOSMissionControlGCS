/**
 * @module mock/mock-plan-route-check.test
 * @description The demo route check behind the planner's Send dialog: the
 * Alpha-01 live mission is clear on every leg but the one past the mapped
 * mast, named by the seqs the upload gives it; a plan off the mapped ground is
 * unverified; and the publisher keeps the target drone's demo pilot reporting
 * the open plan's check while the planner is open, stopping only the pilot it
 * started.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Waypoint } from "@/lib/types";
import { parseRouteCheck, type RouteCheck } from "@/lib/hud/cockpit-frames";
import { routeCheckReport } from "@/lib/hud/route-check";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { resolveNodeId } from "@/stores/node-registry";
import { useSettingsStore } from "@/stores/settings-store";
import { DEMO_DRONES } from "../drones";
import { FLIGHT_PATHS } from "../flight-paths";
import { pathMissionItems } from "../engine-mission";
import { MockProtocol } from "../mock-protocol";
import { mockPilot } from "../mock-pilot";
import { DEMO_MAPPED_RADIUS_M, demoPlanRouteCheck, mockPlanRouteCheck } from "../mock-plan-route-check";

const ID = resolveNodeId("alpha-1");
const PATROL = FLIGHT_PATHS[0];
const ALPHA = DEMO_DRONES.find((d) => d.id === "alpha-1")!;
const ORIGIN = { lat: ALPHA.homeLat, lon: ALPHA.homeLon };

/** The Alpha-01 live mission as the planner holds it after the download. */
function patrolPlan(): Waypoint[] {
  const points = [...PATROL, PATROL[0]];
  return [
    { id: "wp-to", lat: PATROL[0].lat, lon: PATROL[0].lon, alt: PATROL[0].alt, speed: PATROL[0].speed, command: "TAKEOFF" },
    ...points.map((p, i) => ({ id: `wp-${i}`, lat: p.lat, lon: p.lon, alt: p.alt, speed: p.speed, command: "WAYPOINT" })),
  ] as Waypoint[];
}

/** The seq the vehicle's mission gives the NAV_WAYPOINT at path point `k`. */
function patrolSeq(k: number): number {
  const lat = Math.round(PATROL[k].lat * 1e7);
  const lon = Math.round(PATROL[k].lon * 1e7);
  return pathMissionItems(PATROL, true).find((it) => it.command === 16 && it.frame === 3 && it.x === lat && it.y === lon)!.seq;
}

/** The check as the dialog reads it, through the pilot frame parser. */
function check(waypoints: Waypoint[], opts: Partial<Parameters<typeof demoPlanRouteCheck>[1]> = {}): RouteCheck | null {
  return parseRouteCheck(demoPlanRouteCheck(waypoints, { origin: ORIGIN, homeSlot: true, ...opts }));
}

describe("demoPlanRouteCheck", () => {
  it("finds the patrol too tight on the leg past the mast, with its tightest point, and clear elsewhere", () => {
    const rc = check(patrolPlan())!;
    expect(rc.state).toBe("infeasible");
    expect(rc.unverifiedLegs).toEqual([]);
    // The leg from the third patrol point to the fourth, as the upload numbers it.
    expect([rc.pinch?.fromSeq, rc.pinch?.toSeq]).toEqual([patrolSeq(2), patrolSeq(3)]);
    expect(rc.pinch?.clearanceM).toBeCloseTo(1.4, 1);
    expect(rc.pinch?.requiredM).toBe(2.25);
    expect(rc.pinch?.ned[2]).toBeLessThan(-39);

    const report = routeCheckReport(rc)!;
    expect(report.severity).toBe("critical");
    expect(report.line).toContain(`${patrolSeq(2)}→${patrolSeq(3)}`);
    expect(report.pinchAt).not.toBeNull();
  });

  it("reads clear on every leg without the mast, keeping its margin", () => {
    const rc = check(patrolPlan(), { obstacles: [] })!;
    expect(rc.state).toBe("feasible");
    expect(rc.pinch?.clearanceM).toBeGreaterThan(2.25);
  });

  it("numbers the legs from seq 0 without a home slot", () => {
    const rc = check(patrolPlan(), { homeSlot: false })!;
    expect([rc.pinch?.fromSeq, rc.pinch?.toSeq]).toEqual([patrolSeq(2) - 1, patrolSeq(3) - 1]);
  });

  it("counts the speed item the planner's default speed adds on upload", () => {
    // A take-off without its own speed: the default speed goes out ahead of
    // it and the loop's speed after it, one item more than the download held.
    const plan = patrolPlan().map((w) => (w.id === "wp-to" ? { ...w, speed: undefined } : w));
    const rc = check(plan, { defaultSpeed: 5 })!;
    expect([rc.pinch?.fromSeq, rc.pinch?.toSeq]).toEqual([patrolSeq(2) + 1, patrolSeq(3) + 1]);
  });

  it("reports a leg leaving the mapped ground unverified", () => {
    const plan = patrolPlan().slice(0, 3);
    // 2 km north: past the mapped ground.
    plan.push({ id: "far", lat: ORIGIN.lat + 2000 / 111_320, lon: ORIGIN.lon, alt: 40, command: "WAYPOINT" } as Waypoint);
    const rc = check(plan, { obstacles: [] })!;
    expect(rc.state).toBe("unverified");
    expect(rc.unverifiedLegs).toEqual([patrolSeq(1) + 1]);
    expect(DEMO_MAPPED_RADIUS_M).toBeLessThan(2000);
  });

  it("has no check without a leg, nor any checked point off the map", () => {
    expect(check(patrolPlan().slice(0, 1))).toBeNull();
    const rc = check(patrolPlan().map((w) => ({ ...w, lat: w.lat + 1 })))!;
    expect(rc.state).toBe("unverified");
    expect(rc.pinch).toBeNull();
  });
});

describe("MockPlanRouteCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    void useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
    const drones = new Map<string, ManagedDrone>();
    drones.set(ID, { id: ID, name: "Alpha-01", protocol: new MockProtocol("ardupilot-copter") } as Partial<ManagedDrone> as ManagedDrone);
    useDroneManager.setState({ drones, selectedDroneId: ID });
    useMissionStore.getState().setWaypoints(patrolPlan());
  });

  afterEach(() => {
    mockPlanRouteCheck.stop();
    mockPilot.stop();
    useNavStreamStore.getState().clear(ID);
    useMissionStore.getState().setWaypoints([]);
    void useSettingsStore.setState({ demoMode: false });
    vi.useRealTimers();
  });

  const routeCheck = () => useNavStreamStore.getState().byDrone[ID]?.pilot?.data.routeCheck ?? null;

  it("starts the target drone's pilot reporting the open plan's check and follows edits", () => {
    mockPlanRouteCheck.start(ID);
    vi.advanceTimersByTime(300);
    expect(mockPilot.session()?.droneId).toBe(ID);
    expect(routeCheck()?.state).toBe("infeasible");
    expect(routeCheck()?.pinch?.fromSeq).toBe(patrolSeq(2));

    // Dropping the patrol's third point takes the route away from the mast.
    useMissionStore.getState().setWaypoints(patrolPlan().filter((w) => w.id !== "wp-3"));
    vi.advanceTimersByTime(300);
    expect(routeCheck()?.state).toBe("feasible");

    mockPlanRouteCheck.stop();
    expect(mockPilot.session()).toBeNull();
    expect(routeCheck()).toBeNull();
  });

  it("leaves a pilot it did not start running", () => {
    mockPilot.start(ID);
    const session = mockPilot.session();
    mockPlanRouteCheck.start(ID);
    expect(routeCheck()?.state).toBe("infeasible");
    mockPlanRouteCheck.stop();
    expect(mockPilot.session()).toEqual(session);
  });

  it("stops no pilot another view restarted after it", () => {
    mockPlanRouteCheck.start(ID);
    mockPilot.start(ID);
    const session = mockPilot.session();
    mockPlanRouteCheck.stop();
    expect(mockPilot.session()).toEqual(session);
  });
});
