/**
 * @module mock/demo-mission-detour.test
 * @description The demo pins for a blocked mission leg: the detour frame
 * carries the item it resumes at and its free point, and both banners read
 * from the spec strings.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { specText } from "@/lib/hud/spec-text";
import { DEMO_MISSION_DETOUR_PIN, DEMO_MISSION_UNREACHABLE_PIN } from "@/mock/mock-pilot-detour";
import { demoPilotWire } from "@/mock/mock-pilot-wire";

describe("demo mission detour", () => {
  it("carries the detour and words its banner", () => {
    const wire = demoPilotWire(DEMO_MISSION_DETOUR_PIN);
    const d = wire.mission_detour as { seq: number; target_ned: number[] };
    expect(d.seq).toBe(3);
    expect(d.target_ned).toHaveLength(3);
    const b = parsePilotState(wire)?.banner;
    expect(b?.textKey).toBe("pilot.banner.mission_detour");
    expect(specText(b!.textKey, b!.args)).toBe("Leg to waypoint 3 blocked · Routing round");
  });

  it("words the immediate skip of an unreachable waypoint", () => {
    const b = parsePilotState(demoPilotWire(DEMO_MISSION_UNREACHABLE_PIN))?.banner;
    expect(specText(b!.textKey, b!.args)).toBe(
      "Waypoint 4 is inside an obstacle · Skipped · Coverage gap saved",
    );
    expect(specText("pilot.banner.mission_wp_no_path", { wp: "4" })).toBe(
      "No way to waypoint 4 within 200 m · Skipped · Coverage gap saved",
    );
  });
});
