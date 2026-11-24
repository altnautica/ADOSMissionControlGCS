"use client";

/**
 * @module aircraft-setup/AircraftSetupView
 * @description Settings › Aircraft setup: the drone agent's ground and air
 * setup wizards for the selected drone. The aircraft summary, a tab per
 * wizard, and for each an overview (progress, component cards, one primary
 * button: Start, Continue or Run again) with a guided one-step-at-a-time
 * flow behind it that follows the engine while a wizard runs, holds a
 * finished step for a 1 s confirmation, then moves on. Then the
 * parameter-snapshot revert offer and the setup report.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronRight, CircleStop, Cpu, FileClock } from "lucide-react";

import { HoldButton } from "@/components/cockpit/v2/HoldButton";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { cardTarget, guidedSteps, overviewPrimary } from "@/lib/fc-setup/overview";
import { currentStep } from "@/lib/fc-setup/parse";
import { formatValue, setupLabel, setupText } from "@/lib/fc-setup/strings";
import { HOLD_CONFIRM_MS, type SetupReport, type SetupSnapshot, type SetupStatus, type SetupStep, type Wizard } from "@/lib/fc-setup/types";
import type { FcSetupController } from "@/lib/fc-setup/use-fc-setup";
import { cn } from "@/lib/utils";

import { SetupOverview } from "./SetupOverview";
import { ProgressRing, StepCard, StepDoneBanner, StepStateIcon } from "./StepCard";

const BUTTON = "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:opacity-40";

export function AircraftSetupView({ setup, droneId }: { setup: FcSetupController; /** The drone the wizards act on; its arm state gates the ground wizard. */ droneId?: string }) {
  const t = useTranslations("aircraftSetup");
  const [wizardId, setWizardId] = useState<string | null>(null);
  const { status } = setup;

  let body: ReactNode;
  if (!status) {
    body = setup.loading ? (
      <Note>{t("loading")}</Note>
    ) : (
      <Note tone="err">
        {t("loadError", { error: setup.loadError ?? "" })}{" "}
        <button type="button" onClick={() => void setup.refresh()} className="underline">
          {t("retry")}
        </button>
      </Note>
    );
  } else if (!status.uid) {
    body = <Note>{t("noFc")}</Note>;
  } else {
    const running = status.running?.wizard;
    const shown =
      status.wizards.find((w) => w.id === (wizardId ?? running)) ??
      status.wizards.find((w) => w.state !== "done" && w.available) ??
      status.wizards[0];
    body = (
      <>
        <AircraftSummary status={status} />
        <div role="tablist" className="flex flex-wrap gap-2">
          {status.wizards.map((w) => (
            <button
              key={w.id}
              type="button"
              role="tab"
              aria-selected={w.id === shown?.id}
              onClick={() => setWizardId(w.id)}
              className={cn(
                "flex min-h-12 items-center gap-2 rounded-md border px-4 text-left",
                w.id === shown?.id ? "border-accent-primary bg-accent-primary/10" : "border-border-default hover:bg-bg-tertiary",
              )}
              data-testid={`setup-wizard-tab-${w.id}`}
            >
              <span className="text-sm font-semibold text-text-primary">{setupText(`setup.wizard.${w.id}.title`)}</span>
              <span className="text-xs text-text-secondary">{t(`wizardState.${w.state}`)}</span>
            </button>
          ))}
        </div>
        {shown && <WizardPanel key={shown.id} wizard={shown} status={status} setup={setup} droneId={droneId} />}
        {status.report && <ReportCard report={status.report} wizards={status.wizards} setup={setup} />}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="aircraft-setup">
      {body}
    </div>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: "err" }) {
  return (
    <p
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        tone === "err" ? "border-status-error/40 bg-status-error/10 text-status-error" : "border-border-default bg-bg-secondary text-text-secondary",
      )}
    >
      {children}
    </p>
  );
}

