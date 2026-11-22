/**
 * @license GPL-3.0-only
 *
 * The demo pilot tracks two people and a lidar cluster that move on the demo
 * clock inside the demo room, the second person going unmeasured (faded) for
 * part of every cycle; every entry parses as the agent's would.
 */

import { describe, expect, it } from "vitest";

import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoMovers, demoPilotWire } from "@/mock/mock-pilot-wire";

describe("demo movers", () => {
  it("move between frames and stay inside the room", () => {
    const a = parsePilotState(demoPilotWire({ movers: demoMovers(10_000) }))!.movers;
    const b = parsePilotState(demoPilotWire({ movers: demoMovers(11_000) }))!.movers;
    expect(a.map((m) => m.kind)).toEqual(["person", "person", "unknown"]);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].ne).not.toEqual(b[i].ne);
      for (const v of a[i].ne) expect(Math.abs(v)).toBeLessThan(6);
    }
    // The walker never exceeds a walking pace.
    for (let t = 0; t < 30_000; t += 250) {
      const [walker] = parsePilotState(demoPilotWire({ movers: demoMovers(t) }))!.movers;
      expect(Math.hypot(...walker.velNe)).toBeLessThanOrEqual(1.4 + 1e-9);
    }
  });

  it("fades the second person for 2 s of every 6", () => {
    expect(demoMovers(1_000)[1].age_ms).toBe(1500);
    expect(demoMovers(3_000)[1].age_ms).toBe(100);
  });
});
