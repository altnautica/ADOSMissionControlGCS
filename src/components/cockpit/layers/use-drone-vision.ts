"use client";

/**
 * @module cockpit/layers/use-drone-vision
 * @description One drone's vision engine for the cockpit: its status read
 * (`GET /api/vision/status`, polled), the stored `vision.enabled` flag, and
 * the operator's actions on it through that drone's agent client: write the
 * flag (`PUT /api/config`), restart the `ados-vision` unit, or restart the
 * agent when it will not restart that unit on its own. Demo mode answers with
 * the demo vision client and the mock agent client.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { useNodeConfig, readConfigPath } from "@/components/command/settings/use-node-config";
import { ENGINE_MODELS_POLL_MS } from "@/hooks/use-vision-engine-models";
import { UNKNOWN_ENGINE_STATUS, type EngineStatus } from "@/lib/agent/vision-client";
import { directClientForNode } from "@/lib/agent/config-access";
import { resolveLanAgentUrl, resolvePairedApiKey } from "@/lib/agent/resolve-agent";
import { resolveVisionClient } from "@/lib/vision/resolve-vision-client";
import { isDemoMode } from "@/lib/utils";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useFleetDrones } from "@/stores/node-registry/use-fleet-drones";

import { engineRunning, restartVisionUnit, VISION_START_MS } from "./vision-state";

/** The status poll while a start or restart is being watched. */
export const VISION_WATCH_POLL_MS = 2000;

export interface DroneVision {
  status: EngineStatus;
  /** False until the first status poll had time to settle. */
  read: boolean;
  /** The engine is up (true), off or unreachable (false), or unknown (null). */
  engineUp: boolean | null;
  /** The stored `vision.enabled`, or null while unread. */
  enabled: boolean | null;
  /** A path to this drone's agent exists for writes and restarts. */
  canWrite: boolean;
  setEnabled: (on: boolean) => Promise<void>;
  /** Resolves "refused" when the agent does not restart the unit itself. */
  restart: () => Promise<"ok" | "refused">;
  restartAgent: () => Promise<void>;
}

/** The agent device id behind a fleet drone id. */
export function useDroneNodeId(droneId: string): string | null {
  return useFleetDrones((drones) => drones.find((d) => d.id === droneId)?.cloudDeviceId ?? null);
}

export function useDroneVision(droneId: string): DroneVision {
  const nodeId = useDroneNodeId(droneId);
  const agentUrl = nodeId ? resolveLanAgentUrl(nodeId) : null;
  const apiKey = nodeId ? resolvePairedApiKey(nodeId) : null;
  const client = useMemo(() => resolveVisionClient(agentUrl, apiKey), [agentUrl, apiKey]);
  const [status, setStatus] = useState<EngineStatus>(UNKNOWN_ENGINE_STATUS);
  const [read, setRead] = useState(false);
  // Until when the poll runs at the watch interval, and a bump to re-read now.
  const fastUntil = useRef(0);
  const [kick, setKick] = useState(0);
  useEffect(() => {
    if (!client?.getEngineStatus) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let next: EngineStatus = UNKNOWN_ENGINE_STATUS;
      try {
        next = await client.getEngineStatus!();
      } catch {
        // Unreachable or refused: the unknown status.
      }
      if (!live) return;
      setStatus(next);
      setRead(true);
      timer = setTimeout(poll, Date.now() < fastUntil.current ? VISION_WATCH_POLL_MS : ENGINE_MODELS_POLL_MS);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, kick]);
  /** Watch a start: poll every 2 s for the start window, from now. */
  const watch = () => {
    fastUntil.current = Date.now() + VISION_START_MS;
    setKick((k) => k + 1);
  };
  const config = useNodeConfig(nodeId);
  const storeClient = useAgentConnectionStore((s) => s.client);
  const attached = useAgentConnectionStore((s) => s.nodeDeviceId);
  // The demo attaches one mock client and never sets a focused device id.
  const agent = isDemoMode() ? storeClient : directClientForNode(storeClient, attached, nodeId);

  const raw = readConfigPath(config.config, "vision.enabled");
  const enabled = typeof raw === "boolean" ? raw : null;
  const up = engineRunning(status);
  return {
    status,
    read,
    engineUp: up ? true : read || enabled === false ? false : null,
    enabled,
    canWrite: !config.readOnly && agent !== null,
    setEnabled: (on) => config.setValue("vision.enabled", on ? "true" : "false"),
    restart: async () => {
      if (!agent) throw new Error("no agent connection");
      const result = await restartVisionUnit(agent);
      if (result === "ok") watch();
      return result;
    },
    restartAgent: async () => {
      if (!agent) throw new Error("no agent connection");
      await agent.restartSupervisor();
      watch();
    },
  };
}
