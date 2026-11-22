"use client";

/**
 * @module plan/use-demo-route-check
 * @description Demo mode only: while the planner is open, the demo pilot of
 * the drone the Send dialog uploads to reports the route check of the open
 * plan, as a live agent's pilot does for the mission it holds. Nothing runs
 * outside demo mode, and the demo module is loaded on demand so it never
 * ships in a real session.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { useDroneManager } from "@/stores/drone-manager";

export function useDemoRouteCheck(): void {
  const demo = useDemoMode();
  // The Send dialog's target: the drone selected in the drone manager.
  const droneId = useDroneManager((s) => s.selectedDroneId);
  useEffect(() => {
    if (!demo || !droneId) return;
    let active = true;
    let stop: (() => void) | undefined;
    import("@/mock/mock-plan-route-check").then(({ mockPlanRouteCheck }) => {
      if (!active) return;
      mockPlanRouteCheck.start(droneId);
      stop = () => mockPlanRouteCheck.stop();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, [demo, droneId]);
}
