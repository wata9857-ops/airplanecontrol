// Aircraft state + flight dynamics (point-mass model with rate-limited turns,
// accelerations and vertical speeds) and the "pilot/FMS" layer that flies
// LNAV/VNAV routes, assigned headings/altitudes/speeds, holds and ILS approaches.
import { angDiff, norm360, bearing, dist, project, trackInfo, magToTrue, trueToMag, toLatLon, rad, deg } from '../geo.js';
import { perf, tasFromIas, machToTas, iasFromMach } from './performance.js';

const G_FT_PER_NM = 300;          // planning descent gradient (~2.8°)
const FT_PER_NM = 6076.12;

let nextId = 1;
// along-track distance of a point to the runway threshold (positive before it)
const alongPt = (r, p) => (r.thr.x - p.x) * Math.sin(rad(r.trueHdg)) + (r.thr.y - p.y) * Math.cos(rad(r.trueHdg));

export class Aircraft {
  constructor(o) {
    Object.assign(this, {
      id: nextId++,
      callsign: o.callsign, flight: o.flight || o.callsign, airline: o.airline || '',
      telephony: o.telephony || '', type: o.type,
      from: o.from, to: o.to, dir: o.dir, // ARR | DEP | OVF
      x: o.x, y: o.y, alt: o.alt ?? 0, ias: o.ias ?? 0, hdg: o.hdg ?? 0, trk: o.hdg ?? 0,
      vs: 0, gs: 0, tas: 0,
      onGround: !!o.onGround,
      phase: o.phase || 'CRUISE',
      route: o.route || [], routeIdx: 0, legStart: null,
      cruiseAlt: o.cruiseAlt || 35000,
      clearedAlt: o.clearedAlt ?? o.alt ?? 0,
      lat: { mode: 'LNAV', hdg: null, turn: 0 }, // turn: -1 left, +1 right, 0 shortest
      atcSpd: null, atcHdg: null, // user/auto assigned
      vnav: o.dir === 'ARR',      // descend via STAR constraints
      hold: null, appr: null, // approach: {rwy, cleared, established, gsCaptured}
      squawk: o.squawk || '2000', emergency: null,
      trail: [], lastTrail: 0,
      notes: [], sector: '', handedOff: false,
      sched: o.sched || null, stand: o.stand || null,
      taxi: null, groundSpeedTarget: 0,
      created: o.time || 0, landedAt: null, airborneAt: null,
      manual: { hdg: false, alt: false, spd: false },
      delay: 0, slot: null, seq: null, ga: 0,
    });
    this.perf = perf(this.type);
    this.wake = this.perf.wake;
  }

  get pos() { return { x: this.x, y: this.y }; }
  get latlon() { return toLatLon(this.x, this.y); }
  get activeWp() { return this.route[this.routeIdx] || null; }

  // ---------- route helpers ----------
  remainingRoute() { return this.route.slice(this.routeIdx); }
  distToGo() {
    let d = 0, p = this.pos;
    for (let i = this.routeIdx; i < this.route.length; i++) { d += dist(p, this.route[i]); p = this.route[i]; }
    return d;
  }
  distAlongTo(idx) {
    let d = 0, p = this.pos;
    for (let i = this.routeIdx; i <= idx && i < this.route.length; i++) { d += dist(p, this.route[i]); p = this.route[i]; }
    return d;
  }
  directTo(fixId) {
    const i = this.route.findIndex((w, k) => k >= 0 && w.id === fixId);
    if (i < 0) return false;
    this.routeIdx = i; this.legStart = this.pos; this.lat = { mode: 'LNAV', hdg: null, turn: 0 }; this.hold = null;
    this.manual.hdg = false;
    return true;
  }

  // ---------- target speed ----------
  profileSpeed(world) {
    const p = this.perf;
    if (this.onGround) return 0;
    if (this.appr && this.appr.established) {
      const d = this.appr.distThr ?? 99;
      if (d < 4.5) return p.vapp;
      if (d < 7) return Math.max(p.vapp, 160);
      return Math.min(this.atcSpd ?? 180, 180);
    }
    if (this.dir === 'DEP' || this.phase === 'GOAROUND') {
      const agl = this.alt - (world.elevFor(this) || 0);
      if (agl < 1500) return p.vr + 20;
      if (agl < 3000) return Math.min(p.vr + 50, 220);
      if (this.alt < 10000) return 250;
      return this.alt > 26000 ? iasFromMach(p.mach, this.alt) : p.cruiseIas;
    }
    // arrivals / overflights
    const wp = this.activeWp;
    let s = this.alt > 10500 ? (this.alt > 26000 ? iasFromMach(p.mach - 0.01, this.alt) : p.cruiseIas) : 250;
    if (wp && wp.spd && this.alt < 15000) s = Math.min(s, wp.spd);
    if (this.dir === 'ARR') {
      const dthr = this.distToGo();
      if (dthr < 25 && this.alt < 12000) s = Math.min(s, 210);
    }
    return s;
  }

