/**
 * @module mock/mock-pilot-wire
 * @description The demo pilot's wire state and the pins a demo scenario
 * lays over it. The wire is the agent's `pilot` kind in snake_case; pins
 * (`window.__adosDemoPilot.pin`) override any field of it, which is how the
 * states the demo vehicle does not fly on its own reach the cockpit: an FC
 * failsafe (`fc_failsafe`, `failsafe_cause`), a tuning step (`owner:
 * "tuning"`, `setup_step`) and an aborted setup air run (`setup_abort`, a
 * `setup.blocker.aborted_<reason>` key). One pin is not a pilot field: `follow`
 * holds the demo follow-me report in one phase, with any `follow.state` fields
 * (snake_case) laid over it, e.g. `pin({ armed: true, landed: false, owner:
 * "skill", skill: { plugin_id: "com.altnautica.follow-me", skill_id:
 * "follow-me", label: "Follow-Me" }, follow: { phase:
 * "holding-await-operator", hold_reason: "search-exhausted" } })`.
 * @license GPL-3.0-only
 */

export type Json = Record<string, unknown>;

/** The pilot actions the demo pilot accepts from a surface, as the agent
 * advertises them. */
export const DEMO_SURFACE_OPS: readonly string[] = ["goto"];

/** The demo pilot's wire state (snake_case, as the agent sends it). The
 * agent omits `fc_failsafe` while it is false; a pin sets it. */
export function demoPilotWire(over: Json = {}): Json {
  return {
    owner: "idle",
    owner_label: null,
    skill: null,
    vehicle_class: "multirotor",
    control_mode: "ados",
    profile: "normal",
    avoid: "brake",
    fc_mode: 4,
    fc_mode_name: "GUIDED",
    armed: false,
    landed: true,
    input_src: null,
    input_age_ms: null,
    hold_reason: null,
    avoid_state: "clear",
    min_clearance_m: null,
    goal_ned: null,
    plan_ned: [],
    setpoint_ned: null,
    readiness: [
      DEMO_FC_PROFILE_DIFFERS,
      { id: "position", ok: true, severity: "block", msg: "Position estimate available" },
      { id: "agl", ok: true, severity: "warn", msg: "Rangefinder AGL available" },
      DEMO_SENSOR_PARAMS_DIFFER,
      DEMO_BALANCE_LEARNING,
    ],
    // The FC's own warnings the pilot passes on (newest first), so the alert
    // list shows its "Flight controller messages" section.
    statustext: DEMO_FC_STATUSTEXT,
    link_loss_in_s: null,
    mission: null,
    input_session: null,
    gate: null,
    sequence: null,
    banner: null,
    rth_countdown_s: null,
    surface_ops: [],
    setup_step: null,
    failsafe_cause: null,
    setup_abort: null,
    place_class: "open",
    // The 3D lidar's voxel map and the speed that stops inside its seen-clear range.
    sensing: { tier: "lidar3d", clear_range_m: 11.6, speed_limit_mps: 4.2 },
    // People the camera tracks and something the lidar sees move, on the
    // demo clock (`demoMovers`; the demo pilot refreshes them every frame).
    movers: demoMovers(Date.now()),
    ...over,
  };
}

/**
 * The moving obstacles the demo pilot tracks at epoch ms `nowMs`, in the
 * demo room's local frame (walls at ±6 m about the EKF origin): a person
 * walking an 8 m beat along the north wall at up to 1.4 m/s, a second person
 * drifting by the south wall whose track goes unmeasured for 2 s of every 6
 * (drawn faded), and something the lidar sees circling at 4.5 m.
 */
export function demoMovers(nowMs: number): Json[] {
  const t = nowMs / 1000;
  const a = 0.33 * t + 1;
  return [
    { id: 3, kind: "person", source: "vision", ne: [4.5, 4 * Math.sin(0.35 * t)], vel_ne: [0, 1.4 * Math.cos(0.35 * t)], sigma_m: 0.4, age_ms: 120 },
    {
      id: 5,
      kind: "person",
      source: "vision",
      ne: [-4.5, -2 + 1.5 * Math.sin(0.2 * t)],
      vel_ne: [0, 0.3 * Math.cos(0.2 * t)],
      sigma_m: 0.6,
      age_ms: t % 6 < 2 ? 1500 : 100,
    },
    { id: 9, kind: "unknown", source: "scan", ne: [4.5 * Math.cos(a), 4.5 * Math.sin(a)], vel_ne: [-1.5 * Math.sin(a), 1.5 * Math.cos(a)], sigma_m: 0.25, age_ms: 0 },
  ];
}

