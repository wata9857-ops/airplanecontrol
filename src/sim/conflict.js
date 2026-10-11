// Short-term conflict alert (STCA) and separation monitoring.
// Minima: terminal radar 3 NM (inside terminal areas below FL200), enroute
// radar 5 NM, vertical 1000 ft (RVSM, up to FL410). Independent parallel
// approaches to different runways of the same airport are excluded once both
// aircraft are established on their localisers.
import { dist } from '../geo.js';

const LOOKAHEAD = 120; // s
const STEP = 10;

export class ConflictProbe {
  constructor(world) { this.w = world; this.acc = 0; this.active = new Map(); this.list = []; }

  minima(a, b) {
    const term = this.inTerminal(a) && this.inTerminal(b);
    return { h: term ? 3 : 5, v: 1000 };
  }
  inTerminal(ac) {
    if (ac.alt > 20000) return false;
    for (const ap of this.w.airports.values()) if (ap.major && dist(ac, ap) < 45) return true;
    return false;
  }
  excluded(a, b) {
    const ag = (x) => x.alt - (this.w.elevFor(x) || 0);
    if (ag(a) < 900 || ag(b) < 900) return true; // tower environment / below radar coverage of interest
    if (a.appr?.established && b.appr?.established && a.arrRwy && b.arrRwy && a.arrRwy !== b.arrRwy && a.arrRwy.airport === b.arrRwy.airport) return true;
    // Procedural / tower separation at the same airport: arrival established on
    // final (or going around) vs a departure in its initial climb.
    for (const [x, y] of [[a, b], [b, a]]) {
      const ap = x.arrRwy?.airport;
      if (!ap || y.dir !== 'DEP' || y.from !== ap.icao) continue;
      const yInit = y.airborneAt != null && this.w.time - y.airborneAt < 150 && y.alt < 6000;
      if (yInit && ((x.appr?.established && x.appr.distThr < 12) || x.phase === 'GOAROUND')) return true;
    }
    return false;
  }

  update(dt) {
    this.acc += dt;
    if (this.acc < 1) return;
    this.acc = 0;
    const air = this.w.aircraft.filter((a) => !a.onGround);
    const found = [];
    for (let i = 0; i < air.length; i++) {
      const a = air[i];
      for (let j = i + 1; j < air.length; j++) {
        const b = air[j];
        if (Math.abs(a.alt - b.alt) > 4000 && Math.abs(a.vs) < 500 && Math.abs(b.vs) < 500) continue;
        const dh0 = dist(a, b);
        if (dh0 > 30) continue;
        if (this.excluded(a, b)) continue;
        const m = this.minima(a, b);
        const dv0 = Math.abs(a.alt - b.alt);
        if (dh0 < m.h - 0.05 && dv0 < m.v - 200) { found.push({ a, b, level: 'LOS', tca: 0, dh: dh0, dv: dv0 }); continue; }
        // linear prediction
        const va = vel(a), vb = vel(b);
        for (let t = STEP; t <= LOOKAHEAD; t += STEP) {
          const dx = (b.x + vb.x * t) - (a.x + va.x * t), dy = (b.y + vb.y * t) - (a.y + va.y * t);
          const altA = predAlt(a, t), altB = predAlt(b, t);
          if (Math.hypot(dx, dy) < m.h && Math.abs(altA - altB) < m.v - 200) { found.push({ a, b, level: 'STCA', tca: t, dh: dh0, dv: dv0 }); break; }
        }
      }
    }
    // bookkeeping: count new losses of separation
    const now = new Map();
    for (const c of found) {
      const k = c.a.id < c.b.id ? `${c.a.id}-${c.b.id}` : `${c.b.id}-${c.a.id}`;
      now.set(k, c);
      const prev = this.active.get(k);
      if (c.level === 'LOS' && (!prev || prev.level !== 'LOS')) {
        this.w.stats.losses++;
        this.w.log('los', { a: c.a.callsign, b: c.b.callsign, dh: c.dh.toFixed(1), dv: Math.round(c.dv) }, 'alert', c.a);
      } else if (c.level === 'STCA' && !prev) {
        this.w.log('stca', { a: c.a.callsign, b: c.b.callsign, t: c.tca }, 'warn', c.a);
      }
    }
    this.active = now;
    this.list = found;
    // weather cells
    for (const ac of air) {
      ac.inWx = this.w.weatherCells.some((c) => dist(ac, c) < c.r && ac.alt < c.top);
    }
  }

  // Would a climb/descent to `target` conflict within 2 minutes?
  climbBlocked(ac, target) {
    const lo = Math.min(ac.alt, target) - 900, hi = Math.max(ac.alt, target) + 900;
    const va = vel(ac);
    for (const o of this.w.aircraft) {
      if (o === ac || o.onGround) continue;
      if (o.alt < lo || o.alt > hi) continue;
      const vb = vel(o);
      for (let t = 0; t <= 150; t += 15) {
        const dx = (o.x + vb.x * t) - (ac.x + va.x * t), dy = (o.y + vb.y * t) - (ac.y + va.y * t);
        if (Math.hypot(dx, dy) < 6) return o;
      }
    }
    return null;
  }

  alertsFor(ac) { return this.list.filter((c) => c.a === ac || c.b === ac); }
}

function vel(ac) {
  const r = ac.trk * Math.PI / 180;
  return { x: Math.sin(r) * ac.gs / 3600, y: Math.cos(r) * ac.gs / 3600 };
}
function predAlt(ac, t) {
  const target = ac.clearedAlt;
  const p = ac.alt + ac.vs / 60 * t;
  if (ac.appr?.gsCaptured) return p;
  if (ac.vs > 0) return Math.min(p, Math.max(target, ac.alt));
  if (ac.vs < 0) return Math.max(p, Math.min(target, ac.alt));
  return p;
}
