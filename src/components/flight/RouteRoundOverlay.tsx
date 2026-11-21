"use client";

/**
 * @module RouteRoundOverlay
 * @description The pilot's way round an obstacle on the flight map, inside a
 * react-leaflet MapContainer: while the pilot flies a mission detour round a
 * blocked leg or a routed return home, its planned path (`plan_ned`) as a
 * dashed line in the avoiding hue and the detour's free point (where the
 * mission resumes) as a ring, labelled with the chip's routing line. Placed
 * about the vehicle's EKF origin; hidden while the pilot frame is stale, the
 * pilot routes round nothing, or the origin is unknown.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { CircleMarker, Polyline, Tooltip } from "react-leaflet";

import { useCssVarColors } from "@/hooks/use-css-var-colors";
import { specString } from "@/lib/cockpit/spec-strings";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { routeRoundPreview } from "@/lib/hud/cockpit-mission";
import { pilotFresh } from "@/lib/hud/pilot-fresh";
import { routeRoundGeo } from "@/lib/nav/ned-geo";
import { useDroneManager } from "@/stores/drone-manager";
import { useGpsOriginStore } from "@/stores/gps-origin-store";

/** The avoiding hue of the flight-state chip's routing line (`tokens.json`
 *  `state.avoiding`). Leaflet writes colours into SVG attributes, which
 *  cannot hold var(). */
const ROUTE_ROUND_TOKENS = ["--state-avoiding"] as const;
/** Re-check of the pilot frame's age while nothing else re-renders. */
const FRESH_TICK_MS = 1000;

export function RouteRoundOverlay() {
  const droneId = useDroneManager((s) => s.selectedDroneId);
  const { pilot, receivedAt } = usePilotState(droneId);
  const origin = useGpsOriginStore((s) => (droneId ? (s.byDrone[droneId] ?? null) : null));
  const [color] = useCssVarColors(ROUTE_ROUND_TOKENS);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), FRESH_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const preview = pilot && pilotFresh(receivedAt, now) ? routeRoundPreview(pilot) : null;
  const geo = routeRoundGeo(preview, origin);
  if (!geo || !pilot) return null;

  const label =
    geo.kind === "detour" && pilot.missionDetour
      ? specString("chip.route_round.detour", { wp: pilot.missionDetour.seq })
      : pilot.returnRoute
        ? specString("chip.route_round.return", {
            remaining_m: Math.round(pilot.returnRoute.remainingM),
            straight_m: Math.round(pilot.returnRoute.straightM),
          })
        : null;
  // The label sits on the detour's free point, or on the path's far end for
  // a return that names none.
  const labelAt = geo.target ?? geo.path[geo.path.length - 1] ?? null;

  return (
    <>
      {geo.path.length >= 2 && (
        <Polyline
          positions={geo.path}
          interactive={false}
          pathOptions={{ color, weight: 3, opacity: 0.95, dashArray: "6 4" }}
        />
      )}
      {labelAt && (
        <CircleMarker
          center={labelAt}
          radius={geo.target ? 7 : 4}
          interactive={false}
          pathOptions={{ color, fillColor: color, fillOpacity: geo.target ? 0 : 0.9, weight: 2 }}
        >
          {label && (
            <Tooltip direction="top" offset={[0, -8]} permanent>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>{label}</span>
            </Tooltip>
          )}
        </CircleMarker>
      )}
    </>
  );
}
