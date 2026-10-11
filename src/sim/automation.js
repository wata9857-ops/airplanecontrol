// Automatic ATC: routes/procedure assignment, arrival sequencing (AMAN-style
// slot allocation with speed control and holding), approach clearances,
// final-approach spacing monitoring, runway use, departure release and
// climb clearances. Every action yields to manual (user) instructions.
import { dist, bearing, angDiff, norm360, project, toXY, magToTrue, trueToMag, rad } from '../geo.js';
import { WAKE_NM, tasFromIas } from './performance.js';
import { alongRunway } from './ground.js';

const FINAL_MIN_NM = 3.0;   // radar minimum on final (Japan terminal radar 3 NM)
const SMALL_TYPES = new Set(['DH8D', 'AT76', 'AT46', 'E170', 'E190', 'CRJ7', 'B737']);

export class Automation {
  constructor(world) {
    this.w = world;
    this.t = 0;
    this.enabled = { arrivals: true, departures: true };
  }

  // ======================= route planning =======================
  wp(id, cons = {}) {
    const f = this.w.fix(id);
    if (!f) return null;
    return { id, x: f.x, y: f.y, altMin: cons.altMin ?? null, altMax: cons.altMax ?? null, spd: cons.speed ?? cons.spd ?? null, kind: cons.kind || 'FIX' };
  }
  legsToWps(legs, kind) {
    const out = [];
    for (const l of legs || []) { const w = this.wp(l.fix, { ...l, kind }); if (w && (!out.length || out.at(-1).id !== w.id)) out.push(w); }
    return out;
  }

  procs(icao) { return this.w.procedures[icao] || { stars: [], sids: [], approaches: [] }; }

