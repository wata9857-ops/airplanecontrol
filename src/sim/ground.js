// Airport surface model: taxi graph built from OpenStreetMap taxiway data,
// A* taxi routing, stand allocation, runway entry/exit selection and
// ground movement (pushback, taxi, line-up, take-off roll, landing roll-out).
import { toXY, dist, bearing, angDiff, norm360, project, rad } from '../geo.js';

const M2NM = 1 / 1852;

export class AirportGround {
  constructor(layout, airport) {
    this.icao = layout.icao;
    this.airport = airport;
    this.v = layout.vertices.map(([la, lo]) => toXY(la, lo));
    this.adj = this.v.map(() => []);
    this.edges = layout.edges.map((e, i) => {
      const pts = [this.v[e.a], ...e.p.map(([la, lo]) => toXY(la, lo)), this.v[e.b]];
      const ed = { i, a: e.a, b: e.b, k: e.k, n: e.n, len: e.len * M2NM, pts };
      this.adj[e.a].push({ to: e.b, e: ed, fwd: true });
      this.adj[e.b].push({ to: e.a, e: ed, fwd: false });
      return ed;
    });
    this.stands = layout.stands.filter((s) => s.node != null && this.adj[s.node].length).map((s) => ({ ref: s.ref, node: s.node, pos: toXY(s.pos[0], s.pos[1]), occupied: null }));
    this.aprons = layout.aprons.map((a) => ({ name: a.name, pts: a.pts.map(([la, lo]) => toXY(la, lo)) }));
    this.terminals = layout.terminals.map((a) => ({ name: a.name, pts: a.pts.map(([la, lo]) => toXY(la, lo)) }));
    this.boundary = (layout.boundary || []).map((ring) => ring.map(([la, lo]) => toXY(la, lo)));
    this.runwayVerts = new Set();
    this.taxiVerts = new Set();
    for (const e of this.edges) {
      if (e.k === 'R') { this.runwayVerts.add(e.a); this.runwayVerts.add(e.b); }
      else if (e.k === 'T') { this.taxiVerts.add(e.a); this.taxiVerts.add(e.b); }
    }
    // keep only the connected component that contains the runways
    // (OSM data has small isolated fragments: GSE roads, hangars, etc.)
    const comp = new Uint8Array(this.v.length);
    const stack = [...this.runwayVerts];
    stack.forEach((i) => (comp[i] = 1));
    while (stack.length) { const c = stack.pop(); for (const n of this.adj[c]) if (!comp[n.to]) { comp[n.to] = 1; stack.push(n.to); } }
    this.inMain = comp;
    this.stands = this.stands.filter((s) => comp[s.node]);
    for (const set of [this.taxiVerts]) for (const i of [...set]) if (!comp[i]) set.delete(i);
  }

  nearestVertex(p, pred = () => true) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.v.length; i++) {
      if (!this.adj[i].length || !this.inMain[i] || !pred(i)) continue;
      const d = dist(p, this.v[i]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // A* over the taxi graph. Runways are strongly penalised so aircraft only
  // use them to enter/exit/cross; stand lanes are penalised unless they are
  // the start or goal.
  path(from, to) {
    if (from < 0 || to < 0) return null;
    const goal = this.v[to];
    const g = new Map([[from, 0]]), came = new Map();
    const open = [[dist(this.v[from], goal), from]];
    const closed = new Set();
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === to) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      for (const nb of this.adj[cur]) {
        let w = nb.e.len;
        if (nb.e.k === 'R') w *= 25;
        if (nb.e.k === 'P' && nb.to !== to && cur !== from) w *= 8;
        const ng = g.get(cur) + w;
        if (ng < (g.get(nb.to) ?? Infinity)) {
          g.set(nb.to, ng); came.set(nb.to, { prev: cur, nb });
          open.push([ng + dist(this.v[nb.to], goal), nb.to]);
        }
      }
    }
    if (!came.has(to) && from !== to) return null;
    const steps = [];
    for (let c = to; c !== from; c = came.get(c).prev) steps.unshift(came.get(c).nb);
    const pts = [this.v[from]];
    const names = [];
    for (const s of steps) {
      const seg = s.fwd ? s.e.pts : [...s.e.pts].reverse();
      for (let k = 1; k < seg.length; k++) pts.push(seg[k]);
      if (s.e.n && s.e.k === 'T' && names.at(-1) !== s.e.n) names.push(s.e.n);
    }
    return { pts, names, end: to };
  }

  // Vertex where departing aircraft hold short / enter the runway: the
  // runway vertex nearest the threshold that connects to a taxiway.
  entryVertex(rwy) {
    let best = -1, bd = Infinity;
    for (const i of this.runwayVerts) {
      if (!this.adj[i].some((n) => n.e.k === 'T')) continue;
      const d = dist(this.v[i], rwy.start);
      // must be on the runway within the first ~600 m of the take-off end
      const along = alongRunway(rwy, this.v[i]) - alongRunway(rwy, rwy.start);
      if (along < -0.1 || along > 0.35) continue;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) best = this.nearestVertex(rwy.start, (i) => this.taxiVerts.has(i));
    return best;
  }
  // Taxiway vertex adjacent to the runway entry (the holding point)
  holdingVertex(rwy) {
    const ent = this.entryVertex(rwy);
    const nb = this.adj[ent]?.find((n) => n.e.k === 'T');
    return { entry: ent, hold: nb ? nb.to : ent };
  }

  // First runway/taxiway junction beyond `minAlong` NM from the threshold,
  // preferring exits that turn less than ~60° (rapid exits).
  exitVertex(rwy, minAlong) {
    let best = -1, ba = Infinity;
    for (const i of this.runwayVerts) {
      const along = alongRunway(rwy, this.v[i]);
      if (along < minAlong || along > rwy.lengthNm + 0.05) continue;
      if (Math.abs(crossRunway(rwy, this.v[i])) > 0.03) continue;
      const tw = this.adj[i].filter((n) => n.e.k === 'T');
      if (!tw.length) continue;
      if (along < ba) { ba = along; best = i; }
    }
    return best;
  }

  allocateStand(pref) {
    const free = this.stands.filter((s) => !s.occupied);
    if (!free.length) return null;
    let list = free;
    if (pref) { const p = free.filter(pref); if (p.length) list = p; }
    return list[Math.floor(Math.random() * list.length)];
  }
}

