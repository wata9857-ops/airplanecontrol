// Builds data/layout_<ICAO>.json from OpenStreetMap (© OpenStreetMap contributors, ODbL)
// Overpass extracts in research/raw/osm_<ICAO>.json.
// Output: runways (precise ends), taxi graph (junction nodes + polyline edges),
// apron/terminal polygons, stands and holding points.
import fs from 'node:fs';

const AIRPORTS = ['RJBB', 'RJTT', 'RJAA', 'RJOO', 'RJBE'];
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const R = 6371008.8;
function meters(a, b) {
  const dLat = (b[0] - a[0]) * Math.PI / 180, dLon = (b[1] - a[1]) * Math.PI / 180;
  const x = dLon * Math.cos((a[0] + b[0]) / 2 * Math.PI / 180);
  return Math.hypot(x, dLat) * R;
}

for (const icao of AIRPORTS) {
  const src = `research/raw/osm_${icao}.json`;
  if (!fs.existsSync(src)) continue;
  const els = JSON.parse(fs.readFileSync(src, 'utf8')).elements;
  const nodePos = new Map();
  const ways = els.filter((e) => e.type === 'way');
  for (const w of ways) w.nodes.forEach((id, i) => nodePos.set(id, [r6(w.geometry[i].lat), r6(w.geometry[i].lon)]));

  // Runways: OSM may split one runway into several ways; merge by ref taking the
  // two farthest-apart end points, then orient so ends[0] is the threshold of
  // the first designator (e.g. "16R" of "16R/34L").
  const byRef = new Map();
  for (const w of ways) if (w.tags.aeroway === 'runway' && w.tags.ref) {
    const ref = w.tags.ref.replace(/\s/g, '');
    const e = byRef.get(ref) || { ref, width: +(w.tags.width || 45), pts: [], surface: w.tags.surface || '' };
    for (const g of w.geometry) e.pts.push([r6(g.lat), r6(g.lon)]);
    byRef.set(ref, e);
  }
  const runways = [];
  for (const e of byRef.values()) {
    let best = [e.pts[0], e.pts[1]], bd = 0;
    for (const a of e.pts) for (const b of e.pts) { const d = meters(a, b); if (d > bd) { bd = d; best = [a, b]; } }
    const [d1] = e.ref.split('/');
    const hdg1 = parseInt(d1, 10) * 10;
    const brg = (Math.atan2((best[1][1] - best[0][1]) * Math.cos(best[0][0] * Math.PI / 180), best[1][0] - best[0][0]) * 180 / Math.PI + 360) % 360;
    let diff = Math.abs(((brg - hdg1 + 540) % 360) - 180);
    if (diff > 90) best.reverse();
    runways.push({ ref: e.ref, width: e.width, ends: best, length: Math.round(bd), surface: e.surface });
  }

  // Taxi graph: taxiways + parking_position lanes + runways (so exits connect)
  const graphWays = ways.filter((w) => ['taxiway', 'parking_position', 'runway'].includes(w.tags.aeroway));
  const useCount = new Map();
  for (const w of graphWays) w.nodes.forEach((id, i) => {
    const inc = (i === 0 || i === w.nodes.length - 1) ? 2 : 1; // endpoints are always vertices
    useCount.set(id, (useCount.get(id) || 0) + inc);
  });
  const vIndex = new Map(); const vertices = [];
  const vid = (id) => { if (!vIndex.has(id)) { vIndex.set(id, vertices.length); vertices.push(nodePos.get(id)); } return vIndex.get(id); };
  const edges = [];
  for (const w of graphWays) {
    const kind = w.tags.aeroway === 'runway' ? 'R' : w.tags.aeroway === 'parking_position' ? 'P' : 'T';
    const name = w.tags.ref || w.tags.name || '';
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (useCount.get(w.nodes[i]) > 1 || i === w.nodes.length - 1) {
        const ids = w.nodes.slice(start, i + 1);
        const pts = ids.map((id) => nodePos.get(id));
        let len = 0; for (let k = 1; k < pts.length; k++) len += meters(pts[k - 1], pts[k]);
        edges.push({ a: vid(ids[0]), b: vid(ids.at(-1)), k: kind, n: name, len: Math.round(len), p: pts.slice(1, -1) });
        start = i;
      }
    }
  }

  const poly = (aw) => ways.filter((w) => w.tags.aeroway === aw && w.geometry.length > 2).map((w) => ({ name: w.tags.name || w.tags.ref || '', pts: w.geometry.map((g) => [r6(g.lat), r6(g.lon)]) }));

  // Stands: prefer parking_position nodes; fall back to last node of parking_position ways.
  const stands = [];
  const seen = new Set();
  for (const e of els) if (e.type === 'node' && e.tags.aeroway === 'parking_position' && e.tags.ref) { stands.push({ ref: e.tags.ref, pos: [r6(e.lat), r6(e.lon)], node: vIndex.has(e.id) ? vIndex.get(e.id) : null }); seen.add(e.tags.ref); }
  for (const w of ways) if (w.tags.aeroway === 'parking_position' && w.tags.ref && !seen.has(w.tags.ref)) {
    const id = w.nodes.at(-1);
    stands.push({ ref: w.tags.ref, pos: nodePos.get(id), node: vIndex.get(id) ?? null, lane: true });
    seen.add(w.tags.ref);
  }
  const holds = els.filter((e) => e.type === 'node' && e.tags.aeroway === 'holding_position').map((e) => ({ ref: e.tags.ref || '', pos: [r6(e.lat), r6(e.lon)], node: vIndex.has(e.id) ? vIndex.get(e.id) : null }));

  // Aerodrome boundary (land fill for reclaimed airport islands missing from small-scale coastlines)
  const boundary = [];
  const AD = 'research/raw/osm_aerodromes.json';
  if (fs.existsSync(AD)) {
    for (const e of JSON.parse(fs.readFileSync(AD, 'utf8')).elements) {
      if (e.tags?.icao !== icao) continue;
      const segs = e.type === 'way' ? [e.geometry] : (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry);
      // join open segments into rings by matching end points
      const pts = segs.map((g) => g.map((p) => [r6(p.lat), r6(p.lon)]));
      while (pts.length) {
        let ring = pts.shift();
        let grown = true;
        while (grown && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) {
          grown = false;
          for (let i = 0; i < pts.length; i++) {
            const s = pts[i], same = (a, b) => a[0] === b[0] && a[1] === b[1];
            if (same(ring.at(-1), s[0])) ring = ring.concat(s.slice(1));
            else if (same(ring.at(-1), s.at(-1))) ring = ring.concat([...s].reverse().slice(1));
            else continue;
            pts.splice(i, 1); grown = true; break;
          }
        }
        if (ring.length > 3) boundary.push(ring);
      }
    }
  }

  const out = { icao, source: 'OpenStreetMap contributors (ODbL), via Overpass API', runways, vertices, edges, aprons: poly('apron'), terminals: poly('terminal'), stands, holds, boundary };
  fs.writeFileSync(`data/layout_${icao}.json`, JSON.stringify(out));
  console.log(icao, 'rwy', runways.map((r) => r.ref + ':' + r.length + 'm').join(' '), 'V', vertices.length, 'E', edges.length, 'stands', stands.length, 'holds', holds.length, 'bytes', fs.statSync(`data/layout_${icao}.json`).size);
}
