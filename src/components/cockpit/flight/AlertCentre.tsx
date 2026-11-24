"use client";

/**
 * @module cockpit/flight/AlertCentre
 * @description The alert centre the status pill opens, as the agent cockpit
 * draws it: a header with the counts by severity and the hidden toggle, one
 * collapsible section per alert group (`alert-groups.json`), and one row per
 * alert. A row reads the same way on every surface: severity glyph, a
 * one-line title, its source; the parameter rows behind it as a table (name,
 * current, wanted); then at most two actions, the fix first and Hide (a
 * warning) or Collapse (a critical) second. Where a fix goes on Mission
 * Control is the caller's ({@link AlertActions}).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { specString } from "@/lib/cockpit/spec-strings";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { rerunStep, runStepAction, setupErrorKey, type SetupTransport } from "@/lib/fc-setup/client";
import { formatValue, setupText } from "@/lib/fc-setup/strings";
import { HOLD_CONFIRM_MS, type SetupStep } from "@/lib/fc-setup/types";
import { findStep, useFcSetup } from "@/lib/fc-setup/use-fc-setup";
import { groupAlerts, unsnoozedAlerts, type GroupedAlert, type ParamDiff, type PillAlert } from "@/lib/hud/status-pill";
import { HoldButton } from "../v2/HoldButton";
import { alertText } from "./alert-text";

type Severity = PillAlert["severity"];

/** The setup wizard step "Apply recommended values" runs and writes. */
export const APPLY_PROFILE_STEP = { wizard: "ground", step: "ados_profile" } as const;

/** Where a fix navigates: the page, and what to set up before going there. */
export interface FixLink {
  href: string;
  onFollow?: () => void;
}

/** Where a row's fix action goes on this surface. */
export interface AlertActions {
  /** The selected drone's setup engine; null when it has none reachable. */
  transport: SetupTransport | null;
  /** Aircraft setup (at `step` when given); null when the drone has no setup
   *  engine (a ground station, no agent): setup fixes then read as a hint
   *  naming where to fix them, with no button. */
  setup: ((step?: string) => FixLink) | null;
  /** A settings section by its cockpit id (`sensors`, `vision`). */
  settings: (section: string) => FixLink;
  /** The parameter editor at these names. */
  parameters: (names: string[]) => FixLink;
  /** The surface's own action for an alert that carries no agent fix. */
  extra?: (a: PillAlert) => ReactNode;
}

const DOT: Record<Severity, string> = { critical: "var(--fs-crit)", warning: "var(--fs-warn)" };
const BTN = "fs-hit min-h-[48px] rounded px-3 text-xs";
const BTN_SECONDARY = `${BTN} border border-white/15 bg-white/10 hover:bg-white/15`;
const BTN_PRIMARY = `${BTN} border border-white/20 bg-white/20 font-semibold hover:bg-white/25`;
const DIM = "opacity-70";

/** A fix that navigates: a link styled as a button. */
function FixLinkButton({ to, primary, testId, children }: { to: FixLink; primary?: boolean; testId?: string; children: ReactNode }) {
  return (
    <Link
      href={to.href}
      onClick={to.onFollow}
      className={`${primary ? BTN_PRIMARY : BTN_SECONDARY} inline-flex items-center`}
      data-testid={testId}
    >
      {children}
    </Link>
  );
}

/** The parameter rows of an alert: name (monospace), current, wanted. Past
 *  six rows the rest wait behind "Show all N". */