  // ---------- main update ----------
  update(dt, world) {
    if (this.onGround) return; // ground movement handled by ground module
    const p = this.perf;
    const wind = world.windAt(this.x, this.y, this.alt);

    // Lateral guidance -> desired true heading
    let desiredHdg = this.hdg, turnDir = 0;
    const L = this.lat;
    if (this.appr && this.appr.cleared && !this.appr.established) this.tryLocCapture(world);
    if (this.appr && this.appr.established) {
      desiredHdg = this.locHeading(wind);
    } else if (L.mode === 'HDG') {
      desiredHdg = L.hdg; turnDir = L.turn;
      if (Math.abs(angDiff(this.hdg, desiredHdg)) < 2) L.turn = 0;
    } else if (L.mode === 'ORBIT') {
      // continuous rate-one turn for 360°, then resume LNAV
      const step = Math.abs(this.turnRate || 3) * dt;
      L.remaining -= step;
      desiredHdg = norm360(this.hdg + L.turn * 40); turnDir = L.turn;
      if (L.remaining <= 0) { this.lat = { mode: L.resume || 'LNAV', hdg: L.resumeHdg ?? null, turn: 0 }; this.legStart = this.pos; }
    } else if (L.mode === 'HOLD' && this.hold) {
      const r = this.holdGuidance(dt, wind); desiredHdg = r.hdg; turnDir = r.turn;
    } else if (L.mode === 'LNAV') {
      desiredHdg = this.lnavHeading(wind, world);
    }

    // Turn dynamics: standard rate (3°/s) limited to 25° bank (30° on final intercept)
    this.tas = this.alt > 26000 && this.ias >= iasFromMach(p.mach, this.alt) - 1 ? machToTas(Math.min(p.mach, this.machOf()), this.alt) : tasFromIas(this.ias, this.alt);
    if (p.tas && this.alt > 15000) this.tas = Math.min(this.tas, p.tas);
    // turn rate (deg/s) = 1091·tan(bank)/TAS(kt)
    const rate = Math.min(3, 1091 * Math.tan(rad(25)) / Math.max(this.tas, 100));
    let d = angDiff(this.hdg, desiredHdg);
    if (turnDir === 1 && d < -5) d += 360;
    if (turnDir === -1 && d > 5) d -= 360;
    const maxTurn = rate * dt;
    this.turnRate = Math.abs(d) <= maxTurn ? d / dt : Math.sign(d) * rate;
    this.hdg = norm360(this.hdg + Math.max(-maxTurn, Math.min(maxTurn, d)));

    // Speed
    let tgt = this.atcSpd ?? (this.autoSpd != null ? Math.min(this.autoSpd, this.profileSpeed(world)) : this.profileSpeed(world));
    if (this.alt < 10000 && !this.atcSpd) tgt = Math.min(tgt, 250);
    tgt = Math.max(tgt, (this.appr && this.appr.established) ? p.vapp : Math.min(p.vmin, tgt));
    const dv = tgt - this.ias;
    const acc = dv > 0 ? p.accel : (this.vs < -500 ? 0.6 : 1.0);
    this.ias += Math.max(-acc * dt, Math.min(acc * dt, dv));

    // Vertical
    let tgtAlt = this.clearedAlt;
    if (this.vnav && !this.manual.alt) tgtAlt = Math.max(this.clearedAlt, Math.min(this.alt, this.vnavCeiling(world)));
    if (this.dir === 'DEP' && !this.manual.alt) {
      const c = this.sidCeiling();
      if (c != null) tgtAlt = Math.min(tgtAlt, c);
    }
    // temporary level-off restriction from the conflict-resolution logic
    if (this.hold && this.hold.level != null && !this.manual.alt && !this.hold.exit) tgtAlt = Math.min(this.alt, this.hold.levelEff ?? this.hold.level) > this.hold.level ? Math.max(this.hold.levelEff ?? this.hold.level, this.hold.level) : (this.hold.levelEff ?? this.hold.level);
    if (this.restrict && !this.manual.alt && !(this.hold && this.hold.level != null)) {
      if (this.restrict.to != null) tgtAlt = this.restrict.to;
      if (this.restrict.max != null && tgtAlt > this.restrict.max) tgtAlt = Math.max(this.restrict.max, Math.min(tgtAlt, this.alt));
      if (this.restrict.min != null && tgtAlt < this.restrict.min) tgtAlt = Math.min(this.restrict.min, Math.max(tgtAlt, this.alt));
    }
    // on the localiser but not yet on the glidepath: descend to just below it
    if (this.appr && this.appr.established && !this.appr.gsCaptured && !this.manual.alt) {
      const r = this.appr.rwy;
      const gsBelow = (r.elev || 0) + 50 + this.appr.distThr * FT_PER_NM * Math.tan(rad(r.gp || 3)) - 200;
      tgtAlt = Math.max((r.elev || 0) + 400, Math.min(this.alt, gsBelow));
      // pass route points that are now behind the aircraft
      while (this.activeWp && this.routeIdx < this.route.length - 1 && this.alongToThr(r) < alongPt(r, this.activeWp) - 0.2) this.routeIdx++;
    }
    this.tgtAltEff = tgtAlt;
    if (this.appr && this.appr.gsCaptured) {
      const thrElev = this.appr.rwy.elev || 0;
      const gsAlt = thrElev + 50 + this.appr.distThr * FT_PER_NM * Math.tan(rad(this.appr.rwy.gp || 3));
      const need = (gsAlt - this.alt) * 0.25; // ft/s correction
      const pathVs = -this.gs * FT_PER_NM / 3600 * Math.tan(rad(this.appr.rwy.gp || 3)); // ft/s
      this.vs = (pathVs + need) * 60;
      this.vs = Math.max(-2500, Math.min(500, this.vs));
    } else {
      const diff = tgtAlt - this.alt;
      if (Math.abs(diff) < 5) { this.vs = 0; this.alt = tgtAlt; }
      else if (diff > 0) {
        const c = this.alt < 10000 ? p.climb[0] : this.alt < 24000 ? p.climb[1] : p.climb[2];
        const want = Math.min(c, Math.max(300, diff * 2.0)); // smooth level-off
        this.vs += Math.max(-600 * dt, Math.min(600 * dt, want - this.vs));
      } else {
        let want = -Math.min(this.descentRate(world), Math.max(300, -diff * 2.0));
        this.vs += Math.max(-600 * dt, Math.min(600 * dt, want - this.vs));
      }
    }
    this.alt += this.vs / 60 * dt;

    // Kinematics with wind
    const vx = Math.sin(rad(this.hdg)) * this.tas + wind.vx;
    const vy = Math.cos(rad(this.hdg)) * this.tas + wind.vy;
    this.gs = Math.hypot(vx, vy);
    this.trk = norm360(deg(Math.atan2(vx, vy)));
    this.x += vx / 3600 * dt;
    this.y += vy / 3600 * dt;

    if (this.appr) this.appr.distThr = this.alongToThr(this.appr.rwy);
  }

