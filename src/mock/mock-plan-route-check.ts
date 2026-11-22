/**
 * @module mock/mock-plan-route-check
 * @description The demo pilot's route check while the planner is open. A
 * real pilot checks the mission against its live occupancy map and reports
 * `route_check` on its `pilot` kind, which the Send dialog shows before an
 * upload. In demo mode the planner page starts the demo pilot for the target
 * drone (when nothing else runs it) and this module keeps that drone's
 * `route_check` in step with the plan open in the planner, so the dialog shows
 * the check of the route it is about to send.
 *
 * The demo live map is the ground the demo drones have flown: everything
 * within {@link DEMO_MAPPED_RADIUS_M} of the drone's home, holding one mapped
 * mast. The mast stands {@link MAST_OFFSET_M} beside the third leg of the
 * Alpha-01 patrol, so that drone's live mission is clear on every leg but one,
 * which is too tight and names its tightest point. A leg leaving the mapped
 * ground is reported unverified. Heights are taken as the waypoints' altitude
 * above home.
 *
 * Loaded only through the demo-mode dynamic import in the planner page.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { planSlots } from "@/lib/mission/mission-slots";
import { useDroneManager } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { DEMO_DRONES } from "./drones";
import { FLIGHT_PATHS } from "./flight-paths";
import { holdsHomeSlot } from "./engine-mission";
import { MockProtocol } from "./mock-protocol";
import { mockPilot } from "./mock-pilot";
import type { Json } from "./mock-pilot-wire";

/** Ground the demo live map covers around the drone's home, metres. */
export const DEMO_MAPPED_RADIUS_M = 800;
/** The pilot's open-place obstacle margin and its pose sigma; the route must
 *  keep margin + max(0.1, 3 sigma). */
const MARGIN_M = 1.5;
const SIGMA_M = 0.25;
const REQUIRED_M = MARGIN_M + Math.max(0.1, 3 * SIGMA_M);
/** The pilot's clearance field reaches this far; beyond it a point reads this. */
const CLEARANCE_CAP_M = 20;
/** Spacing of the checked points along a leg, metres. */
const STEP_M = 0.5;
/** Commands the vehicle flies no position for. */
const NO_POSITION: Record<string, true> = { RTL: true, DO_LAND_START: true };

const M_PER_DEG = 111_320;

/** A mapped vertical obstacle: a cylinder `radiusM` wide up to `topM` above home. */
export interface DemoObstacle {
  lat: number;
  lon: number;
  radiusM: number;
  topM: number;
}

/** How far the mast stands from the patrol leg's centre line, and its radius. */
const MAST_OFFSET_M = 1.8;
const MAST_RADIUS_M = 0.4;

/** The mast beside the Alpha-01 patrol's leg from its third to fourth point. */
function patrolMast(): DemoObstacle {
  const [a, b] = [FLIGHT_PATHS[0][2], FLIGHT_PATHS[0][3]];
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const dn = (b.lat - a.lat) * M_PER_DEG;
  const de = (b.lon - a.lon) * M_PER_DEG * cos;
  const len = Math.hypot(dn, de);
  // Left of the direction of travel.
  const [pn, pe] = [-de / len, dn / len];
  return {
    lat: (a.lat + b.lat) / 2 + (pn * MAST_OFFSET_M) / M_PER_DEG,
    lon: (a.lon + b.lon) / 2 + (pe * MAST_OFFSET_M) / (M_PER_DEG * cos),
    radiusM: MAST_RADIUS_M,
    topM: 60,
  };
}

export const DEMO_OBSTACLES: readonly DemoObstacle[] = [patrolMast()];

interface Origin {
  lat: number;
  lon: number;
}

type Ned = [number, number, number];

function toNed(origin: Origin, lat: number, lon: number, heightM: number): Ned {
  const cos = Math.cos((origin.lat * Math.PI) / 180);
  return [(lat - origin.lat) * M_PER_DEG, (lon - origin.lon) * M_PER_DEG * cos, -heightM];
}

