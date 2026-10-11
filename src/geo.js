// Geodesy helpers. The simulation works in a planar "world" frame measured in
// nautical miles (x east, y north) around a fixed reference point between
// Kansai and Kanto. Equirectangular projection with cos(lat) evaluated per
// point keeps local distances within ~0.1% over the domain.

export const REF = { lat: 35.0, lon: 137.5 };
const NM_PER_DEG_LAT = 60.0;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function toXY(lat, lon) {
  // Use the mean latitude of point and reference to scale longitude.
  const k = Math.cos(((lat + REF.lat) / 2) * D2R);
  return { x: (lon - REF.lon) * NM_PER_DEG_LAT * k, y: (lat - REF.lat) * NM_PER_DEG_LAT };
}

export function toLatLon(x, y) {
  const lat = REF.lat + y / NM_PER_DEG_LAT;
  const k = Math.cos(((lat + REF.lat) / 2) * D2R);
  return { lat, lon: REF.lon + x / (NM_PER_DEG_LAT * k) };
}

export const norm360 = (a) => ((a % 360) + 360) % 360;
export const angDiff = (a, b) => { let d = norm360(b - a); if (d > 180) d -= 360; return d; }; // b relative to a, -180..180
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const bearing = (a, b) => norm360(Math.atan2(b.x - a.x, b.y - a.y) * R2D); // true, degrees
export const rad = (d) => d * D2R;
export const deg = (r) => r * R2D;

export function project(p, brgDeg, nm) {
  return { x: p.x + Math.sin(brgDeg * D2R) * nm, y: p.y + Math.cos(brgDeg * D2R) * nm };
}

// Magnetic variation (west negative). Japan AIP values are ~7–8°W across
// Kansai/Kanto; a linear fit is sufficient for the domain.
export function magVar(lat, lon) {
  return -(7.6 + (lat - 34.5) * 0.3);
}
export const trueToMag = (t, lat = 35, lon = 137) => norm360(t - magVar(lat, lon));
export const magToTrue = (m, lat = 35, lon = 137) => norm360(m + magVar(lat, lon));

// Cross-track / along-track of point p relative to segment a->b.
export function trackInfo(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  const ux = dx / len, uy = dy / len;
  const px = p.x - a.x, py = p.y - a.y;
  return { along: px * ux + py * uy, cross: px * uy - py * ux, len }; // cross > 0 => right of track
}

export const fmtAlt = (ft) => (ft >= 14000 ? 'FL' + String(Math.round(ft / 100)).padStart(3, '0') : Math.round(ft).toLocaleString('en-US'));
export const pad3 = (n) => String(Math.round(n)).padStart(3, '0');
