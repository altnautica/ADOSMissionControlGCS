/**
 * @module cockpit/layers/engine-types
 * @description The options, flight context, statistics and scratch shapes of
 * the layer stack's draw loop ({@link LayerEngine}).
 *
 * @license GPL-3.0-only
 */

import layersSpec from "@/lib/cockpit-spec/layers.json";
import { specText } from "@/lib/hud/spec-text";
import type { LayerLevel } from "@/lib/hud/ar-layout";
import type { AvoidState, MissionState } from "@/lib/hud/cockpit-frames";
import type { DepthRange, DepthStyle } from "@/stores/cockpit-layers-store";

/** The status chips the engine reports, in stacking order; chip
 *  `CHIP_IDS[i]` is bit `1 << i` of the engine's chip mask. */
export const CHIP_IDS = ["depth", "depthUnscaled", "surfaces", "obstacles", "ar", "arApprox", "targets"] as const;
export type ChipId = (typeof CHIP_IDS)[number];

/** The bit of one chip in the engine's chip mask. */
export function chipBit(id: ChipId): number {
  return 1 << CHIP_IDS.indexOf(id);
}

/**
 * Why a status chip shows:
 * - `engine_off`: the layer comes from the vision engine and the engine is off
 *   or unreachable;
 * - `no_data`: the layer's frames stopped (older than the hide time);
 * - `degraded`: frames arrive but are approximate (unscaled depth, AR placed
 *   without a camera pose).
 */
export type ChipReason = "engine_off" | "no_data" | "degraded";

/** The layer a chip names. */
export type ChipLayer = "depth" | "surfaces" | "obstacles" | "ar" | "targets";

/** One status chip as the cockpit shows it: `layer` names it, `layers` are
 *  the layer flags it stands for (AR is the route and motion layers). */
export interface LayerChip {
  id: ChipId;
  layer: ChipLayer;
  layers: readonly string[];
  text: string;
  reason: ChipReason;
}

/** Per chip: the layer it names, the flags it stands for, whether the vision
 *  engine produces its data (obstacles and AR come from the pilot and the
 *  nav stream) and whether it reports degraded data rather than none. */
const CHIP_META: Readonly<Record<ChipId, { layer: ChipLayer; layers: readonly string[]; vision: boolean; degraded: boolean }>> = {
  depth: { layer: "depth", layers: ["depth"], vision: true, degraded: false },
  depthUnscaled: { layer: "depth", layers: ["depth"], vision: true, degraded: true },
  surfaces: { layer: "surfaces", layers: ["surfaces"], vision: true, degraded: false },
  obstacles: { layer: "obstacles", layers: ["obstacles"], vision: false, degraded: false },
  ar: { layer: "ar", layers: ["ar_route", "ar_motion"], vision: false, degraded: false },
  arApprox: { layer: "ar", layers: ["ar_route", "ar_motion"], vision: false, degraded: true },
  targets: { layer: "targets", layers: ["targets"], vision: true, degraded: false },
};

/** The chips the vision engine feeds, as a mask: only these need its status. */
export const VISION_CHIP_MASK: number = CHIP_IDS.reduce((m, id, i) => (CHIP_META[id].vision ? m | (1 << i) : m), 0);

/** The chip texts from the spec (`layer.unavailable` with the layer's label,
 *  `layer.ar_approx`, `layer.depth_unscaled`), resolved once. */
function chipText(): Readonly<Record<ChipId, string>> {
  const label = (id: string) => (layersSpec.layers as { id: string; label: string }[]).find((l) => l.id === id)?.label ?? id;
  const unavailable = (layer: string) => specText("layer.unavailable", { layer });
  return {
    depth: unavailable(label("depth")),
    depthUnscaled: specText("layer.depth_unscaled"),
    surfaces: unavailable(label("surfaces")),
    obstacles: unavailable(label("obstacles")),
    ar: unavailable(specText("layer.name.ar")),
    arApprox: specText("layer.ar_approx"),
    targets: unavailable(label("targets")),
  };
}
let CHIP_TEXT: Readonly<Record<ChipId, string>> | null = null;

/** The structured chips of an engine chip mask, in stacking order.
 *  `engineUp` is the vision engine's state (`GET /api/vision/status`): false
 *  when it is off or unreachable, null while unknown. */
export function layerChips(mask: number, engineUp: boolean | null): LayerChip[] {
  CHIP_TEXT ??= chipText();
  const text = CHIP_TEXT;
  return CHIP_IDS.filter((_, i) => (mask & (1 << i)) !== 0).map((id) => {
    const m = CHIP_META[id];
    const reason: ChipReason = m.degraded ? "degraded" : engineUp === false && m.vision ? "engine_off" : "no_data";
    return { id, layer: m.layer, layers: m.layers, text: text[id], reason };
  });
}

/** What the loop draws, set from React only when a toggle, the level, the
 * camera or the view changes. */
export interface LayerOptions {
  droneId: string;
  cameraId: string;
  level: LayerLevel;
  layers: ReadonlySet<string>;
  depthMode: DepthStyle;
  depthRange: DepthRange;
  /** Max frames per second (kiosk/TV: 30); 0 = display rate. */
  fpsCap: number;
}

/** Live flight context the AR layout needs, read at draw time into the
 * engine's own object (never through React state). */
export interface FlightContext {
  mission: MissionState | null;
  avoid: AvoidState | null;
  showLoaded: boolean;
}

/** Draw-time statistics for the performance gate. */
export interface LayerPerf {
  draws: number;
  skipped: number;
  /** Last 512 draw durations, ms. */
  samples: Float64Array;
  cursor: number;
}

/** A decoded per-camera grid in reused buffers. */
export interface GridScratch {
  near: Uint8Array;
  measured: Uint8Array;
  hasMeasured: boolean;
}

/** Per-kind layout state: the frame the ops were laid out from, and whether a
 * rect or option change since then forces a new layout. */
export interface Laid {
  frame: unknown;
  valid: boolean;
}
