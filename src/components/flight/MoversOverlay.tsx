"use client";

/**
 * @module MoversOverlay
 * @description The moving obstacles the pilot tracks, on the flight map
 * inside a react-leaflet MapContainer: per mover its one-sigma uncertainty
 * ring (metres, faint fill), an arrow to where it will be in 2 s on its
 * velocity, and a mark in its kind's colour and shape (person a disc,
 * vehicle a square, anything else a triangle) titled with its kind, faded
 * once it went unmeasured for over a second. Placed about the vehicle's EKF
 * origin; hidden while the pilot frame is stale or the origin is unknown.
 * @license GPL-3.0-only
 */

import { Fragment, useEffect, useState } from "react";
import L from "leaflet";
import { Circle, Marker, Polyline, Tooltip } from "react-leaflet";

import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { MOVER_KIND_COLOR, moverKindLabel } from "@/lib/hud/movers";
import type { MoverKind } from "@/lib/hud/pilot-fields";
import { pilotFresh } from "@/lib/hud/pilot-fresh";
import { moversGeo } from "@/lib/nav/ned-geo";
import { useDroneManager } from "@/stores/drone-manager";
import { useGpsOriginStore } from "@/stores/gps-origin-store";

/** Re-check of the pilot frame's age while nothing else re-renders. */
const FRESH_TICK_MS = 1000;
const GLYPH_PX = 12;
const FADED_OPACITY = 0.4;

const GLYPH_SVG: Record<MoverKind, string> = {
  person: '<circle cx="6" cy="6" r="4.5"/>',
  vehicle: '<rect x="1.5" y="1.5" width="9" height="9" rx="1"/>',
  unknown: '<polygon points="6,0.6 11,10 1,10"/>',
};

/** One icon per kind and fade, built once: a new icon object makes
 *  react-leaflet rebuild the marker's DOM on every frame. */
const iconCache = new Map<string, L.DivIcon>();
function moverIcon(kind: MoverKind, faded: boolean): L.DivIcon {
  const key = `${kind}|${faded}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const colour = MOVER_KIND_COLOR[kind];
    icon = L.divIcon({
      className: "",
      iconSize: [GLYPH_PX, GLYPH_PX],
      iconAnchor: [GLYPH_PX / 2, GLYPH_PX / 2],
      html: `<svg width="${GLYPH_PX}" height="${GLYPH_PX}" viewBox="0 0 12 12" style="opacity:${faded ? FADED_OPACITY : 1}" data-mover-kind="${kind}"><g fill="${colour}" stroke="rgba(0,0,0,0.65)" stroke-width="1">${GLYPH_SVG[kind]}</g></svg>`,
    });
    iconCache.set(key, icon);
  }
  return icon;
}

export function MoversOverlay() {
  const droneId = useDroneManager((s) => s.selectedDroneId);
  const { pilot, receivedAt } = usePilotState(droneId);
  const origin = useGpsOriginStore((s) => (droneId ? (s.byDrone[droneId] ?? null) : null));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), FRESH_TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (!pilot || !pilotFresh(receivedAt, now)) return null;
  const movers = moversGeo(pilot.movers, origin);
  if (movers.length === 0) return null;

  return (
    <>
      {movers.map((m) => {
        const color = MOVER_KIND_COLOR[m.kind];
        const opacity = m.faded ? FADED_OPACITY : 1;
        return (
          <Fragment key={m.id}>
            <Circle
              center={m.position}
              radius={m.sigmaM}
              interactive={false}
              pathOptions={{ color, weight: 1, opacity: 0.8 * opacity, fillOpacity: 0.12 * opacity, dashArray: "3 2" }}
            />
            {m.arrow && (
              <Polyline
                positions={[[m.position, m.arrow.tip], [m.arrow.barbs[0], m.arrow.tip, m.arrow.barbs[1]]]}
                interactive={false}
                pathOptions={{ color, weight: 2, opacity }}
              />
            )}
            <Marker position={m.position} icon={moverIcon(m.kind, m.faded)} keyboard={false}>
              <Tooltip direction="top" offset={[0, -6]}>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>{moverKindLabel(m.kind)}</span>
              </Tooltip>
            </Marker>
          </Fragment>
        );
      })}
    </>
  );
}
