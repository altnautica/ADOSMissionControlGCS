"use client";

/**
 * @module aircraft-setup/StepCard
 * @description One flight-controller setup step, drawn generically from the
 * agent's step schema: title and body (spec text keys with the step's args),
 * the pose / motor-order picture, a progress ring, the motor or surface
 * question, operator inputs, the parameters the step will write (each with
 * what it is for), live values, blockers, the result, and the action
 * buttons with their confirm tier (tap, 1.5 s hold, or a hold that reads
 * "Propellers are removed"). The closing `ados_intro` step is the same data in
 * the "Meet ADOS Pilot" layout.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, Gamepad2, Loader2, MinusCircle, Navigation, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";

import { HoldButton } from "@/components/cockpit/v2/HoldButton";
import { inputArgs, liveRows, outputQuestion } from "@/lib/fc-setup/parse";
import { formatValue, hasSetupText, motorOrderMarkup, paramNote, setupImageUrl, setupLabel, setupRefusalText, setupText } from "@/lib/fc-setup/strings";
import { HOLD_CONFIRM_MS, type ActionStyle, type ParamRow, type SetupAction, type SetupStep, type SetupValue, type StepState } from "@/lib/fc-setup/types";
import { cn } from "@/lib/utils";

import { InputField } from "./StepInputs";

/** The step id whose actions render as the "Meet ADOS Pilot" screen. */
export const ADOS_INTRO_STEP = "ados_intro";
/** The intro's choice to fly ADOS Pilot with no RC transmitter; the engine
 *  makes it the primary action when it saw no RC receiver (`rc_present`). */
export const USE_ADOS_NO_RC = "use_ados_no_rc";

const STYLE_CLASS: Record<ActionStyle, string> = {
  primary: "bg-accent-primary text-white hover:bg-accent-primary/90",
  secondary: "border border-border-default text-text-primary hover:bg-bg-tertiary",
  danger: "bg-status-error text-white hover:bg-status-error/90",
};

const BUTTON = "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:opacity-40";

export function StepStateIcon({ state }: { state: StepState }) {
  const cls = "h-4 w-4 shrink-0";
  switch (state) {
    case "done":
      return <CheckCircle2 className={cn(cls, "text-status-success")} aria-hidden />;
    case "failed":
      return <XCircle className={cn(cls, "text-status-error")} aria-hidden />;
    case "running":
      return <Loader2 className={cn(cls, "animate-spin text-accent-primary")} aria-hidden />;
    case "waiting_user":
      return <AlertTriangle className={cn(cls, "text-status-warning")} aria-hidden />;
    case "skipped":
      return <MinusCircle className={cn(cls, "text-text-tertiary")} aria-hidden />;
    default:
      return <CircleDashed className={cn(cls, "text-text-tertiary")} aria-hidden />;
  }
}

