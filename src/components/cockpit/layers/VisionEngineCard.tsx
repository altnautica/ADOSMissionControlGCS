"use client";

/**
 * @module cockpit/layers/VisionEngineCard
 * @description The Vision panel's engine card, first in the panel: a status
 * dot and one line saying what the drone's vision engine is doing, and the
 * one action that moves it forward.
 *
 * - Running: the backend and the detector model.
 * - Off (`vision.enabled` false): Turn on vision writes the flag, restarts the
 *   `ados-vision` unit, then the status poll watches it come up for up to 30 s.
 * - Not responding while enabled, or its backend unavailable: Restart vision.
 * - An agent that refuses to restart the unit on its own: vision starts after
 *   the agent restarts, so the card offers that restart instead.
 * - Armed: every action is disabled with the reason.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { useArmedLock } from "@/hooks/use-armed-lock";
import { specString } from "@/lib/cockpit/spec-strings";
import { cn } from "@/lib/utils";

import type { DroneVision } from "./use-drone-vision";
import { engineCardState, type EngineCardState, type EnginePending } from "./vision-state";

const DOT: Readonly<Record<EngineCardState, string>> = {
  running: "bg-status-success",
  starting: "bg-status-warning animate-pulse",
  agent_restarting: "bg-status-warning animate-pulse",
  off: "bg-text-tertiary",
  checking: "bg-text-tertiary",
  needs_agent_restart: "bg-status-warning",
  unreachable: "bg-status-error",
  unavailable: "bg-status-error",
  start_timeout: "bg-status-error",
};

const LINE_KEY: Readonly<Record<EngineCardState, string>> = {
  running: "running",
  starting: "starting",
  agent_restarting: "agentRestarting",
  off: "off",
  checking: "checking",
  needs_agent_restart: "needsAgentRestart",
  unreachable: "unreachable",
  unavailable: "unavailable",
  start_timeout: "startTimeout",
};

const PRIMARY = "min-h-12 w-full rounded-md bg-accent-primary px-3 text-sm font-semibold text-white hover:bg-accent-primary/90 disabled:opacity-40";

export function VisionEngineCard({ droneId, vision }: { droneId: string; vision: DroneVision }) {
  const t = useTranslations("vision.cockpit");
  const { isHardBlocked } = useArmedLock(droneId);
  const [pending, setPending] = useState<EnginePending>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busy = pending?.kind === "starting" || pending?.kind === "agent_restarting";
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy]);
  const state = engineCardState({ enabled: vision.enabled, status: vision.status, read: vision.read, pending, now });
  const locked = isHardBlocked || !vision.canWrite;

  const fail = (e: unknown) => {
    setPending(null);
    setFailure(t("failed", { error: e instanceof Error ? e.message : String(e) }));
  };

  const restart = async () => {
    setFailure(null);
    setNow(Date.now());
    setPending({ kind: "starting", since: Date.now() });
    try {
      if ((await vision.restart()) === "refused") setPending({ kind: "needs_agent_restart" });
    } catch (e) {
      fail(e);
    }
  };

  const turnOn = async () => {
    setFailure(null);
    try {
      await vision.setEnabled(true);
    } catch (e) {
      fail(e);
      return;
    }
    await restart();
  };

  const restartAgent = async () => {
    setFailure(null);
    setNow(Date.now());
    setPending({ kind: "agent_restarting", since: Date.now() });
    try {
      await vision.restartAgent();
    } catch (e) {
      fail(e);
    }
  };

  const status = vision.status;
  const detector = status.known ? (status.models.find((m) => m.kind.toLowerCase() === "detection")?.id ?? status.models[0]?.id ?? null) : null;
  const spinning = state === "starting" || state === "agent_restarting";

  return (
    <section className="flex flex-col gap-2 rounded-md bg-white/5 p-3" data-testid="vision-engine-card" data-state={state}>
      <h3 className="text-[11px] uppercase tracking-wide text-text-secondary">{t("engineTitle")}</h3>
      <div className="flex items-center gap-2">
        {spinning ? (
          <Loader2 className="h-4 w-4 animate-spin text-status-warning" aria-hidden />
        ) : (
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[state])} aria-hidden />
        )}
        <span className="text-sm font-semibold text-text-primary">{t(LINE_KEY[state])}</span>
      </div>
      {state === "running" && status.known && (
        <p className="text-text-secondary">{[status.backend ?? specString("vision.no_backend"), detector].filter(Boolean).join(" · ")}</p>
      )}
      {state === "off" && <p className="text-text-tertiary">{t("offHint")}</p>}
      {state === "unavailable" && status.known && status.backendReason && <p className="text-status-warning">{status.backendReason}</p>}
      {state === "off" && (
        <button type="button" className={PRIMARY} disabled={locked} onClick={() => void turnOn()} data-testid="vision-turn-on">
          {t("turnOn")}
        </button>
      )}
      {(state === "unreachable" || state === "unavailable" || state === "start_timeout") && (
        <button type="button" className={PRIMARY} disabled={locked} onClick={() => void restart()} data-testid="vision-restart">
          {t("restart")}
        </button>
      )}
      {state === "needs_agent_restart" && (
        <button type="button" className={PRIMARY} disabled={locked} onClick={() => void restartAgent()} data-testid="vision-restart-agent">
          {t("restartAgent")}
        </button>
      )}
      {isHardBlocked && state !== "running" && !spinning && <p className="text-text-tertiary">{t("armed")}</p>}
      {!vision.canWrite && state !== "running" && <p className="text-text-tertiary">{t("noPath")}</p>}
      {failure && <p className="text-status-error">{failure}</p>}
    </section>
  );
}