/** The airframe balance row before the first steady hover has taught it. */
export const DEMO_BALANCE_LEARNING: Json = {
  id: "airframe_balance",
  ok: true,
  severity: "warn",
  msg: "Balance: learning. Learned after the first steady hover.",
};

/** The airframe balance row once a steady take-off has learned the trim. */
export const DEMO_BALANCE_LEARNED: Json = { ...DEMO_BALANCE_LEARNING, msg: "Balance: OK." };

/** The FC profile row with seven parameters off the ADOS profile, offering
 * "Apply recommended values" (the demo setup engine's `ados_profile` step).
 * A warning in the demo, so the demo vehicle still flies. */
export const DEMO_FC_PROFILE_DIFFERS: Json = {
  id: "fc_profile",
  ok: false,
  severity: "warn",
  msg: "FC parameters differ from the ADOS profile",
  params: [
    { name: "MAV_GCS_SYSID", have: 255, want: "1" },
    { name: "FS_GCS_ENABLE", have: 0, want: "2" },
    { name: "FS_GCS_TIMEOUT", have: 5, want: "3" },
    { name: "FS_THR_ENABLE", have: 0, want: "1" },
    { name: "FS_EKF_ACTION", have: 1, want: "2" },
    { name: "FENCE_ENABLE", have: 0, want: "1" },
    { name: "RTL_ALT", have: null, want: "1500" },
  ],
  fix: { kind: "apply_profile" },
};

/** The FC profile row once the demo setup engine wrote the profile. */
export const DEMO_FC_PROFILE_OK: Json = { id: "fc_profile", ok: true, severity: "warn", msg: "FC failsafe parameters match the ADOS profile" };

/** Set by the demo setup engine when its `ados_profile` step writes the
 * profile; the demo pilot then reports {@link DEMO_FC_PROFILE_OK}. */
export const demoFcProfile = { applied: false };

/** The flow and rangefinder rows off their rule, offering the parameter editor. */
export const DEMO_SENSOR_PARAMS_DIFFER: Json = {
  id: "sensor_params",
  ok: false,
  severity: "warn",
  msg: "Flow and rangefinder parameters differ",
  params: [
    { name: "FLOW_TYPE", have: 0, want: "5 or 7" },
    { name: "RNGFND1_TYPE", have: 0, want: "10 or 32" },
  ],
  fix: { kind: "parameters", names: ["FLOW_TYPE", "RNGFND1_TYPE"] },
};

/** Three FC STATUSTEXT warnings (severity 4), newest first. */
export const DEMO_FC_STATUSTEXT: Json[] = [
  { severity: 4, text: "Compass variance", age_ms: 0 },
  { severity: 4, text: "GPS Glitch or Compass error", age_ms: 0 },
  { severity: 4, text: "EKF primary changed:1", age_ms: 0 },
];

/** The stop distance from `v` m/s, as the agent's
 * `ProfileLimits::stop_distance_m`: `v²/(2·a_brk) + v·a_brk/(2·jerk) + v·0.15 s`. */
function stopM(v: number, aBrk: number, jerk: number): number {
  return Math.round(((v * v) / (2 * aBrk) + (v * aBrk) / (2 * jerk) + v * 0.15) * 100) / 100;
}

function limitsRow(profile: string, r: Json): Json {
  const stop = stopM(r.v_h_mps as number, r.a_brk_mps2 as number, r.jerk_mps3 as number);
  return { profile, ...r, stop_m: stop, margin_m: 1.5 };
}

/** The multirotor stick rows the agent flies per profile (snake_case
 * `profile_limits`), from ados-pilot's `multirotor_sticks`. */
