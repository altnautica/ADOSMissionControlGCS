"use client";

/**
 * @module cockpit/flight/use-alert-actions
 * @description Where an alert's fix goes on Mission Control, and the alert
 * snooze set kept on this device:
 *
 * - Aircraft setup: Settings › Aircraft setup for the drone (`?drone=`); only
 *   when the drone's setup engine is reachable (a ground station or a drone
 *   without an agent gets the hint instead).
 * - A settings section: the drone's Agent tab at the matching page.
 * - Parameters: the drone's Parameters tab, filtered to the first name.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { useDroneSetupTransport } from "@/lib/fc-setup/use-fc-setup";
import { loadSnoozed, pruneSnoozed, saveSnoozed, withSnoozed } from "@/lib/hud/alert-snooze";
import type { PillAlert } from "@/lib/hud/status-pill";
import { useDroneManager } from "@/stores/drone-manager";
import { useUiStore } from "@/stores/ui-store";
import { AIRCRAFT_SETUP_HREF } from "@/components/shared/AircraftSetupBanner";
import type { AlertActions } from "./AlertCentre";

/** The Agent tab page for a cockpit settings section id; a section with no
 *  page of its own opens the Agent tab where it last was. */
const AGENT_PANEL: Readonly<Record<string, string>> = {
  vision: "vision",
  battery: "battery",
  radio: "radio",
  cameras: "cameras",
  video: "cameras",
};

/** The fix actions for `droneId`; `onLeave` runs as a fix navigates. */
export function useAlertActions(droneId: string, onLeave?: () => void): AlertActions {
  const transport = useDroneSetupTransport(droneId);
  return useMemo(() => {
    // The drone's detail page opens at `tab` (the dashboard reads the pending tab).
    const toDrone = (tab: string, prepare: () => void) => ({
      href: "/",
      onFollow: () => {
        onLeave?.();
        prepare();
        useDroneManager.getState().selectDrone(droneId);
        useUiStore.getState().setPendingDetailTab(tab);
      },
    });
    return {
      transport,
      // The setup page opens the drone's wizards; it has no per-step entry.
      setup: transport ? () => ({ href: `${AIRCRAFT_SETUP_HREF}?drone=${encodeURIComponent(droneId)}`, onFollow: onLeave }) : null,
      settings: (section) =>
        toDrone("agent", () => {
          const panel = AGENT_PANEL[section];
          if (panel) useUiStore.getState().setPendingAgentPanel(panel);
        }),
      parameters: (names) =>
        toDrone("parameters", () => {
          if (names.length > 0) useUiStore.getState().setPendingParamSearch(names[0]);
        }),
    };
  }, [transport, droneId, onLeave]);
}

/** How long after mount the snooze set waits before pruning: the first reads
 *  (no pilot frame yet) list nothing a key could match. */
const SNOOZE_SETTLE_MS = 5000;

/** The snoozed alert keys, kept in storage. Keys whose alert has cleared are
 *  pruned once `settled` (the sources answer) and the page has been up a few
 *  seconds, so a reload keeps them and an alert that clears and returns
 *  shows again. */
export function useAlertSnooze(alerts: readonly PillAlert[], settled: boolean) {
  const [snoozed, setSnoozedSet] = useState<ReadonlySet<string>>(loadSnoozed);
  const mountedAt = useRef<number | null>(null);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);
  const liveKey = alerts.map((a) => a.key).join("\n");
  useEffect(() => {
    if (!settled || mountedAt.current === null || Date.now() - mountedAt.current < SNOOZE_SETTLE_MS) return;
    setSnoozedSet((s) => {
      const next = pruneSnoozed(s, liveKey ? liveKey.split("\n") : []);
      if (next !== s) saveSnoozed(next);
      return next;
    });
  }, [liveKey, settled]);
  const setSnoozed = (key: string, on: boolean) =>
    setSnoozedSet((s) => {
      const next = withSnoozed(s, key, on);
      saveSnoozed(next);
      return next;
    });
  return { snoozed, setSnoozed };
}
