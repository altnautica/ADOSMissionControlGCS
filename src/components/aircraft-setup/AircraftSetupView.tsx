"use client";

/**
 * @module aircraft-setup/AircraftSetupView
 * @description Settings › Aircraft setup: the drone agent's ground and air
 * setup wizards for the selected drone. A tab per wizard and the connected
 * flight controller (its id behind Details), and for each wizard an overview
 * (progress, component cards, one primary button: Start, Continue or Run
 * again) with a guided one-step-at-a-time flow behind it that follows the
 * engine while a run is in progress, holds a finished step for a 1 s
 * confirmation, then moves on. A run in progress is the status's top-level
 * `running`, whatever the wizard is filed as. The drone's pilot readiness
 * flags the cards its fixes name. Then the parameter-snapshot revert offer
 * and the setup report.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronRight, CircleStop, Cpu, FileClock } from "lucide-react";

import { HoldButton } from "@/components/cockpit/v2/HoldButton";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import {
  cardTarget,
  firmwareLabel,
  guidedSteps,
  overviewPrimary,
  readinessFlags,
  resultRows,
  runningStep,
  snapshotTime,
} from "@/lib/fc-setup/overview";
import { currentStep } from "@/lib/fc-setup/parse";
import { formatValue, setupLabel, setupText } from "@/lib/fc-setup/strings";
import {
  HOLD_CONFIRM_MS,
  type SetupReport,
  type SetupSnapshot,
  type SetupStatus,
  type SetupStep,
  type Wizard,
  type WizardState,
} from "@/lib/fc-setup/types";
import type { FcSetupController } from "@/lib/fc-setup/use-fc-setup";
import { cn, isDemoMode } from "@/lib/utils";

import { SetupOverview } from "./SetupOverview";
import { ProgressRing, StepCard, StepDoneBanner, StepStateIcon } from "./StepCard";

const BUTTON = "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:opacity-40";

/** The narrowest wizard (px) that gets the side stepper beside the guided
 *  step: a 15 rem stepper plus a step card with room for its pictures and
 *  its fields side by side. Narrower gets the "Step k of n" bar. */
export const STEPPER_MIN_PX = 1000;

/** Whether the element is at least `minPx` wide; false until measured (and
 *  where nothing measures, as in a server render or a test). */
function useWideEnough(minPx: number): [(el: HTMLDivElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setWide(el.clientWidth >= minPx);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, minPx]);
  return [setEl, wide];
}