export const DEMO_STICK_LIMITS: Record<"cine" | "normal" | "sport", Json> = {
  cine: limitsRow("cine", {
    v_h_mps: 3, v_up_mps: 1.5, v_down_mps: 1, yaw_dps: 30, a_acc_mps2: 1, a_brk_mps2: 2, jerk_mps3: 4,
    a_v_mps2: 0.6, yaw_dps2: 60, expo_h: 0.25, expo_v: 0.3, expo_yaw: 0.2,
  }),
  normal: limitsRow("normal", {
    v_h_mps: 7, v_up_mps: 2.5, v_down_mps: 1.5, yaw_dps: 90, a_acc_mps2: 2, a_brk_mps2: 2.5, jerk_mps3: 5,
    a_v_mps2: 1, yaw_dps2: 180, expo_h: 0.25, expo_v: 0.3, expo_yaw: 0.2,
  }),
  sport: limitsRow("sport", {
    v_h_mps: 10, v_up_mps: 3, v_down_mps: 2, yaw_dps: 150, a_acc_mps2: 2.5, a_brk_mps2: 2.5, jerk_mps3: 5,
    a_v_mps2: 1, yaw_dps2: 270, expo_h: 0.4, expo_v: 0.4, expo_yaw: 0.3,
  }),
};

/** The pin for an airframe flying the standard take-off (steady take-off
 * off): its readiness row says so and a launch runs no supervised lift-off.
 * The demo default is steady take-off on. */
export const DEMO_STANDARD_TAKEOFF_PIN: Json = {
  readiness: [
    ...(demoPilotWire().readiness as Json[]),
    { id: "supervised_liftoff", ok: false, severity: "warn", msg: "Standard take-off. Steady take-off is off." },
  ],
};

/**
 * The pin for a position the pilot cannot trust: the optical flow measures
 * 5.3 m/s while the estimate reads 0.3 m/s (the estimate froze while the
 * drone flew on), and the pilot holds for it. The demo Navigation echoes it
 * as a degraded pose (`mock-nav`). From the console:
 * `__adosDemoPilot.pin({ hold_reason: "position-unverified", position_unverified:
 * { reason: "flow_disagrees", flow_mps: 5.3, estimate_mps: 0.3 } })`.
 */
export const DEMO_POSITION_UNVERIFIED_PIN: Json = {
  hold_reason: "position-unverified",
  position_unverified: { reason: "flow_disagrees", flow_mps: 5.3, estimate_mps: 0.3 },
};

/**
 * The pin for a position that is uncertain but still flown: after a long
 * corridor the external position's one-sigma is 2.8 m, inside the pilot's
 * 5 m limit, so the pilot keeps flying with its speed cut to 1.5 m/s. From
 * the console: `__adosDemoPilot.pin(DEMO_POSITION_UNCERTAIN_PIN)` while
 * flying.
 */
export const DEMO_POSITION_UNCERTAIN_PIN: Json = {
  pose_uncertainty_m: 2.8,
  speed_cap: { reason: "position-uncertain", v_h_mps: 1.5 },
};

/**
 * The pin for a low-battery return the estimate of the way home asked for
 * above the 30 % floor: 1 km out, the return needs 52 % and the battery
 * reads 48 %, so the pilot counts down to its SmartRTL. From the console:
 * `__adosDemoPilot.pin(DEMO_LOW_BATTERY_ENERGY_PIN)` while flying.
 */
export const DEMO_LOW_BATTERY_ENERGY_PIN: Json = {
  low_battery_action: "rth",
  rth_countdown_s: 8,
  battery_reserve: { need_pct: 52, basis: "energy", return_s: 248 },
  banner: {
    text_key: "pilot.banner.low_battery_rth_energy",
    args: { pct: 48, need_pct: 52, in_s: 10 },
    until_ms: null,
  },
};

/**
 * The pin for a return the pilot routes itself: the FC's SmartRTL met a
 * wall on its way home, so the pilot flies GUIDED round it and lands at
 * home. The way left is 38 m against 24 m straight; the reserve counts the
 * 38. From the console: `__adosDemoPilot.pin(DEMO_ROUTED_RETURN_PIN)`.
 */
export const DEMO_ROUTED_RETURN_PIN: Json = {
  armed: true,
  landed: false,
  owner: "goto",
  return_route: { remaining_m: 38, straight_m: 24, since_ms: Date.now() },
  battery_reserve: { need_pct: 34, basis: "energy", return_s: 41 },
  banner: { text_key: "pilot.banner.return_routed", args: {}, until_ms: null },
};

