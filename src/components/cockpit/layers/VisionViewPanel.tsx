"use client";

/**
 * @module cockpit/layers/VisionViewPanel
 * @description The panel of the cockpit's Vision view, beside the video in
 * landscape and stacked under it in portrait. Top to bottom:
 * - a header with a close button (and Esc) back to the Pilot view;
 * - the vision engine card: its state and the one action that moves it on;
 * - one row per vision layer (depth, surfaces): its switch, name and live
 *   status (receiving, no data, engine off). The view forces both on, so the
 *   switch reads on and disabled with the reason, and a small checkbox keeps
 *   each one on in the other views. Depth's style and range sit in its row,
 *   behind a disclosure;
 * - the live detection list for the displayed camera;
 * - the detector model picker.
 * The header stays put; everything under it scrolls in the panel's column.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { ModelPicker } from "@/components/vision/ModelPicker";
import { useDisplayedDetectionBatch } from "@/hooks/use-detection-batch";
import { getFrames } from "@/lib/cockpit/layers/frame-store";
import { specString } from "@/lib/cockpit/spec-strings";
import { useCockpitViewStore } from "@/lib/cockpit/views";
import { cn } from "@/lib/utils";
import { useCockpitLayersStore, useVehicleLayers, type DepthRange, type DepthStyle } from "@/stores/cockpit-layers-store";

import { depthRangeText } from "./LayerLevelButton";
import { useDroneVision } from "./use-drone-vision";
import { VisionEngineCard } from "./VisionEngineCard";
import { layerLiveState, type LayerLiveState } from "./vision-state";

const DEPTH_RANGES: readonly DepthRange[] = ["off", "2", "5"];
const DEPTH_STYLES: readonly DepthStyle[] = ["solid", "outline"];
/** Rows shown in the detection list. */
const MAX_ROWS = 12;
/** The layers the vision engine feeds that the Vision view forces on. */
const VISION_LAYERS = ["targets", "depth", "surfaces"] as const;
type VisionLayer = (typeof VISION_LAYERS)[number];
const SECTION_TITLE = "mb-2 text-[11px] uppercase tracking-wide text-text-secondary";