  // choose arrival runway for an aircraft given the active configuration
  pickArrRunway(ap, fromPt) {
    const cfg = this.w.config(ap);
    const cands = cfg.arr.map((id) => ap.runways.get(id)).filter((r) => r && !r.closed);
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0];
    // rule-based assignment if configuration defines arrival split by bearing
    if (cfg.arrSplit) {
      const brg = bearing(ap, fromPt);
      for (const s of cfg.arrSplit) if (inSector(brg, s.from, s.to)) { const r = ap.runways.get(s.rwy); if (r && !r.closed) return r; }
    }
    // balance by count of assigned arrivals
    const load = (r) => this.w.aircraft.filter((a) => a.arrRwy === r && !a.landedAt).length;
    return cands.reduce((a, b) => (load(a) <= load(b) ? a : b));
  }

  pickDepRunway(ap, destPt) {
    const cfg = this.w.config(ap);
    const cands = cfg.dep.map((id) => ap.runways.get(id)).filter((r) => r && !r.closed);
    if (!cands.length) return null;
    if (cfg.smallDep && SMALL_TYPES.has(this._depType)) { const r = ap.runways.get(cfg.smallDep); if (r && !r.closed) return r; }
    if (cands.length === 1) return cands[0];
    const brg = bearing(ap, destPt);
    const pref = cfg.depSplit?.find((s) => inSector(brg, s.from, s.to))?.rwy;
    const load = (r) => this.w.aircraft.filter((a) => a.onGround && a.depRwy === r && a.phase !== 'PARKED').length;
    let best = cands[0], bs = Infinity;
    for (const r of cands) { const sc = load(r) * (cfg.mixed?.includes(r.id) || cfg.arr.includes(r.id) ? 1.6 : 1) + (r.id === pref ? 0 : 6); if (sc < bs) { bs = sc; best = r; } }
    return best;
  }

  // STAR: prefer procedures for the runway whose first fix is closest to the
  // aircraft's inbound direction.
  pickStar(ap, rwy, fromPt) {
    const stars = this.procs(ap.icao).stars.filter((s) => !s.runways?.length || s.runways.includes(rwy.id) || s.runways.includes('ALL'));
    let best = null, bs = Infinity;
    for (const s of stars) {
      const wps = this.legsToWps(s.legs, 'STAR');
      if (wps.length < 2) continue;
      const first = wps[0];
      const off = Math.abs(angDiff(bearing(ap, first), bearing(ap, fromPt)));
      const lastId = wps.at(-1).id;
      const connects = this.procs(ap.icao).approaches.some((a) => a.runway === rwy.id && a.legs.some((l) => l.fix === lastId));
      const score = off * 2 + dist(fromPt, first) * 0.05 + (connects ? 0 : 80);
      if (score < bs) { bs = score; best = { s, wps }; }
    }
    return best;
  }

  pickApproach(ap, rwy, lastFix) {
    const pref = (a) => (/^ILS Z/.test(a.name) ? 0 : /^ILS/.test(a.name) ? 1 : /^RNP/.test(a.name) ? 2 : 3);
    const apps = this.procs(ap.icao).approaches.filter((a) => a.runway === rwy.id).sort((a, b) => pref(a) - pref(b));
    if (!apps.length) return null;
    // Only legs up to and including the FAF: the final segment is flown on the localiser.
    const upToFaf = (legs) => { const f = legs.findIndex((l) => l.role === 'FAF'); return (f >= 0 ? legs.slice(0, f + 1) : legs).filter((l) => !/^RW/.test(l.fix) && l.role !== 'MAPt'); };
    // 1) an approach containing the STAR's last fix: continue after it,
    //    skipping alternative IAFs listed next to it
    if (lastFix) for (const a of apps) {
      const legs = upToFaf(a.legs || []);
      const i = legs.findIndex((l) => l.fix === lastFix.id);
      if (i < 0) continue;
      let k = i + 1;
      if (legs[i].role === 'IAF') while (k < legs.length && legs[k].role === 'IAF') k++;
      return { a, wps: this.legsToWps(legs.slice(k), 'APP') };
    }
    // 2) otherwise join at the intermediate fix
    const a = apps[0];
    const legs = upToFaf(a.legs || []);
    let k = legs.findIndex((l) => l.role === 'IF');
    if (k < 0) k = Math.max(0, legs.findIndex((l) => l.role !== 'IAF'));
    return { a, wps: this.legsToWps(legs.slice(k), 'APP') };
  }

  // Generic radar-vector pattern when no published procedure data is available:
  // unnamed vector points (VEC) to a 10 NM final at 3000 ft.
  vectorPattern(rwy, fromPt) {
    const thr = rwy.thr, inb = rwy.trueHdg;
    const side = angDiff(inb, bearing(thr, fromPt)) > 0 ? 1 : -1;
    const fi = project(thr, inb + 180, 11);
    const base = project(fi, inb + 180 + side * -90 * -1, 6);
    const dw = project(base, inb, 8);
    return [
      { id: 'VEC', x: dw.x, y: dw.y, altMax: 6000, spd: 210, kind: 'VEC' },
      { id: 'VEC', x: base.x, y: base.y, altMax: 4000, spd: 190, kind: 'VEC' },
      { id: 'VEC', x: fi.x, y: fi.y, altMin: 3000, altMax: 3000, spd: 180, kind: 'VEC' },
    ];
  }

  finalWps(rwy) {
    const fi = project(rwy.thr, rwy.trueHdg + 180, 5);
    return [
      { id: 'FNL', x: fi.x, y: fi.y, kind: 'FNL', altMax: null, altMin: null },
      { id: 'RW' + rwy.id, x: rwy.thr.x, y: rwy.thr.y, kind: 'THR', altMax: (rwy.elev || 0) + 50 },
    ];
  }

  buildArrivalSegment(ap, rwy, fromPt) {
    const star = this.pickStar(ap, rwy, fromPt);
    let wps = star ? [...star.wps] : [];
    const app = this.pickApproach(ap, rwy, wps.at(-1));
    if (app) wps.push(...app.wps); // may be empty when the STAR ends at the FAF
    else wps.push(...this.vectorPattern(rwy, wps.at(-1) || fromPt));
    // ensure route ends on the runway centreline
    const fw = this.finalWps(rwy);
    if (wps.length && dist(wps.at(-1), rwy.thr) < 6.5) fw.shift(); // FAF already inside the 5 NM point
    wps.push(...fw);
    // remove legs that would require flying backwards near the end
    wps = pruneBacktrack(wps);
    if (wps.length && star) {
      wps[0].hold = { inbound: bearing(fromPt, wps[0]), turn: 1, big: true };
      const li = star.wps.length - 1, last = wps.find((w) => w.id === star.wps[li].id);
      if (last && li > 0) last.hold = { inbound: bearing(star.wps[li - 1], star.wps[li]), turn: 1, big: false };
    }
    return { wps, starName: star?.s.name || 'VECTORS', appName: app?.a.name || `VIS/ILS ${rwy.id}` };
  }

  planArrival(ac, fromPt = ac.pos) {
    const ap = this.w.airport(ac.to);
    const rwy = this.pickArrRunway(ap, fromPt);
    if (!rwy) return;
    const seg = this.buildArrivalSegment(ap, rwy, fromPt);
    ac.arrRwy = rwy; ac.starName = seg.starName; ac.appName = seg.appName;
    ac.route = seg.wps; ac.routeIdx = 0; ac.legStart = ac.pos;
    ac.appr = null; ac.vnav = true; ac.holdRequest = false; ac.hold = null;
    if (ac.lat.mode !== 'HDG' || !ac.manual.hdg) ac.lat = { mode: 'LNAV', hdg: null, turn: 0 };
    ac.clearedAlt = Math.min(ac.clearedAlt, Math.max(rwy.elev + 3000, 3000));
  }

  planDeparture(ac) {
    const ap = this.w.airport(ac.from);
    const destPt = this.w.data.worldAirports[ac.to] ? toXY(...this.w.data.worldAirports[ac.to]) : project(ap, 270, 300);
    this._depType = ac.type;
    const rwy = this.pickDepRunway(ap, destPt);
    ac.depRwy = rwy;
    const sids = this.procs(ap.icao).sids.filter((s) => !s.runways?.length || s.runways.includes(rwy.id));
    let best = null, bs = Infinity;
    const destBrg = bearing(ap, destPt);
    for (const s of sids) {
      const wps = this.legsToWps(s.legs, 'SID');
      if (!wps.length) continue;
      const off = Math.abs(angDiff(destBrg, bearing(ap, wps.at(-1))));
      if (off < bs) { bs = off; best = { s, wps }; }
    }
    let route = best && bs < 75 ? best.wps : [];
    ac.sidName = best && bs < 75 ? best.s.name : 'RADAR VECTORS';
    if (!route.length) {
      const p1 = project(rwy.end, rwy.trueHdg, 5);
      route.push({ id: 'DEP', x: p1.x, y: p1.y, kind: 'VEC' });
    }
    const last = route.at(-1);
    const destAp = this.w.airport(ac.to);
    if (destAp) {
      // domestic flight inside the simulation: plan the enroute + arrival now
      const rwyA = this.pickArrRunway(destAp, last);
      if (rwyA) {
        const seg = this.buildArrivalSegment(destAp, rwyA, last);
        route = route.concat(this.w.traffic.enrouteBetween(last, destAp, seg.wps[0]));
        ac.arrJoinIdx = route.length;
        route = route.concat(seg.wps);
        ac.arrRwy = rwyA; ac.starName = seg.starName; ac.appName = seg.appName;
      }
    } else {
      route = route.concat(this.w.traffic.exitRoute(last, destPt));
    }
    ac.route = route; ac.routeIdx = 0;
    const sidTop = (best?.wps || []).reduce((m, w) => (w.altMax != null ? Math.max(m, w.altMax) : m), 0);
    ac.initialAlt = sidTop > 0 ? Math.max(sidTop, 7000) : 13000;
  }

  // Re-plan arrivals after a runway configuration change / closure.
  onConfigChange(ap) {
    for (const ac of this.w.aircraft) {
      if (ac.to !== ap.icao || ac.landedAt || ac.onGround) continue;
      if (ac.dir === 'ARR' && !(ac.appr && ac.appr.established)) {
        const keepManual = ac.manual.hdg;
        this.planArrival(ac);
        if (keepManual) ac.manual.hdg = true;
      }
    }
    for (const ac of this.w.aircraft) {
      if (ac.from === ap.icao && ac.onGround && ['PARKED', 'PUSHBACK', 'STARTUP', 'TAXI_OUT', 'HOLD_SHORT'].includes(ac.phase)) {
        const old = ac.depRwy;
        const destPt = ac.route.at(-1) || ap;
        const r = this.pickDepRunway(ap, destPt);
        if (r && r !== old) {
          ac.depRwy.airport.depQueue = ac.depRwy.airport.depQueue.filter((a) => a !== ac);
          this.planDeparture(ac);
          if (ac.phase === 'TAXI_OUT' || ac.phase === 'HOLD_SHORT') this.beginTaxiOut(ac);
        }
      }
    }
  }

  // ======================= ground operations =======================
  beginPushback(ac) {
    const ap = this.w.airport(ac.airportIcao);
    const g = ap.ground;
    const { hold } = g.holdingVertex(ac.depRwy);
    const path = g.path(ac.stand.node, hold);
    if (!path) { this.w.log(`${ac.callsign}: no taxi route found from stand ${ac.stand.ref}`, 'warn', ac); ac.pushAt = (ac.pushAt + 300) % 86400; return; }
    // pushback: along stand lane until the first taxiway vertex
    let k = 1;
    while (k < path.pts.length && !isTaxiPoint(g, path.pts[k])) k++;
    const pushPts = path.pts.slice(0, Math.min(k + 1, path.pts.length));
    ac.taxiPlan = path;
    if (pushPts.length >= 2 && polyLen(pushPts) < 0.15) {
      ac.taxi = { pts: pushPts, i: 0, reverse: true, maxSpd: 4 };
      ac.phase = 'PUSHBACK';
    } else { ac.phase = 'STARTUP'; ac.phaseT = this.w.time; }
    ac.stand.occupied = null;
    this.w.log(`${ac.callsign} pushback approved, RWY ${ac.depRwy.id}`, 'info', ac);
  }

  beginTaxiOut(ac) {
    const ap = this.w.airport(ac.airportIcao);
    const g = ap.ground;
    const { hold } = g.holdingVertex(ac.depRwy);
    const start = g.nearestVertex(ac.pos);
    const path = g.path(start, hold);
    if (!path) { this.w.log(`${ac.callsign}: taxi route unavailable`, 'warn', ac); return; }
    ac.taxi = { pts: [ac.pos, ...path.pts], i: 0, reverse: false, maxSpd: 18 };
    ac.taxiNames = path.names;
    ac.phase = 'TAXI_OUT';
    this.w.log(`${ac.callsign} taxi to holding point RWY ${ac.depRwy.id}${path.names.length ? ' via ' + path.names.slice(0, 6).join(' ') : ''}`, 'info', ac);
  }

  liftOff(ac) {
    const r = ac.depRwy;
    ac.onGround = false; ac.phase = 'CLIMB'; ac.airborneAt = this.w.time;
    ac.alt = (r.elev || 0) + 10; ac.vs = 1500; ac.ias = ac.gsGround;
    ac.lat = { mode: 'HDG', hdg: r.trueHdg, turn: 0 };
    ac.lnavArm = (r.elev || 0) + 500;
    ac.clearedAlt = Math.min(ac.initialAlt || 13000, ac.cruiseAlt);
    r.lastDep = this.w.time; r.lastDepAc = ac;
    this.w.stats.departures++;
    this.w.log(`${ac.callsign} airborne RWY ${r.id}, ${ac.sidName}`, 'info', ac);
  }

  touchdown(ac) {
    const r = ac.arrRwy;
    ac.onGround = true; ac.phase = 'ROLLOUT'; ac.landedAt = this.w.time;
    ac.alt = r.elev || 0; ac.vs = 0; ac.gsGround = ac.gs; ac.airportIcao = r.airport.icao;
    ac.appr = null; ac.autoSpd = null; ac.atcSpd = null;
    r.occupiedBy = ac; r.lastArr = this.w.time;
    const g = r.airport.ground;
    const along = alongRunway(r, ac);
    const v = ac.gsGround, t = (v - 25) / 3.5, stopNm = ((v + 25) / 2) * t / 3600;
    ac.exitV = g ? g.exitVertex(r, along + stopNm) : -1;
    ac.exitAlong = ac.exitV >= 0 ? alongRunway(r, g.v[ac.exitV]) : r.lengthNm - 0.1;
    this.w.stats.arrivals++;
    this.w.log(`${ac.callsign} landed RWY ${r.id}`, 'info', ac);
  }

  vacate(ac) {
    const r = ac.arrRwy, ap = r.airport, g = ap.ground;
    r.occupiedBy = null;
    if (!g) { ac.remove = true; return; }
    const stand = ac.stand || g.allocateStand(this.w.traffic.standPref(ap, ac));
    if (!stand) { ac.remove = true; return; }
    stand.occupied = ac; ac.stand = stand;
    const start = ac.exitV >= 0 ? ac.exitV : g.nearestVertex(ac.pos);
    const path = g.path(start, stand.node);
    if (!path) { ac.remove = true; return; }
    ac.taxi = { pts: [ac.pos, ...path.pts, stand.pos], i: 0, reverse: false, maxSpd: 18 };
    ac.taxiNames = path.names;
    ac.phase = 'TAXI_IN'; ac.gsGround = Math.min(ac.gsGround, 15);
  }

  goAround(ac, reason) {
    const r = ac.arrRwy;
    ac.appr = null; ac.phase = 'GOAROUND'; ac.ga++;
    ac.lat = { mode: 'HDG', hdg: r.trueHdg, turn: 0 };
    ac.clearedAlt = r.missedAlt || 3000; ac.vnav = false; ac.autoSpd = null;
    ac.manual.hdg = false; ac.manual.alt = false;
    ac.gaTime = this.w.time;
    this.w.stats.goArounds++;
    this.w.log(`${ac.callsign} GO AROUND RWY ${r.id} (${reason})`, 'alert', ac);
  }

  // ======================= periodic update =======================
  update(dt) {
    this.t += dt;
    for (const ac of this.w.aircraft) this.perAircraft(ac);
    if (Math.floor(this.t / 2) !== Math.floor((this.t - dt) / 2)) {
      for (const ap of this.w.airports.values()) { this.sequenceArrivals(ap); this.releaseDepartures(ap); }
      this.resolveConflicts();
      this.manageStacks();
    }
  }

  perAircraft(ac) {
    const w = this.w;
    if (ac.onGround) {
      // scheduled pushback (respecting a manual "delay pushback")
      if (ac.phase === 'PARKED' && ac.dir === 'DEP' && !ac.pushHold && ac.pushAt != null && this.enabled.departures) {
        const late = ((w.clock - ac.pushAt) % 86400 + 86400) % 86400;
        if (late < 6 * 3600) this.beginPushback(ac);
      }
      return;
    }
    // departures: engage LNAV after 500 ft AGL, then climb clearances
    if (ac.lnavArm != null && ac.alt >= ac.lnavArm) {
      ac.lnavArm = null;
      if (!ac.manual.hdg) { ac.lat = { mode: 'LNAV', hdg: null, turn: 0 }; ac.legStart = ac.pos; }
    }
    if (ac.depRwy && ac.depRwy.occupiedBy === ac && ac.alt - (ac.depRwy.elev || 0) > 300) ac.depRwy.occupiedBy = null;
    if (ac.dir === 'DEP' && !ac.manual.alt && ac.clearedAlt < ac.cruiseAlt) {
      const ap = w.airport(ac.from);
      if (dist(ac, ap) > 20 && ac.alt > ac.clearedAlt - 1500 && (!ac.nextClimbCheck || w.time > ac.nextClimbCheck)) {
        ac.nextClimbCheck = w.time + 10;
        const target = ac.cruiseAlt;
        if (!w.conflicts.climbBlocked(ac, target)) { ac.clearedAlt = target; }
      }
    }
    // domestic flights inside the sim become arrivals at top of descent area
    if (ac.dir === 'DEP' && ac.arrJoinIdx != null && ac.routeIdx > 0 && ac.alt > 5000 && ac.distToGo() < ac.alt / 1000 * 3.2 + 40) {
      ac.dir = 'ARR'; ac.vnav = true; ac.phase = 'DESCENT';
      if (!ac.manual.alt) ac.clearedAlt = Math.max((ac.arrRwy?.elev || 0) + 3000, 3000);
      w.log(`${ac.callsign} inbound ${w.airport(ac.to).iata}, ${ac.starName} arrival`, 'info', ac);
    }
    if (ac.dir !== 'ARR') return;
    if ((ac.phase === 'CRUISE' || ac.phase === 'DESCENT') && !ac.appr) ac.phase = ac.vs < -300 ? 'DESCENT' : ac.alt > 20000 ? 'CRUISE' : 'DESCENT';
    const r = ac.arrRwy;
    if (!r) return;
    // go-around climb-out complete -> re-plan to the approach
    if (ac.phase === 'GOAROUND' && w.time - ac.gaTime > 90 && ac.alt > (r.missedAlt || 3000) - 300) {
      ac.phase = 'APPROACH';
      const ap = r.airport;
      const dw = project(r.thr, r.trueHdg + 180, 14);
      ac.route = [{ id: 'VEC', x: project(dw, r.trueHdg + 90, 0).x, y: project(dw, r.trueHdg + 90, 0).y, kind: 'VEC', altMin: 3000, altMax: 3000 }, ...this.finalWps(r)];
      // fly a right/left downwind pattern via vectors
      const side = 1;
      const p1 = project(r.thr, r.trueHdg + 90 * side, 4.5);
      const p2 = project(p1, r.trueHdg + 180, 9);
      const p3 = project(r.thr, r.trueHdg + 180, 12);
      ac.route = [
        { id: 'VEC', x: p1.x, y: p1.y, kind: 'VEC', altMax: 3000 },
        { id: 'VEC', x: p2.x, y: p2.y, kind: 'VEC', altMax: 3000 },
        { id: 'VEC', x: p3.x, y: p3.y, kind: 'VEC', altMin: 3000, altMax: 3000 },
        ...this.finalWps(r)];
      ac.routeIdx = 0; ac.legStart = ac.pos; ac.lat = { mode: 'LNAV', hdg: null, turn: 0 }; ac.vnav = true;
      ac.priority = true;
      void ap;
    }
    // Approach clearance: once on the approach/final legs within 30 NM
    if (!ac.appr && ac.phase !== 'GOAROUND' && !ac.noAutoApproach) {
      const wp = ac.activeWp;
      const dThr = dist(ac, r.thr);
      const onFinalLegs = wp && (wp.kind === 'APP' || wp.kind === 'FNL' || wp.kind === 'THR' || (wp.kind === 'VEC' && wp.altMin != null));
      const outside = ac.alongToThr(r) > 3;
      if (dThr < 30 && outside && (onFinalLegs || (ac.manual.hdg && ac.autoClearOnVector))) {
        ac.clearApproach(r);
        ac.phase = 'APPROACH';
        w.log(`${ac.callsign} cleared ${ac.appName || 'ILS ' + r.id} approach`, 'info', ac);
      }
    }
    if (ac.appr && ac.appr.established) {
      ac.phase = ac.appr.distThr < 8 ? 'FINAL' : 'APPROACH';
      // runway occupied check
      if (ac.appr.distThr < 0.6 && ac.appr.distThr > 0) {
        const occ = (r.occupiedBy && r.occupiedBy !== ac) ? r.occupiedBy : w.aircraft.find((o) => o.onGround && o.depRwy === r && (o.phase === 'LINEUP' || o.phase === 'LINED_UP'));
        if (occ) { this.goAround(ac, `runway occupied by ${occ.callsign} ${occ.phase}`); return; }
      }
      if (r.closed) { this.goAround(ac, 'runway closed'); return; }
      if (ac.alt <= (r.elev || 0) + 3 && ac.appr.gsCaptured) this.touchdown(ac);
    } else if (ac.appr && ac.appr.cleared && ac.appr.distThr < 2.0) {
      // not established close in: go around if low on final, otherwise re-plan
      if (ac.alt - (r.elev || 0) < 2500 && Math.abs(angDiff(ac.trk, r.trueHdg)) < 60) this.goAround(ac, 'not established');
      else { ac.appr = null; if (!ac.manual.hdg) this.planArrival(ac, ac.pos); }
    }
    // stabilised approach criterion: more than ~1000 ft above the glidepath inside 5 NM
    if (ac.appr?.established && ac.appr.distThr < 5 && ac.appr.distThr > 0.5) {
      const gsAlt = (r.elev || 0) + 50 + ac.appr.distThr * 6076 * Math.tan((r.gp || 3) * Math.PI / 180);
      if (ac.alt - gsAlt > 1000) { this.goAround(ac, 'unstable (high)'); return; }
    }
  }

  // ---------------- AMAN ----------------
  eta(ac) {
    // remaining time: route length with speed by distance-to-threshold
    const dtg = ac.appr && ac.appr.established ? ac.appr.distThr : ac.distToGo();
    let t = 0, d = dtg;
    const vapp = ac.perf.vapp;
    const band = (from, to, kt) => { const seg = Math.max(0, Math.min(d, from) - to); return seg / Math.max(kt, 100) * 3600; };
    t += band(1e9, 40, Math.max(ac.gs, 280));
    t += band(40, 15, 230);
    t += band(15, 5, 180);
    t += band(5, 0, vapp + 5);
    if (ac.hold) t += 60; // at least finishing the current lap
    return this.w.time + t;
  }

  // Persistent arrival sequence per runway (AMAN): aircraft are inserted once,
  // by ETA, and keep their position. Emergencies go to the front (behind
  // aircraft already close in on final); aircraft re-joining after a
  // go-around are inserted with priority.
  sequenceArrivals(ap) {
    const cfg = this.w.config(ap);
    ap.seq = ap.seq || {};
    for (const rid of cfg.arr) {
      const r = ap.runways.get(rid);
      if (!r) continue;
      const live = (a) => a.arrRwy === r && a.dir === 'ARR' && !a.onGround && a.phase !== 'GOAROUND' && this.w.aircraft.includes(a);
      let list = (ap.seq[rid] || []).filter(live);
      const members = new Set(list);
      for (const a of list) a._eta = this.eta(a);
      const fresh = this.w.aircraft.filter((a) => live(a) && !members.has(a));
      for (const a of fresh) {
        a._eta = this.eta(a);
        let pos = list.length;
        if (a.emergency || a.priority) {
          // in front of everything not yet within ~8 NM of the threshold
          pos = list.findIndex((o) => !(o.appr?.established && o.appr.distThr < 8) && !o.emergency);
          if (pos < 0) pos = list.length;
        } else {
          // by ETA, but never ahead of aircraft already committed (holding / inside 35 NM)
          for (let i = list.length - 1; i >= 0; i--) {
            const o = list[i];
            if (o._eta <= a._eta || o.distToGo() < 35 || o.appr?.established) { pos = i + 1; break; }
            pos = i;
          }
        }
        list.splice(pos, 0, a);
        a.priority = false;
      }
      // an emergency already in the list moves to the front
      const em = list.filter((a) => a.emergency && !a._emSeq);
      for (const a of em) {
        list = list.filter((x) => x !== a);
        let pos = list.findIndex((o) => !(o.appr?.established && o.appr.distThr < 8));
        if (pos < 0) pos = list.length;
        list.splice(pos, 0, a); a._emSeq = true;
      }
      // re-optimise: swap neighbours when the follower would arrive >90 s earlier
      // and neither is committed (inside 35 NM / on the approach)
      const committed = (x) => x.appr?.established || x.distToGo() < 35 || x.emergency;
      for (let i = 0; i + 1 < list.length; i++) {
        const x = list[i], y = list[i + 1];
        if (!committed(x) && !committed(y) && y._eta + 90 < x._eta) { list[i] = y; list[i + 1] = x; }
      }
      ap.seq[rid] = list;

      let prev = null, prevSlot = -Infinity;
      const isMixed = (cfg.mixed || []).includes(rid) || cfg.dep.includes(rid);
      const mixed = (isMixed && ap.depQueue.some((d) => d.depRwy === r))
        || ap.depQueue.some((d) => (d.depRwy?.crossing || []).includes(rid));
      list.forEach((a, i) => {
        let slot = a._eta;
        if (prev) {
          const sepNm = Math.max(FINAL_MIN_NM, WAKE_NM[prev.wake]?.[a.wake] || 0) + 1.2 + (mixed ? 3.0 : 0);
          const gap = Math.max(sepNm / (a.perf.vapp + 5) * 3600, 85);
          slot = Math.max(slot, prevSlot + gap);
        }
        a.slot = slot; a.seq = i + 1; a.delay = slot - a._eta;
        this.w.stats.maxDelay = Math.max(this.w.stats.maxDelay, a.delay);
        this.absorbDelay(a, prev);
        prev = a; prevSlot = slot;
      });
    }
  }

  absorbDelay(a, leader) {
    if (a.manual.spd) return;
    const dtg = a.appr && a.appr.established ? a.appr.distThr : a.distToGo();
    // holding for large delays (before the first STAR fix)
    // holding: at the STAR entry fix for large delays, at the IAF hold for smaller ones
    if (!a.manual.hdg && !a.hold && !a.appr?.established) {
      let k = a.routeIdx; while (k < a.route.length && !a.route[k].hold) k++;
      const hw = a.route[k];
      const stackBusy = hw && this.w.aircraft.some((o) => o !== a && o.hold && o.hold.fix.id === hw.id);
      const need = hw ? (stackBusy ? 30 : hw.hold.big ? 240 : 110) : Infinity;
      a.holdRequest = !!hw && a.delay > need;
      if (hw && a.holdRequest && k === a.routeIdx && dist(a, hw) < 1.5) {
        a.holdRequest = false;
        a.startHold(hw, hw.hold.inbound, 1);
        this.w.log(`${a.callsign} hold at ${hw.id}, expect further clearance (delay ${Math.round(a.delay / 60)} min)`, 'warn', a);
      }
    }
    // (hold exit is decided by manageStacks: lowest aircraft first)
    // speed control
    let spd = null;
    if (a.delay > 60 && dtg > 15) spd = a.alt > 10500 ? 250 : (dtg > 30 ? 220 : 200);
    else if (a.delay > 25 && dtg > 12) spd = 210;
    // spacing behind the leader measured along the remaining track (works for merging flows)
    if (leader && !leader.onGround && leader.dir === 'ARR') {
      const need = Math.max(FINAL_MIN_NM, WAKE_NM[leader.wake]?.[a.wake] || 0);
      const dtgL = leader.appr?.established ? leader.appr.distThr : leader.distToGo();
      const trackGap = dtg - dtgL;
      if (dtg < 35) {
        if (trackGap < need + 1.5) spd = Math.max(dtg > 6 ? 160 : a.perf.vapp, Math.min(spd ?? 999, leader.ias - 15, dtg > 15 ? 210 : 180));
        // well inside the required spacing and still outside 12 NM: one 360° orbit
        if (trackGap < need - 0.5 && dtg > 12 && !a.appr?.established && !a.hold && !a.manual.hdg && a.lat.mode === 'LNAV' && (a.orbits || 0) < 2) {
          a.startOrbit(angDiff(a.trk, bearing(a, leader)) > 0 ? -1 : 1);
          a.orbits = (a.orbits || 0) + 1;
          this.w.log(`${a.callsign} make a 360 for spacing behind ${leader.callsign}`, 'info', a);
        }
      }
      if (a.appr?.established && leader.appr?.established) {
        const gap = dist(a, leader);
        if (gap < need - 0.7 && a.appr.distThr < 5) this.goAround(a, `spacing ${gap.toFixed(1)} NM`);
      }
    }
    a.autoSpd = spd ? Math.max(spd, a.perf.vapp + 10) : null;
  }

  // ---------------- departures ----------------
  releaseDepartures(ap) {
    if (!this.enabled.departures) return;
    const w = this.w;
    for (const r of ap.runways.values()) {
      if (r.closed) continue;
      const q = ap.depQueue.filter((a) => a.depRwy === r);
      const lined = w.aircraft.find((a) => a.onGround && a.depRwy === r && (a.phase === 'LINEUP' || a.phase === 'LINED_UP') && !a.takeoffCleared);
      const arrivalWithin = (nm) => w.aircraft.some((a) => !a.onGround && a.appr && a.appr.established && a.arrRwy && a.arrRwy.airport === ap
        && (a.arrRwy === r || (r.crossing || []).includes(a.arrRwy.id)) && a.appr.distThr < nm && a.appr.distThr > -0.5);
      const crossOcc = (r.crossing || []).some((id) => { const o = ap.runways.get(id); return o && o.occupiedBy && !o.occupiedBy.taxi; });
      if (lined) {
        if (lined.manualHold) continue;
        // take-off clearance: runway clear, departure interval, no close arrival
        if (r.occupiedBy && r.occupiedBy !== lined) continue;
        if (w.time - r.lastDep < this.depInterval(ap, r.lastDepAc, lined)) continue;
        const crossArr = w.aircraft.some((a) => !a.onGround && a.appr?.established && a.arrRwy && a.arrRwy.airport === ap && (r.crossing || []).includes(a.arrRwy.id) && a.appr.distThr < 2 && a.appr.distThr > -0.5);
        const sameArr = w.aircraft.some((a) => !a.onGround && a.appr?.established && a.arrRwy === r && a.appr.distThr < 3 && a.appr.distThr > -0.5);
        if (sameArr || crossArr || crossOcc) continue;
        lined.takeoffCleared = true; r.occupiedBy = lined;
        w.log(`${lined.callsign} RWY ${r.id} cleared for take-off`, 'info', lined);
        continue;
      }
      const head = q[0];
      if (!head || head.manualHold) continue;
      // line up and wait behind a departure already rolling
      const occ = r.occupiedBy;
      if (occ && !(occ.phase === 'TAKEOFF' || !occ.onGround)) continue;
      // time until the next arrival to this (or a crossing) runway reaches the threshold
      // time until the next arrival reaches the threshold: same runway (must be airborne
      // before ~2 NM) or a crossing runway (must be through the intersection, ~45 s of roll)
      const tFor = (a) => (a.appr && a.appr.established ? a.appr.distThr : a.distToGo()) / Math.max(a.gs, 120) * 3600;
      const arrs = w.aircraft.filter((a) => !a.onGround && a.dir === 'ARR' && a.arrRwy && a.arrRwy.airport === ap);
      const tSame = Math.min(Infinity, ...arrs.filter((a) => a.arrRwy === r).map(tFor));
      const tCross = Math.min(Infinity, ...arrs.filter((a) => (r.crossing || []).includes(a.arrRwy.id)).map(tFor));
      const tArr = Math.min(tSame, tCross + 25);
      const wait = occ && occ.onGround ? this.depInterval(ap, occ, head) + 35 : Math.max(0, this.depInterval(ap, r.lastDepAc, head) - (w.time - r.lastDep));
      const g = ap.ground;
      const { entry } = g.holdingVertex(r);
      const lineupPts = [head.pos, g.v[entry]];
      if (dist(g.v[entry], r.start) > 0.03) lineupPts.push(r.start);
      lineupPts.push(project(r.start, r.trueHdg, 0.02));
      let lineupNm = 0; for (let i = 1; i < lineupPts.length; i++) lineupNm += dist(lineupPts[i - 1], lineupPts[i]);
      const lineupTime = lineupNm / 10 * 3600 + 15;
      // the departure must be rolling well before the arrival reaches ~3 NM
      if (tArr < Math.max(wait, lineupTime) + 85) continue;
      ap.depQueue = ap.depQueue.filter((a) => a !== head);
      head.taxi = { pts: lineupPts, i: 0, reverse: false, maxSpd: 12 };
      head.phase = 'LINEUP'; head.takeoffCleared = false;
      w.log(`${head.callsign} RWY ${r.id} line up and wait`, 'info', head);
    }
  }

  // JCAB departure intervals (approximate): 2 min behind Heavy/Super for
  // lighter types, otherwise ~90 s; 60 s when the SIDs diverge by > 45°.
  depInterval(ap, prev, next) {
    if (!prev) return 0;
    const wake = (prev.wake === 'H' || prev.wake === 'J') && next.wake !== 'H' && next.wake !== 'J';
    if (wake || prev.wake === 'J') return 120;
    const div = Math.abs(angDiff(bearing(ap, prev.route.at(-1) || ap), bearing(ap, next.route.at(-1) || ap))) > 45;
    return div ? 60 : 90;
  }

  // Holding stacks: 1000 ft between aircraft in the same hold; the first
  // aircraft in holds lowest (published MHA / fix constraint) and the stack
  // steps down as aircraft leave.
  manageStacks() {
    const stacks = new Map();
    for (const ac of this.w.aircraft) if (ac.hold && !ac.manual.alt) {
      const k = ac.hold.fix.id;
      if (!stacks.has(k)) stacks.set(k, []);
      stacks.get(k).push(ac);
    }
    for (const [id, list] of stacks) {
      const wp = list[0].route.find((w) => w.id === id) || {};
      const elev = this.w.elevFor(list[0]) || 0;
      let base = wp.altMin ?? wp.altMax ?? (wp.hold?.big ? 13000 : 5000);
      base = Math.max(base, elev + 3000);
      const staying = list.filter((a) => !a.hold.exit);
      // new aircraft join on top of the stack
      const top = () => Math.max(base - 1000, ...staying.filter((a) => a.hold.level != null).map((a) => a.hold.level));
      for (const a of staying.filter((x) => x.hold.level == null).sort((x, y) => x.alt - y.alt)) a.hold.level = top() + 1000;
      // step down one level at a time when the level below is free and reached
      staying.sort((x, y) => x.hold.level - y.hold.level);
      const occupied = new Set(staying.map((a) => a.hold.level));
      for (const a of staying) {
        const below = a.hold.level - 1000;
        const lowerAc = staying.find((o) => o !== a && o.hold.level === below);
        if (below >= base && !occupied.has(below) && !lowerAc && Math.abs(a.alt - a.hold.level) < 300
            && !list.some((o) => o !== a && Math.abs(o.alt - below) < 900 && o.alt < a.alt)) {
          occupied.delete(a.hold.level); a.hold.level = below; occupied.add(below);
        }
      }
      // while aircraft descend into the stack keep 1000 ft above the one below
      staying.forEach((a, i) => {
        const below = staying[i - 1];
        a.hold.levelEff = below ? Math.max(a.hold.level, Math.ceil((below.alt + 1000) / 100) * 100) : a.hold.level;
      });
      // the lowest holder leaves first once anyone in the stack is due
      if (staying.length && staying.some((a) => a.delay < 45)) {
        const lowest = staying[0];
        if (lowest.alt - lowest.hold.level < 300) { lowest.hold.exit = true; lowest.holdRequest = false; }
      }
    }
  }

  // ---------------- conflict resolution ----------------
  // Automatic controller: for predicted conflicts between automated aircraft,
  // stop the climb/descent of one aircraft 1000 ft clear of the other
  // (temporary restriction, released when clear), or slow an overtaking
  // aircraft in trail.
  resolveConflicts() {
    const w = this.w;
    for (const ac of w.aircraft) if (ac.restrict && w.time > ac.restrict.until) ac.restrict = null;
    for (const c of w.conflicts.list) {
      const { a, b } = c;
      if (a.appr?.established && b.appr?.established) continue;
      if (a.hold && b.hold) continue; // stack levels take care of holders
      const tg = (x) => x.tgtAltEff ?? x.clearedAlt;
      const vertMover = (x) => Math.abs(x.vs) > 300 || Math.abs(tg(x) - x.alt) > 300;
      let mover = null, other = null;
      const candidates = [[a, b], [b, a]].filter(([x]) => !x.manual.alt && !x.appr?.established && !x.onGround && !x.emergency && !x.hold
        && !(x.dir === 'ARR' && x.arrRwy && dist(x, x.arrRwy.thr) < 15));
      // prefer the one changing level; a departure keeps climbing if the other can stop instead
      for (const [x, y] of candidates) if (vertMover(x) && !mover) { mover = x; other = y; }
      if (mover && mover.dir === 'DEP' && candidates.some(([x]) => x === other) && vertMover(other)) { const t = mover; mover = other; other = t; }
      const isClimb = (x) => tg(x) > x.alt + 300 || x.vs > 300;
      const isDesc = (x) => tg(x) < x.alt - 300 || x.vs < -300;
      const free = (x) => candidates.some(([y]) => y === x);
      const [lo, hi] = a.alt < b.alt ? [a, b] : [b, a];
      if (isClimb(lo) && isDesc(hi) && free(lo) && free(hi)) {
        // split the levels: climber stops below, descender stops 1000 ft above it
        let lc = Math.floor(((lo.alt + hi.alt) / 2 - 500) / 1000) * 1000;
        if (lc < lo.alt - 300) lc = Math.ceil(lo.alt / 1000) * 1000;
        lo.restrict = { max: lc, until: w.time + 75 };
        hi.restrict = { min: lc + 1000, until: w.time + 75 };
        continue;
      }
      if (mover) {
        const otherAlt = other.alt + Math.max(-1500, Math.min(1500, other.vs / 60 * 30));
        const climbing = tg(mover) > mover.alt + 300 || mover.vs > 300;
        const lvl = climbing ? Math.floor((otherAlt - 1000) / 1000) * 1000 : Math.ceil((otherAlt + 1000) / 1000) * 1000;
        const elev = w.elevFor(mover) || 0;
        if (climbing && lvl > mover.alt - 300 && lvl > elev + 2000) mover.restrict = { max: lvl, until: w.time + 60 };
        else if (!climbing && lvl < mover.alt + 300) mover.restrict = { min: lvl, until: w.time + 60 };
        else if (climbing) mover.restrict = { max: Math.max(Math.round(mover.alt / 1000) * 1000, elev + 2000), until: w.time + 45 };
        else mover.restrict = { min: Math.round(mover.alt / 1000) * 1000, until: w.time + 45 };
        continue;
      }
      // both level: in-trail speed control, otherwise a 1000 ft step for the arrival / lower-priority one
      const [lead, foll] = trailOrder(a, b);
      if (lead && !foll.manual.spd && Math.abs(angDiff(a.trk, b.trk)) < 40) { foll.autoSpd = Math.max(foll.perf.vmin, Math.round(lead.ias - 15)); continue; }
      // both level: the lower arrival steps down 1000 ft (or the higher one climbs if it is a departure)
      const lower = a.alt <= b.alt ? a : b, upper = lower === a ? b : a;
      const free2 = (x) => candidates.some(([y]) => y === x);
      if (lower.dir === 'ARR' && free2(lower)) {
        const tgt = Math.floor((lower.alt - 100) / 1000) * 1000;
        if (tgt > (w.elevFor(lower) || 0) + 2500) lower.restrict = { to: tgt, until: w.time + 90 };
      } else if (upper.dir === 'DEP' && free2(upper)) {
        upper.restrict = { to: Math.ceil((upper.alt + 100) / 1000) * 1000, until: w.time + 90 };
      }
    }
  }
}

function trailOrder(a, b) {
  // returns [leader, follower] if one is behind the other on a similar track
  const brg = bearing(a, b);
  if (Math.abs(angDiff(a.trk, brg)) < 50) return [b, a];
  if (Math.abs(angDiff(b.trk, norm360(brg + 180))) < 50) return [a, b];
  return [null, null];
}

export function inSector(b, from, to) {
  b = norm360(b); from = norm360(from); to = norm360(to);
  return from <= to ? b >= from && b <= to : b >= from || b <= to;
}
function polyLen(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]); return d; }
function isTaxiPoint(g, p) {
  for (const i of g.taxiVerts) { const v = g.v[i]; if (Math.abs(v.x - p.x) < 1e-6 && Math.abs(v.y - p.y) < 1e-6) return true; }
  return false;
}
function pruneBacktrack(wps) {
  // remove consecutive duplicates
  const out = [];
  for (const w of wps) { if (out.length && dist(out.at(-1), w) < 0.2) { Object.assign(out.at(-1), { altMax: w.altMax ?? out.at(-1).altMax, altMin: w.altMin ?? out.at(-1).altMin }); continue; } out.push(w); }
  return out;
}