  machOf() { return this.tas / (38.967854 * Math.sqrt(this.alt < 36089 ? 288.15 - 0.0019812 * this.alt : 216.65)); }

  descentRate(world) {
    const p = this.perf;
    if (this.appr && this.appr.established && !this.appr.gsCaptured) return 2500;
    // Arrivals under VNAV follow the path; otherwise use typical idle descent
    if (this.vnav && !this.manual.alt) {
      const ceil = this.vnavCeiling(world);
      const pathRate = this.gs * G_FT_PER_NM / 60; // fpm along gradient
      if (this.alt - ceil > 1500) return Math.min(p.desc + 1000, 3500);
      return Math.max(800, Math.min(p.desc + 500, pathRate * 1.15));
    }
    return Math.min(p.desc, this.alt < 10000 ? 1800 : p.desc);
  }

  // Highest altitude the aircraft may be at now and still meet downstream
  // "at or below" constraints using a ~2.8° descent gradient.
  vnavCeiling(world) {
    let ceil = Infinity, d = 0, prev = this.pos;
    for (let i = this.routeIdx; i < this.route.length; i++) {
      const w = this.route[i];
      d += dist(prev, w); prev = w;
      if (w.altMax != null) ceil = Math.min(ceil, w.altMax + d * G_FT_PER_NM);
    }
    if (this.dir === 'ARR') ceil = Math.min(ceil, (world.elevFor(this) || 0) + 1500 + d * G_FT_PER_NM);
    // never below the next "at or above" constraint
    const nx = this.route.slice(this.routeIdx).find((w) => w.altMin != null);
    if (nx) ceil = Math.max(ceil, nx.altMin);
    return ceil;
  }

