/**
 * @license GPL-3.0-only
 *
 * The top bar's goal chip: the goal the flying skill sent the pilot and, for
 * a follow intent, the viewpoint the pilot picked; the demo follow flies an
 * intent.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { GoalKindChip } from "@/components/cockpit/flight/GoalKindChip";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { DEMO_FOLLOW_GOAL, demoPilotWire } from "@/mock/mock-pilot-wire";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "goal-kind-test";

function mount(wire: Record<string, unknown>) {
  const pilot = parsePilotState(wire);
  if (!pilot) throw new Error("pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, pilot);
  return render(<GoalKindChip droneId={DRONE} />);
}

afterEach(() => {
  cleanup();
});

describe("GoalKindChip", () => {
  it("shows the demo follow's intent and the viewpoint the pilot picked", () => {
    mount(demoPilotWire({ owner: "skill", ...DEMO_FOLLOW_GOAL }));
    const chip = screen.getByTestId("goal-kind-chip");
    expect(chip.textContent).toBe("Follow intent · view 15° 8 m");
    expect(chip.getAttribute("data-kind")).toBe("follow_intent");
  });

  it("names the skill's own goals in the spec's words", () => {
    const cases: [string, string][] = [
      ["follow", "Ring"],
      ["orbit", "Orbit"],
      ["position", "Position"],
      ["vantage", "Vantage"],
    ];
    for (const [kind, text] of cases) {
      const view = mount(demoPilotWire({ owner: "skill", goal_kind: kind }));
      expect(screen.getByTestId("goal-kind-chip").textContent).toBe(text);
      view.unmount();
    }
  });

  it("shows nothing while no skill goal is reported", () => {
    mount(demoPilotWire());
    expect(screen.queryByTestId("goal-kind-chip")).toBeNull();
  });

  it("hides once the pilot state is stale", () => {
    const pilot = parsePilotState(demoPilotWire({ owner: "skill", ...DEMO_FOLLOW_GOAL }));
    if (!pilot) throw new Error("pilot wire did not parse");
    useNavStreamStore.getState().setPilot(DRONE, pilot, Date.now() - 5_000);
    render(<GoalKindChip droneId={DRONE} />);
    expect(screen.queryByTestId("goal-kind-chip")).toBeNull();
  });
});
