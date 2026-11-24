/**
 * @module cockpit/layers/vision-state
 * @description The cockpit Vision controls' rules, apart from their
 * components: what the engine card shows, how a restart of the vision unit
 * resolves, what a layer badge's first action does, and a layer row's live
 * status. The same rules as the agent cockpit's Vision panel.
 * @license GPL-3.0-only
 */

import viewsSpec from "@/lib/cockpit-spec/views.json";
import { AgentHttpError } from "@/lib/agent/agent-client/transport";
import type { EngineStatus } from "@/lib/agent/vision-client";
import type { LayerChip } from "@/lib/cockpit/layers/engine-types";
import { LAYER_HIDE_MS, type LayerStackView } from "@/lib/cockpit/layers/layer-spec";

/** How long a start (or restart) of the vision unit may take. */
export const VISION_START_MS = 30_000;
/** How long the agent takes to come back and start vision after its restart. */
export const AGENT_RESTART_MS = 45_000;

export type EnginePending =
  | { kind: "starting" | "agent_restarting"; since: number }
  | { kind: "needs_agent_restart" }
  | null;

export type EngineCardState =
  | "running"
  | "starting"
  | "off"
  | "unreachable"
  | "unavailable"
  | "needs_agent_restart"
  | "agent_restarting"
  | "start_timeout"
  | "checking";

/** Whether a status read shows the engine running a usable backend. */
export function engineRunning(status: EngineStatus): boolean {
  return status.known && status.backendState !== "unavailable";
}

/** What the engine card shows, from the stored `vision.enabled` flag (null
 *  while unread), the last status read (`read` false until the first poll
 *  settled) and the action in flight. */
export function engineCardState(i: {
  enabled: boolean | null;
  status: EngineStatus;
  read: boolean;
  pending: EnginePending;
  now: number;
}): EngineCardState {
  if (engineRunning(i.status)) return "running";
  const p = i.pending;
  if (p?.kind === "starting") return i.now - p.since < VISION_START_MS ? "starting" : "start_timeout";
  if (p?.kind === "agent_restarting") return i.now - p.since < AGENT_RESTART_MS ? "agent_restarting" : "start_timeout";
  if (p?.kind === "needs_agent_restart") return "needs_agent_restart";
  if (i.enabled === false) return "off";
  if (i.status.known) return "unavailable";
  return i.read ? "unreachable" : "checking";
}

/** The slice of the agent client a vision restart needs. */
export interface VisionRestartClient {
  restartService(name: string): Promise<{ status: string; message?: string }>;
}

/** Restart the `ados-vision` unit. Resolves "ok", or "refused" when the agent
 *  does not restart that unit through its API (it answers with an "Unknown
 *  service" message, or 403/404); throws any other failure. */
export async function restartVisionUnit(client: VisionRestartClient): Promise<"ok" | "refused"> {
  try {
    await client.restartService("ados-vision");
    return "ok";
  } catch (e) {
    if (e instanceof AgentHttpError && (e.status === 403 || e.status === 404)) return "refused";
    if (e instanceof Error && e.message.startsWith("Unknown service")) return "refused";
    throw e;
  }
}

const FORCED: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  viewsSpec.views.map((v) => [v.id, v.forced_layers as readonly string[]]),
);

/** What a badge's first action does: switch the layer off, or close the view
 *  that forces it on (switching its flag off would change nothing there). */
export function badgeTurnOff(chip: LayerChip, view: LayerStackView): "turn_off" | "close_view" {
  const forced = FORCED[view] ?? [];
  return chip.layers.some((id) => forced.includes(id)) ? "close_view" : "turn_off";
}

/** A layer's live state: frames arriving, none for the hide time, or the
 *  engine that makes them is off. */
export type LayerLiveState = "receiving" | "no_data" | "engine_off";

export function layerLiveState(seenAt: number | null, now: number, engineUp: boolean | null): LayerLiveState {
  if (engineUp === false) return "engine_off";
  return seenAt !== null && now - seenAt < LAYER_HIDE_MS ? "receiving" : "no_data";
}