export function ProgressRing({ value, size = 56 }: { value: number | null; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const p = value === null ? null : Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="progressbar" aria-valuenow={p === null ? undefined : Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-accent-primary, #3a82ff)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={p === null ? `${c * 0.25} ${c}` : `${c * p} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className={p === null ? "origin-center animate-spin" : undefined}
      />
      {p !== null && (
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-current text-[11px] font-semibold tabular-nums">
          {Math.round(p * 100)}%
        </text>
      )}
    </svg>
  );
}

export function SetupActionButton({
  action,
  step,
  disabled,
  onFire,
  className,
}: {
  action: SetupAction;
  step: SetupStep;
  disabled: boolean;
  onFire: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations("aircraftSetup");
  const label = setupText(action.label_key, step.args);
  if (action.confirm === "none") {
    return (
      <button type="button" disabled={disabled} onClick={() => onFire(action.id)} className={cn(BUTTON, STYLE_CLASS[action.style], className)} data-testid={`setup-action-${action.id}`}>
        {label}
      </button>
    );
  }
  const propsOff = action.confirm === "hold_props_off";
  return (
    <HoldButton
      holdMs={HOLD_CONFIRM_MS}
      onFire={() => onFire(action.id)}
      disabled={disabled}
      title={propsOff ? t("holdTo", { action: label }) : setupText("setup.confirm.hold")}
      className={cn(BUTTON, STYLE_CLASS[action.style], className)}
      data-testid={`setup-action-${action.id}`}
    >
      {propsOff ? setupText("setup.confirm.hold_props_off") : label}
    </HoldButton>
  );
}

export interface StepCardProps {
  step: SetupStep;
  /** A request is in flight: every action waits. */
  busy: boolean;
  error: string | null;
  onAction: (step: SetupStep, actionId: string, args?: Record<string, SetupValue>) => void;
}

/** A step's actions split into the one primary (the first primary-styled
 *  action) and the rest; the outputs step's yes/no answers are both primary. */
function splitActions(step: SetupStep): { primary: SetupAction[]; secondary: SetupAction[] } {
  if (outputQuestion(step)) {
    const answers = step.actions.filter((a) => a.id === "answer_yes" || a.id === "answer_no");
    if (answers.length) return { primary: answers, secondary: step.actions.filter((a) => !answers.includes(a)) };
  }
  const first = step.actions.find((a) => a.style === "primary");
  return { primary: first ? [first] : [], secondary: step.actions.filter((a) => a !== first) };
}

/** The outputs step drives motors: it carries the props-off banner. */
function drivesMotors(step: SetupStep): boolean {
  return step.step === "outputs" && (step.image?.startsWith("motor_order_") === true || step.actions.some((a) => a.confirm === "hold_props_off"));
}

/** The larger primary button of a guided step. */
const PRIMARY_LARGE = "min-h-14 min-w-48 px-6 text-base";

/** One setup step as a guided screen: a large picture (the pose, the frame
 *  layout, or the motor-order diagram with the motor under test marked), a
 *  progress ring, one sentence on what to do now, the outputs question, the
 *  inputs, then one primary action with any others smaller beside it. What
 *  the step writes sits in a closed "What this changes" disclosure. */
export function StepCard({ step, busy, error, onAction }: StepCardProps) {
  const t = useTranslations("aircraftSetup");
  const [edits, setEdits] = useState<Record<string, SetupValue>>({});
  const args = step.inputs.length ? inputArgs(step.inputs, edits) : undefined;
  const fire = (id: string) => onAction(step, id, args);
  const question = outputQuestion(step);
  const motorSvg = useMotorDiagram(question?.kind === "motor" ? step.image : null, question?.index ?? 0);

  if (step.step === ADOS_INTRO_STEP) {
    return <MeetAdosPilot step={step} busy={busy} error={error} onFire={fire} />;
  }

  const title = setupText(step.title_key, step.args);
  // A step whose inputs are a picture picker shows the pictures there only.
  const picker = step.inputs.some((i) => Object.keys(i.images).length > 0);
  const image = motorSvg || picker ? null : setupImageUrl(step.image);
  const live = liveRows(step);
  const showRing = step.progress !== null || step.state === "running";
  const result = step.result ? Object.entries(step.result) : [];
  const { primary, secondary } = splitActions(step);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border-default bg-bg-secondary p-4" data-testid="setup-step-card" data-step={step.step} data-state={step.state}>
      <header className="flex items-start justify-between gap-2">
        <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
        <StepStateBadge state={step.state} />
      </header>

      {(image || motorSvg || showRing) && (
        <div className="flex flex-wrap items-center justify-center gap-6">
          {motorSvg ? (
            <div
              role="img"
              aria-label={title}
              data-testid="setup-motor-diagram"
              className="w-full max-w-md rounded-md bg-black/80 p-2 [&>svg]:h-auto [&>svg]:w-full"
              // The spec's own motor-order picture, with one motor recoloured.
              dangerouslySetInnerHTML={{ __html: motorSvg }}
            />
          ) : (
            image && (
              // The spec draws these as light line art for a dark surface.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt={title} className="max-h-72 w-full max-w-md rounded-md bg-black/80 object-contain p-2" />
            )
          )}
          {showRing && <ProgressRing value={step.progress} size={image || motorSvg ? 112 : 72} />}
        </div>
      )}

      {step.body_key && <p className="whitespace-pre-line text-base text-text-primary">{setupText(step.body_key, step.args)}</p>}

      {question && (
        <p className="rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-lg font-semibold text-text-primary" data-testid="setup-question">
          {setupText(question.question_key, { ...step.args, n: question.index, index: question.index, kind: question.kind })}
        </p>
      )}

      {step.inputs.length > 0 && (
        // Picture pickers two to a row, the number and choice fields three.
        <div className="flex flex-col gap-4">
          {[step.inputs.filter((i) => Object.keys(i.images).length > 0), step.inputs.filter((i) => Object.keys(i.images).length === 0)].map((group, g) =>
            group.length > 0 ? (
              <div key={g} className={cn("grid grid-cols-1 gap-4", g === 0 ? "lg:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>
                {group.map((input) => (
                  <InputField
                    key={input.name}
                    input={input}
                    value={input.name in edits ? edits[input.name] : input.value}
                    onChange={(v) => setEdits((e) => ({ ...e, [input.name]: v }))}
                  />
                ))}
              </div>
            ) : null,
          )}
        </div>
      )}

      {live.length > 0 && <ValueTable title={t("live")} group="live" rows={live} args={step.args} />}

      {step.blockers.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-status-error/40 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {step.blockers.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{setupRefusalText(b, step.args)}</span>
            </li>
          ))}
        </ul>
      )}

      {result.length > 0 && <ValueTable title={t("result")} group="result" rows={result} args={step.args} ok />}

      {error && (
        <p className="text-sm text-status-error" role="alert">
          {error}
        </p>
      )}

      {drivesMotors(step) && step.actions.length > 0 && (
        <p data-testid="setup-props-off" className="flex items-center gap-2 rounded-md border border-status-error/50 bg-status-error/10 px-3 py-2 text-sm font-semibold text-status-error">
          <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden />
          {setupText("setup.overview.props_off")}
        </p>
      )}

      {step.actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {primary.map((a) => (
            <SetupActionButton key={a.id} action={a} step={step} disabled={busy} onFire={fire} className={PRIMARY_LARGE} />
          ))}
          {secondary.map((a) => (
            <SetupActionButton key={a.id} action={a} step={step} disabled={busy} onFire={fire} />
          ))}
        </div>
      )}

      {step.params.length > 0 && <ParamTable step={step.step} rows={step.params} />}
    </section>
  );
}

