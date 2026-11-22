"use client";

/**
 * @module cockpit/flight/GoalKindChip
 * @description The top bar's goal chip: which goal the flying skill sent the
 * pilot (`pilot.goal_kind`) and, for a follow intent, the viewpoint the
 * pilot picked (`pilot.view`): "Follow intent · view 15° 8 m", "Ring",
 * "Orbit". Nothing while no skill goal is reported (an older agent) or the
 * pilot state is stale.
 * @license GPL-3.0-only
 */

import { useFreshPilot } from "@/lib/cockpit/use-pilot-state";
import { goalKindChipText } from "@/lib/hud/goal-kind";

export function GoalKindChip({ droneId }: { droneId: string }) {
  const pilot = useFreshPilot(droneId);
  const kind = pilot?.goalKind ?? null;
  const text = goalKindChipText(kind, pilot?.view ?? null);
  if (!kind || !text) return null;
  return (
    <div className="stat" data-testid="goal-kind-chip" data-kind={kind} title={text}>
      <span className="v">{text}</span>
    </div>
  );
}
