"use client";

/**
 * @module cockpit/layers/LayerChips
 * @description The data layers' status badges ("Depth unavailable", "AR
 * unavailable") over the main video, a fifth down under the top chrome. Each
 * badge is a button that opens a small menu: why it shows (the vision engine
 * is off, the layer sent nothing for 2 s, or its data is approximate), Turn
 * off (or Close Vision view when the open view forces the layer on), and Set
 * up, which opens the drone's Vision settings.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import cockpitTokens from "@/lib/cockpit-spec/tokens.json";
import { layerChips, VISION_CHIP_MASK, type LayerChip } from "@/lib/cockpit/layers/engine-types";
import type { LayerStackView } from "@/lib/cockpit/layers/layer-spec";
import { useCockpitViewStore } from "@/lib/cockpit/views";
import { useCockpitLayersStore } from "@/stores/cockpit-layers-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useUiStore } from "@/stores/ui-store";

import { useDroneVision } from "./use-drone-vision";
import { badgeTurnOff } from "./vision-state";

const CHIP_COLOR = cockpitTokens.layer.unavailable_chip;

/** Open the drone's Vision settings (its Agent tab at the Vision page). */
export function openVisionSettings(droneId: string): void {
  useDroneManager.getState().selectDrone(droneId);
  const ui = useUiStore.getState();
  ui.setPendingAgentPanel("vision");
  ui.setPendingDetailTab("agent");
}

/** Run a badge's first action: close the forcing view (back to Pilot), or
 *  switch every layer flag the chip stands for off. */
export function turnOffBadge(droneId: string, chip: LayerChip, view: LayerStackView): void {
  if (badgeTurnOff(chip, view) === "close_view") {
    useCockpitViewStore.getState().setView(droneId, "pilot");
    return;
  }
  const layers = useCockpitLayersStore.getState();
  for (const id of chip.layers) layers.setLayer(droneId, id, false);
}

export interface BadgeMenuProps {
  droneId: string;
  chip: LayerChip;
  view: LayerStackView;
  /** The badge the menu opens from: it sits under it, above the HUD. */
  anchor: HTMLElement | null;
  onClose: () => void;
}

/** The badge menu: the reason line, then Turn off (or Close Vision view) and
 *  Set up. Portalled to the page so the HUD drawn over the video never covers it. */
export function BadgeMenu({ droneId, chip, view, anchor, onClose }: BadgeMenuProps) {
  const t = useTranslations("vision.cockpit");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      // A DOM event's target is always a node.
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor?.contains(target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose, anchor]);
  const r = anchor?.getBoundingClientRect();
  const reason =
    chip.reason === "engine_off"
      ? t("badge.engineOff")
      : chip.reason === "degraded"
        ? t(chip.layer === "ar" ? "badge.approx" : "badge.unscaled")
        : t("badge.noData", { layer: t(`layerName.${chip.layer}`) });
  const off = badgeTurnOff(chip, view);
  const item = "flex min-h-12 w-full items-center px-3 text-left text-sm text-text-primary hover:bg-white/10";
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[1000] min-w-56 -translate-x-1/2 overflow-hidden rounded-md border border-border-default bg-bg-primary py-1 shadow-xl"
      style={{ left: r ? r.left + r.width / 2 : "50%", top: r ? r.bottom + 4 : "20%" }}
      data-testid="layer-chip-menu"
    >
      <p className="px-3 py-1.5 text-xs text-text-secondary" data-testid="layer-chip-reason">
        {reason}
      </p>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onClose();
          turnOffBadge(droneId, chip, view);
        }}
        data-testid="layer-chip-turn-off"
      >
        {t(off === "close_view" ? "badge.closeView" : "badge.turnOff")}
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onClose();
          openVisionSettings(droneId);
        }}
        data-testid="layer-chip-set-up"
      >
        {t("badge.setUp")}
      </button>
    </div>,
    document.body,
  );
}

export function LayerChips({ droneId, mask, engineUp, view }: { droneId: string; mask: number; engineUp: boolean | null; view: LayerStackView }) {
  const t = useTranslations("vision.cockpit");
  const [open, setOpen] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (mask === 0) return null;
  const chips = layerChips(mask, engineUp);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-0 top-[20%] z-20 flex flex-col items-center gap-1" data-testid="layer-chips">
      {chips.map((chip) => (
        <div key={chip.id} className="pointer-events-auto relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open === chip.id}
            aria-label={t("badge.options", { layer: chip.text })}
            onClick={(e) => {
              setAnchor(e.currentTarget);
              setOpen((o) => (o === chip.id ? null : chip.id));
            }}
            className="min-h-12 rounded-md bg-black/60 px-3 text-xs font-semibold backdrop-blur"
            style={{ color: CHIP_COLOR }}
            data-testid="layer-chip"
            data-reason={chip.reason}
          >
            {chip.text}
          </button>
          {open === chip.id && <BadgeMenu droneId={droneId} chip={chip} view={view} anchor={anchor} onClose={() => setOpen(null)} />}
        </div>
      ))}
    </div>
  );
}

/** The badges for an engine chip mask; reads the vision engine's status only
 *  while a badge the engine feeds shows. */
export function LayerBadges({ droneId, mask, view }: { droneId: string; mask: number; view: LayerStackView }) {
  if ((mask & VISION_CHIP_MASK) === 0) return <LayerChips droneId={droneId} mask={mask} engineUp={null} view={view} />;
  return <VisionLayerChips droneId={droneId} mask={mask} view={view} />;
}

function VisionLayerChips({ droneId, mask, view }: { droneId: string; mask: number; view: LayerStackView }) {
  const { engineUp } = useDroneVision(droneId);
  return <LayerChips droneId={droneId} mask={mask} engineUp={engineUp} view={view} />;
}
