// Simulation world: airports, navdata, traffic, automation and alerts.
import { toXY, dist, bearing, angDiff, norm360, project, magToTrue, trueToMag, toLatLon, rad } from '../geo.js';
import { Aircraft } from './aircraft.js';
import { AirportGround, followPolyline, alongRunway } from './ground.js';
import { perf, WAKE_NM, tasFromIas } from './performance.js';
import { Automation } from './automation.js';
import { ConflictProbe } from './conflict.js';
import { Traffic } from './traffic.js';
import { Radio } from './radio.js';
import { unitOf } from './positions.js';
import { fmtEvent } from '../i18n.js';

export const SIM_DT = 0.5; // seconds per physics step

export class World {
  constructor(data) {
    this.data = data;
    this.time = 0;          // seconds since sim start
    this.startClock = 8 * 3600; // JST seconds-of-day at time 0
    this.aircraft = [];
    this.events = [];       // message log
    this.alerts = [];
    this.stats = { arrivals: 0, departures: 0, goArounds: 0, losses: 0, maxDelay: 0 };
    this.weatherCells = [];
    this.wind = {};         // per airport surface wind {dir,spd}
    this.buildNav(data.nav);
    this.buildAirports(data);
    this.automation = new Automation(this);
    this.conflicts = new ConflictProbe(this);
    this.traffic = new Traffic(this, data);
    this.listeners = [];
    this.radio = new Radio(this);
    this.userPos = null;   // selected ATC position (null = global)
    this.manualClr = false; // user issues routine clearances for that position
  }

