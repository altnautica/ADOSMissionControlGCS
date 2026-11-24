"use client";

/**
 * @module aircraft-setup/SetupOverview
 * @description The Aircraft setup overview: progress ("N of M done"), the
 * interrupted or blocked notice, one large primary button (Start / Continue /
 * Run again), and a grid of component cards. A card shows what is set now and
 * its state; one that needs attention has a red border. Tapping a card opens
 * its step.
 * @license GPL-3.0-only
 */

import {
  AlertTriangle,
  BatteryMedium,
  Bot,
  Compass,
  Fan,
  Gamepad2,
  Info,
  PlaneTakeoff,
  Plane,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import { cardSummary, overviewPrimary, wizardCards, wizardProgress, type CardState, type SetupCard } from "@/lib/fc-setup/overview";
import { setupRefusalText, setupText } from "@/lib/fc-setup/strings";
import type { Wizard } from "@/lib/fc-setup/types";
import { cn } from "@/lib/utils";

const CARD_ICONS: Record<string, LucideIcon> = {
  frame: Plane,
  sensors: Compass,
  radio: Gamepad2,
  outputs: Fan,
  battery: BatteryMedium,
  flight: SlidersHorizontal,
  safety: ShieldCheck,
  ados: Bot,
};

const CARD_BORDER: Record<CardState, string> = {
  done: "border-border-default",
  attention: "border-2 border-status-error",
  in_progress: "border-2 border-accent-primary",
  not_set: "border-border-default",
  optional: "border-border-default",
  not_needed: "border-border-default opacity-80",
};

const BADGE_TONE: Record<CardState, string> = {
  done: "bg-status-success/15 text-status-success",
  attention: "bg-status-error/15 text-status-error",
  in_progress: "bg-accent-primary/15 text-accent-primary",
  not_set: "bg-bg-tertiary text-text-secondary",
  optional: "bg-bg-tertiary text-text-secondary",
  not_needed: "bg-bg-tertiary text-text-secondary",
};

export interface SetupOverviewProps {
  wizard: Wizard;
  busy: boolean;
  /** Why the primary button is held (an armed or unknown arm state), else null. */
  lockNote: string | null;
  /** The wizard's blockers to show (the lock note already says "armed"). */
  blockers: string[];
  /** The primary button: start, resume or open the running wizard. */
  onPrimary: () => void;
  onCard: (card: SetupCard) => void;
}

export function SetupOverview({ wizard, busy, lockNote, blockers, onPrimary, onCard }: SetupOverviewProps) {
  const cards = wizardCards(wizard);
  const { done, total } = wizardProgress(wizard);
  const primary = overviewPrimary(wizard.state);
  const viewOnly = primary.kind === "continue";
  // Blockers stop a start, never the view of a run already going.
  const blocked = blockers.length > 0 && !viewOnly;
  const locked = lockNote !== null && !viewOnly;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4" data-testid="setup-overview">
      <div className="flex flex-col gap-2">
        <p className="max-w-2xl text-sm text-text-secondary">{setupText(`setup.wizard.${wizard.id}.body`)}</p>
        <div className="flex items-center gap-3">
          <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="h-2 max-w-md flex-1 overflow-hidden rounded-full bg-bg-tertiary">
            <div className="h-full rounded-full bg-accent-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-sm font-medium tabular-nums text-text-primary" data-testid="setup-progress">
            {setupText("setup.overview.progress", { done, total })}
          </span>
        </div>
      </div>

      {wizard.state === "interrupted" && (
        <p className="flex items-start gap-2 rounded-md border border-accent-primary/40 bg-accent-primary/10 px-4 py-3 text-sm text-text-primary" data-testid="setup-interrupted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-primary" aria-hidden />
          {setupText("setup.overview.interrupted")}
        </p>
      )}

      {locked && (
        <p className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm text-status-warning" data-testid="setup-armed">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {lockNote}
        </p>
      )}

      {blocked ? (
        <div className="flex flex-col gap-1 rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-status-warning" data-testid="setup-blocked">
          <p className="text-sm font-semibold">{setupText("setup.overview.blocked")}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {blockers.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {setupRefusalText(b)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div>
          <button
            type="button"
            disabled={busy || locked || (!wizard.available && !viewOnly)}
            title={locked ? lockNote : undefined}
            onClick={onPrimary}
            className="inline-flex min-h-14 min-w-56 items-center justify-center rounded-md bg-accent-primary px-8 text-base font-semibold text-white hover:bg-accent-primary/90 disabled:opacity-40"
            data-testid="setup-start"
            data-kind={primary.kind}
          >
            {setupText(primary.label_key)}
          </button>
        </div>
      )}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        {cards.map((card) => (
          <li key={card.id}>
            <ComponentCard card={card} disabled={busy || (locked && !viewOnly)} onOpen={() => onCard(card)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComponentCard({ card, disabled, onOpen }: { card: SetupCard; disabled: boolean; onOpen: () => void }) {
  const Icon = CARD_ICONS[card.id] ?? PlaneTakeoff;
  const summary = cardSummary(card);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      data-testid={`setup-card-${card.id}`}
      data-state={card.state}
      className={cn("flex h-full min-h-28 w-full flex-col gap-2 rounded-lg border bg-bg-secondary p-3 text-left hover:bg-bg-tertiary disabled:opacity-60", CARD_BORDER[card.state])}
    >
      <span className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-primary/10 text-accent-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">{setupText(card.title_key)}</span>
      </span>
      {card.steps.length > 1 && (
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-secondary">
          {card.steps.map((s) => (
            <span key={s.step} className={s.state === "done" ? "text-status-success" : s.state === "failed" ? "text-status-error" : undefined}>
              {setupText(s.title_key, s.args)}
            </span>
          ))}
        </span>
      )}
      {summary && <span className="truncate text-sm text-text-secondary">{summary}</span>}
      <span className={cn("mt-auto self-start rounded-full px-2.5 py-0.5 text-xs font-semibold", BADGE_TONE[card.state])}>{setupText(`setup.card.state.${card.state}`)}</span>
    </button>
  );
}