/**
 * The goal Follow-Me sends a demo pilot and the viewpoint the pilot picks
 * for it: an intent, flown 8 m off the subject at 15° from north, 4.5 m up,
 * seeing nine tenths of its predicted way.
 */
export const DEMO_FOLLOW_GOAL = {
  goal_kind: "follow_intent",
  view: { bearing_deg: 15, radius_m: 8, height_m: 4.5, visibility: 0.92 },
} as const satisfies Json;

/**
 * The pin for a follow under trees: the pilot sees leaves 6 m along the
 * follow skill's way that the airframe passes under at 3.9 m, and follow-me
 * lowers its height to that. From the console, while the demo follows:
 * `__adosDemoPilot.pin(DEMO_UNDER_LEAVES_PIN)`.
 */
export const DEMO_UNDER_LEAVES_PIN: Json = {
  armed: true,
  landed: false,
  owner: "skill",
  skill: { plugin_id: "com.altnautica.follow-me", skill_id: "follow-me", label: "Follow-Me" },
  ...DEMO_FOLLOW_GOAL,
  overhead_ahead: { lease_id: 1, fly_under_agl_m: 3.9, ahead_m: 6 },
  follow: { phase: "following", height_setpoint_m: 3.9, height_lowered: true, height_reason: "canopy" },
};

/**
 * The pin for a follow on the operator's phone position: the camera lost the
 * subject and the phone's GNSS fix alone carries it. From the console, while
 * the demo follows: `__adosDemoPilot.pin(DEMO_BEACON_PIN)`.
 */
export const DEMO_BEACON_PIN: Json = {
  armed: true,
  landed: false,
  owner: "skill",
  skill: { plugin_id: "com.altnautica.follow-me", skill_id: "follow-me", label: "Follow-Me" },
  ...DEMO_FOLLOW_GOAL,
  follow: { phase: "following", subject_source: "beacon" },
};

/** The wire's `position_unverified` reason and detail. */
export interface DemoPositionUnverified {
  reason: string;
  detail: string | null;
}

/** `position_unverified` on a wire state, or null when absent. */
export function pinnedPositionUnverified(wire: Json): DemoPositionUnverified | null {
  const pu = wire.position_unverified as Json | null | undefined;
  if (!pu || typeof pu.reason !== "string") return null;
  return { reason: pu.reason, detail: typeof pu.detail === "string" ? pu.detail : null };
}

/** Pins a demo scenario lays over the live wire state. */
export class PilotPins {
  private fields: Json = {};

  /** Replace every pin; `{}` clears. */
  set(fields: Json): void {
    this.fields = { ...fields };
  }

  clear(): void {
    this.fields = {};
  }

  /** The wire state with the pins on top. */
  over(wire: Json): Json {
    return { ...wire, ...this.fields };
  }

  /** The pinned `follow` report, or null. */
  follow(): Json | null {
    const f = this.fields.follow;
    return typeof f === "object" && f !== null && !Array.isArray(f) ? (f as Json) : null;
  }

  /** Lay `fields` over the current pins. */
  patch(fields: Json): void {
    this.fields = { ...this.fields, ...fields };
  }

  /** Drop the named pins (the pilot or the operator set those fields itself). */
  drop(...keys: string[]): void {
    for (const k of keys) delete this.fields[k];
  }

  /** The FC flies a failsafe of its own (pinned, or on the wire). */
  failsafe(wire: Json): boolean {
    return this.over(wire).fc_failsafe === true;
  }

  /** The FC left its failsafe (an operator's mode change or a disarm). */
  clearFailsafe(): void {
    delete this.fields.fc_failsafe;
    delete this.fields.failsafe_cause;
  }

  /** The pilot left a pinned mission stall (a skip, a return or a landing):
   *  the stall, its hold reason and its banner go with it. */
  clearStall(): void {
    delete this.fields.mission_stall;
    delete this.fields.hold_reason;
    delete this.fields.banner;
  }

  /** The operator set the open class: the confined route check and the speed
   *  cap near the clearance limit go with the confined class. */
  clearConfined(): void {
    delete this.fields.route_check;
    const cap = this.fields.speed_cap;
    if (typeof cap === "object" && cap !== null && (cap as Json).reason === "confined-near") delete this.fields.speed_cap;
  }
}
