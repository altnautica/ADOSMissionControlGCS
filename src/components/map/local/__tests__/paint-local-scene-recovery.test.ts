/**
 * @module paint-local-scene-recovery.test
 * @description The local map draws a sought follow target's search ellipse,
 * predicted path and vantage point in the coast colour, and none of them for a
 * target the follow is not seeking; and the pilot's movers in their kind's
 * colour, faded when unmeasured.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { paintLocalScene, type LocalSceneColours } from "@/components/map/local/paint-local-scene";
import { EMPTY_OCCUPANCY } from "@/lib/hud/local-frame";
import { buildLocalScene, followSceneTarget } from "@/lib/hud/local-scene";
import { parseFollowState } from "@/lib/hud/nav-types";
import { MOVER_KIND_COLOR } from "@/lib/hud/movers";
import type { Mover } from "@/lib/hud/pilot-fields";

const COLOURS: LocalSceneColours = {
  ink: "ink",
  primary: "primary",
  track: "track",
  coast: "coast",
  hair: "hair",
  muted: "muted",
  glass: "glass",
  mono: "mono",
};

/** A 2D context that records the calls the painter makes. */
function recorder() {
  const calls: Array<{ op: string; args: unknown[]; strokeStyle: unknown; fillStyle: unknown }> = [];
  const state = { strokeStyle: "" as unknown, fillStyle: "" as unknown };
  const ctx = new Proxy(state as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => calls.push({ op: key, args, strokeStyle: target.strokeStyle, fillStyle: target.fillStyle });
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function paint(raw: Record<string, unknown>, movers: Mover[] = []) {
  const target = followSceneTarget(parseFollowState(raw)!);
  const scene = buildLocalScene({
    width: 200,
    height: 200,
    view: { centreX: 0, centreY: 0, pxPerM: 10, cx: 100, cy: 100 },
    occupancy: EMPTY_OCCUPANCY,
    occupancyStale: false,
    trail: [],
    scanPoints: null,
    target,
    drone: null,
    plan: null,
    movers,
  });
  const { ctx, calls } = recorder();
  paintLocalScene(ctx, scene, { width: 200, height: 200 }, COLOURS, () => null, "0");
  return calls;
}

const RECOVERY = {
  active: true,
  target_ned: [5, 0],
  search_area: { center_ne: [5, 0], semi_major_m: 3, semi_minor_m: 1.5, heading_deg: 90 },
  predicted_path_ne: [
    [5, 0],
    [5, 1],
    [5, 2],
  ],
  vantage_ne: [2, -2],
};

describe("paintLocalScene: follow recovery", () => {
  it("draws the search ellipse about the prediction, its major axis east, in the coast colour", () => {
    const calls = paint({ ...RECOVERY, phase: "searching" });
    const ellipse = calls.find((c) => c.op === "ellipse");
    // North-up: 5 m north of the centre is 50 px up; the radii scale at 10 px/m.
    expect(ellipse?.args.slice(0, 5)).toEqual([100, 50, 30, 15, 0]);
    const fill = calls.find((c) => c.op === "fill");
    expect(fill?.fillStyle).toBe("coast");
  });

  it("draws the predicted path and the vantage diamond", () => {
    const calls = paint({ ...RECOVERY, phase: "repositioning" });
    const lines = calls.filter((c) => c.op === "lineTo").map((c) => c.args);
    // The predicted path heads east from the prediction: (100, 50) → (120, 50).
    expect(lines).toContainEqual([110, 50]);
    expect(lines).toContainEqual([120, 50]);
    // The vantage point 2 m north, 2 m west: (80, 80), a 4 px diamond.
    expect(calls.some((c) => c.op === "moveTo" && c.args[0] === 80 && c.args[1] === 76)).toBe(true);
  });

  it("draws none of them while following", () => {
    const calls = paint({ ...RECOVERY, phase: "following" });
    expect(calls.some((c) => c.op === "ellipse")).toBe(false);
    expect(calls.some((c) => c.op === "moveTo" && c.args[0] === 80 && c.args[1] === 76)).toBe(false);
  });
});

describe("paintLocalScene: movers", () => {
  it("draws a person's disc, sigma ring and 2 s arrow in the person colour", () => {
    const person: Mover = { id: 3, kind: "person", source: "vision", ne: [5, 0], velNe: [0, 1], sigmaM: 0.8, ageMs: 100 };
    const calls = paint({ active: false, phase: "idle" }, [person]);
    // Ring at sigma (8 px), then the disc (4.5 px), both about (100, 50).
    const arcs = calls.filter((c) => c.op === "arc").map((c) => c.args.slice(0, 3));
    expect(arcs).toContainEqual([100, 50, 8]);
    expect(arcs).toContainEqual([100, 50, 4.5]);
    // The arrow runs 2 m east: to (120, 50).
    expect(calls.some((c) => c.op === "lineTo" && c.args[0] === 120 && c.args[1] === 50)).toBe(true);
    const disc = calls.filter((c) => c.op === "fill").at(-1);
    expect(disc?.fillStyle).toBe(MOVER_KIND_COLOR.person);
  });

  it("draws nothing for an empty list", () => {
    const calls = paint({ active: false, phase: "idle" });
    expect(calls.some((c) => c.op === "arc")).toBe(false);
  });
});