/** Distance from `p` to the nearest obstacle surface, capped at the field's reach. */
function clearanceAt(p: Ned, obstacles: readonly Ned[], spec: readonly DemoObstacle[]): number {
  let best = CLEARANCE_CAP_M;
  obstacles.forEach((o, i) => {
    const side = Math.max(0, Math.hypot(p[0] - o[0], p[1] - o[1]) - spec[i].radiusM);
    const above = Math.max(0, -p[2] - spec[i].topM);
    best = Math.min(best, Math.hypot(side, above));
  });
  return best;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface RouteCheckOptions {
  /** The pilot's local origin (the drone's home). */
  origin: Origin;
  /** ArduPilot layout: home at seq 0 and the mission from seq 1. */
  homeSlot: boolean;
  /** The planner's default speed: a waypoint without its own speed gets a
   *  speed item on upload, which moves the seqs after it. */
  defaultSpeed?: number;
  obstacles?: readonly DemoObstacle[];
}

/**
 * The `route_check` the pilot reports for `waypoints` once they are the
 * vehicle's mission, in its wire form; null with fewer than two flown
 * positions (no leg). Legs run between the flown positions, named by the
 * mission seqs the upload gives them.
 */
export function demoPlanRouteCheck(waypoints: readonly Waypoint[], opts: RouteCheckOptions): Json | null {
  const spec = opts.obstacles ?? DEMO_OBSTACLES;
  const obstacles = spec.map((o) => toNed(opts.origin, o.lat, o.lon, 0));
  const base = opts.homeSlot ? 1 : 0;
  const flown: { seq: number; ned: Ned }[] = [];
  planSlots(waypoints, "relative", opts.defaultSpeed).forEach((slot, i) => {
    if (slot.kind !== "nav" || NO_POSITION[slot.wp.command ?? "WAYPOINT"]) return;
    if (!Number.isFinite(slot.wp.lat) || !Number.isFinite(slot.wp.lon)) return;
    flown.push({ seq: base + i, ned: toNed(opts.origin, slot.wp.lat, slot.wp.lon, slot.wp.alt) });
  });
  if (flown.length < 2) return null;

  const unverified: number[] = [];
  let pinch: { from_seq: number; to_seq: number; ned: Ned; clearance_m: number } | null = null;
  for (let k = 1; k < flown.length; k++) {
    const [a, b] = [flown[k - 1], flown[k]];
    const len = Math.hypot(b.ned[0] - a.ned[0], b.ned[1] - a.ned[1], b.ned[2] - a.ned[2]);
    const steps = Math.max(1, Math.ceil(len / STEP_M));
    let seen = true;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p: Ned = [0, 1, 2].map((j) => a.ned[j] + (b.ned[j] - a.ned[j]) * t) as Ned;
      if (Math.hypot(p[0], p[1]) > DEMO_MAPPED_RADIUS_M) {
        seen = false;
        continue;
      }
      const c = clearanceAt(p, obstacles, spec);
      if (!pinch || c < pinch.clearance_m) pinch = { from_seq: a.seq, to_seq: b.seq, ned: p, clearance_m: c };
    }
    if (!seen) unverified.push(b.seq);
  }

  const tight = pinch !== null && pinch.clearance_m < REQUIRED_M;
  return {
    state: tight ? "infeasible" : unverified.length > 0 ? "unverified" : "feasible",
    required_m: REQUIRED_M,
    margin_m: MARGIN_M,
    sigma_m: SIGMA_M,
    pinch: pinch && {
      ...pinch,
      ned: pinch.ned.map(round2),
      clearance_m: round2(pinch.clearance_m),
      required_m: REQUIRED_M,
    },
    unverified_legs: unverified,
  };
}

/** The demo drone's home, or the plan's first position without one. */
function originFor(droneId: string, waypoints: readonly Waypoint[]): Origin | null {
  const device = deviceIdFromNodeId(droneId) ?? droneId;
  const cfg = DEMO_DRONES.find((d) => d.id === device);
  if (cfg) return { lat: cfg.homeLat, lon: cfg.homeLon };
  const first = waypoints.find((w) => Number.isFinite(w.lat) && Number.isFinite(w.lon));
  return first ? { lat: first.lat, lon: first.lon } : null;
}

/** Keeps the demo pilot of the planner's target drone reporting the route
 *  check of the open plan. */
export class MockPlanRouteCheck {
  private droneId: string | null = null;
  /** The pilot session this publisher started, to stop only that one. */
  private ownSession: number | null = null;
  private unsubscribe: (() => void) | null = null;

  start(droneId: string): void {
    this.stop();
    this.droneId = droneId;
    const running = mockPilot.session();
    if (running?.droneId !== droneId) {
      mockPilot.start(droneId);
      this.ownSession = mockPilot.session()?.id ?? null;
    }
    this.unsubscribe = useMissionStore.subscribe((s, prev) => {
      if (s.waypoints !== prev.waypoints) this.publish();
    });
    this.publish();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const droneId = this.droneId;
    const own = this.ownSession;
    this.droneId = null;
    this.ownSession = null;
    if (!droneId || own === null || mockPilot.session()?.id !== own) return;
    mockPilot.stop();
    // The pilot stopped with the page, as a closed stream leaves no state.
    useNavStreamStore.getState().clear(droneId);
  }

  private publish(): void {
    const droneId = this.droneId;
    if (!droneId || mockPilot.session()?.droneId !== droneId) return;
    const { waypoints } = useMissionStore.getState();
    const origin = originFor(droneId, waypoints);
    const protocol = useDroneManager.getState().drones.get(droneId)?.protocol;
    const homeSlot = protocol instanceof MockProtocol ? holdsHomeSlot(protocol) : true;
    const { defaultSpeed } = usePlannerStore.getState();
    const check = origin ? demoPlanRouteCheck(waypoints, { origin, homeSlot, defaultSpeed }) : null;
    mockPilot.pin(check ? { route_check: check } : {});
  }
}

export const mockPlanRouteCheck = new MockPlanRouteCheck();