export function VisionViewPanel({ droneId }: { droneId: string }) {
  const t = useTranslations("vision.cockpit");
  const batch = useDisplayedDetectionBatch(droneId);
  const vision = useDroneVision(droneId);
  const detections = batch?.detections ?? [];
  const close = () => useCockpitViewStore.getState().setView(droneId, "pilot");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) useCockpitViewStore.getState().setView(droneId, "pilot");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [droneId]);

  return (
    <aside className="flex h-full w-full flex-col text-xs" data-testid="vision-view-panel">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-1">
        <h2 className="text-sm font-semibold text-text-primary">{specString("vision.title")}</h2>
        <button
          type="button"
          onClick={close}
          aria-label={t("close")}
          title={t("close")}
          className="flex h-12 w-12 items-center justify-center rounded-md text-text-secondary hover:bg-white/10 hover:text-text-primary"
          data-testid="vision-close"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <VisionEngineCard droneId={droneId} vision={vision} />

        <section>
          <h3 className={SECTION_TITLE}>{t("layersTitle")}</h3>
          <ul className="flex flex-col gap-2">
            {VISION_LAYERS.map((id) => (
              <LayerRow key={id} droneId={droneId} layer={id} engineUp={vision.engineUp} targetsAt={batch?.receivedAt ?? null}>
                {id === "depth" ? <DepthOptions droneId={droneId} /> : null}
              </LayerRow>
            ))}
          </ul>
        </section>

        <section>
          <h3 className={SECTION_TITLE}>
            {specString("vision.detections")}
            {detections.length > 0 && <span className="ml-1 normal-case text-text-tertiary">· {t("detectionCount", { count: detections.length })}</span>}
          </h3>
          {detections.length === 0 ? (
            <p className="text-text-tertiary" data-testid="vision-detections-empty">
              {t("detectionsEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="vision-detection-list">
              {detections.slice(0, MAX_ROWS).map((d, i) => (
                <li key={d.trackId ?? `i${i}`} className="rounded bg-white/5 px-2 py-1 font-mono tabular-nums">
                  {d.trackId != null
                    ? specString("vision.detection_row_track", { id: d.trackId, label: d.classLabel, pct: Math.round(d.confidence * 100) })
                    : specString("vision.detection_row", { label: d.classLabel, pct: Math.round(d.confidence * 100) })}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className={SECTION_TITLE}>{specString("vision.model")}</h3>
          <ModelPicker droneId={droneId} mode="compact" />
        </section>
      </div>
    </aside>
  );
}

const LIVE_DOT: Readonly<Record<LayerLiveState, string>> = {
  receiving: "bg-status-success",
  no_data: "bg-status-warning",
  engine_off: "bg-text-tertiary",
};

const LIVE_KEY: Readonly<Record<LayerLiveState, string>> = {
  receiving: "receiving",
  no_data: "noData",
  engine_off: "engineOff",
};

/** The layer's live state, re-read once a second: depth and surfaces from the
 *  frame store, targets from the displayed detection batch. */
function useLayerLive(droneId: string, layer: VisionLayer, targetsAt: number | null, engineUp: boolean | null): LayerLiveState {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seenAt = layer === "targets" ? targetsAt : (getFrames(droneId)[layer]?.receivedAt ?? null);
  return layerLiveState(seenAt, now, engineUp);
}

function LayerRow({
  droneId,
  layer,
  engineUp,
  targetsAt,
  children,
}: {
  droneId: string;
  layer: VisionLayer;
  engineUp: boolean | null;
  targetsAt: number | null;
  children?: ReactNode;
}) {
  const t = useTranslations("vision.cockpit");
  const vl = useVehicleLayers(droneId);
  const setLayer = useCockpitLayersStore((s) => s.setLayer);
  const live = useLayerLive(droneId, layer, targetsAt, engineUp);
  const keepOn = vl.flips[layer] === true;
  const name = t(`layerName.${layer}`);
  return (
    <li className="flex flex-col gap-1.5 rounded-md bg-white/5 p-2" data-testid={`vision-layer-${layer}`} data-live={live}>
      <div className="flex min-h-12 items-center gap-3">
        <span role="switch" aria-checked aria-disabled aria-label={name} className="relative h-6 w-10 shrink-0 cursor-not-allowed rounded-full bg-accent-primary/70 opacity-60">
          <span className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-white" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-text-primary">{name}</span>
          <span className="text-text-tertiary">{specString("vision.on_while_view", { view: specString("vision.title") })}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-text-secondary">
          <span className={cn("h-2 w-2 rounded-full", LIVE_DOT[live])} aria-hidden />
          {t(LIVE_KEY[live])}
        </span>
      </div>
      <label className="flex min-h-12 cursor-pointer items-center gap-2 pl-1 text-text-secondary">
        <input type="checkbox" className="h-4 w-4" checked={keepOn} onChange={(e) => setLayer(droneId, layer, e.target.checked)} />
        {specString("vision.keep_on")}
      </label>
      {children}
    </li>
  );
}

function DepthOptions({ droneId }: { droneId: string }) {
  const t = useTranslations("vision.cockpit");
  const vl = useVehicleLayers(droneId);
  const setDepth = useCockpitLayersStore((s) => s.setDepth);
  return (
    <details className="group rounded-md border border-white/10">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-2 text-text-secondary">
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
        {t("depthOptions")}
      </summary>
      <div className="flex flex-col gap-1 px-2 pb-2">
        <div className="flex gap-1">
          {DEPTH_STYLES.map((v) => (
            <Choice key={v} on={vl.depthStyle === v} onClick={() => setDepth(droneId, v, vl.depthRange)}>
              {specString(`vision.depth_style.${v}`)}
            </Choice>
          ))}
        </div>
        <div className="flex gap-1">
          {DEPTH_RANGES.map((v) => (
            <Choice key={v} on={vl.depthRange === v} onClick={() => setDepth(droneId, vl.depthStyle, v)}>
              {depthRangeText(v)}
            </Choice>
          ))}
        </div>
      </div>
    </details>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("min-h-12 flex-1 rounded px-2 text-[11px]", on ? "bg-accent-primary text-white" : "bg-white/5 text-text-secondary hover:bg-white/10")}
    >
      {children}
    </button>
  );
}
