import { describe, expect, it } from "vitest";

import { fcSetupUrls } from "../client";
import { cardState, cardSummary, cardTarget, overviewPrimary, wizardCards, wizardProgress } from "../overview";
import { parseInput, parseStatus, parseWizard } from "../parse";
import { motorOrderMarkup, setupText } from "../strings";
import type { SetupStep, StepState, Wizard, WizardState } from "../types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function step(id: string, state: StepState, extra: Partial<SetupStep> = {}): SetupStep {
  return {
    wizard: "ground",
    step: id,
    title_key: `setup.${id}.title`,
    body_key: `setup.${id}.body`,
    args: {},
    inputs: [],
    params: [],
    image: null,
    state,
    progress: null,
    live: {},
    actions: [],
    blockers: [],
    result: null,
    ...extra,
  };
}

function wizard(state: WizardState, steps: SetupStep[]): Wizard {
  return { id: "ground", state, available: true, blockers: [], completed_at: null, steps };
}

describe("interrupted wizard", () => {
  it("parses the interrupted state and rejects an unknown one", () => {
    expect(parseWizard({ id: "ground", state: "interrupted", steps: [] })?.state).toBe("interrupted");
    const status = parseStatus({ uid: "fc", wizards: [{ id: "ground", state: "interrupted", steps: [] }] });
    expect(status?.wizards[0].state).toBe("interrupted");
    expect(parseWizard({ id: "ground", state: "paused", steps: [] })).toBeNull();
  });

  it("builds the resume route", () => {
    expect(fcSetupUrls.resume("ground")).toBe("/api/v1/fc-setup/ground/resume");
  });
});

describe("overview primary button", () => {
  it("reads Continue for an interrupted or running wizard, Start before any run, Run again after", () => {
    const label = (s: WizardState) => setupText(overviewPrimary(s).label_key);
    expect(overviewPrimary("interrupted").kind).toBe("resume");
    expect(label("interrupted")).toBe("Continue setup");
    expect(overviewPrimary("running").kind).toBe("continue");
    expect(label("running")).toBe("Continue setup");
    expect(overviewPrimary("not_started").kind).toBe("start");
    expect(label("not_started")).toBe("Start setup");
    expect(overviewPrimary("done").kind).toBe("run_again");
    expect(label("done")).toBe("Run again");
    expect(overviewPrimary("failed").kind).toBe("run_again");
    expect(overviewPrimary("aborted").kind).toBe("run_again");
  });
});

describe("component cards", () => {
  it("groups the ground steps into cards in order, hiding detect and unlisted cards", () => {
    const w = wizard("running", [
      step("detect", "done"),
      step("frame", "done"),
      step("accel", "done"),
      step("level", "pending"),
      step("compass", "pending"),
      step("battery", "pending"),
      step("ados_intro", "pending"),
    ]);
    const cards = wizardCards(w);
    expect(cards.map((c) => c.id)).toEqual(["frame", "sensors", "battery", "ados"]);
    expect(cards[1].steps.map((s) => s.step)).toEqual(["accel", "level", "compass"]);
    expect(cards[0].title_key).toBe("setup.card.frame.title");
    expect(wizardProgress(w)).toEqual({ done: 2, total: 6 });
    expect(cardTarget(cards[1]).step).toBe("level");
  });

  it("derives each card state", () => {
    expect(cardState([step("frame", "done")])).toBe("done");
    expect(cardState([step("accel", "done"), step("compass", "failed")])).toBe("attention");
    expect(cardState([step("accel", "pending", { blockers: ["setup.blocker.no_fc"] })])).toBe("attention");
    expect(cardState([step("frame", "waiting_user")])).toBe("in_progress");
    expect(cardState([step("radio", "skipped"), step("rc_ados_switch", "skipped")])).toBe("not_needed");
    expect(cardState([step("battery", "pending")])).toBe("not_set");
    expect(cardState([step("ados_intro", "pending")], true)).toBe("optional");
  });

  it("summarises a card from its finished results", () => {
    const [frame] = wizardCards(wizard("done", [step("frame", "done", { result: { frame_class: 1, frame_type: 1, prop_in: 10 } })]));
    expect(cardSummary(frame)).toBe("Quad · X · 10 in props");
    const [radio] = wizardCards(wizard("done", [step("radio", "skipped")]));
    expect(cardSummary(radio)).toBe("Not needed");
  });
});

describe("frame picture picker input", () => {
  it("parses the images map per option and drops empty keys", () => {
    const input = parseInput("frame_class", {
      kind: "enum",
      value: 1,
      options: [1, 2],
      images: { "1": "motor_order_quad_x", "2": "", "3": 4 },
      label_key: "setup.input.frame_class",
    });
    expect(input?.images).toEqual({ "1": "motor_order_quad_x" });
    expect(parseInput("cells", { kind: "number", value: 4, label_key: "setup.input.cells" })?.images).toEqual({});
  });
});

describe("motor order diagram", () => {
  it("marks the motor under test and nothing for an unknown motor", () => {
    const svg = readFileSync(join(process.cwd(), "src/lib/cockpit-spec/setup-images/motor_order_quad_x.svg"), "utf8");
    const marked = motorOrderMarkup(svg, 2);
    expect(marked).not.toBeNull();
    expect(marked).toContain('r="22" style="fill:var(--color-status-warning');
    expect(motorOrderMarkup(svg, 9)).toBeNull();
  });
});