export function AircraftSetupView({
  setup,
  droneId,
  initialStep,
}: {
  setup: FcSetupController;
  /** The drone the wizards act on; its arm state gates the ground wizard and
   *  its pilot readiness flags the cards. */
  droneId?: string;
  /** A step to open first, in the wizard that has it (a link's `?step=`). */
  initialStep?: string;
}) {
  const t = useTranslations("aircraftSetup");
  const [wizardId, setWizardId] = useState<string | null>(null);
  const [rootRef, wide] = useWideEnough(STEPPER_MIN_PX);
  const { pilot } = usePilotState(droneId);
  const readiness = pilot?.readiness;
  const flags = useMemo(() => readinessFlags(readiness), [readiness]);
  const { status } = setup;

  // Demo mode: the always-on nav bridge that carries the pilot frame (and its
  // readiness) is inert, so run the synthetic feed for this drone, as the Map
  // and Perception tabs do. Never imported outside demo.
  useEffect(() => {
    if (!isDemoMode() || !droneId) return;
    let active = true;
    let stream: { start: (id: string) => void; stop: () => void } | undefined;
    void import("@/mock/mock-detections").then((mod) => {
      if (!active) return;
      stream = mod.mockDetectionStream;
      stream.start(droneId);
    });
    return () => {
      active = false;
      stream?.stop();
    };
  }, [droneId]);

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
    const stepWizard = initialStep ? status.wizards.find((w) => w.steps.some((s) => s.step === initialStep)) : undefined;
    const shown =
      status.wizards.find((w) => w.id === (wizardId ?? stepWizard?.id ?? running)) ??
      status.wizards.find((w) => w.state !== "done" && w.available) ??
      status.wizards[0];
    body = (
      <>
        {/* One row: the wizard tabs, then the connected FC. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div role="tablist" className="flex flex-wrap gap-2">
            {status.wizards.map((w) => (
              <WizardTab key={w.id} wizard={w} running={running === w.id} selected={w.id === shown?.id} onSelect={() => setWizardId(w.id)} />
            ))}
          </div>
          <AircraftSummary status={status} />
        </div>
        {shown && (
          <WizardPanel
            key={shown.id}
            wizard={shown}
            status={status}
            setup={setup}
            droneId={droneId}
            stepper={wide}
            flags={flags}
            initialStep={shown.id === stepWizard?.id ? initialStep : undefined}
          />
        )}
        {status.report && <ReportCard report={status.report} wizards={status.wizards} setup={setup} />}
      </>
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-4" data-testid="aircraft-setup">
      {body}
    </div>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: "err" }) {
  return (
    <div
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        tone === "err" ? "border-status-error/40 bg-status-error/10 text-status-error" : "border-border-default bg-bg-secondary text-text-secondary",
      )}
    >
      {children}
    </div>
  );
}

/** The connected FC in one line (firmware as its project writes it, version,
 *  vehicle), with its id behind a small Details disclosure. */
function AircraftSummary({ status }: { status: SetupStatus }) {
  const t = useTranslations("aircraftSetup");
  const cls = status.vehicle_class ? t(`vehicleClass.${status.vehicle_class}`) : null;
  const parts = [[firmwareLabel(status.firmware), status.firmware_version].filter(Boolean).join(" "), cls].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary" data-testid="setup-fc">
      <Cpu className="h-4 w-4 text-accent-primary" aria-hidden />
      <span className="font-medium text-text-primary">{parts.join(" · ")}</span>
      {status.uid && (
        <details className="group relative">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-xs hover:bg-bg-tertiary">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
            {t("details")}
          </summary>
          <div className="absolute right-0 z-20 mt-1 flex flex-col gap-0.5 rounded-md border border-border-default bg-bg-primary px-3 py-2 shadow-lg">
            <span className="text-xs">{t("fcId")}</span>
            <span className="select-all break-all font-mono text-xs text-text-primary">{status.uid}</span>
          </div>
        </details>
      )}
    </div>
  );
}

function WizardTab({ wizard, running, selected, onSelect }: { wizard: Wizard; running: boolean; selected: boolean; onSelect: () => void }) {
  const t = useTranslations("aircraftSetup");
  // A wizard waiting on the ground wizard reads "After setup", not "Not started".
  const waits = wizard.blockers.some((b) => b === "setup.blocker.ground_not_done" || b === "setup.blocker.ground_required");
  const state: WizardState = running ? "running" : wizard.state;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-12 items-center gap-2 rounded-md border px-4 text-left",
        selected ? "border-accent-primary bg-accent-primary/10" : "border-border-default hover:bg-bg-tertiary",
      )}
      data-testid={`setup-wizard-tab-${wizard.id}`}
    >
      <span className="text-sm font-semibold text-text-primary">{setupText(`setup.wizard.${wizard.id}.title`)}</span>
      <span className="text-xs text-text-secondary">
        {waits && state === "not_started" ? setupText("setup.card.state.after_setup") : t(`wizardState.${state}`)}
      </span>
    </button>
  );
}

/** An inline confirmation for a request that throws work away (Run again,
 *  Abort): what it does, then a hold-to-confirm button and Cancel. Escape
 *  cancels. */
