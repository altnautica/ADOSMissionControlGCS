/**
 * @license GPL-3.0-only
 *
 * The status pill's alert centre: sections per alert group in the spec's
 * order, the parameter table behind a readiness item (six rows, then "Show
 * all"), the "Apply recommended values" flow up to its hold button, the
 * ground-station hint, and Hide with the hidden counts.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { pillAlerts, type PillAlert } from "@/lib/hud/status-pill";
import type { ReadinessItem } from "@/lib/hud/cockpit-frames";
import { demoSetupTransport, resetDemoSetup } from "@/mock/mock-fc-setup";
import { AlertCentre, type AlertActions } from "../AlertCentre";

afterEach(() => {
  cleanup();
  resetDemoSetup();
});

const PARAMS = ["MAV_GCS_SYSID", "FS_GCS_ENABLE", "FS_GCS_TIMEOUT", "FS_THR_ENABLE", "FS_EKF_ACTION", "FENCE_ENABLE", "RTL_ALT"].map(
  (name, i) => ({ name, have: i === 6 ? null : i, want: String(i + 1) }),
);

const fcProfile: ReadinessItem = {
  id: "fc_profile",
  ok: false,
  severity: "block",
  msg: "FC parameters differ from the ADOS profile",
  params: PARAMS,
  fix: { kind: "apply_profile" },
};

function alerts(readiness: ReadinessItem[] = [fcProfile]): PillAlert[] {
  return pillAlerts({
    alerts: [],
    readiness,
    prearm: undefined,
    storagePct: null,
    pilotAgeMs: 0,
    fcStatus: [
      { severity: 4, text: "Compass variance", ageMs: 0 },
      { severity: 4, text: "EKF primary changed:1", ageMs: 0 },
    ],
  });
}

const link = (href: string) => () => ({ href });
const actions = (over: Partial<AlertActions> = {}): AlertActions => ({
  transport: demoSetupTransport("alert-centre-test"),
  setup: link("/config/aircraft-setup"),
  settings: link("/"),
  parameters: link("/"),
  ...over,
});

function renderCentre(list: PillAlert[], a: AlertActions = actions(), snoozed: ReadonlySet<string> = new Set()) {
  const onSnooze: Array<[string, boolean]> = [];
  render(<AlertCentre alerts={list} snoozed={snoozed} onSnooze={(k, on) => onSnooze.push([k, on])} actions={a} />);
  return onSnooze;
}

describe("alert centre", () => {
  it("groups alerts in the spec order with counts, opening the section that blocks", () => {
    renderCentre(alerts());
    const sections = screen.getAllByTestId("alert-section");
    expect(sections.map((s) => s.dataset.group)).toEqual(["setup", "flight_controller"]);
    expect(screen.getByTestId("alert-counts").textContent).toBe("1 blocking · 2 warnings");
    // The blocking section is open, the FC messages wait behind their toggle.
    expect(within(sections[0]).getAllByTestId("alert-item")).toHaveLength(1);
    expect(within(sections[1]).queryAllByTestId("alert-item")).toHaveLength(0);
    fireEvent.click(within(sections[1]).getByTestId("alert-section-toggle"));
    expect(within(sections[1]).getAllByTestId("alert-item")).toHaveLength(2);
  });

  it("shows the parameter rows, six at first, then all", () => {
    renderCentre(alerts());
    const rows = () => screen.getAllByTestId("alert-param-row");
    expect(rows()).toHaveLength(6);
    expect(rows()[0].textContent).toContain("MAV_GCS_SYSID");
    fireEvent.click(screen.getByTestId("alert-params-more"));
    expect(rows()).toHaveLength(7);
    expect(rows()[6].textContent).toContain("not reported");
  });

  it("reads the recommended values, then offers them behind a hold", async () => {
    renderCentre(alerts());
    fireEvent.click(screen.getByTestId("alert-fix-apply"));
    const review = await screen.findByTestId("alert-apply-review");
    expect(within(review).getByTestId("alert-apply-writes").children.length).toBeGreaterThan(0);
    expect(within(review).getByTestId("alert-apply-hold").textContent).toBe("Apply recommended values");
  });

  it("names where to fix setup when the drone has no setup engine", () => {
    renderCentre(alerts(), actions({ setup: null, transport: null }));
    expect(screen.queryByTestId("alert-fix-apply")).toBeNull();
    expect(screen.getByTestId("alert-fix-hint").textContent).toContain("Aircraft setup");
  });

  it("links a parameters fix to the parameter editor", () => {
    const sensor: ReadinessItem = {
      id: "sensor_params",
      ok: false,
      severity: "warn",
      msg: "Flow and rangefinder parameters differ",
      params: [{ name: "FLOW_TYPE", have: 0, want: "5 or 7" }],
      fix: { kind: "parameters", names: ["FLOW_TYPE"] },
    };
    renderCentre(alerts([fcProfile, sensor]), actions({ parameters: (names) => ({ href: `/?param=${names[0]}` }) }));
    expect(screen.getByTestId("alert-fix-parameters").getAttribute("href")).toBe("/?param=FLOW_TYPE");
  });

  it("drops a hidden warning from the counts and lists it under Show hidden", () => {
    const list = alerts();
    const fc = list.find((a) => a.text === "Compass variance")!;
    const crit = list.find((a) => a.severity === "critical")!;
    renderCentre(list, actions(), new Set([fc.key, crit.key]));
    expect(screen.getByTestId("alert-counts").textContent).toBe("1 blocking · 1 warning");
    // A hidden critical only folds: its title and Expand stay.
    const critRow = within(screen.getAllByTestId("alert-section")[0]).getByTestId("alert-item");
    expect(critRow.dataset.collapsed).toBe("true");
    expect(within(critRow).getByTestId("alert-expand")).toBeTruthy();
    expect(within(critRow).queryByTestId("alert-params")).toBeNull();
    const fcSection = screen.getAllByTestId("alert-section")[1];
    expect(within(fcSection).getByTestId("alert-section-hidden").textContent).toBe("1 hidden");
    const toggle = screen.getByTestId("alert-show-hidden");
    expect(toggle.textContent).toBe("Show hidden (1)");
    fireEvent.click(toggle);
    fireEvent.click(within(fcSection).getByTestId("alert-section-toggle"));
    expect(within(fcSection).getAllByTestId("alert-unhide")).toHaveLength(1);
  });

  it("hides a warning and collapses a critical", () => {
    const list = alerts();
    const calls = renderCentre(list);
    fireEvent.click(screen.getByTestId("alert-collapse"));
    fireEvent.click(within(screen.getAllByTestId("alert-section")[1]).getByTestId("alert-section-toggle"));
    fireEvent.click(screen.getAllByTestId("alert-hide")[0]);
    expect(calls).toEqual([
      [list.find((a) => a.severity === "critical")!.key, true],
      [list.find((a) => a.text === "Compass variance")!.key, true],
    ]);
  });

  it("reads all clear with nothing listed", () => {
    renderCentre([]);
    expect(screen.getByTestId("alert-all-clear").textContent).toContain("All clear");
  });
});