export function alongRunway(rwy, p) {
  const dx = p.x - rwy.thr.x, dy = p.y - rwy.thr.y;
  return dx * Math.sin(rad(rwy.trueHdg)) + dy * Math.cos(rad(rwy.trueHdg));
}
export function crossRunway(rwy, p) {
  const dx = p.x - rwy.thr.x, dy = p.y - rwy.thr.y;
  return dx * Math.cos(rad(rwy.trueHdg)) - dy * Math.sin(rad(rwy.trueHdg));
}

// Move an aircraft along a polyline (taxi). Returns true when finished.
export function followPolyline(ac, dt, world) {
  const t = ac.taxi;
  if (!t || !t.pts.length) return true;
  // speed target: slow for sharp corners ahead
  let target = t.maxSpd ?? 18;
  const look = cornerAhead(t, ac);
  if (look.angle > 45 && look.dist < 0.05) target = Math.min(target, 8);
  if (t.i >= t.pts.length - 1) return true;
  const remainingTotal = remaining(t, ac);
  if (remainingTotal < 0.03) target = Math.min(target, 5);
  // stop for traffic ahead
  if (world.groundBlocked(ac)) target = 0;
  if (t.hold) target = 0;
  const acc = target > ac.gsGround ? 1.0 : 2.0;
  ac.gsGround += Math.max(-acc * dt, Math.min(acc * dt, target - ac.gsGround));
  let step = ac.gsGround / 3600 * dt;
  while (step > 0 && t.i < t.pts.length - 1) {
    const a = { x: ac.x, y: ac.y }, b = t.pts[t.i + 1];
    const d = dist(a, b);
    if (d < 1e-6) { t.i++; continue; }
    const brg = bearing(a, b);
    if (step >= d) { ac.x = b.x; ac.y = b.y; step -= d; t.i++; }
    else { ac.x += (b.x - a.x) / d * step; ac.y += (b.y - a.y) / d * step; step = 0; }
    ac.hdg = t.reverse ? norm360(brg + 180) : brg;
  }
  ac.gs = ac.gsGround; ac.ias = ac.gsGround; ac.trk = ac.hdg;
  return t.i >= t.pts.length - 1;
}

function remaining(t, ac) {
  let d = dist(ac, t.pts[Math.min(t.i + 1, t.pts.length - 1)]);
  for (let k = t.i + 1; k < t.pts.length - 1; k++) d += dist(t.pts[k], t.pts[k + 1]);
  return d;
}
function cornerAhead(t, ac) {
  let d = 0, prevBrg = null, p = { x: ac.x, y: ac.y };
  for (let k = t.i + 1; k < t.pts.length && d < 0.08; k++) {
    const b = bearing(p, t.pts[k]);
    const seg = dist(p, t.pts[k]);
    if (prevBrg != null && seg > 0.002) {
      const a = Math.abs(angDiff(prevBrg, b));
      if (a > 45) return { angle: a, dist: d };
    }
    if (seg > 0.002) prevBrg = b;
    d += seg; p = t.pts[k];
  }
  return { angle: 0, dist: 1 };
}