function ConfirmPanel({
  title,
  body,
  confirmLabel,
  disabled,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("aircraftSetup");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.focus();
  }, []);
  return (
    <div
      ref={root}
      role="alertdialog"
      aria-label={title}
      tabIndex={-1}
      data-testid="setup-confirm"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      className="flex flex-col gap-2 rounded-lg border-2 border-status-warning/60 bg-bg-secondary p-4 outline-none"
    >
      <p className="text-base font-semibold text-text-primary">{title}</p>
      <p className="text-sm text-text-secondary">{body}</p>
      <div className="flex flex-wrap items-center gap-3">
        <HoldButton
          holdMs={HOLD_CONFIRM_MS}
          disabled={disabled}
          title={setupText("setup.confirm.hold")}
          onFire={onConfirm}
          className={cn(BUTTON, "bg-status-error text-white")}
          data-testid="setup-confirm-hold"
        >
          {confirmLabel}
        </HoldButton>
        <button type="button" onClick={onCancel} className={cn(BUTTON, "border border-border-default text-text-primary hover:bg-bg-tertiary")}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

/** How long a finished step stays on screen before the guided view moves on. */
const STEP_DONE_MS = 1000;

/** What the panel shows: the overview, the guided flow following the
 *  engine, or one step opened on its own. */
type Mode = { kind: "overview" } | { kind: "guided" } | { kind: "step"; id: string };

function WizardPanel({
  wizard,
  status,
  setup,
  droneId,
  stepper,
  flags,
  initialStep,
}: {
  wizard: Wizard;
  status: SetupStatus;
  setup: FcSetupController;
  droneId?: string;
  stepper: boolean;
  flags: ReadonlyMap<string, string>;
  initialStep?: string;
}) {
  const t = useTranslations("aircraftSetup");
  // The engine refuses the ground wizard's calibrations while armed; say so up
  // front, like the calibration panels, instead of offering a Start it refuses.
  const { isArmed, isHardBlocked, hardBlockMessage } = useArmedLock(droneId);
  const armedLocked = wizard.id === "ground" && isHardBlocked;
  // An unknown arm state reads as the calibration panels word it, not "Disarm first".
  const armedNote = isArmed ? setupText("setup.err.armed") : hardBlockMessage;
  // The armed note already says it; do not repeat the engine's blocker.
  const blockers = armedLocked ? wizard.blockers.filter((b) => b !== "setup.blocker.armed") : wizard.blockers;
  // A run of this wizard: a whole run, or one step run on its own after the
  // wizard was filed done or aborted (`single`), which its state does not show.
  const runStep = runningStep(status, wizard);
  const isRunning = wizard.state === "running" || runStep !== null;
  const single = runStep !== null && wizard.state !== "running";
  const current = runStep ?? (wizard.state === "running" ? (currentStep(wizard)?.step ?? null) : null);
  const [mode, setMode] = useState<Mode>(() => (initialStep ? { kind: "step", id: initialStep } : { kind: "overview" }));
  const [confirm, setConfirm] = useState<"run_again" | "abort" | null>(null);
  const toOverview = useCallback(() => setMode({ kind: "overview" }), []);
  const busy = setup.busy !== null;
  const snapshots = status.report?.snapshots ?? [];
  const snapshot = snapshots[snapshots.length - 1] ?? null;

  // The run in progress follows the engine; any other step opens to read.
  const modeFor = (id: string): Mode => (id === current && !single ? { kind: "guided" } : { kind: "step", id });

  const start = () => void setup.start(wizard.id).then((ok) => ok && setMode({ kind: "guided" }));
  const abort = () => void setup.abort(wizard.id);

  const onPrimary = () => {
    const primary = overviewPrimary(wizard.state, isRunning);
    if (primary.kind === "continue") setMode(current ? modeFor(current) : { kind: "guided" });
    else if (primary.kind === "run_again") setConfirm("run_again");
    else if (primary.kind === "resume") void setup.resume(wizard.id).then((ok) => ok && setMode({ kind: "guided" }));
    else start();
  };

  // Abort asks first; in the air (flight tuning) an abort lands the aircraft,
  // so it never waits on a confirm there.
  const askAbort = () => (wizard.id === "air" ? abort() : setConfirm("abort"));

  // While a run is in progress a step opens to read; otherwise it runs on its
  // own once the engine takes it.
  const openStep = (step: SetupStep) => {
    if (isRunning) {
      setMode(modeFor(step.step));
      return;
    }
    void setup.runStep(step.wizard, step.step).then((ok) => ok && setMode({ kind: "step", id: step.step }));
  };

  const confirmPanel =
    confirm === "run_again" ? (
      <ConfirmPanel
        title={t("confirmRunAgain.title")}
        body={t("confirmRunAgain.body")}
        confirmLabel={t("confirmRunAgain.confirm")}
        disabled={busy}
        onConfirm={() => {
          setConfirm(null);
          start();
        }}
        onCancel={() => setConfirm(null)}
      />
    ) : confirm === "abort" && isRunning ? (
      <ConfirmPanel
        title={t("confirmAbort.title")}
        body={t("confirmAbort.body")}
        confirmLabel={t("confirmAbort.confirm")}
        disabled={busy}
        onConfirm={() => {
          setConfirm(null);
          abort();
        }}
        onCancel={() => setConfirm(null)}
      />
    ) : null;

  if (mode.kind !== "overview") {
    return (
      <div className="flex flex-col gap-4">
        {confirmPanel}
        <GuidedView
          key={mode.kind === "step" ? mode.id : "guided"}
          wizard={wizard}
          setup={setup}
          stepId={mode.kind === "step" ? mode.id : null}
          stepper={stepper}
          isRunning={isRunning}
          locked={armedLocked}
          onBack={toOverview}
          onPick={openStep}
          onAbort={confirm === null ? askAbort : null}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {confirmPanel}
      {setup.requestError && <Note tone="err">{setup.requestError}</Note>}
      <SetupOverview
        wizard={wizard}
        busy={busy}
        running={isRunning}
        flags={flags}
        lockNote={armedLocked ? armedNote : null}
        blockers={blockers}
        onPrimary={onPrimary}
        onCard={(card) => openStep(cardTarget(card, flags))}
      />
      {isRunning && confirm === null && (
        <div>
          <button type="button" disabled={busy} onClick={askAbort} className={cn(BUTTON, "bg-status-error text-white")} data-testid="setup-abort">
            <CircleStop className="h-4 w-4" aria-hidden />
            {setupText("setup.action.abort")}
          </button>
        </div>
      )}
      {wizard.state === "done" && !isRunning && snapshot && <RevertOffer snapshot={snapshot} setup={setup} />}
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

/** One step at a time: a stepper beside it when the wizard is wide enough,
 *  else a "Step k of n" bar above it; the step card, and the 1 s done
 *  confirmation before moving on. */
function GuidedView({
  wizard,
  setup,
  stepId,
  stepper,
  isRunning,
  locked,
  onBack,
  onPick,
  onAbort,
}: {
  wizard: Wizard;
  setup: FcSetupController;
  /** One step opened on its own; null follows the engine's current step. */
  stepId: string | null;
  stepper: boolean;
  /** A run of this wizard is in progress. */
  isRunning: boolean;
  locked: boolean;
  onBack: () => void;
  onPick: (step: SetupStep) => void;
  /** Ask to abort the run; null while the confirm is already showing. */
  onAbort: (() => void) | null;
}) {
  const t = useTranslations("aircraftSetup");
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
  // so its pictures, fields and action fit a laptop screen.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: "start" });
  }, []);

  return (
    <div ref={rootRef} className="flex scroll-mt-2 flex-col gap-3" data-testid="setup-guided">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className={cn(BUTTON, "border border-border-default text-text-primary hover:bg-bg-tertiary")} data-testid="setup-back">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {setupText("setup.overview.back")}
        </button>
        {/* The "Step k of n" bar when there is no stepper beside the step. */}
        {index >= 0 && !stepper ? (
          <div className="flex min-w-40 flex-1 flex-col gap-1" data-testid="setup-step-bar">
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
        {isRunning && onAbort && (
          <button type="button" disabled={busy} onClick={onAbort} className={cn(BUTTON, "bg-status-error text-white")} data-testid="setup-abort">
            <CircleStop className="h-4 w-4" aria-hidden />
            {setupText("setup.action.abort")}
          </button>
        )}
      </div>

      <div className={stepper ? "grid grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)] items-start gap-4" : "flex flex-col gap-4"}>
        {stepper && (
          <ol aria-label={t("steps")} className="flex flex-col gap-1" data-testid="setup-stepper">
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
                    <StepStateIcon step={s} />
                    <span className="min-w-0 flex-1 truncate">{setupText(s.title_key, s.args)}</span>
                    {s.state === "running" && s.progress !== null && <ProgressRing value={s.progress} size={28} />}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
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

/** A snapshot as the operator reads it: its date and time, else its name. */
function snapshotDate(s: SetupSnapshot): string {
  return snapshotTime(s.ts) ?? snapshotTime(s.file) ?? s.file;
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
  const steps = Object.entries(report.steps)
    .map(([id, values]): [string, Array<[string, unknown]>] => [id, resultRows(values)])
    .filter(([, rows]) => rows.length > 0);
  const meta: Array<[string, string | null]> = [
    [t("report.date"), report.date ? new Date(report.date).toLocaleString() : null],
    [t("report.firmware"), [firmwareLabel(report.firmware), report.firmware_version].filter(Boolean).join(" ") || null],
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
            {steps.map(([stepId, rows]) => (
              <div key={stepId} className="rounded-md border border-border-default bg-bg-tertiary/40 px-3 py-2">
                <h4 className="mb-1 text-sm font-semibold text-text-primary">{titles[stepId] ?? stepId}</h4>
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-xs">
                  {rows.map(([k, v]) => (
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
                <span className="text-text-secondary" title={s.file}>
                  {snapshotDate(s)}
                </span>
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
