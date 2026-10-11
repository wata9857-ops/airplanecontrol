// Schedule-driven traffic generation from researched real-world flights.
// Departures appear on stands ~20 min before STD and push back at STD;
// arrivals from outside the simulated domain enter at the domain edge so that
// they land close to STA. Flights between two simulated airports are flown
// gate-to-gate.
import { toXY, dist, bearing, project, norm360, trueToMag, gcDist, gcPoint } from '../geo.js';
import { Aircraft } from './aircraft.js';

const ENTRY_MAX = 330; // arrivals enter where their great-circle route crosses the domain edge (capped)

// First point (walking back from the destination toward the origin) that is
// still inside the simulated domain = where the flight enters our airspace.
function entryPoint(dest, orig, box) {
  const total = gcDist(dest[0], dest[1], orig[0], orig[1]);
  const inside = (p) => p.lat > box.minLat + 0.05 && p.lat < box.maxLat - 0.05 && p.lon > box.minLon + 0.05 && p.lon < box.maxLon - 0.05;
  let last = { lat: dest[0], lon: dest[1] }, d = 0;
  for (d = 10; d <= Math.min(total, ENTRY_MAX); d += 10) {
    const p = gcPoint(dest[0], dest[1], orig[0], orig[1], d / total);
    if (!inside(p)) break;
    last = p;
  }
  return { ll: last, nm: Math.min(d, total, ENTRY_MAX) };
}

export class Traffic {
  constructor(world, data) {
    this.w = world;
    this.flights = (data.schedule?.flights || []).map((f, i) => ({ ...f, key: i, t: hhmm(f.timeLocal) }));
    this.overflights = (data.schedule?.overflights || []).map((f, i) => ({ ...f, key: 'o' + i }));
    this.airlines = new Map((data.schedule?.airlines || []).map((a) => [a.icao, a]));
    this.spawned = new Set();
    this.density = 1.0;
    this.squawkSeq = 1100;
    this.pending = [];
  }

  simAirport(icao) { return this.w.airports.get(icao); }

