/** Phone GPS math. Distances are on the ground, not a guessed straight line. */

export type GeoPoint = { lat: number; lng: number };

const EARTH_M = 6371000;

export function haversine(a: GeoPoint, b: GeoPoint): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dLat = p2 - p1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathMeters(points: GeoPoint[]): number {
  let meters = 0;
  for (let i = 1; i < points.length; i += 1) meters += haversine(points[i - 1]!, points[i]!);
  return meters;
}

export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function compassLabel(bearing: number): string {
  const dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  const wrapped = ((bearing % 360) + 360) % 360;
  return dirs[Math.round(wrapped / 45) % 8]!;
}

/** A point this many metres from start, along a compass bearing (0 = north). */
export function destinationPoint(start: GeoPoint, bearing: number, meters: number): GeoPoint {
  const delta = meters / EARTH_M;
  const theta = (bearing * Math.PI) / 180;
  const lat1 = (start.lat * Math.PI) / 180;
  const lng1 = (start.lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  let lng = (lng2 * 180) / Math.PI;
  lng = ((lng + 540) % 360) - 180;
  return { lat: (lat2 * 180) / Math.PI, lng };
}

/** Keep a route small enough to save. The first and last points always stay. */
export function simplifyRoute(points: GeoPoint[], max = 80): GeoPoint[] {
  if (points.length <= max) return points.map((point) => ({ lat: round6(point.lat), lng: round6(point.lng) }));
  const step = (points.length - 1) / (max - 1);
  const out: GeoPoint[] = [];
  for (let i = 0; i < max; i += 1) {
    const point = points[Math.round(i * step)]!;
    out.push({ lat: round6(point.lat), lng: round6(point.lng) });
  }
  return out;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Web-mercator tile coordinates. x/y are in tile units, including the fraction. */
export function worldToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** A view that keeps every point on screen, with padding. */
export function fitZoom(
  points: GeoPoint[],
  width: number,
  height: number,
): { center: GeoPoint; zoom: number } {
  const first = points[0] ?? { lat: 0, lng: 0 };
  if (points.length === 0 || width < 40 || height < 40) return { center: first, zoom: 15 };
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const pad = 72;
  for (let zoom = 17; zoom >= 12; zoom -= 1) {
    const northWest = worldToTile(maxLat, minLng, zoom);
    const southEast = worldToTile(minLat, maxLng, zoom);
    const spanX = Math.abs(southEast.x - northWest.x) * 256;
    const spanY = Math.abs(southEast.y - northWest.y) * 256;
    if (spanX <= width - pad && spanY <= height - pad) return { center, zoom };
  }
  return { center, zoom: 12 };
}

/** Ground metres per screen pixel at this latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export function tileToWorld(x: number, y: number, zoom: number): GeoPoint {
  const n = 2 ** zoom;
  const lng = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lng };
}