  get clock() { return (this.startClock + this.time) % 86400; }
  clockStr(sec = this.clock) { const h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60, s = Math.floor(sec % 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }

  // Event log. Messages are stored as (key, params) and rendered in the UI
  // language; `msg` keeps an English rendering for tools/tests.
  log(k, p = {}, kind = 'info', ac = null) {
    this.events.push({ t: this.clock, k, p, msg: fmtEvent('en', k, p), kind, ac: ac?.id });
    if (this.events.length > 300) this.events.shift();
  }

  // ---------------- navdata ----------------
  buildNav(nav) {
    this.fixes = new Map();
    const add = (id, lat, lon, kind, extra = {}) => { if (!this.fixes.has(id)) this.fixes.set(id, { id, lat, lon, kind, ...toXY(lat, lon), ...extra }); };
    for (const n of nav.navaids || []) add(n.id, n.lat, n.lon, 'NAVAID', { name: n.name, ntype: n.type, freq: n.freq, verified: n.verified });
    for (const f of nav.fixes || []) add(f.id, f.lat, f.lon, 'FIX', { verified: f.verified });
    this.airways = nav.airways || [];
    this.procedures = nav.procedures || {};
  }
  fix(id) { return this.fixes.get(id); }

  buildAirports(data) {
    this.airports = new Map();
    for (const a of data.airports) {
      const ap = { ...a, ...toXY(a.lat, a.lon), runways: new Map() };
      for (const r of a.runways) {
        const thr = toXY(r.thr[0], r.thr[1]), end = toXY(r.end[0], r.end[1]), start = toXY((r.start || r.thr)[0], (r.start || r.thr)[1]);
        const trueHdg = bearing(thr, end);
        const rw = { ...r, airport: ap, thr, end, start, trueHdg, magHdg: trueToMag(trueHdg, r.thr[0], r.thr[1]), lengthNm: dist(thr, end), elev: r.elev ?? a.elev, gp: r.gp || 3.0, closed: false, occupiedBy: null, lastDep: -999, lastDepAc: null, lastArr: -999 };
        ap.runways.set(r.id, rw);
      }
      const lay = data.layouts[a.icao];
      ap.ground = lay ? new AirportGround(lay, ap) : null;
      ap.configIdx = 0;
      ap.depQueue = [];
      this.airports.set(a.icao, ap);
      this.wind[a.icao] = { dir: a.defaultWind?.dir ?? 0, spd: a.defaultWind?.spd ?? 8 };
    }
    for (const ap of this.airports.values()) this.autoSelectConfig(ap, true);
  }
  airport(icao) { return this.airports.get(icao); }
  config(ap) { return ap.configs[ap.configIdx]; }
  elevFor(ac) { const ap = this.airports.get(ac.dir === 'DEP' ? ac.from : ac.to); return ap ? ap.elev : 0; }

  // Choose a runway configuration from the surface wind (tailwind limits) unless locked by the user.
  autoSelectConfig(ap, initial = false) {
    if (ap.configLocked) return;
    const w = this.wind[ap.icao];
    let best = ap.configIdx, bestScore = -Infinity;
    const clock = this.clock;
    const inWin = (t) => (t[0] <= t[1] ? clock >= t[0] && clock < t[1] : clock >= t[0] || clock < t[1]);
    ap.configs.forEach((c, i) => {
      if (c.manualOnly) return;
      const rwys = [...c.arr, ...c.dep].map((id) => ap.runways.get(id)).filter(Boolean);
      if (!rwys.length || rwys.some((r) => r.closed)) return;
      // headwind component on the primary arrival runway (tailwind limit ~5 kt)
      const r = ap.runways.get(c.arr[0]);
      const head = w.spd * Math.cos(rad(w.dir - r.magHdg));
      let score = head + (c.preferred ? 3 : 0) + (c.bias ?? 0) + (i === ap.configIdx ? 2 : 0);
      if (c.time) { if (!inWin(c.time)) return; score += 4; }
      if (head < -(c.tailwindLimit ?? 5)) score -= 20;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best !== ap.configIdx) {
      ap.configIdx = best;
      if (!initial) { this.log('cfgChanged', { ap: ap.iata, cfg: ap.configs[best].name, cfgJa: ap.configs[best].ja || ap.configs[best].name }, 'warn'); this.automation.onConfigChange(ap); }
    }
  }

  // Wind: surface wind blended into a westerly flow aloft (typical over Japan).
  windAt(x, y, alt) {
    // nearest airport surface wind
    let best = null, bd = Infinity;
    for (const ap of this.airports.values()) { const d = (x - ap.x) ** 2 + (y - ap.y) ** 2; if (d < bd) { bd = d; best = ap; } }
    const sw = this.wind[best.icao];
    const f = Math.min(1, Math.max(0, (alt - 2000) / 10000));
    const upDir = 265, upSpd = 15 + Math.min(alt, 36000) / 36000 * (this.jet ?? 80);
    const s = { vx: -Math.sin(rad(sw.dir)) * sw.spd * 1.3, vy: -Math.cos(rad(sw.dir)) * sw.spd * 1.3 };
    const u = { vx: -Math.sin(rad(upDir)) * upSpd, vy: -Math.cos(rad(upDir)) * upSpd };
    return { vx: s.vx * (1 - f) + u.vx * f, vy: s.vy * (1 - f) + u.vy * f };
  }

  // ---------------- runtime ----------------
  step(dt) {
    this.time += dt;
    this.traffic.update(dt);
    for (const ac of this.aircraft) {
      if (ac.onGround) this.groundUpdate(ac, dt); else ac.update(dt, this);
      ac.recordTrail(this.time);
    }
    this.automation.update(dt);
    this.conflicts.update(dt);
    if (Math.floor(this.time) !== Math.floor(this.time - dt)) this.updateUnits();
    if (Math.floor(this.time / 60) !== Math.floor((this.time - dt) / 60)) for (const ap of this.airports.values()) this.autoSelectConfig(ap);
    this.cleanup();
  }

  cleanup() {
    const B = this.data.domain;
    this.aircraft = this.aircraft.filter((ac) => {
      if (ac.remove) return false;
      if (ac.dir === 'OVF' && ac.endInside && !ac.activeWp) { this.log('handedOver', { cs: ac.callsign, to: this.data.iata[ac.to] || ac.to }, 'info', ac); return false; }
      if (!ac.onGround && ac.dir !== 'ARR') {
        const ll = ac.latlon;
        if (ll.lat < B.minLat || ll.lat > B.maxLat || ll.lon < B.minLon || ll.lon > B.maxLon) {
          // hand off to the adjacent sector / Fukuoka FIR oceanic before leaving the simulated area
          if (ac.unit && ac.unit !== 'FUKUOKA_ACC') this.radio.exchange(ac, ac.unit, 'contact', { u2: 'FUKUOKA_ACC' });
          this.log('leftArea', { cs: ac.callsign }, 'info', ac);
          return false;
        }
      }
      return true;
    });
  }

  // ---------------- ground ----------------
  // Simple surface separation: stop for aircraft ahead within ~80 m. Head-on or
  // crossing conflicts are resolved by priority (lower id proceeds), and an
  // aircraft blocked for more than 90 s is allowed to creep through so the
  // surface never deadlocks.
  groundBlocked(ac) {
    const RWY = ['LINEUP', 'LINED_UP', 'TAKEOFF', 'ROLLOUT'];
    if (ac.ghostUntil && this.time < ac.ghostUntil) return false;
    const fwdOf = (a) => (a.taxi?.reverse ? norm360(a.hdg + 180) : a.hdg);
    let blocked = false;
    for (const o of this.aircraft) {
      if (o === ac || !o.onGround || o.airportIcao !== ac.airportIcao) continue;
      if (RWY.includes(o.phase) !== RWY.includes(ac.phase)) continue;
      if (o.phase === 'PARKED') continue;
      const d = dist(ac, o);
      if (d > 0.045) continue;
      if (Math.abs(angDiff(fwdOf(ac), bearing(ac, o))) >= 35) continue;
      const mutual = Math.abs(angDiff(fwdOf(o), bearing(o, ac))) < 35 && o.phase !== 'HOLD_SHORT' && o.gsGround > 0.1 || (o.blockedSince && Math.abs(angDiff(fwdOf(o), bearing(o, ac))) < 35);
      if (mutual && ac.id < o.id) continue;
      blocked = true; this._blocker = o; break;
    }
    if (blocked) {
      ac.blockedSince = ac.blockedSince ?? this.time;
      // creep through only when part of a cycle (the blocker itself is stuck), never through a queue
      if (this.time - ac.blockedSince > 90 && this._blocker && this._blocker.blockedSince && !['HOLD_SHORT', 'LINEUP', 'LINED_UP'].includes(this._blocker.phase)) { ac.ghostUntil = this.time + 25; ac.blockedSince = null; return false; }
    } else ac.blockedSince = null;
    return blocked;
  }

  groundUpdate(ac, dt) {
    const ap = this.airports.get(ac.airportIcao);
    switch (ac.phase) {
      case 'PARKED':
        break;
      case 'PUSHBACK': {
        const done = followPolyline(ac, dt, this);
        if (done) {
          ac.phase = 'STARTUP'; ac.phaseT = this.time;
        }
        break;
      }
      case 'STARTUP':
        if (this.time - ac.phaseT > 45 && !ac.req) this.automation.startupDone(ac);
        break;
      case 'TAXI_OUT':
        if (followPolyline(ac, dt, this)) {
          ac.phase = 'HOLD_SHORT'; ac.gsGround = 0; ac.gs = 0;
          ac.depRwy.airport.depQueue.includes(ac) || ac.depRwy.airport.depQueue.push(ac);
        }
        break;
      case 'HOLD_SHORT':
        break;
      case 'LINEUP':
        if (followPolyline(ac, dt, this)) {
          ac.hdg = ac.depRwy.trueHdg; ac.gsGround = 0;
          if (ac.takeoffCleared) { ac.phase = 'TAKEOFF'; this.log('rolling', { cs: ac.callsign, rwy: ac.depRwy.id }, 'info', ac); }
          else ac.phase = 'LINED_UP';
        }
        break;
      case 'LINED_UP':
        if (ac.takeoffCleared) ac.phase = 'TAKEOFF';
        break;
      case 'TAKEOFF': {
        const r = ac.depRwy;
        ac.hdg = r.trueHdg;
        const a = ac.wake === 'M' ? 4.2 : 3.4; // kt/s
        ac.gsGround += a * dt;
        const s = ac.gsGround / 3600 * dt;
        ac.x += Math.sin(rad(ac.hdg)) * s; ac.y += Math.cos(rad(ac.hdg)) * s;
        ac.ias = ac.gsGround; ac.gs = ac.gsGround; ac.trk = ac.hdg;
        if (ac.ias >= ac.perf.vr + 8) this.automation.liftOff(ac);
        break;
      }
      case 'ROLLOUT': {
        const r = ac.arrRwy;
        ac.hdg = r.trueHdg;
        const target = ac.exitAlong != null && alongRunway(r, ac) > ac.exitAlong - 0.05 ? 10 : 25;
        const dec = ac.gsGround > 60 ? 4.5 : 2.5;
        ac.gsGround = Math.max(target, ac.gsGround - dec * dt);
        const s = ac.gsGround / 3600 * dt;
        ac.x += Math.sin(rad(ac.hdg)) * s; ac.y += Math.cos(rad(ac.hdg)) * s;
        ac.ias = ac.gsGround; ac.gs = ac.gsGround; ac.trk = ac.hdg;
        if (ac.exitAlong == null || alongRunway(r, ac) >= ac.exitAlong) this.automation.vacate(ac);
        break;
      }
      case 'TAXI_IN':
        if (followPolyline(ac, dt, this)) {
          ac.phase = 'PARKED'; ac.gsGround = 0; ac.gs = 0; ac.parkedAt = this.time;
          this.log('onStand', { cs: ac.callsign, spot: ac.stand?.ref ?? '' }, 'info', ac);
        }
        break;
    }
    if (ac.phase === 'PARKED' && ac.dir === 'ARR' && this.time - ac.parkedAt > 600) {
      if (ac.stand) ac.stand.occupied = null;
      ac.remove = true;
    }
  }

  // ---------------- ATC units / handoffs ----------------
  isUser(ac, unit = unitOf(this, ac)) { return !!this.userPos && this.manualClr && unit === this.userPos; }
  updateUnits() {
    for (const ac of this.aircraft) {
      const u = unitOf(this, ac);
      if (u === ac.unit) { ac.unitPend = null; continue; }
      if (ac.unit == null || u == null) { ac.unit = u; ac.unitPend = null; continue; }
      // small hysteresis so boundary wobbles do not cause repeated handoffs
      if (ac.unitPend !== u) { ac.unitPend = u; ac.unitPendT = this.time; continue; }
      if (this.time - ac.unitPendT < 3) continue;
      this.handoff(ac, ac.unit, u);
    }
  }
  handoff(ac, from, to) {
    const R = this.radio;
    ac.unit = to; ac.unitPend = null;
    R.exchange(ac, from, 'contact', { u2: to });
    const type = to.split('_').pop();
    const user = this.isUser(ac, to);
    if (type === 'APP' || type === 'ACC') {
      if (ac.dir === 'DEP') { R.say(ac, to, 'PLT', 'dep_checkin', { alt: Math.round(ac.alt / 100) * 100, clr: ac.clearedAlt }); R.say(ac, to, 'ATC', type === 'APP' ? 'radar_dep' : 'radar_enr', { clr: ac.clearedAlt }); }
      else if (ac.dir === 'ARR' && type === 'APP') { R.say(ac, to, 'PLT', 'arr_checkin', { alt: Math.round(ac.alt / 100) * 100, star: (ac.starName || 'STAR').replace(' ARRIVAL', '') }); R.say(ac, to, 'ATC', 'arr_ack', { app: ac.appName || 'ILS' }); }
      else { R.say(ac, to, 'PLT', 'enr_checkin', { alt: Math.round(ac.alt / 100) * 100 }); R.say(ac, to, 'ATC', 'radar_enr', {}); }
    } else if (type === 'TWR') {
      if (ac.onGround && ac.dir === 'DEP') { R.say(ac, to, 'PLT', 'ready', { rwy: ac.depRwy?.id }); if (user) ac.req = { type: 'DEPART', t: this.time }; }
      else if (ac.dir === 'ARR') { R.say(ac, to, 'PLT', 'twr_checkin', { app: ac.appName || 'ILS' }); if (!user) R.say(ac, to, 'ATC', 'cont_app', { rwy: ac.arrRwy?.id }); else ac.req = { type: 'LAND', t: this.time }; }
    } else if (type === 'GND' && ac.dir === 'ARR') {
      R.say(ac, to, 'PLT', 'vacated', { rwy: ac.arrRwy?.id, spot: ac.stand?.ref || '' });
      if (user) { if (ac.taxi) ac.taxi.hold = true; ac.req = { type: 'TAXIIN', t: this.time }; }
      else R.exchange(ac, to, 'taxi_in', { spot: ac.stand?.ref || '', via: (ac.taxiNames || []).slice(0, 4).join(' ') });
    }
  }

  add(ac) { this.aircraft.push(ac); return ac; }
  byId(id) { return this.aircraft.find((a) => a.id === id); }
}