  sidCeiling() {
    for (let i = this.routeIdx; i < this.route.length; i++) {
      const w = this.route[i];
      if (w.altMax != null && w.altMax < this.clearedAlt) return w.altMax;
    }
    return null;
  }

  lnavHeading(wind, world) {
    let wp = this.activeWp;
    if (!wp) { return this.hdg; }
    if (!this.legStart) this.legStart = this.pos;
    let ti = trackInfo(this.pos, this.legStart, wp);
    const remain = ti.len - ti.along;
    // turn anticipation
    const next = this.route[this.routeIdx + 1];
    let lead = 0.3;
    if (next) {
      const b1 = bearing(this.legStart, wp), b2 = bearing(wp, next);
      const turn = Math.abs(angDiff(b1, b2));
      const R = (this.gs * this.gs) / (11.26 * Math.tan(rad(25))) / FT_PER_NM;
      lead = Math.min(R * Math.tan(rad(Math.min(turn, 150) / 2)), 6) + 0.1;
    }
    if (remain < lead || (dist(this.pos, wp) < 0.4)) {
      this.onWaypointPassed(wp, world);
      if (this.lat.mode !== 'LNAV') return this.hdg;
      this.legStart = { x: wp.x, y: wp.y };
      this.routeIdx++;
      wp = this.activeWp;
      if (!wp) {
        // end of route: hold present heading
        this.lat = { mode: 'HDG', hdg: this.hdg, turn: 0 };
        return this.hdg;
      }
      ti = trackInfo(this.pos, this.legStart, wp);
    }
    const legBrg = bearing(this.legStart, wp);
    // if far off track (e.g. after vectors) just go direct
    let track;
    if (Math.abs(ti.cross) > 8 || ti.along < -2) { track = bearing(this.pos, wp); this.legStart = this.pos; }
    else track = norm360(legBrg - Math.max(-40, Math.min(40, ti.cross * 30)));
    return this.headingForTrack(track, wind);
  }

  headingForTrack(track, wind) {
    // wind correction angle
    const tas = Math.max(this.tas, 60);
    const wx = wind.vx, wy = wind.vy;
    const cross = wx * Math.cos(rad(track)) - wy * Math.sin(rad(track)); // wind component to the right of track
    const wca = deg(Math.asin(Math.max(-0.9, Math.min(0.9, -cross / tas))));
    return norm360(track + wca);
  }

  onWaypointPassed(wp, world) {
    if (wp.hold && this.holdRequest && !this.hold) {
      this.holdRequest = false;
      world?.log(`${this.callsign} hold at ${wp.id}, expect further clearance (delay ${Math.round((this.delay || 0) / 60)} min)`, 'warn', this);
      this.startHold(wp, wp.hold.inbound, wp.hold.turn || 1);
    }
    if (world && world.onWaypoint) world.onWaypoint(this, wp);
  }

  // ---------- holding ----------
  startHold(fix, inboundTrue, turn = 1) {
    this.hold = { fix: { x: fix.x, y: fix.y, id: fix.id }, inbound: inboundTrue, turn, phase: dist(this.pos, fix) < 1 ? 'outbound' : 'toFix', t: 0, laps: 0, since: Date.now() + Math.random(), level: null };
    this.lat = { mode: 'HOLD', hdg: null, turn: 0 };
  }
  holdGuidance(dt, wind) {
    const h = this.hold;
    const legTime = this.alt > 14000 ? 90 : 60;
    if (h.phase === 'toFix') {
      if (dist(this.pos, h.fix) < 0.5) { h.phase = 'outbound'; h.t = 0; }
      return { hdg: this.headingForTrack(bearing(this.pos, h.fix), wind), turn: 0 };
    }
    if (h.phase === 'outbound') {
      const out = norm360(h.inbound + 180);
      if (Math.abs(angDiff(this.hdg, out)) < 5) h.t += dt;
      if (h.t > legTime) h.phase = 'inbound';
      return { hdg: out, turn: h.turn };
    }
    // inbound: track to fix along inbound course
    const start = project(h.fix, h.inbound + 180, 15);
    const ti = trackInfo(this.pos, start, h.fix);
    if (ti.len - ti.along < 0.3) {
      h.laps++;
      if (h.exit) { this.hold = null; this.lat = { mode: 'LNAV', hdg: null, turn: 0 }; this.legStart = this.pos; return { hdg: this.hdg, turn: 0 }; }
      h.phase = 'outbound'; h.t = 0;
      return { hdg: norm360(h.inbound + 180), turn: h.turn };
    }
    const off = Math.abs(angDiff(this.hdg, h.inbound));
    if (off > 60) return { hdg: h.inbound, turn: h.turn };
    const track = norm360(h.inbound - Math.max(-40, Math.min(40, ti.cross * 30)));
    return { hdg: this.headingForTrack(track, wind), turn: 0 };
  }