/** The motor-order picture's markup with motor `n` marked, read from the
 *  bundled file; null until it loads, or when `key` has no motor `n`. */
function useMotorDiagram(key: string | null, n: number): string | null {
  const url = key?.startsWith("motor_order_") ? setupImageUrl(key) : null;
  const [svg, setSvg] = useState<{ url: string; text: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    fetch(url)
      .then((r) => (r.ok ? r.text() : null))
      .then((text) => {
        if (live && text) setSvg({ url, text });
      })
      .catch(() => {
        // The plain picture stays.
      });
    return () => {
      live = false;
    };
  }, [url]);
  return url && svg?.url === url ? motorOrderMarkup(svg.text, n) : null;
}

/** The 1 s confirmation shown over a step that just finished, before the
 *  guided view moves on. */
export function StepDoneBanner({ step }: { step: SetupStep }) {
  return (
    <p role="status" className="flex items-center gap-2 rounded-lg border border-status-success/50 bg-status-success/10 px-4 py-3 text-base font-semibold text-status-success">
      <CheckCircle2 className="h-5 w-5" aria-hidden />
      {setupText("setup.overview.step_done", { title: setupText(step.title_key, step.args) })}
    </p>
  );
}

/** The parameters a step will write, closed under "What this changes", each
 *  with what it is for when the spec says (the obstacle backstop rows). */
