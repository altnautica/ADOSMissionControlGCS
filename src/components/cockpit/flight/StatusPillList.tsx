"use client";

/**
 * @module cockpit/flight/StatusPillList
 * @description The status pill's alert list: a sheet at the flight screen's
 * root, below the top bar beside the left column like every sheet, so the
 * top bar's box never clips it and every row stays readable and tappable.
 * It holds the alert centre ({@link AlertCentre}): sections per alert group,
 * parameter tables, fix actions and Hide/Collapse.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState, type RefObject } from "react";

import { specString } from "@/lib/cockpit/spec-strings";
import { refusalText } from "@/lib/hud/refusal";
import type { PillAlert } from "@/lib/hud/status-pill";
import { requestPilotAction } from "@/lib/input/pilot-stream";
import { AlertCentre } from "./AlertCentre";
import { useFlightGrid } from "./flight-context";
import { FlightSheetPortal, sheetPlacement } from "./flight-sheet";
import { useAlertActions } from "./use-alert-actions";

/** The pill id of the pilot's `airframe_balance` readiness row. */
const AIRFRAME_BALANCE_ID = "pilot:airframe_balance";

/** "I rebalanced it" on the `airframe_balance` row: clears the connected
 *  flight controller's learned airframe record (`airframe_reset`), so the
 *  next lift-off finds the trim again. A refusal shows on the row. Offered
 *  only while the drone is known disarmed. */
function AirframeResetButton() {
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    const r = await requestPilotAction("airframe_reset", {});
    setBusy(false);
    setRefused(r.ok ? null : refusalText(r.err));
  };
  return (
    <>
      <button
        type="button"
        className="fs-hit min-h-[48px] rounded bg-white/10 px-3 text-xs font-semibold"
        data-testid="airframe-reset"
        disabled={busy}
        onClick={() => void reset()}
      >
        {specString("readiness.airframe_balance.reset")}
      </button>
      {refused && (
        <span className="fs-text-crit text-[11px]" data-testid="airframe-reset-refused">
          {refused}
        </span>
      )}
    </>
  );
}

export const PILL_COLOR = { ok: "var(--fs-ok)", warning: "var(--fs-warn)", critical: "var(--fs-crit)" } as const;

const NO_SNOOZE: ReadonlySet<string> = new Set();

export function StatusPillList({
  alerts,
  listRef,
  armed,
  droneId = "",
  snoozed = NO_SNOOZE,
  onSnooze = () => {},
  onLeave,
}: {
  alerts: readonly PillAlert[];
  listRef: RefObject<HTMLDivElement | null>;
  /** The drone's arm state as the pill reads it; null when unknown. */
  armed: boolean | null;
  /** The drone the fixes act on. */
  droneId?: string;
  /** The snoozed alert keys and how to change them. */
  snoozed?: ReadonlySet<string>;
  onSnooze?: (key: string, on: boolean) => void;
  /** Close the list as a fix navigates away. */
  onLeave?: () => void;
}) {
  const grid = useFlightGrid();
  const base = useAlertActions(droneId, onLeave);
  const actions = useMemo(
    () => ({
      ...base,
      extra: (a: PillAlert) => (a.id === AIRFRAME_BALANCE_ID && armed === false ? <AirframeResetButton /> : null),
    }),
    [base, armed],
  );
  return (
    <FlightSheetPortal>
      <div
        ref={listRef}
        role="dialog"
        aria-labelledby="status-pill-list-title"
        // Not `fs-pill-list`: its row grid is the old one-line list's.
        className="fs-sheet p-1.5"
        data-testid="status-pill-list"
        style={{
          position: "absolute",
          ...sheetPlacement(grid, "left"),
          width: "min(420px, calc(100vw - 16px))",
          maxHeight: "70vh",
          overflowY: "auto",
          overscrollBehavior: "contain",
        }}
      >
        <AlertCentre alerts={alerts} snoozed={snoozed} onSnooze={onSnooze} actions={actions} titleId="status-pill-list-title" />
      </div>
    </FlightSheetPortal>
  );
}
