/**
 * @module mock/demo-routed-return.test
 * @description The demo pin for a return the pilot routes round an obstacle
 * that stopped the FC's own: the pilot frame carries the planned way home,
 * and the banner reads from the spec string.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { specText } from "@/lib/hud/spec-text";
import { DEMO_ROUTED_RETURN_PIN, demoPilotWire } from "@/mock/mock-pilot-wire";

describe("demo routed return", () => {
  it("carries the planned way home and words the banner", () => {
    const wire = demoPilotWire(DEMO_ROUTED_RETURN_PIN);
    const rr = wire.return_route as { remaining_m: number; straight_m: number };
    expect(rr.remaining_m).toBeGreaterThan(rr.straight_m);
    const p = parsePilotState(wire);
    expect(p?.batteryReserve?.returnS).toBe(41);
    const b = p?.banner;
    expect(b?.textKey).toBe("pilot.banner.return_routed");
    expect(specText(b!.textKey, b!.args)).toBe("Return blocked · Routing home round it");
  });
});