export function ParamTable({ params }: { params: readonly ParamDiff[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? params : params.slice(0, 6);
  return (
    <div data-testid="alert-params">
      <table className="w-full border-collapse text-[11px] tabular-nums">
        <thead className="sr-only">
          <tr>
            <th>{alertText("param.name")}</th>
            <th>{alertText("param.current")}</th>
            <th aria-hidden />
            <th>{alertText("param.wanted")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => (
            <tr key={p.name} data-testid="alert-param-row" className="border-t border-white/10">
              <td className="py-[3px] pr-2 font-mono">{p.name}</td>
              <td className={`py-[3px] pr-1 text-right ${p.have === null ? DIM : ""}`}>
                {p.have === null ? alertText("param.notReported") : formatValue(p.have)}
              </td>
              <td aria-hidden className={`px-1 ${DIM}`}>
                →
              </td>
              <td className="py-[3px] font-semibold">{p.want}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {params.length > 6 ? (
        <button type="button" onClick={() => setAll(!all)} className="fs-hit min-h-[48px] px-1 text-xs underline" data-testid="alert-params-more">
          {all ? alertText("param.showFewer") : alertText("param.showAll", { count: params.length })}
        </button>
      ) : null}
    </div>
  );
}

type ApplyPhase =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "review"; step: SetupStep }
  | { phase: "writing" }
  | { phase: "done" }
  | { phase: "error"; text: string };

function errorText(err: unknown): string {
  const key = setupErrorKey(err);
  if (!key) return err instanceof Error ? err.message : String(err);
  // The engine answers some refusals with a bare blocker name (`armed`).
  return setupText(key.includes(".") ? key : `setup.blocker.${key}`);
}

/** The step's own failure text, else the generic one. */
function stepFailure(step: SetupStep): string {
  return step.blockers.length > 0 ? setupText(step.blockers[0]) : alertText("apply.failed");
}

/** "Apply recommended values": run the ground wizard's ADOS profile step
 *  (it writes nothing yet and lists what it would write), show those values,
 *  and write them on a hold. The engine refuses while armed and snapshots
 *  every parameter before the first write. */
export function ApplyProfileFix({ transport, setup }: { transport: SetupTransport; setup: (step?: string) => FixLink }) {
  const [s, setS] = useState<ApplyPhase>({ phase: "idle" });
  const { wizard, step: stepId } = APPLY_PROFILE_STEP;
  const read = () => {
    setS({ phase: "reading" });
    rerunStep(transport, wizard, stepId).then(
      (step) => setS(step.state === "failed" ? { phase: "error", text: stepFailure(step) } : { phase: "review", step }),
      (err: unknown) => setS({ phase: "error", text: errorText(err) }),
    );
  };
  const write = (actionId: string) => {
    setS({ phase: "writing" });
    runStepAction(transport, wizard, stepId, actionId).then(
      (next) =>
        setS(next.state === "done" ? { phase: "done" } : next.state === "failed" ? { phase: "error", text: stepFailure(next) } : { phase: "writing" }),
      (err: unknown) => setS({ phase: "error", text: errorText(err) }),
    );
  };
  switch (s.phase) {
    case "idle":
      return (
        <button type="button" onClick={read} className={BTN_PRIMARY} data-testid="alert-fix-apply">
          {alertText("action.apply")}
        </button>
      );
    case "reading":
      return (
        <span className={`flex items-center gap-1.5 text-xs ${DIM}`} role="status">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {alertText("apply.reading")}
        </span>
      );
    case "review": {
      const action = s.step.actions.find((a) => a.style === "primary") ?? s.step.actions[0];
      return (
        <div className="flex w-full flex-col gap-1.5" data-testid="alert-apply-review">
          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{alertText("apply.writes")}</div>
          <ul className="flex flex-col text-[11px] tabular-nums" data-testid="alert-apply-writes">
            {s.step.params.map((p) => (
              <li key={p.name} className="flex justify-between gap-2 border-t border-white/10 py-[3px]">
                <span className="font-mono">{p.name}</span>
                <span className="font-semibold">{formatValue(p.value)}</span>
              </li>
            ))}
          </ul>
          <p className={`text-[11px] ${DIM}`}>{alertText("apply.snapshot")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {action ? (
              <HoldButton
                holdMs={HOLD_CONFIRM_MS}
                onFire={() => write(action.id)}
                title={setupText("setup.confirm.hold")}
                className={BTN_PRIMARY}
                data-testid="alert-apply-hold"
              >
                {alertText("action.apply")}
              </HoldButton>
            ) : null}
            <button type="button" onClick={() => setS({ phase: "idle" })} className={BTN_SECONDARY}>
              {alertText("action.cancel")}
            </button>
          </div>
        </div>
      );
    }
    case "writing":
      return <FollowApply transport={transport} onEnd={setS} />;
    case "done":
      return (
        <span role="status" data-testid="alert-apply-done" className="text-xs font-semibold">
          {alertText("apply.done")}
        </span>
      );
    case "error":
      return (
        <div className="flex flex-wrap items-center gap-2" data-testid="alert-apply-error">
          <span role="alert" className="text-xs" style={{ color: "var(--fs-text-crit)" }}>
            {s.text}
          </span>
          <FixLinkButton to={setup(stepId)}>{alertText("action.openSetup")}</FixLinkButton>
        </div>
      );
  }
}

/** Follow the written step on the setup stream until it ends. */
function FollowApply({ transport, onEnd }: { transport: SetupTransport; onEnd: (s: ApplyPhase) => void }) {
  const { status } = useFcSetup(transport);
  const step = findStep(status, APPLY_PROFILE_STEP.wizard, APPLY_PROFILE_STEP.step);
  const state = step?.state;
  useEffect(() => {
    if (!step) return;
    if (state === "done") onEnd({ phase: "done" });
    else if (state === "failed") onEnd({ phase: "error", text: stepFailure(step) });
  }, [state, step, onEnd]);
  return (
    <span className={`flex items-center gap-1.5 text-xs ${DIM}`} role="status" data-testid="alert-apply-writing">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      {alertText("apply.writing")}
    </span>
  );
}

/** A row's fix: a button, or on a drone with no setup engine the hint that
 *  names where to fix it. */
function FixAction({ alert, actions }: { alert: PillAlert; actions: AlertActions }) {
  const fix = alert.fix;
  if (!fix) return actions.extra ? <>{actions.extra(alert)}</> : null;
  switch (fix.kind) {
    case "apply_profile":
    case "setup_step": {
      const setup = actions.setup;
      if (!setup) {
        return (
          <p className={`text-[11px] ${DIM}`} data-testid="alert-fix-hint">
            {alertText("groundHint")}
          </p>
        );
      }
      if (fix.kind === "apply_profile" && actions.transport) return <ApplyProfileFix transport={actions.transport} setup={setup} />;
      return (
        <FixLinkButton to={setup(fix.kind === "setup_step" ? fix.step : APPLY_PROFILE_STEP.step)} primary testId="alert-fix-setup">
          {alertText("action.openSetup")}
        </FixLinkButton>
      );
    }
    case "settings":
      return (
        <FixLinkButton to={actions.settings(fix.section)} primary testId="alert-fix-settings">
          {alertText("action.openSettings")}
        </FixLinkButton>
      );
    case "parameters":
      return (
        <FixLinkButton to={actions.parameters(fix.names)} primary testId="alert-fix-parameters">
          {alertText("action.openParameters")}
        </FixLinkButton>
      );
  }
}

/** One alert: glyph, title, source; its parameter table; its fix and Hide
 *  (a warning) or Collapse (a critical). A collapsed critical shows its title
 *  and Expand only. `snoozed`: the row is shown under "Show hidden". */
export function AlertRow({
  alert,
  actions,
  snoozed,
  onSnooze,
}: {
  alert: GroupedAlert;
  actions: AlertActions;
  snoozed: boolean;
  onSnooze?: (key: string, on: boolean) => void;
}) {
  const critical = alert.severity === "critical";
  const icon = critical ? tokens.chrome.severity_icon.critical : tokens.chrome.severity_icon.warning;
  const snoozeButton = onSnooze ? (
    <button
      type="button"
      onClick={() => onSnooze(alert.key, !snoozed)}
      className={BTN_SECONDARY}
      data-testid={critical ? (snoozed ? "alert-expand" : "alert-collapse") : snoozed ? "alert-unhide" : "alert-hide"}
    >
      {critical
        ? alertText(snoozed ? "action.expand" : "action.collapse")
        : alertText(snoozed ? "action.unhide" : "action.hide")}
    </button>
  ) : null;
  return (
    <li
      data-testid="alert-item"
      data-severity={alert.severity}
      data-collapsed={alert.collapsed ? "true" : undefined}
      className={`flex items-start gap-2 px-1 py-1.5 ${snoozed && !critical ? DIM : ""}`}
    >
      <span
        data-testid="status-pill-glyph"
        className="fs-ico mt-[1px] flex w-[1.2em] shrink-0 items-center justify-center font-bold leading-none"
        style={{ color: DOT[alert.severity] }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <div
              data-testid="alert-item-text"
              className={`fs-pill-item ${alert.collapsed ? "truncate" : "break-words"}`}
              style={critical ? { color: "var(--fs-text-crit)" } : undefined}
            >
              {alert.text}
            </div>
            <div data-testid="alert-item-source" className={`fs-pill-src text-[11px] ${DIM}`}>
              {specString(`cockpit.status.source.${alert.source}`)}
            </div>
          </div>
          {alert.collapsed ? snoozeButton : null}
        </div>
        {alert.collapsed ? null : (
          <>
            {alert.params && alert.params.length > 0 ? <ParamTable params={alert.params} /> : null}
            <div className="flex flex-wrap items-center gap-2">
              <FixAction alert={alert} actions={actions} />
              {snoozeButton}
            </div>
          </>
        )}
      </div>
    </li>
  );
}

/** The alert centre: the counts, the hidden toggle, and one section per
 *  group. A section holding a critical starts open, the rest closed. */
export function AlertCentre({
  alerts,
  snoozed,
  onSnooze,
  actions,
  titleId,
}: {
  alerts: readonly PillAlert[];
  snoozed: ReadonlySet<string>;
  onSnooze: (key: string, on: boolean) => void;
  actions: AlertActions;
  titleId?: string;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const counted = unsnoozedAlerts(alerts, snoozed);
  const blocking = counted.filter((a) => a.severity === "critical").length;
  const warnings = counted.length - blocking;
  const hiddenCount = alerts.filter((a) => a.severity === "warning" && snoozed.has(a.key)).length;
  // Under "Show hidden" the hidden warnings list again; a collapsed critical
  // stays collapsed either way.
  const sections = groupAlerts(
    alerts,
    showHidden ? new Set(alerts.filter((a) => a.severity === "critical" && snoozed.has(a.key)).map((a) => a.key)) : snoozed,
  );
  const counts = [
    blocking > 0 ? alertText("blocking", { count: blocking }) : null,
    warnings > 0 ? alertText("warnings", { count: warnings }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-col gap-1" data-testid="alert-centre">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <p id={titleId} className="fs-menu-h" data-testid="status-pill-list-title">
            {specString("cockpit.alerts.title")}
          </p>
          {counts ? (
            <div className={`text-[11px] ${DIM}`} data-testid="alert-counts">
              {counts}
            </div>
          ) : null}
        </div>
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowHidden(!showHidden)}
            aria-pressed={showHidden}
            className={BTN_SECONDARY}
            data-testid="alert-show-hidden"
          >
            {alertText(showHidden ? "hideHidden" : "showHidden", { count: hiddenCount })}
          </button>
        ) : null}
      </div>
      {sections.every((s) => s.alerts.length === 0) ? (
        <p className="fs-sheet-empty flex items-center gap-2 px-1 py-1.5" data-testid="alert-all-clear">
          <span aria-hidden style={{ color: "var(--fs-ok)" }}>
            ✓
          </span>
          {alertText("allClear")}
        </p>
      ) : (
        sections
          .filter((s) => s.alerts.length > 0)
          .map((s) => {
            const isOpen = open[s.group] ?? s.alerts.some((a) => a.severity === "critical");
            const worst: Severity = s.alerts.some((a) => a.severity === "critical") ? "critical" : "warning";
            return (
              <section key={s.group} data-testid="alert-section" data-group={s.group} className="border-t border-white/10">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen({ ...open, [s.group]: !isOpen })}
                  className="fs-hit flex min-h-[48px] w-full items-center gap-2 px-1 text-left text-xs font-semibold"
                  data-testid="alert-section-toggle"
                >
                  {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden /> : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: DOT[worst] }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className="tabular-nums">{s.alerts.length}</span>
                  {s.hidden > 0 ? (
                    <span className={`text-[11px] font-normal ${DIM}`} data-testid="alert-section-hidden">
                      {alertText("hiddenNote", { count: s.hidden })}
                    </span>
                  ) : null}
                </button>
                {isOpen ? (
                  <ul className="flex flex-col">
                    {s.alerts.map((a) => (
                      <AlertRow key={a.key} alert={a} actions={actions} snoozed={snoozed.has(a.key)} onSnooze={onSnooze} />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })
      )}
    </div>
  );
}
