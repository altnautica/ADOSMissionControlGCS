/**
 * @module nav/ned-geo
 * @description Local north/east metres → latitude/longitude about the EKF
 * origin, the follow target placed on the global (tile) minimap (the
 * target, and while it is sought its search ellipse, predicted path and the
 * vantage point; `followSceneTarget` decides what shows), and the pilot's way
 * round an obstacle (a mission detour or a routed return), and the moving
 * obstacles the pilot tracks. At the ranges these sit from their origin the
 * spherical offset is exact to well under a centimetre.
 *
 * @license GPL-3.0-only
 */

import { followSceneTarget } from "@/lib/hud/local-scene";
import type { RouteRoundPreview } from "@/lib/hud/cockpit-mission";
import type { FollowState, SearchArea } from "@/lib/hud/nav-types";
import { moverMarks, type MoverMark } from "@/lib/hud/movers";
import type { Mover } from "@/lib/hud/pilot-fields";
import { offsetPoint } from "@/lib/drawing/geo-utils";

/** `(north, east)` metres from `origin` as `[lat, lon]` degrees. */
export function nedToLatLon(origin: { lat: number; lon: number }, north: number, east: number): [number, number] {
  const distance = Math.hypot(north, east);
  if (distance === 0) return [origin.lat, origin.lon];
  const bearingDeg = (Math.atan2(east, north) * 180) / Math.PI;
  return offsetPoint(origin.lat, origin.lon, bearingDeg, distance);
}

/** Points sampled around the search ellipse's outline. */
export const SEARCH_RING_POINTS = 36;

/** The search ellipse as a closed ring of `(north, east)` points: the major
 * axis lies along `headingDeg` (clockwise from north). */
export function searchAreaRingNe(a: SearchArea, points = SEARCH_RING_POINTS): Array<[number, number]> {
  const h = (a.headingDeg * Math.PI) / 180;
  const [un, ue] = [Math.cos(h), Math.sin(h)];
  const [vn, ve] = [-Math.sin(h), Math.cos(h)];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points; i++) {
    const t = (2 * Math.PI * i) / points;
    const ca = a.semiMajorM * Math.cos(t);
    const sb = a.semiMinorM * Math.sin(t);
    out.push([a.centerNe[0] + ca * un + sb * vn, a.centerNe[1] + ca * ue + sb * ve]);
  }
  return out;
}

export interface FollowTargetGeo {
  position: [number, number];
  /** Where the target will be in 1 s, or null without a velocity. */
  tick: [number, number] | null;
  /** Sought (predicting, moving to look, searching): drawn dashed in the
   * coast colour. */
  dashed: boolean;
  /** The search ellipse outline while the subject is sought, else null. */
  searchRing: Array<[number, number]> | null;
  /** The predicted subject path while the subject is sought, else empty. */
  predictedPath: Array<[number, number]>;
  /** The vantage point while the follow flies to or searches from it. */
  vantage: [number, number] | null;
}

/**
 * The follow target on the tile map: null when the follow state is absent or
 * stale, follow-me is idle or holds for the operator, the target has no local
 * position, or the EKF origin is unknown.
 */
export function followTargetGeo(
  follow: FollowState | null,
  origin: { lat: number; lon: number } | null,
): FollowTargetGeo | null {
  const t = follow ? followSceneTarget(follow) : null;
  if (!t || !origin) return null;
  const geo = ([n, e]: readonly [number, number]) => nedToLatLon(origin, n, e);
  return {
    position: geo([t.north, t.east]),
    tick: t.velNorth !== null && t.velEast !== null ? geo([t.north + t.velNorth, t.east + t.velEast]) : null,
    dashed: t.dashed,
    searchRing: t.searchArea ? searchAreaRingNe(t.searchArea).map(geo) : null,
    predictedPath: (t.predictedPath ?? []).map(geo),
    vantage: t.vantageNe ? geo(t.vantageNe) : null,
  };
}

/** The way round on the tile map: the planned path and the detour's free
 *  point as `[lat, lon]`. */
export interface RouteRoundGeo {
  kind: RouteRoundPreview["kind"];
  path: Array<[number, number]>;
  target: [number, number] | null;
}

/** The pilot's way round placed about the EKF origin; null without a
 *  preview or without the origin. */
export function routeRoundGeo(
  preview: RouteRoundPreview | null,
  origin: { lat: number; lon: number } | null,
): RouteRoundGeo | null {
  if (!preview || !origin) return null;
  const geo = ([n, e]: readonly [number, number]) => nedToLatLon(origin, n, e);
  return { kind: preview.kind, path: preview.pathNe.map(geo), target: preview.targetNe ? geo(preview.targetNe) : null };
}

/** A tracked mover on the tile map: its position, its 2 s velocity arrow
 *  (shaft tip and the two barb ends, or null while it is still) as
 *  `[lat, lon]`, its one-sigma radius in metres and whether it is faded. */
export interface MoverGeo {
  id: number;
  kind: MoverMark["kind"];
  position: [number, number];
  arrow: { tip: [number, number]; barbs: [[number, number], [number, number]] } | null;
  sigmaM: number;
  faded: boolean;
}

/** The barbs are this share of the arrow's length, at ±30°. */
const BARB_SHARE = 0.25;

/** The pilot's movers placed about the EKF origin; none without it. */
export function moversGeo(movers: readonly Mover[], origin: { lat: number; lon: number } | null): MoverGeo[] {
  if (!origin) return [];
  return moverMarks(movers).map((m) => {
    let arrow: MoverGeo["arrow"] = null;
    if (m.leadNe) {
      const [tn, te] = m.leadNe;
      const [dn, de] = [tn - m.ne[0], te - m.ne[1]];
      const back = (rad: number): [number, number] => {
        const [c, s] = [Math.cos(rad), Math.sin(rad)];
        return nedToLatLon(origin, tn - BARB_SHARE * (dn * c - de * s), te - BARB_SHARE * (dn * s + de * c));
      };
      arrow = { tip: nedToLatLon(origin, tn, te), barbs: [back(Math.PI / 6), back(-Math.PI / 6)] };
    }
    return {
      id: m.id,
      kind: m.kind,
      position: nedToLatLon(origin, m.ne[0], m.ne[1]),
      arrow,
      sigmaM: m.sigmaM,
      faded: m.faded,
    };
  });
}
