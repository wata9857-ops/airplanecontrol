// ATC instructions issued by the user. Each command marks the relevant
// dimension as manually controlled (automation then leaves it alone), is
// transmitted on the controlling unit's frequency (radio transcript) and the
// pilot reads back. Pending pilot requests are cleared by the matching command.
import { pad3, dist, bearing, project } from '../geo.js';
import { unitOf, posName, posFreq } from '../sim/positions.js';
import { windStr } from '../sim/automation.js';
import { t, getLang } from '../i18n.js';

export function commands(w, ui) {
  const R = w.radio;
  const unit = (ac) => unitOf(w, ac) || ac.unit || (ac.airportIcao ? ac.airportIcao + '_GND' : null);
  const send = (ac, key, p = {}) => {
    const u = unit(ac);
    const before = R.log.length;
    R.exchange(ac, u, key, p);
    const msgs = R.log.slice(before);
    if (msgs.length) ui.toast(msgs.map((m, i) => (i ? '« ' : '') + R.render(m, ui.radioLang, w.data) + (i ? ' »' : '')).join('\n'));
    ui.flash(ac);
  };

  return {
    unitFor(ac) {
      const u = unit(ac);
      return { id: u, name: posName(u, getLang(), ac.dir), freq: posFreq(u, ac.dir) };
    },

    heading(ac, mag, turn) {
      mag = Math.round(mag) % 360 || 360;
      ac.cmdHeading(mag, turn, w);
      ac.manual.hdg = true; ac.noAutoApproach = false; ac.autoClearOnVector = false;
      send(ac, 'hdg', { hdg: pad3(mag), turn: turn < 0 ? 'left' : turn > 0 ? 'right' : '' });
    },
    orbit(ac, dir) {
      ac.startOrbit(dir);
      ac.manual.hdg = true;
      send(ac, 'orbit', { dir: dir < 0 ? 'left' : 'right' });
    },
    altitude(ac, ft) {
      const climb = ft > ac.alt;
      ac.cmdAltitude(ft); ac.manual.alt = true;
      if (ac.req?.type === 'CLIMB') ac.req = null;
      send(ac, climb ? 'climb' : 'descend', { alt: ft });
    },
    via(ac) {
      ac.manual.alt = false; ac.vnav = ac.dir === 'ARR';
      if (ac.dir === 'ARR') { ac.clearedAlt = Math.max((ac.arrRwy?.elev || 0) + 3000, 3000); send(ac, 'via_star', { star: (ac.starName || 'STAR').replace(' ARRIVAL', '') }); }
      else { ac.clearedAlt = ac.cruiseAlt; if (ac.req?.type === 'CLIMB') ac.req = null; send(ac, 'via_sid', { alt: ac.cruiseAlt }); }
    },
    climbApprove(ac) { const a = ac.req?.alt || ac.cruiseAlt; ac.req = null; ac.clearedAlt = a; send(ac, 'climb', { alt: a }); },
    speed(ac, kt) {
      if (kt == null) { ac.atcSpd = null; ac.manual.spd = false; send(ac, 'spd_resume'); return; }
      ac.atcSpd = kt; ac.manual.spd = true;
      send(ac, 'spd', { spd: kt });
    },
    resumeNav(ac) {
      ac.cmdResumeNav(); ac.manual.hdg = false;
      send(ac, 'resume_nav', { fix: ac.activeWp && ac.activeWp.kind !== 'VEC' ? ac.activeWp.id : '' });
    },
    direct(ac, id) { if (ac.directTo(id)) { ac.manual.hdg = false; send(ac, 'direct', { fix: id }); } },
    hold(ac, id) {
      const f = w.fix(id); if (!f) return;
      const i = ac.route.findIndex((x, k) => k >= ac.routeIdx && x.id === id);
      const inbound = i > 0 ? bearing(i > ac.routeIdx ? ac.route[i - 1] : ac, f) : bearing(ac, f);
      ac.directTo(id);
      ac.startHold(f, inbound, 1);
      ac.manual.hdg = true;
      send(ac, 'hold', { fix: id, min: 10 });
    },
    exitHold(ac) { if (ac.hold) { ac.hold.exit = true; ac.manual.hdg = false; send(ac, 'exit_hold'); } },
    reroute(ac, starName) {
      const ap = w.airport(ac.to); const s = w.procedures[ac.to].stars.find((x) => x.name === starName);
      if (!s) return;
      const auto = w.automation;
      const wps = auto.legsToWps(s.legs, 'STAR');
      const app = auto.pickApproach(ap, ac.arrRwy, wps.at(-1));
      const fw = auto.finalWps(ac.arrRwy);
      const tail = app ? app.wps : auto.vectorPattern(ac.arrRwy, wps.at(-1));
      if (tail.length && dist(tail.at(-1), ac.arrRwy.thr) < 6.5) fw.shift();
      ac.route = [...wps, ...tail, ...fw]; ac.routeIdx = 0; ac.legStart = ac.pos; ac.starName = s.name; ac.appName = app?.a.name || ac.appName;
      ac.lat = { mode: 'LNAV', hdg: null, turn: 0 }; ac.manual.hdg = false; ac.seqFrozen = false;
      send(ac, 'reroute', { star: s.name.replace(' ARRIVAL', ' arrival') });
    },
    runway(ac, id) {
      const ap = w.airport(ac.to); const r = ap.runways.get(id);
      if (!r || r.closed) { ui.toast(t('rwyNA')); return; }
      const keepHdg = ac.manual.hdg;
      ac.seqFrozen = false;
      const seg = w.automation.buildArrivalSegment(ap, r, ac.pos);
      ac.arrRwy = r; ac.starName = seg.starName; ac.appName = seg.appName; ac.route = seg.wps; ac.routeIdx = 0; ac.legStart = ac.pos; ac.appr = null; ac.landClr = false;
      if (!keepHdg) ac.lat = { mode: 'LNAV', hdg: null, turn: 0 };
      send(ac, 'expect_rwy', { app: seg.appName });
    },
    approach(ac) {
      if (!ac.arrRwy) return;
      ac.clearApproach(ac.arrRwy);
      ac.phase = 'APPROACH'; ac.noAutoApproach = false;
      if (ac.req?.type === 'APP') ac.req = null;
      if (!ac.manual.alt) ac.vnav = true;
      send(ac, 'app_clr', { app: ac.appName || 'ILS RWY' + ac.arrRwy.id });
    },
    cancelApproach(ac) {
      ac.appr = null; ac.noAutoApproach = true;
      if (ac.lat.mode === 'LOC') ac.lat = { mode: 'HDG', hdg: ac.hdg, turn: 0 };
      send(ac, 'cancel_app');
    },
    clearLand(ac) {
      if (!ac.arrRwy) return;
      ac.landClr = true; if (ac.req?.type === 'LAND') ac.req = null;
      send(ac, 'land_clr', { rwy: ac.arrRwy.id, wind: windStr(w, ac.arrRwy.airport) });
    },
    goAround(ac) {
      if (!ac.arrRwy) return;
      send(ac, 'go_around', { alt: ac.arrRwy.missedAlt || 3000 });
      w.automation.goAround(ac, 'ATC instruction');
    },
    expedite(ac) { ac.expedite = true; ac.manual.spd = false; ac.atcSpd = null; send(ac, 'expedite'); },
    emergency(ac) {
      const u = unit(ac);
      if (ac.emergency) { ac.emergency = null; ac.squawk = ac.prevSquawk || ac.squawk; w.log('emergencyOff', { cs: ac.callsign }, 'info', ac); return; }
      ac.emergency = 'MAYDAY'; ac.prevSquawk = ac.squawk; ac.squawk = '7700';
      const nature = ac.dir === 'DEP' ? 'engine failure, requesting return' : 'medical emergency, requesting priority';
      w.log('emergency', { cs: ac.callsign, nature }, 'alert', ac);
      R.say(ac, u, 'PLT', 'mayday', { nature, natureJa: ac.dir === 'DEP' ? 'エンジン故障、引き返しを要求' : '急病人発生、優先着陸を要求' });
      R.say(ac, u, 'ATC', 'mayday_ack', {});
      if (ac.dir === 'DEP' && !ac.onGround && w.airport(ac.from)) {
        ac.to = ac.from; ac.dir = 'ARR'; ac.arrJoinIdx = null;
        w.automation.planArrival(ac, ac.pos);
        ac.clearedAlt = Math.min(ac.alt, 8000); ac.cruiseAlt = ac.clearedAlt;
      }
      ac.priority = true; ac.seqFrozen = false;
      ui.toast(`MAYDAY MAYDAY MAYDAY — ${ac.callsign}`, 4000); ui.flash(ac);
    },
    randomEmergency() {
      const cands = w.aircraft.filter((a) => !a.onGround && !a.emergency && a.alt > 6000 && (w.airport(a.to) || w.airport(a.from)));
      if (!cands.length) return;
      const ac = cands[Math.floor(Math.random() * cands.length)];
      this.emergency(ac); ui.select(ac);
    },
    toggleRunway(ap, r) {
      const opp = ap.runways.get(r.opp);
      r.closed = !r.closed; if (opp) opp.closed = r.closed;
      w.log(r.closed ? 'rwyClosed' : 'rwyOpen', { ap: ap.iata, rwy: `${r.id}/${r.opp}` }, r.closed ? 'alert' : 'warn');
      const locked = ap.configLocked; ap.configLocked = false;
      w.autoSelectConfig(ap);
      ap.configLocked = locked && !w.config(ap).arr.some((id) => ap.runways.get(id).closed);
      w.automation.onConfigChange(ap);
    },
    // ---------- ground ----------
    push(ac) { if (ac.phase === 'PARKED') { ac.pushHold = false; send(ac, 'push_ok'); w.automation.beginPushback(ac, true); } },
    pushHold(ac) { ac.pushHold = !ac.pushHold; if (ac.pushHold) { if (ac.req?.type === 'PUSH') ac.req = null; send(ac, 'push_wait'); } },
    taxi(ac) {
      if (ac.phase !== 'STARTUP') return;
      const before = R.log.length;
      w.automation.beginTaxiOut(ac);
      const msgs = R.log.slice(before);
      if (msgs.length) ui.toast(msgs.map((m) => R.render(m, ui.radioLang, w.data)).join('\n'));
      ui.flash(ac);
    },
    taxiIn(ac) {
      if (ac.taxi) ac.taxi.hold = false;
      if (ac.req?.type === 'TAXIIN') ac.req = null;
      send(ac, 'taxi_in', { spot: ac.stand?.ref || '', via: (ac.taxiNames || []).slice(0, 4).join(' ') });
    },
    holdPos(ac) { if (ac.taxi) { ac.taxi.hold = !ac.taxi.hold; send(ac, ac.taxi.hold ? 'hold_pos' : 'cont_taxi'); } },
    holdShort(ac) { ac.manualHold = !ac.manualHold; if (ac.manualHold) send(ac, 'hold_short', { rwy: ac.depRwy.id }); },
    lineUp(ac) {
      const ap = ac.depRwy.airport, r = ac.depRwy;
      if (r.closed) { ui.toast(t('rwyClosedT')); return; }
      if (ac.phase !== 'HOLD_SHORT') return;
      ap.depQueue = ap.depQueue.filter((a) => a !== ac);
      lineupPath(ac, ap, r);
      ac.takeoffCleared = false; ac.manualHold = true;
      if (ac.req?.type === 'DEPART') ac.req = null;
      send(ac, 'luaw', { rwy: r.id });
    },
    takeoff(ac) {
      const ap = ac.depRwy.airport, r = ac.depRwy;
      if (r.closed) { ui.toast(t('rwyClosedT')); return; }
      ap.depQueue = ap.depQueue.filter((a) => a !== ac);
      if (ac.phase === 'HOLD_SHORT') lineupPath(ac, ap, r);
      ac.takeoffCleared = true; r.occupiedBy = ac; ac.manualHold = false; ac.req = null;
      w.log('toClr', { cs: ac.callsign, rwy: r.id }, 'info', ac);
      send(ac, 'to_clr', { rwy: r.id, wind: windStr(w, ap) });
    },
    depRunway(ac, id) {
      const ap = w.airport(ac.from); const r = ap.runways.get(id);
      if (!r || r.closed) return;
      ap.depQueue = ap.depQueue.filter((a) => a !== ac);
      const cfg = w.config(ap); const save = cfg.dep; cfg.dep = [id];
      w.automation.planDeparture(ac);
      cfg.dep = save;
      if (['TAXI_OUT', 'HOLD_SHORT'].includes(ac.phase)) w.automation.beginTaxiOut(ac, true);
      send(ac, 'dep_rwy', { rwy: id, sid: ac.sidName });
    },
    // act on a pending pilot request (radio panel buttons)
    approveRequest(ac) {
      const k = ac.req?.type;
      if (k === 'PUSH') this.push(ac);
      else if (k === 'TAXI') this.taxi(ac);
      else if (k === 'DEPART') this.takeoff(ac);
      else if (k === 'LAND') this.clearLand(ac);
      else if (k === 'APP') this.approach(ac);
      else if (k === 'CLIMB') this.climbApprove(ac);
      else if (k === 'TAXIIN') this.taxiIn(ac);
    },
    auto(ac) {
      ac.manual = { hdg: false, alt: false, spd: false }; ac.atcSpd = null; ac.noAutoApproach = false; ac.manualHold = false; ac.pushHold = false;
      if (ac.dir === 'ARR' && !ac.onGround && !(ac.appr && ac.appr.established) && w.airport(ac.to)) w.automation.planArrival(ac, ac.pos);
      if (ac.dir !== 'ARR' && !ac.onGround) { ac.lat = { mode: 'LNAV', hdg: null, turn: 0 }; ac.legStart = ac.pos; ac.clearedAlt = ac.cruiseAlt; }
      ui.toast(t('returnedAuto', { cs: ac.callsign }));
    },
  };
}

function lineupPath(ac, ap, r) {
  const g = ap.ground; const { entry } = g.holdingVertex(r);
  const pts = [ac.pos, g.v[entry]]; if (dist(g.v[entry], r.start) > 0.03) pts.push(r.start);
  pts.push(project(r.start, r.trueHdg, 0.02));
  ac.taxi = { pts, i: 0, reverse: false, maxSpd: 12 }; ac.phase = 'LINEUP';
}
