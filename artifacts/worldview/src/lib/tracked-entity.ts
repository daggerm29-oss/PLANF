import type { Ship } from "../components/ShipsLayer";
import type { SatPosition } from "../components/SatelliteLayer";

export type EntityKind = "aircraft" | "ship" | "satellite";

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export interface FollowTarget {
  lat: number;
  lon: number;
  altM: number;
  headingDeg?: number;
  speedMs?: number;
}

export interface EntityField {
  label: string;
  value: string;
  accent?: boolean;
}

export interface ResolvedEntity {
  ref: EntityRef;
  name: string;
  classification: string;
  color: string;
  fields: EntityField[];
  target: FollowTarget | null;
  modelUrl: string;
}

export interface AircraftLike {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  squawk?: string;
  t?: string;
  desc?: string;
  r?: string;
}

export interface ResolveContext {
  aircraft: AircraftLike[];
  aircraftIsMil: boolean;
  ships: Ship[];
  satPosMap: Map<string, SatPosition>;
  base: string;
}

const FT_TO_M = 0.3048;
const KTS_TO_MS = 0.514444;
const EARTH_R_KM = 6371;

export function entityKey(ref: EntityRef | null): string | null {
  return ref ? `${ref.kind}:${ref.id}` : null;
}

export function altMetersFromBaro(alt: AircraftLike["alt_baro"]): number {
  if (alt === undefined || alt === null) return 300;
  if (alt === "ground") return 0;
  const n = Number(alt);
  return Number.isFinite(n) ? n * FT_TO_M : 300;
}

