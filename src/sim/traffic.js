// Schedule-driven traffic generation from researched real-world flights.
// Departures appear on stands ~20 min before STD and push back at STD;
// arrivals from outside the simulated domain enter at the domain edge so that
// they land close to STA. Flights between two simulated airports are flown
// gate-to-gate.
import { toXY, dist, bearing, project, norm360, trueToMag } from '../geo.js';
import { Aircraft } from './aircraft.js';

const ENTRY_NM = 170; // arrivals appear this far (track miles) from destination

export class Traffic {
  constructor(world, data) {
    this.w = world;
    this.flights = (data.schedule?.flights || []).map((f, i) => ({ ...f, key: i, t: hhmm(f.timeLocal) }));
    this.airlines = new Map((data.schedule?.airlines || []).map((a) => [a.icao, a]));
    this.spawned = new Set();
    this.density = 1.0;
    this.squawkSeq = 1100;
    this.pending = [];
  }

  simAirport(icao) { return this.w.airports.get(icao); }

  update() {
    const clock = this.w.clock;
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

  inboundTime(f) { return ENTRY_NM / 330 * 3600 + 6 * 60; }

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
    const brg = bearing(ap, origPt);
    const entry = project(ap, brg, Math.min(ENTRY_NM, dist(ap, origPt)));
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
  advanceAlongRoute(ac, sec) {
    let remaining = sec * 400 / 3600; // NM
    while (remaining > 0 && ac.routeIdx < ac.route.length - 4) {
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
