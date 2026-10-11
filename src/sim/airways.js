// Airway network routing (Dijkstra) over researched airway segments.
// Used to connect domain entry points / SID ends with STAR entry fixes.
import { dist, bearing, angDiff } from '../geo.js';

export class AirwayGraph {
  constructor(world) {
    this.w = world;
    this.adj = new Map();
    for (const a of world.airways) {
      const pts = a.points.map((id) => world.fix(id)).filter(Boolean);
      for (let i = 1; i < pts.length; i++) this.link(pts[i - 1], pts[i], a.id);
    }
  }
  link(a, b, awy) {
    if (!this.adj.has(a.id)) this.adj.set(a.id, []);
    if (!this.adj.has(b.id)) this.adj.set(b.id, []);
    const d = dist(a, b);
    this.adj.get(a.id).push({ to: b.id, d, awy });
    this.adj.get(b.id).push({ to: a.id, d, awy });
  }

  // Route from an arbitrary point to waypoint `toWp`. Joins the network at a
  // node roughly in the direction of travel. Returns [] when going direct is
  // nearly as short (or the network does not help).
  route(fromPt, toWp) {
    const direct = dist(fromPt, toWp);
    if (direct < 40) return [];
    const target = this.adj.has(toWp.id) ? toWp.id : null;
    if (!target) return [];
    const brg = bearing(fromPt, toWp);
    // candidate entry nodes: within 35 NM, roughly ahead
    const starts = [];
    for (const id of this.adj.keys()) {
      const f = this.w.fix(id); const d = dist(fromPt, f);
      if (d < 35 && Math.abs(angDiff(brg, bearing(fromPt, f))) < 70) starts.push({ id, d });
    }
    if (!starts.length) return [];
    const D = new Map(), prev = new Map(), open = [];
    for (const s of starts) { D.set(s.id, s.d); open.push(s.id); }
    const done = new Set();
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (D.get(open[i]) < D.get(open[bi])) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (done.has(cur)) continue; done.add(cur);
      if (cur === target) break;
      for (const e of this.adj.get(cur)) {
        const nd = D.get(cur) + e.d;
        if (nd < (D.get(e.to) ?? Infinity)) { D.set(e.to, nd); prev.set(e.to, cur); open.push(e.to); }
      }
    }
    if (!D.has(target) || D.get(target) > direct * 1.35) return [];
    const ids = [];
    for (let c = target; c != null; c = prev.get(c)) ids.unshift(c);
    ids.pop(); // the target itself is the first STAR fix
    return ids.map((id) => { const f = this.w.fix(id); return { id, x: f.x, y: f.y, kind: 'ENR', altMin: null, altMax: null, spd: null }; });
  }
}