function fmtCoord(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function fmtNum(n: number | undefined, digits = 0, suffix = ""): string {
  return n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}${suffix}`;
}

function shipCoords(s: Ship): [number, number] | null {
  const lat = typeof s.lat === "number" ? s.lat : s.last_known_lat;
  const lon = typeof s.lon === "number" ? s.lon : s.last_known_lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return [lat, lon];
}

function resolveAircraft(ref: EntityRef, ctx: ResolveContext): ResolvedEntity | null {
  const a = ctx.aircraft.find((x) => x.hex === ref.id);
  if (!a) return null;
  const isMil = ctx.aircraftIsMil;
  const hasPos = a.lat !== undefined && a.lon !== undefined;
  const altLabel =
    a.alt_baro === "ground" ? "GROUND" : a.alt_baro === undefined ? "—" : `${Number(a.alt_baro).toLocaleString()} FT`;
  return {
    ref,
    name: (a.flight?.trim() || a.r || a.hex).toUpperCase(),
    classification: isMil ? "MILITARY AIRCRAFT" : "CIVIL AIRCRAFT",
    color: isMil ? "#ff6b35" : "#00ffff",
    fields: [
      { label: "ICAO HEX", value: a.hex.toUpperCase(), accent: true },
      { label: "TYPE", value: a.t || a.desc || "UNKNOWN" },
      { label: "REGISTRATION", value: a.r || "—" },
      { label: "SQUAWK", value: a.squawk || "—" },
      { label: "ALTITUDE", value: altLabel, accent: true },
      { label: "GROUND SPEED", value: fmtNum(a.gs, 0, " KTS") },
      { label: "HEADING", value: fmtNum(a.track, 0, "°") },
      { label: "POSITION", value: hasPos ? fmtCoord(a.lat!, a.lon!) : "—", accent: true },
    ],
    target: hasPos
      ? {
          lat: a.lat!,
          lon: a.lon!,
          altM: altMetersFromBaro(a.alt_baro),
          headingDeg: a.track,
          speedMs: a.gs !== undefined ? a.gs * KTS_TO_MS : undefined,
        }
      : null,
    modelUrl: `${ctx.base}/${isMil ? "military-aircraft.glb" : "aeroplane.glb"}`,
  };
}

function resolveShip(ref: EntityRef, ctx: ResolveContext): ResolvedEntity | null {
  const s = ctx.ships.find((x) => String(x.mmsi) === ref.id);
  if (!s) return null;
  const coords = shipCoords(s);
  const isGap = s.is_gap === true || s.source === "DARK_FLEET";
  const category = isGap ? "AIS GAP / DARK" : s.category || "UNKNOWN";
  const color = isGap
    ? "#ff9500"
    : s.category === "TANKER"
      ? "#ff3b30"
      : s.category === "MILITARY"
        ? "#3a8dff"
        : "#e6f7ff";
  const sog = typeof s.sog === "number" ? s.sog : typeof s.last_sog === "number" ? (s.last_sog as number) : undefined;
  const cog = typeof s.cog === "number" ? s.cog : typeof s.last_cog === "number" ? (s.last_cog as number) : undefined;
  const fields: EntityField[] = [
    { label: "MMSI", value: String(s.mmsi), accent: true },
    { label: "CATEGORY", value: category },
    { label: "FEED SOURCE", value: s.source || "—" },
    { label: "SPEED (SOG)", value: fmtNum(sog, 1, " KTS"), accent: true },
    { label: "COURSE (COG)", value: fmtNum(cog, 0, "°") },
    { label: "POSITION", value: coords ? fmtCoord(coords[0], coords[1]) : "—", accent: true },
  ];
  if (s.dwt) fields.push({ label: "DEADWEIGHT", value: `${Number(s.dwt).toLocaleString()} T` });
  if (s.est_barrels) fields.push({ label: "EST. CARGO", value: `${Number(s.est_barrels).toLocaleString()} BBL` });
  if (s.destination) fields.push({ label: "DESTINATION", value: String(s.destination).toUpperCase() });
  if (s.status) fields.push({ label: "STATUS", value: String(s.status).toUpperCase() });
  if (s.time_went_dark) fields.push({ label: "WENT DARK", value: String(s.time_went_dark) });
  if (typeof s.last_updated === "number") {
    const ms = s.last_updated > 1e12 ? s.last_updated : s.last_updated * 1000;
    fields.push({ label: "LAST AIS", value: new Date(ms).toISOString().slice(11, 19) + "Z" });
  }
  return {
    ref,
    name: (s.vessel_name || s.ship_name || `MMSI ${s.mmsi}`).toUpperCase(),
    classification: `VESSEL · ${category}`,
    color,
    fields,
    target: coords
      ? { lat: coords[0], lon: coords[1], altM: 0, headingDeg: cog, speedMs: sog !== undefined ? sog * KTS_TO_MS : undefined }
      : null,
    modelUrl: `${ctx.base}/${s.category === "TANKER" ? "tanker.glb" : "ship.glb"}`,
  };
}

function orbitRegime(p: SatPosition): string {
  if (p.isGeo) return "GEO";
  if (p.altKm < 2000) return "LEO";
  if (p.altKm < 35000) return "MEO";
  return "HEO";
}

function resolveSatellite(ref: EntityRef, ctx: ResolveContext): ResolvedEntity | null {
  const p = ctx.satPosMap.get(ref.id);
  if (!p) return null;
  const isIss = /\bISS\b|ZARYA/i.test(p.name);
  return {
    ref,
    name: p.name.toUpperCase(),
    classification: `SATELLITE · ${p.intelClass}`,
    color: p.color,
    fields: [
      { label: "NORAD ID", value: p.noradId, accent: true },
      { label: "ORIGIN", value: p.origin },
      { label: "INTEL CLASS", value: p.intelClass },
      { label: "ORBIT", value: orbitRegime(p) },
      { label: "ALTITUDE", value: `${p.altKm.toFixed(0)} KM`, accent: true },
      { label: "VELOCITY", value: `${p.velocityKms.toFixed(2)} KM/S` },
      { label: "SUB-POINT", value: fmtCoord(p.lat, p.lon), accent: true },
    ],
    target: {
      lat: p.lat,
      lon: p.lon,
      altM: p.altKm * 1000,
      // Ground-track speed: orbital velocity projected down to the surface.
      speedMs: p.velocityKms * 1000 * (EARTH_R_KM / (EARTH_R_KM + p.altKm)),
    },
    modelUrl: `${ctx.base}/${isIss ? "iss.glb" : "satellite.glb"}`,
  };
}

export function resolveEntity(ref: EntityRef | null, ctx: ResolveContext): ResolvedEntity | null {
  if (!ref) return null;
  switch (ref.kind) {
    case "aircraft":
      return resolveAircraft(ref, ctx);
    case "ship":
      return resolveShip(ref, ctx);
    case "satellite":
      return resolveSatellite(ref, ctx);
  }
}
