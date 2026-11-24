"use client";

/**
 * @module cockpit/v2/FlightStateChipDetail
 * @description The flight-state chip's detail sheet, opened from the chip
 * while readiness items block take-off: the chip's full text (a press opens
 * the Mode sheet), each blocking item as an alert row (its parameter table
 * and fix), then "Warnings (n)", which opens the status pill's alert list.
 *
 * @license GPL-3.0-only
 */

import { useRef } from "react";

import { specString } from "@/lib/cockpit/spec-strings";
import type { ReadinessItem } from "@/lib/hud/cockpit-frames";
import { loadSnoozed } from "@/lib/hud/alert-snooze";
import { pillAlerts, unsnoozedAlerts, type PillAlert } from "@/lib/hud/status-pill";
import { AlertRow } from "@/components/cockpit/flight/AlertCentre";
import { alertText } from "@/components/cockpit/flight/alert-text";
import { useFlightGrid } from "@/components/cockpit/flight/flight-context";
import { FlightSheetPortal, openFlightSheet, sheetPlacement, useSheetDismiss } from "@/components/cockpit/flight/flight-sheet";
import { usePillAlerts } from "@/components/cockpit/flight/StatusPill";
import { useAlertActions } from "@/components/cockpit/flight/use-alert-actions";

/** The readiness items that block take-off, as alert rows. */
export function chipBlockingAlerts(readiness: readonly ReadinessItem[]): PillAlert[] {
  return pillAlerts({ alerts: [], readiness, prearm: undefined, storagePct: null }).filter((a) => a.severity === "critical");
}

export function FlightStateChipDetail({
  droneId,
  fullText,
  blocking,
  onClose,
}: {
  droneId: string;
  fullText: string;
  blocking: readonly PillAlert[];
  onClose: () => void;
}) {
  const grid = useFlightGrid();
  const ref = useRef<HTMLDivElement>(null);
  const actions = useAlertActions(droneId, onClose);
  const warnings = unsnoozedAlerts(usePillAlerts(droneId), loadSnoozed()).filter((a) => a.severity === "warning").length;

  useSheetDismiss(ref, onClose, "[data-sheet-trigger='chip']");

  return (
    <FlightSheetPortal>
      <div
        ref={ref}
        role="dialog"
        aria-labelledby="flight-state-chip-detail-title"
        className="fs-sheet"
        data-testid="flight-state-chip-detail"
        style={{ position: "absolute", ...sheetPlacement(grid, "left"), maxHeight: "70vh", overflowY: "auto", overscrollBehavior: "contain" }}
      >
        <button
          id="flight-state-chip-detail-title"
          type="button"
          onClick={() => openFlightSheet("mode")}
          aria-label={specString("chip.aria", { text: fullText })}
          data-testid="flight-state-chip-full"
          className="fs-hit min-h-[48px] w-full p-2 text-left text-sm font-semibold"
        >
          {fullText}
        </button>
        <p className="fs-menu-h px-1">{blocking.length > 0 ? alertText("chip.blocking") : alertText("chip.noBlocking")}</p>
        <ul className="flex flex-col" data-testid="flight-state-chip-blocking">
          {blocking.map((a) => (
            <AlertRow key={a.key} alert={a} actions={actions} snoozed={false} />
          ))}
        </ul>
        {warnings > 0 ? (
          <button
            type="button"
            onClick={() => openFlightSheet("status")}
            data-testid="flight-state-chip-warnings"
            className="fs-hit min-h-[48px] w-full px-2 text-left text-xs underline"
          >
            {alertText("chip.warnings", { count: warnings })}
          </button>
        ) : null}
      </div>
    </FlightSheetPortal>
  );
}