  update() {
    const clock = this.w.clock;
    this.updateOverflights(clock);
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= this.w.time);
      this.pending = this.pending.filter((p) => p.at > this.w.time);
      for (const p of due) this.spawnArrival(p.f, 0);
    }
    for (const f of this.flights) {
      const dayKey = `${f.key}@${Math.floor((this.w.startClock + this.w.time) / 86400)}`;
      if (this.spawned.has(dayKey)) continue;
      if (this.density < 1 && (f.key * 0.6180339) % 1 > this.density) continue;
      const depSim = this.simAirport(f.from), arrSim = this.simAirport(f.to);
      if (f.dir === 'DEP' && depSim) {
        // appear on stand 20 min before departure
        const appear = f.t - 20 * 60;
        if (inWindow(clock, appear, 60) || (this.w.time < 2 && inWindow(clock, appear, 20 * 60 - 120))) {
          this.spawned.add(dayKey);
          this.spawnDeparture(f);
        }
      } else if (f.dir === 'ARR' && arrSim && !depSim) {
        const ft = this.inboundTime(f);
        const appear = f.t - ft;
        if (inWindow(clock, appear, 60)) { this.spawned.add(dayKey); this.spawnArrival(f, 0); }
        else if (this.w.time < 2 && inWindow(clock, appear, ft - 240)) {
          // already en route at sim start: place along the inbound route
          this.spawned.add(dayKey);
          this.spawnArrival(f, circDiff(clock, appear));
        }
      }
    }
  }

  entryFor(f) {
    if (f._entry) return f._entry;
    const dest = this.w.data.worldAirports[f.to], orig = this.w.data.worldAirports[f.from];
    const ap = this.simAirport(f.to);
    if (!dest || !orig) { const p = project(ap, 250, 170); f._entry = { xy: p, nm: 170 }; return f._entry; }
    const e = entryPoint(dest, orig, this.w.data.domain);
    f._entry = { xy: toXY(e.ll.lat, e.ll.lon), nm: e.nm };
    return f._entry;
  }
  inboundTime(f) { return this.entryFor(f).nm * 1.12 / 400 * 3600 + 7 * 60; }

  // Overflights: real flights between airports outside the simulation whose
  // great-circle route crosses the domain (entry/exit precomputed at build).
  updateOverflights(clock) {
    for (const f of this.overflights) {
      const dayKey = `${f.key}@${Math.floor((this.w.startClock + this.w.time) / 86400)}`;
      if (this.spawned.has(dayKey)) continue;
      if (this.density < 1 && (parseInt(f.key.slice(1), 10) * 0.6180339) % 1 > this.density) continue;
      const dur = f.dur || 1800;
      if (inWindow(clock, f.tIn, 60)) { this.spawned.add(dayKey); this.spawnOverflight(f, 0); }
      else if (this.w.time < 2 && inWindow(clock, f.tIn, dur - 120)) { this.spawned.add(dayKey); this.spawnOverflight(f, circDiff(clock, f.tIn)); }
    }
  }
  spawnOverflight(f, elapsed) {
    const pts = f.path.map(([la, lo]) => toXY(la, lo));
    const route = pts.slice(1).map((p, i) => ({ id: i === pts.length - 2 ? 'EXIT' : '·', x: p.x, y: p.y, kind: 'ENR' }));
    const trk = bearing(pts[0], pts.at(-1));
    const cruise = f.alt || this.cruiseFor(f.from, f.to, trk);
    const ac = this.makeAircraft(f, { dir: 'OVF', x: pts[0].x, y: pts[0].y, alt: cruise, clearedAlt: cruise, hdg: trk, phase: 'CRUISE' });
    ac.cruiseAlt = cruise; ac.route = route; ac.routeIdx = 0; ac.legStart = pts[0]; ac.vnav = false; ac.endInside = !!f.endInside;
    if (f.startInside && !elapsed) { ac.alt = Math.min(cruise, 12000); ac.ias = 280; }
    ac.ias = ac.alt > 26000 ? 270 : ac.perf.cruiseIas;
    if (elapsed > 0) this.advanceAlongRoute(ac, elapsed, 0);
    ac.hdg = bearing(ac, ac.activeWp || pts.at(-1));
    for (let k = 0; k < 3; k++) { if (!this.w.aircraft.some((o) => !o.onGround && dist(o, ac) < 10 && Math.abs(o.alt - ac.alt) < 1500)) break; ac.alt += 2000; ac.clearedAlt = ac.cruiseAlt = ac.alt; }
    this.w.add(ac);
  }

  makeAircraft(f, extra) {
    const al = this.airlines.get(f.airline) || {};
    return new Aircraft({
      callsign: f.callsign, flight: f.flight, airline: f.airline, telephony: al.telephony || '',
      type: f.type, from: f.from, to: f.to, sched: f, squawk: this.nextSquawk(), time: this.w.time, ...extra,
    });
  }
  nextSquawk() {
    this.squawkSeq++;
    let s = this.squawkSeq.toString(8).padStart(4, '0');
    if (this.squawkSeq > 0o7577) this.squawkSeq = 0o1100;
    return s;
  }

  cruiseFor(fromIcao, toIcao, track) {
    const a = this.w.data.worldAirports[fromIcao], b = this.w.data.worldAirports[toIcao];
    let d = 400;
    if (a && b) d = dist(toXY(...a), toXY(...b));
    let fl = d < 200 ? 240 : d < 330 ? 300 : d < 600 ? 360 : 380;
    // semicircular rule (magnetic track): 000–179 odd, 180–359 even (RVSM)
    const mag = trueToMag(track);
    const odd = mag < 180;
    const isOdd = Math.round(fl / 10) % 2 === 1;
    if (odd !== isOdd) fl += 10;
    return fl * 100;
  }

  standPref(ap, ac) {
    const rules = ap.standRules;
    if (!rules) return null;
    for (const r of rules) {
      if (r.airlines && !r.airlines.includes(ac.airline)) continue;
      if (r.intl != null && r.intl !== this.isIntl(ac)) continue;
      const re = new RegExp(r.stands);
      return (s) => re.test(s.ref);
    }
    return null;
  }
  isIntl(ac) { return !(ac.from?.startsWith('RJ') || ac.from?.startsWith('RO')) || !(ac.to?.startsWith('RJ') || ac.to?.startsWith('RO')); }

  spawnDeparture(f) {
    const ap = this.simAirport(f.from);
    if (!ap.ground) return;
    const ac = this.makeAircraft(f, { dir: 'DEP', onGround: true, phase: 'PARKED', x: 0, y: 0, alt: ap.elev });
    const stand = ap.ground.allocateStand(this.standPref(ap, ac));
    if (!stand) return;
    stand.occupied = ac; ac.stand = stand; ac.x = stand.pos.x; ac.y = stand.pos.y; ac.airportIcao = ap.icao;
    ac.gsGround = 0;
    this.w.automation.planDeparture(ac);
    const dest = this.w.data.worldAirports[f.to];
    const trk = dest ? bearing(ap, toXY(...dest)) : 270;
    ac.cruiseAlt = this.cruiseFor(f.from, f.to, trk);
    // heading: point roughly toward the taxi lane
    const nb = ap.ground.adj[stand.node][0];
    if (nb) ac.hdg = norm360(bearing(stand.pos, ap.ground.v[nb.to]) + 180);
    ac.pushAt = f.t + Math.floor(Math.random() * 4) * 60;
    this.w.add(ac);
  }

  spawnArrival(f, elapsed) {
    const ap = this.simAirport(f.to);
    const orig = this.w.data.worldAirports[f.from];
    const origPt = orig ? toXY(...orig) : project(ap, 250, 600);
    const entry = this.entryFor(f).xy;
    const brg = bearing(ap, entry);
    const cruise = this.cruiseFor(f.from, f.to, norm360(brg + 180));
    const ac = this.makeAircraft(f, { dir: 'ARR', x: entry.x, y: entry.y, alt: cruise, ias: 280, hdg: norm360(brg + 180), phase: 'CRUISE', clearedAlt: cruise });
    ac.cruiseAlt = cruise;
    this.w.automation.planArrival(ac, entry);
    // inbound airway leg from the entry point to the STAR
    const head = this.enrouteBetween(entry, null, ac.route[0]);
    ac.route = [{ id: entryName(brg, f.from), x: entry.x, y: entry.y, kind: 'ENR' }, ...head, ...ac.route];
    ac.routeIdx = 1; ac.legStart = entry;
    ac.ias = ac.perf.cruiseIas; ac.alt = cruise;
    if (elapsed > 0) this.advanceAlongRoute(ac, elapsed);
    ac.hdg = bearing(ac, ac.activeWp || ap);
    ac.alt = Math.min(ac.alt, ac.vnavCeiling(this.w));
    if (ac.alt < 10000) ac.ias = 250;
    // Entry deconfliction (the upstream ACC would hand over separated traffic):
    // step down 2000 ft at a time, otherwise delay the hand-over by 2 minutes.
    for (let k = 0; k < 4; k++) {
      const clash = this.w.aircraft.some((o) => !o.onGround && dist(o, ac) < 12 && Math.abs(o.alt - ac.alt) < 1500);
      if (!clash) { this.w.add(ac); return; }
      if (k < 3 && ac.alt > 16000) { ac.alt -= 2000; ac.clearedAlt = Math.min(ac.clearedAlt, ac.alt); } else break;
    }
    f._retry = (f._retry || 0) + 1;
    if (f._retry < 6) { this.pending.push({ f, at: this.w.time + 120 }); }
  }

  // Place an aircraft `sec` seconds along its route (rough average speeds).
  advanceAlongRoute(ac, sec, keep = 4) {
    let remaining = sec * 420 / 3600; // NM
    while (remaining > 0 && ac.routeIdx < ac.route.length - keep) {
      const wp = ac.activeWp;
      const d = dist(ac, wp);
      if (d > remaining) {
        const b = bearing(ac, wp); const p = project(ac, b, remaining);
        ac.x = p.x; ac.y = p.y; remaining = 0;
      } else { ac.x = wp.x; ac.y = wp.y; ac.legStart = { x: wp.x, y: wp.y }; ac.routeIdx++; remaining -= d; }
    }
    ac.legStart = ac.pos;
  }

  // Enroute connection via the researched airway network (if available)
  enrouteBetween(fromPt, destAp, toWp) {
    const net = this.w.data.airwayGraph;
    if (!net || !toWp) return [];
    return net.route(fromPt, toWp) || [];
  }

  exitRoute(last, destPt) {
    const b = bearing(last, destPt);
    const p = project(last, b, 450);
    return [{ id: 'EXIT', x: p.x, y: p.y, kind: 'ENR' }];
  }
}

function hhmm(s) { const [h, m] = String(s || '0:0').split(':').map(Number); return (h * 60 + m) * 60; }
function circDiff(a, b) { return ((a - b) % 86400 + 86400) % 86400; }
function inWindow(clock, t, span) { const d = circDiff(clock, t); return d >= 0 && d < span; }
function entryName(brg, from) { return '·' + (from || 'ENTRY'); }
