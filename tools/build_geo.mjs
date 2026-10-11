// Builds data/geo_land.json from Natural Earth 10m land polygons (public domain),
// clipped to the simulation domain and simplified.
// Usage: node tools/build_geo.mjs
import fs from 'node:fs';

const SRC = 'research/raw/coast10.geojson';
const OUT = 'data/geo_land.json';
const BBOX = { minLon: 128.5, maxLon: 146.0, minLat: 30.0, maxLat: 41.5 };
const TOL = 0.004; // degrees (~400 m)

function clipRing(ring, edge) {
  // Sutherland–Hodgman against one axis-aligned edge
  const inside = (p) => {
    switch (edge.k) {
      case 'minLon': return p[0] >= edge.v;
      case 'maxLon': return p[0] <= edge.v;
      case 'minLat': return p[1] >= edge.v;
      case 'maxLat': return p[1] <= edge.v;
    }
  };
  const isect = (a, b) => {
    const i = edge.k.endsWith('Lon') ? 0 : 1;
    const t = (edge.v - a[i]) / (b[i] - a[i]);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  const out = [];
  for (let n = 0; n < ring.length; n++) {
    const cur = ring[n], prev = ring[(n + ring.length - 1) % ring.length];
    const ci = inside(cur), pi = inside(prev);
    if (ci) { if (!pi) out.push(isect(prev, cur)); out.push(cur); }
    else if (pi) out.push(isect(prev, cur));
  }
  return out;
}

function dp(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    const [x1, y1] = points[s], [x2, y2] = points[e];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1e-12;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = points[i];
      let t = ((x - x1) * dx + (y - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ddx = x - (x1 + t * dx), ddy = y - (y1 + t * dy);
      const d = ddx * ddx + ddy * ddy;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol * tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

const gj = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const polys = [];
for (const f of gj.features) {
  const g = f.geometry;
  const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of list) {
    const outer = poly[0];
    let minx = 999, maxx = -999, miny = 999, maxy = -999;
    for (const [x, y] of outer) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    if (maxx < BBOX.minLon || minx > BBOX.maxLon || maxy < BBOX.minLat || miny > BBOX.maxLat) continue;
    let r = outer;
    for (const k of ['minLon', 'maxLon', 'minLat', 'maxLat']) { r = clipRing(r, { k, v: BBOX[k] }); if (!r.length) break; }
    if (r.length < 3) continue;
    r = dp(r, TOL);
    if (r.length < 3) continue;
    polys.push(r.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]));
  }
}
fs.writeFileSync(OUT, JSON.stringify({ source: 'Natural Earth 10m land (public domain)', bbox: BBOX, polygons: polys }));
console.log('polygons', polys.length, 'points', polys.reduce((a, p) => a + p.length, 0), 'bytes', fs.statSync(OUT).size);
