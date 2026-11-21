/**
 * @module mock/mock-pilot-detour
 * @description Demo pins for a mission leg the pilot meets blocked, as the
 * agent sends them. Under avoid `bypass` the pilot puts the FC in GUIDED,
 * flies its planner round the obstacle to the leg's next free point
 * (`mission_detour`, owner `goto`) and then resumes AUTO at the item; a
 * waypoint it proves unreachable (inside an obstacle, or no way to it within
 * 200 m) is skipped at once and kept as a coverage gap. From the console:
 * `__adosDemoPilot.pin(DEMO_MISSION_DETOUR_PIN)`.
 * @license GPL-3.0-only
 */

import type { Json } from "./mock-pilot-wire";

/** A detour round a wall on the leg to waypoint 3, 7 m to its free point. */
export const DEMO_MISSION_DETOUR_PIN: Json = {
  armed: true,
  landed: false,
  avoid: "bypass",
  owner: "goto",
  owner_label: "DETOUR · 7 m",
  avoid_state: "detour",
  mission: { state: "paused", seq: 3, total: 6 },
  mission_detour: { seq: 3, target_ned: [18.25, 0.0, -5.0], since_ms: Date.now() },
  banner: { text_key: "pilot.banner.mission_detour", args: { wp: "3" }, until_ms: null },
};

/** Waypoint 4 lay inside a wall: skipped at once, the mission flies on. */
export const DEMO_MISSION_UNREACHABLE_PIN: Json = {
  armed: true,
  landed: false,
  owner: "mission_fc",
  mission: {
    state: "active",
    seq: 5,
    total: 6,
    gaps: [{ seq: 4, reason: "unreachable_inside_obstacle", at_ms: Date.now() }],
  },
  banner: { text_key: "pilot.banner.mission_wp_inside_obstacle", args: { wp: "4" }, until_ms: null },
};
