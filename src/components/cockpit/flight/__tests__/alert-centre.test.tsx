/**
 * @license GPL-3.0-only
 *
 * The status pill's alert centre: sections per alert group in the spec's
 * order, the parameter table behind a readiness item (six rows, then "Show
 * all"), the "Apply recommended values" flow up to its hold button, the
 * ground-station hint, and Hide with the hidden counts.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { pillAlerts, type PillAlert } from "@/lib/hud/status-pill";
import type { ReadinessItem } from "@/lib/hud/cockpit-frames";
import { SetupRequestError, type SetupTransport } from "@/lib/fc-setup/client";
import { demoSetupTransport, resetDemoSetup } from "@/mock/mock-fc-setup";
import { AlertCentre, type AlertActions } from "../AlertCentre";

/** The demo setup engine, recording every POST path; `post` may answer first. */
function spyTransport(post?: (path: string) => unknown): { transport: SetupTransport; posts: string[] } {
  const demo = demoSetupTransport("alert-centre-spy");
  const posts: string[] = [];
  return {
    posts,
    transport: {
      ...demo,
      post: async (path, body) => {
        posts.push(path);
        const own = post?.(path);
        return own === undefined ? demo.post(path, body) : own;
      },
    },
  };
}

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

  it("reads the recommended values, then offers the changes behind a hold", async () => {
    renderCentre(alerts());
    fireEvent.click(screen.getByTestId("alert-fix-apply"));
    const review = await screen.findByTestId("alert-apply-review");
    // Only the rows that change, as current → new; the rest fold away.
    const changes = within(review).getAllByTestId("alert-apply-change");
    expect(changes).toHaveLength(8);
    expect(changes[0].textContent).toContain("MAV_GCS_SYSID");
    expect(changes[0].textContent).toContain("255");
    expect(within(review).queryAllByTestId("alert-apply-same")).toHaveLength(0);
    fireEvent.click(within(review).getByTestId("alert-apply-same-toggle"));
    expect(within(review).getAllByTestId("alert-apply-same")).toHaveLength(6);
    expect(within(review).getByTestId("alert-apply-reboots").textContent).toBe("The flight controller will restart");
    expect(within(review).getByTestId("alert-apply-hold").textContent).toBe("Apply recommended values");
    // The row's own table would repeat the review: it is hidden meanwhile.
    expect(screen.queryByTestId("alert-params")).toBeNull();
  });

  it("aborts the ground wizard on Cancel and when the review unmounts", async () => {
    const spy = spyTransport();
    renderCentre(alerts(), actions({ transport: spy.transport }));
    fireEvent.click(screen.getByTestId("alert-fix-apply"));
    fireEvent.click(await screen.findByTestId("alert-apply-cancel"));
    expect(spy.posts.filter((p) => p.endsWith("/ground/abort"))).toHaveLength(1);
    expect(screen.getByTestId("alert-params")).toBeTruthy();

    fireEvent.click(screen.getByTestId("alert-fix-apply"));
    await screen.findByTestId("alert-apply-review");
    cleanup();
    expect(spy.posts.filter((p) => p.endsWith("/ground/abort"))).toHaveLength(2);
  });

  it("picks up a review the engine already holds open", async () => {
    const demo = demoSetupTransport("alert-centre-held");
    // An earlier review left the step waiting for the operator.
    await demo.post("/api/v1/fc-setup/ground/steps/ados_profile/run", {});
    const transport: SetupTransport = {
      ...demo,
      get: async (path, signal) => ({ ...(await demo.get(path, signal) as object), running: { wizard: "ground", step: "ados_profile" } }),
      post: async (path, body) => {
        if (path.endsWith("/run")) throw new SetupRequestError(409, "wizard_running", "a wizard is running");
        return demo.post(path, body);
      },
    };
    renderCentre(alerts(), actions({ transport }));
    fireEvent.click(screen.getByTestId("alert-fix-apply"));
    expect(await screen.findByTestId("alert-apply-review")).toBeTruthy();
  });

  it("words a refusal, never as its raw key", async () => {
    const spy = spyTransport((path) => {
      if (path.endsWith("/run")) throw new SetupRequestError(409, "some_new_code", "refused");
      return undefined;
    });
    renderCentre(alerts(), actions({ transport: spy.transport }));
    fireEvent.click(screen.getByTestId("alert-fix-apply"));
    const error = await screen.findByTestId("alert-apply-error");
    await waitFor(() => expect(error.textContent).toContain("The values were not written."));
    expect(error.textContent).not.toContain("some_new_code");
  });

  it("titles a row with parameters by the words before the colon", () => {
    renderCentre(alerts([{ ...fcProfile, msg: "FC parameters differ from the ADOS profile: MAV_GCS_SYSID 255 (want 1)" }]));
    const row = within(screen.getAllByTestId("alert-section")[0]).getByTestId("alert-item");
    expect(within(row).getByTestId("alert-item-text").textContent).toBe("FC parameters differ from the ADOS profile");
    expect(within(row).getByTestId("alert-item-fulltext").textContent).toBe(
      "FC parameters differ from the ADOS profile: MAV_GCS_SYSID 255 (want 1)",
    );
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