function AircraftSummary({ status }: { status: SetupStatus }) {
  const t = useTranslations("aircraftSetup");
  const cls = status.vehicle_class ? t(`vehicleClass.${status.vehicle_class}`) : null;
  const parts = [[status.firmware, status.firmware_version].filter(Boolean).join(" "), cls].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
      <Cpu className="h-4 w-4 text-accent-primary" aria-hidden />
      <span className="font-medium text-text-primary">{parts.join(" · ")}</span>
      <span className="font-mono text-xs">{status.uid}</span>
    </div>
  );
}

/** How long a finished step stays on screen before the guided view moves on. */
const STEP_DONE_MS = 1000;

/** What the panel shows: the overview, the guided flow following the
 *  engine, or one step opened on its own. */
type Mode = { kind: "overview" } | { kind: "guided" } | { kind: "step"; id: string };

function WizardPanel({ wizard, status, setup, droneId }: { wizard: Wizard; status: SetupStatus; setup: FcSetupController; droneId?: string }) {
  // The engine refuses the ground wizard's calibrations while armed; say so up
  // front, like the calibration panels, instead of offering a Start it refuses.
  const { isArmed, isHardBlocked, hardBlockMessage } = useArmedLock(droneId);
  const armedLocked = wizard.id === "ground" && isHardBlocked;
  // An unknown arm state reads as the calibration panels word it, not "Disarm first".
  const armedNote = isArmed ? setupText("setup.err.armed") : hardBlockMessage;
  // The armed note already says it; do not repeat the engine's blocker.
  const blockers = armedLocked ? wizard.blockers.filter((b) => b !== "setup.blocker.armed") : wizard.blockers;
  const isRunning = wizard.state === "running";
  const [mode, setMode] = useState<Mode>({ kind: "overview" });
  const toOverview = useCallback(() => setMode({ kind: "overview" }), []);
  const busy = setup.busy !== null;
  const snapshots = status.report?.snapshots ?? [];
  const snapshot = snapshots[snapshots.length - 1] ?? null;

  const onPrimary = () => {
    const primary = overviewPrimary(wizard.state);
    if (primary.kind === "continue") {
      setMode({ kind: "guided" });
      return;
    }
    const request = primary.kind === "resume" ? setup.resume(wizard.id) : setup.start(wizard.id);
    void request.then((ok) => ok && setMode({ kind: "guided" }));
  };

  // A running wizard opens its current step (or another one to read);
  // otherwise a step runs on its own once the engine takes it.
  const openStep = (step: SetupStep) => {
    if (isRunning) {
      setMode(currentStep(wizard)?.step === step.step ? { kind: "guided" } : { kind: "step", id: step.step });
      return;
    }
    void setup.runStep(step.wizard, step.step).then((ok) => ok && setMode({ kind: "step", id: step.step }));
  };

  if (mode.kind !== "overview") {
    return (
      <GuidedView
        key={mode.kind === "step" ? mode.id : "guided"}
        wizard={wizard}
        setup={setup}
        stepId={mode.kind === "step" ? mode.id : null}
        locked={armedLocked}
        onBack={toOverview}
        onPick={openStep}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {setup.requestError && <Note tone="err">{setup.requestError}</Note>}
      <SetupOverview
        wizard={wizard}
        busy={busy}
        lockNote={armedLocked ? armedNote : null}
        blockers={blockers}
        onPrimary={onPrimary}
        onCard={(card) => openStep(cardTarget(card))}
      />
      {isRunning && (
        <div>
          <button type="button" disabled={busy} onClick={() => void setup.abort(wizard.id)} className={cn(BUTTON, "bg-status-error text-white")} data-testid="setup-abort">
            <CircleStop className="h-4 w-4" aria-hidden />
            {setupText("setup.action.abort")}
          </button>
        </div>
      )}
      {wizard.state === "done" && snapshot && <RevertOffer snapshot={snapshot} setup={setup} />}
    </div>
  );
}

/** The step to show: `wanted`, except that a step which just finished stays
 *  for {@link STEP_DONE_MS} (with `justDone`) before the view moves on. */
function useAdvance(wizard: Wizard, wanted: SetupStep | null): { step: SetupStep | null; justDone: boolean } {
  const wantedId = wanted?.step ?? null;
  const [shownId, setShownId] = useState<string | null>(wantedId);
  const shown = shownId ? (wizard.steps.find((s) => s.step === shownId) ?? null) : null;
  const holding = shownId !== wantedId && shown?.state === "done";
  if (!holding && shownId !== wantedId) setShownId(wantedId);
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setShownId(wantedId), STEP_DONE_MS);
    return () => clearTimeout(timer);
  }, [holding, wantedId]);
  return holding ? { step: shown, justDone: true } : { step: wanted, justDone: false };
}