function ParamTable({ step, rows }: { step: string; rows: ParamRow[] }) {
  const heading = `setup.${step}.params`;
  return (
    <details className="group rounded-md border border-border-default bg-bg-tertiary/40" data-testid="setup-params">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-text-primary">
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
        {setupText("setup.overview.changes")}
        <span className="font-normal text-text-tertiary">({rows.length})</span>
      </summary>
      <div className="px-3 pb-3">
        {hasSetupText(heading) && <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{setupText(heading)}</h3>}
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
          {rows.map((r) => {
            const note = paramNote(step, r.name);
            return (
              <div key={r.name} className="contents">
                <dt className="min-w-0 text-text-secondary">
                  <span className="font-mono text-text-primary">{r.name}</span>
                  {note && <span className="block text-xs">{note}</span>}
                </dt>
                <dd className="text-right font-mono tabular-nums text-text-primary">{formatValue(r.value)}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </details>
  );
}

function ValueTable({
  title,
  group,
  rows,
  args,
  ok,
}: {
  title: string;
  group: "live" | "result";
  rows: Array<[string, unknown]>;
  args: Record<string, SetupValue>;
  ok?: boolean;
}) {
  return (
    <div className={cn("rounded-md border px-3 py-2", ok ? "border-status-success/40 bg-status-success/5" : "border-border-default bg-bg-tertiary/40")}>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{title}</h3>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate text-text-secondary">{setupLabel(group, k, args)}</dt>
            <dd className="text-right font-mono tabular-nums text-text-primary">{formatValue(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const INTRO_ICONS = [Navigation, ShieldCheck, Gamepad2];

/** The step's state as an icon and its word, in a card header. */
function StepStateBadge({ state }: { state: StepState }) {
  const t = useTranslations("aircraftSetup");
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary">
      <StepStateIcon state={state} />
      {t(`stepState.${state}`)}
    </span>
  );
}

/** The `ados_intro` step: three lines on what ADOS flies, what the FC still
 *  does and how to take over, then the choice, recommended option first.
 *  When the no-RC choice is offered, its line says what stops the drone
 *  without a transmitter. The same layout and order as the agent's own
 *  wizard. */
function MeetAdosPilot({ step, busy, error, onFire }: { step: SetupStep; busy: boolean; error: string | null; onFire: (id: string) => void }) {
  const lines = step.body_key
    ? setupText(step.body_key, step.args)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  const ordered = [...step.actions].sort((a, b) => Number(b.style === "primary") - Number(a.style === "primary"));
  const noRc = step.actions.some((a) => a.id === USE_ADOS_NO_RC);
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-xl border border-accent-primary/40 bg-bg-secondary p-6" data-testid="setup-step-card" data-step={step.step} data-state={step.state}>
      <header className="flex items-start justify-between gap-2">
        <h2 className="text-2xl font-semibold text-text-primary">{setupText(step.title_key, step.args)}</h2>
        <StepStateBadge state={step.state} />
      </header>
      <ol className="flex flex-col gap-3">
        {lines.map((line, i) => {
          const Icon = INTRO_ICONS[i % INTRO_ICONS.length];
          return (
            <li key={line} className="flex items-start gap-3 text-base text-text-primary">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-primary/15 text-accent-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="pt-1.5">{line}</span>
            </li>
          );
        })}
      </ol>
      {noRc && (
        <p className="text-sm text-text-secondary" data-testid="setup-ados-intro-no-rc">
          {setupText("setup.ados_intro.body.no_rc", step.args)}
        </p>
      )}
      {error && (
        <p className="text-sm text-status-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {ordered.map((a) => (
          <SetupActionButton key={a.id} action={a} step={step} disabled={busy} onFire={onFire} className={a.style === "primary" ? "min-h-14 text-base" : undefined} />
        ))}
      </div>
    </section>
  );
}
