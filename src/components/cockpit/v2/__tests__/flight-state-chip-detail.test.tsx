/**
 * @license GPL-3.0-only
 *
 * While readiness items block take-off, the flight-state chip opens its
 * detail sheet: the full text, each blocking item as an alert row with its
 * parameter table and fix. With nothing blocking it opens the Mode sheet.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { FlightStateChip } from "../FlightStateChip";

const DRONE = "chip-detail";

function pin(readiness: unknown[]) {
  const pilot = parsePilotState(demoPilotWire({ readiness }));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, pilot, Date.now());
}

afterEach(() => {
  cleanup();
  useNavStreamStore.getState().clear(DRONE);
});

describe("flight-state chip detail", () => {
  it("lists the blocking items with their parameters", () => {
    pin([
      {
        id: "fc_profile",
        ok: false,
        severity: "block",
        msg: "FC parameters differ from the ADOS profile",
        params: [{ name: "MAV_GCS_SYSID", have: 255, want: "1" }],
        fix: { kind: "apply_profile" },
      },
    ]);
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    fireEvent.click(screen.getByTestId("flight-state-chip").querySelector("button")!);
    const detail = screen.getByTestId("flight-state-chip-detail");
    const rows = within(detail).getAllByTestId("alert-item");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByTestId("alert-item-text").textContent).toBe("FC parameters differ from the ADOS profile");
    expect(within(rows[0]).getByTestId("alert-param-row").textContent).toContain("MAV_GCS_SYSID");
    // No hide on the chip's rows: they are the reason take-off is refused.
    expect(within(detail).queryByTestId("alert-collapse")).toBeNull();
  });

  it("opens the Mode sheet when nothing blocks", () => {
    pin([]);
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    fireEvent.click(screen.getByTestId("flight-state-chip").querySelector("button")!);
    expect(screen.queryByTestId("flight-state-chip-detail")).toBeNull();
  });
});