  // ---------- ILS ----------
  // signed along-track distance to the landing threshold (negative once past it)
  alongToThr(r) {
    const dx = r.thr.x - this.x, dy = r.thr.y - this.y;
    return dx * Math.sin(rad(r.trueHdg)) + dy * Math.cos(rad(r.trueHdg));
  }
  clearApproach(rwy) {
    this.appr = { rwy, cleared: true, established: false, gsCaptured: false, distThr: this.alongToThr(rwy) };
  }
  tryLocCapture(world) {
    const r = this.appr.rwy;
    const start = project(r.thr, r.trueHdg + 180, 30);
    const ti = trackInfo(this.pos, start, r.thr);
    const rel = angDiff(r.trueHdg, this.trk); // + = track is right of course
    const hdgOff = Math.abs(rel);
    const fromThr = ti.len - ti.along;
    // Autopilot LOC capture: begin the turn so as to roll out on the centreline.
    const R = (this.gs * this.gs) / (11.26 * Math.tan(rad(25))) / FT_PER_NM;
    const capW = R * (1 - Math.cos(rad(Math.min(hdgOff, 90)))) + 0.15;
    const converging = Math.abs(ti.cross) < 0.15 || (ti.cross > 0 ? rel < 0 : rel > 0);
    if (fromThr > 0.5 && fromThr < 25 && hdgOff < 95 && converging && Math.abs(ti.cross) < capW) {
      this.appr.established = true;
      this.lat = { mode: 'LOC', hdg: null, turn: 0 };
      this.manual.hdg = false; this.atcHdg = null; this.hold = null;
    }
  }
  locHeading(wind) {
    const r = this.appr.rwy;
    const start = project(r.thr, r.trueHdg + 180, 30);
    const ti = trackInfo(this.pos, start, r.thr);
    // glideslope capture from below/at
    const gsAlt = (r.elev || 0) + 50 + this.alongToThr(r) * FT_PER_NM * Math.tan(rad(r.gp || 3));
    // capture from below / at the intercept altitude (never dive onto it from far above)
    if (!this.appr.gsCaptured && this.alt >= gsAlt - 150 && this.alt <= gsAlt + 250) { this.appr.gsCaptured = true; this.vnav = false; }
    const track = norm360(r.trueHdg - Math.max(-30, Math.min(30, ti.cross * 60)));
    return this.headingForTrack(track, wind);
  }

  // ---------- trail ----------
  recordTrail(t) {
    if (t - this.lastTrail >= 5) { this.trail.push({ x: this.x, y: this.y }); if (this.trail.length > 12) this.trail.shift(); this.lastTrail = t; }
  }

  // ---------- ATC commands (from user or automation) ----------
  cmdHeading(magHdg, turn = 0, world) {
    const ll = this.latlon;
    this.lat = { mode: 'HDG', hdg: magToTrue(magHdg, ll.lat, ll.lon), turn };
    this.hold = null;
    if (this.appr && !this.appr.established) this.appr = null;
    if (this.appr && this.appr.established) { this.appr = null; }
  }
  startOrbit(dir) {
    const prev = this.lat;
    this.lat = { mode: 'ORBIT', turn: dir, remaining: 360, resume: prev.mode === 'HDG' ? 'HDG' : 'LNAV', resumeHdg: prev.mode === 'HDG' ? prev.hdg : null };
  }
  cmdAltitude(ft) { this.clearedAlt = ft; this.vnav = false; }
  cmdDescendVia() { this.vnav = true; }
  cmdSpeed(kt) { this.atcSpd = kt; }
  cmdResumeSpeed() { this.atcSpd = null; }
  cmdResumeNav() { this.lat = { mode: 'LNAV', hdg: null, turn: 0 }; this.legStart = this.pos; this.hold = null; }
  get magHdg() { const ll = this.latlon; return trueToMag(this.hdg, ll.lat, ll.lon); }
  get assignedMagHdg() { if (this.lat.mode !== 'HDG') return null; const ll = this.latlon; return trueToMag(this.lat.hdg, ll.lat, ll.lon); }
}
