"use client";

/**
 * @module MissionRouteOverlay
 * @description The route of the mission the aircraft is flying and the
 * waypoint it is heading to, inside a react-leaflet MapContainer. Drawn only
 * while MISSION_CURRENT maps onto the open plan, which the mission store does
 * only when the aircraft holds that plan (an upload or download receipt), so a
 * plan the vehicle does not hold is never drawn as its route. When the plan
 * on the drone differs from this device's, the route is the agent's mirror of
 * the drone's mission instead, with the waypoint the drone reports.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { CircleMarker, Polyline, Tooltip } from "react-leaflet";
import { planIndicesForSeqs, useMissionStore } from "@/stores/mission-store";
import { useDroneManager } from "@/stores/drone-manager";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { specString } from "@/lib/cockpit/spec-strings";
import { gapReasonText } from "@/lib/hud/mission-stall";
import { useDronePlanIdentity, useMissionMirror } from "@/lib/mission/mission-mirror";
import { useCssVarColors } from "@/hooks/use-css-var-colors";

/** Route in the accent, the waypoint being flown to in the warning hue, a
 * waypoint the drone skipped (`mission.gaps`) as an open ring in the error hue
 * whose tooltip names why it was skipped.
 * Leaflet writes colours into SVG attributes, which cannot hold var(). */
const ROUTE_TOKENS = ["--alt-accent-primary", "--alt-status-warning", "--alt-status-error"] as const;

export function MissionRouteOverlay() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const localCurrent = useMissionStore((s) => s.currentWaypoint);
  const droneId = useDroneManager((s) => s.selectedDroneId);
  const mirrored = useDronePlanIdentity(droneId) === "differs";
  const mirror = useMissionMirror(droneId, mirrored);
  const { pilot } = usePilotState(droneId);
  const [routeColor, activeColor, skippedColor] = useCssVarColors(ROUTE_TOKENS);

  // Waypoints with a position, keeping their mission index for the readout.
  const points = useMemo(() => {
    if (mirrored) {
      return (mirror ?? []).map((p, index) => ({ index, seq: p.seq, pos: [p.lat, p.lon] as [number, number] }));
    }
    return waypoints.flatMap((wp, index) =>
      wp.lat !== 0 || wp.lon !== 0 ? [{ index, seq: index, pos: [wp.lat, wp.lon] as [number, number] }] : [],
    );
  }, [mirrored, mirror, waypoints]);
  // The mirror counts in the FC's sequence; find the vertex the drone flies to.
  const mirrorSeq = pilot?.mission?.seq ?? null;
  const current = mirrored
    ? (points.find((p) => p.seq === mirrorSeq)?.index ?? null)
    : localCurrent;
  const route = useMemo(() => points.map((p) => p.pos), [points]);
  // The skipped items count in the FC's sequence: the mirror carries it, the
  // local plan maps it the way MISSION_CURRENT is mapped. Each keeps the
  // reason of its latest gap.
  const gapKey = JSON.stringify((pilot?.mission?.gaps ?? []).map((g) => [g.seq, g.reason]));
  const skipped = useMemo(() => {
    const gaps = JSON.parse(gapKey) as [number, string | null][];
    const out = new Map<number, string | null>();
    for (const [seq, reason] of gaps) {
      const indices = mirrored
        ? points.filter((p) => p.seq === seq).map((p) => p.index)
        : waypoints.length > 0
          ? planIndicesForSeqs(droneId, [seq])
          : [];
      for (const index of indices) out.set(index, reason);
    }
    return out;
  }, [gapKey, mirrored, points, waypoints, droneId]);

  if (current === null || points.length === 0) return null;
  const active = points.find((p) => p.index === current);

  return (
    <>
      {route.length >= 2 && (
        <Polyline
          positions={route}
          interactive={false}
          pathOptions={{ color: routeColor, weight: 3, opacity: 0.9 }}
        />
      )}
      {points.map((p) =>
        p.index === current ? null : skipped.has(p.index) ? (
          <CircleMarker
            key={p.index}
            center={p.pos}
            radius={6}
            interactive={false}
            pathOptions={{ color: skippedColor, fillOpacity: 0, weight: 2 }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
                {gapLine(p.index + 1, skipped.get(p.index) ?? null)}
              </span>
            </Tooltip>
          </CircleMarker>
        ) : (
          <CircleMarker
            key={p.index}
            center={p.pos}
            radius={4}
            interactive={false}
            pathOptions={{ color: routeColor, fillColor: routeColor, fillOpacity: 0.9, weight: 1 }}
          />
        ),
      )}
      {active && (
        <CircleMarker
          center={active.pos}
          radius={8}
          interactive={false}
          pathOptions={{ color: activeColor, fillColor: activeColor, fillOpacity: 0.85, weight: 2 }}
        >
          <Tooltip direction="top" offset={[0, -8]} permanent>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
              WP {active.index + 1}
            </span>
          </Tooltip>
        </CircleMarker>
      )}
    </>
  );
}

/** A skipped waypoint's tooltip: "WP n · Skipped · <reason>" (`pilot.gap.line`),
 *  or "WP n · Skipped" for a gap without a reason. */
function gapLine(wp: number, reason: string | null): string {
  const text = gapReasonText(reason);
  return text
    ? specString("pilot.gap.line", { wp, reason: text })
    : `WP ${wp} · ${specString("setup.state.skipped")}`;
}