/** One step at a time: "Step k of n" with a stepper beside it on a wide
 *  screen, the step card, and the 1 s done confirmation before moving on. */
function GuidedView({
  wizard,
  setup,
  stepId,
  locked,
  onBack,
  onPick,
}: {
  wizard: Wizard;
  setup: FcSetupController;
  /** One step opened on its own; null follows the engine's current step. */
  stepId: string | null;
  locked: boolean;
  onBack: () => void;
  onPick: (step: SetupStep) => void;
}) {
  const t = useTranslations("aircraftSetup");
  const isRunning = wizard.state === "running";
  const busy = setup.busy !== null;
  const steps = guidedSteps(wizard);
  const wanted = stepId === null ? currentStep(wizard) : (wizard.steps.find((s) => s.step === stepId) ?? null);
  const { step, justDone } = useAdvance(wizard, wanted);

  // Back to the overview 1 s after the shown step finishes for good: a step
  // run on its own, or the last step of a run. Only once it was seen active,
  // so opening a finished step to read it does not bounce.
  const finished = step !== null && (step.state === "done" || step.state === "skipped");
  const final = finished && !justDone && (stepId !== null || !isRunning);
  const sawActive = useRef(false);
  useEffect(() => {
    if (step && !finished) sawActive.current = true;
  }, [step, finished]);
  useEffect(() => {
    if (!final || !sawActive.current) return;
    const timer = setTimeout(onBack, STEP_DONE_MS);
    return () => clearTimeout(timer);
  }, [final, onBack]);

  const index = step ? steps.findIndex((s) => s.step === step.step) : -1;
  // Bring the step to the top of the page, under the drone picker and tabs,
  // so its one action fits a laptop screen.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: "start" });
  }, []);

  return (
    <div ref={rootRef} className="flex scroll-mt-2 flex-col gap-4" data-testid="setup-guided">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className={cn(BUTTON, "border border-border-default text-text-primary hover:bg-bg-tertiary")} data-testid="setup-back">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {setupText("setup.overview.back")}
        </button>
        {index >= 0 ? (
          <div className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-sm font-semibold tabular-nums text-text-primary" data-testid="setup-step-of">
              {setupText("setup.overview.step_of", { k: index + 1, n: steps.length })}
            </span>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
              <div className="h-full rounded-full bg-accent-primary" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
            </div>
          </div>
        ) : (
          <span className="flex-1" />
        )}
        {isRunning && (
          <button type="button" disabled={busy} onClick={() => void setup.abort(wizard.id)} className={cn(BUTTON, "bg-status-error text-white")} data-testid="setup-abort">
            <CircleStop className="h-4 w-4" aria-hidden />
            {setupText("setup.action.abort")}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)]">
        <ol aria-label={t("steps")} className="hidden flex-col gap-1 lg:flex">
          {steps.map((s) => {
            const active = s.step === step?.step;
            return (
              <li key={s.step}>
                <button
                  type="button"
                  disabled={busy || (locked && !isRunning)}
                  aria-current={active ? "step" : undefined}
                  onClick={() => onPick(s)}
                  className={cn(
                    "flex min-h-12 w-full min-w-0 items-center gap-2 rounded-md px-3 text-left text-sm disabled:opacity-60",
                    active ? "bg-accent-primary/15 font-semibold text-text-primary" : "text-text-secondary hover:bg-bg-tertiary",
                  )}
                  data-testid={`setup-step-${s.step}`}
                >
                  <StepStateIcon state={s.state} />
                  <span className="min-w-0 flex-1 truncate">{setupText(s.title_key, s.args)}</span>
                  {s.state === "running" && s.progress !== null && <ProgressRing value={s.progress} size={28} />}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="flex min-w-0 flex-col gap-4">
          {step && (justDone || final) && step.state === "done" && <StepDoneBanner step={step} />}
          {step && (
            <StepCard
              key={`${step.wizard}/${step.step}`}
              step={step}
              busy={busy}
              error={setup.requestError}
              onAction={(s, id, args) => void setup.action(s, id, args)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function snapshotDate(s: SetupSnapshot): string {
  const d = new Date(s.ts);
  return Number.isNaN(d.getTime()) ? s.file : d.toLocaleString();
}

function RevertButton({ snapshot, setup, onRestored }: { snapshot: SetupSnapshot; setup: FcSetupController; onRestored: (n: number | null) => void }) {
  return (
    <HoldButton
      holdMs={HOLD_CONFIRM_MS}
      disabled={setup.busy !== null}
      title={setupText("setup.confirm.hold")}
      onFire={() => void setup.revert(snapshot.file).then(onRestored)}
      className={cn(BUTTON, "border border-border-default text-text-primary")}
    >
      {setupText("setup.action.revert")}
    </HoldButton>
  );
}

function RevertOffer({ snapshot, setup }: { snapshot: SetupSnapshot; setup: FcSetupController }) {
  const t = useTranslations("aircraftSetup");
  const [restored, setRestored] = useState<number | null>(null);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-default bg-bg-secondary p-4">
      <h3 className="flex items-center gap-2 text-base font-semibold text-text-primary">
        <FileClock className="h-4 w-4 text-accent-primary" aria-hidden />
        {setupText("setup.wizard.revert.title")}
      </h3>
      <p className="text-sm text-text-secondary">{setupText("setup.wizard.revert.body", { date: snapshotDate(snapshot) })}</p>
      {restored !== null && <p className="text-sm text-status-success">{t("reverted", { count: restored })}</p>}
      <div>
        <RevertButton snapshot={snapshot} setup={setup} onRestored={setRestored} />
      </div>
    </section>
  );
}

function ReportCard({ report, wizards, setup }: { report: SetupReport; wizards: Wizard[]; setup: FcSetupController }) {
  const t = useTranslations("aircraftSetup");
  const [restored, setRestored] = useState<number | null>(null);
  const titles: Record<string, string> = {};
  for (const w of wizards) for (const s of w.steps) titles[s.step] = setupText(s.title_key, s.args);
  const steps = Object.entries(report.steps);
  const meta: Array<[string, string | null]> = [
    [t("report.date"), report.date ? new Date(report.date).toLocaleString() : null],
    [t("report.firmware"), [report.firmware, report.firmware_version].filter(Boolean).join(" ") || null],
    [t("report.vehicle"), report.vehicle_class ? t(`vehicleClass.${report.vehicle_class}`) : null],
  ];
  return (
    <details className="group rounded-lg border border-border-default bg-bg-secondary" data-testid="setup-report">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-base font-semibold text-text-primary">
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
        {setupText("setup.wizard.report.title")}
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-sm">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-secondary">{k}</dt>
              <dd className="text-text-primary">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
        {steps.length > 0 ? (
          <div className="flex flex-col gap-2">
            {steps.map(([stepId, values]) => (
              <div key={stepId} className="rounded-md border border-border-default bg-bg-tertiary/40 px-3 py-2">
                <h4 className="mb-1 text-sm font-semibold text-text-primary">{titles[stepId] ?? stepId}</h4>
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-xs">
                  {Object.entries(values).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="truncate text-text-secondary">{setupLabel("result", k)}</dt>
                      <dd className="text-right font-mono tabular-nums text-text-primary">{formatValue(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">{t("report.noSteps")}</p>
        )}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-text-primary">{t("report.snapshots")}</h4>
          {restored !== null && <p className="text-sm text-status-success">{t("reverted", { count: restored })}</p>}
          {report.snapshots.length > 0 ? (
            report.snapshots.map((s) => (
              <div key={s.file} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-mono text-text-secondary">{s.file}</span>
                <RevertButton snapshot={s} setup={setup} onRestored={setRestored} />
              </div>
            ))
          ) : (
            <p className="text-sm text-text-secondary">{t("report.noSnapshots")}</p>
          )}
        </div>
      </div>
    </details>
  );
}
