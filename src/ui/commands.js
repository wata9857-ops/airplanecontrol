// ATC instructions issued by the user. Each command marks the relevant
// dimension as manually controlled (automation then leaves it alone), logs
// standard ICAO/JCAB phraseology and shows the pilot readback.
import { fmtAlt, pad3, dist, bearing, project, trueToMag } from '../geo.js';
import { radioName } from './ui.js';

export function commands(w, ui) {
  const data = w.data;
  const say = (ac, atc, rb) => {
    const rn = radioName(ac, data);
    w.log(`→ ${rn}, ${atc}`, 'info', ac);
    ui.toast(`${rn}, ${atc}\n«${rb}, ${rn}»`);
  };
  const altWords = (ft) => (ft >= 14000 ? `flight level ${Math.round(ft / 100)}` : `${ft.toLocaleString('en-US')} feet`);

  const freq = (icao, re) => (w.airport(icao)?.frequencies || []).find((f) => re.test(f.unit));

  return {
    unitFor(ac) {
      const ap = w.airport(ac.onGround ? ac.airportIcao : ac.dir === 'DEP' ? ac.from : ac.to);
      if (ac.onGround && ap) {
        if (['LINEUP', 'LINED_UP', 'TAKEOFF', 'ROLLOUT'].includes(ac.phase)) { const f = freq(ap.icao, /Tower/); return { name: f ? f.unit.replace(/\s*\(.*\)/, '') : `${ap.iata} TWR`, freq: f?.freq }; }
        const f = freq(ap.icao, /Ground/); return { name: f ? f.unit.replace(/\s*\(.*\)/, '') : `${ap.iata} GND`, freq: f?.freq };
      }
      const near = (icao, r) => { const a = w.airport(icao); return a && dist(ac, a) < r; };
      if (ap && dist(ac, ap) < 8 && ac.alt - ap.elev < 2500) { const f = freq(ap.icao, /Tower/); return { name: f ? f.unit.replace(/\s*\(.*\)/, '') : 'Tower', freq: f?.freq }; }
      if (ac.alt < 16000 && (near('RJBB', 50) || near('RJOO', 35))) {
        return ac.dir === 'DEP' ? { name: 'Kansai Departure', freq: '119.20' } : { name: 'Kansai Approach', freq: '120.25' };
      }
      if (ac.alt < 16000 && (near('RJTT', 50) || near('RJAA', 45))) {
        const nrt = near('RJAA', 30) && (ac.to === 'RJAA' || ac.from === 'RJAA');
        return ac.dir === 'DEP' ? { name: 'Tokyo Departure', freq: nrt ? '124.20' : '126.00' } : { name: 'Tokyo Approach', freq: nrt ? '124.40' : '119.10' };
      }
      if (ac.alt > 33500) return { name: 'Fukuoka Control', freq: '' };
      const ll = ac.latlon;
      return ll.lon < 136.6 && ll.lat > 33.9 ? { name: 'Kobe Control', freq: '123.90' } : { name: 'Tokyo Control', freq: '' };
    },

    heading(ac, mag, turn) {
      mag = Math.round(mag) % 360 || 360;
      ac.cmdHeading(mag, turn, w);
      ac.manual.hdg = true; ac.noAutoApproach = false; ac.autoClearOnVector = false;
      const t = turn < 0 ? 'turn left heading' : turn > 0 ? 'turn right heading' : 'fly heading';
      say(ac, `${t} ${pad3(mag)}`, `${turn < 0 ? 'Left ' : turn > 0 ? 'Right ' : ''}heading ${pad3(mag)}`);
    },
    orbit(ac, dir) {
      ac.startOrbit(dir);
      ac.manual.hdg = true;
      say(ac, `make a ${dir < 0 ? 'left' : 'right'} three-sixty`, `${dir < 0 ? 'Left' : 'Right'} three-sixty`);
    },
    altitude(ac, ft) {
      const climb = ft > ac.alt;
      ac.cmdAltitude(ft); ac.manual.alt = true;
      say(ac, `${climb ? 'climb' : 'descend'} and maintain ${altWords(ft)}`, `${climb ? 'Climb' : 'Descend'} and maintain ${altWords(ft)}`);
    },
    via(ac) {
      ac.manual.alt = false; ac.vnav = ac.dir === 'ARR';
      if (ac.dir === 'ARR') { ac.clearedAlt = Math.max((ac.arrRwy?.elev || 0) + 3000, 3000); say(ac, `descend via ${ac.starName || 'STAR'}`, 'Descend via STAR'); }
      else { ac.clearedAlt = ac.cruiseAlt; say(ac, `climb via SID, maintain ${altWords(ac.cruiseAlt)}`, `Climb via SID ${altWords(ac.cruiseAlt)}`); }
    },
    speed(ac, kt) {
      if (kt == null) { ac.atcSpd = null; ac.manual.spd = false; say(ac, 'resume normal speed', 'Resume normal speed'); return; }
      ac.atcSpd = kt; ac.manual.spd = true;
      say(ac, `maintain ${kt} knots`, `Maintain ${kt} knots`);
    },
    resumeNav(ac) {
      ac.cmdResumeNav(); ac.manual.hdg = false;
      const wp = ac.activeWp;
      say(ac, `resume own navigation${wp ? ', direct ' + wp.id : ''}`, 'Resume own navigation');
    },
    direct(ac, id) {
      if (ac.directTo(id)) { ac.manual.hdg = false; say(ac, `proceed direct ${id}`, `Direct ${id}`); }
    },
    hold(ac, id) {
      const f = w.fix(id); if (!f) return;
      const i = ac.route.findIndex((x, k) => k >= ac.routeIdx && x.id === id);
      const inbound = i > 0 ? bearing(i > ac.routeIdx ? ac.route[i - 1] : ac, f) : bearing(ac, f);
      ac.directTo(id);
      ac.startHold(f, inbound, 1);
      ac.manual.hdg = true;
      const ll = ac.latlon;
      say(ac, `hold at ${id}, inbound course ${pad3(trueToMag(inbound, ll.lat, ll.lon))}, right turns, expect further clearance in 10 minutes`, `Hold at ${id}`);
    },
    exitHold(ac) {
      if (ac.hold) { ac.hold.exit = true; ac.manual.hdg = false; say(ac, 'cleared to leave the hold, resume own navigation', 'Leaving the hold'); }
    },
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
      say(ac, `cleared ${s.name.toLowerCase()}`, s.name);
    },
    runway(ac, id) {
      const ap = w.airport(ac.to); const r = ap.runways.get(id);
      if (!r || r.closed) { ui.toast('Runway not available'); return; }
      const keepHdg = ac.manual.hdg;
      ac.seqFrozen = false;
      const seg = w.automation.buildArrivalSegment(ap, r, ac.pos);
      ac.arrRwy = r; ac.starName = seg.starName; ac.appName = seg.appName; ac.route = seg.wps; ac.routeIdx = 0; ac.legStart = ac.pos; ac.appr = null;
      if (!keepHdg) ac.lat = { mode: 'LNAV', hdg: null, turn: 0 };
      say(ac, `expect ${seg.appName} runway ${id}`, `Expect runway ${id}`);
    },
    approach(ac) {
      if (!ac.arrRwy) return;
      ac.clearApproach(ac.arrRwy);
      ac.phase = 'APPROACH';
      if (!ac.manual.alt) ac.vnav = true;
      say(ac, `cleared ${ac.appName || 'ILS runway ' + ac.arrRwy.id} approach`, `Cleared ${ac.appName || 'ILS'} approach`);
    },
    cancelApproach(ac) {
      ac.appr = null; ac.noAutoApproach = true;
      if (ac.lat.mode === 'LOC') ac.lat = { mode: 'HDG', hdg: ac.hdg, turn: 0 };
      say(ac, 'cancel approach clearance, maintain present heading', 'Approach clearance cancelled');
    },
    goAround(ac) {
      if (!ac.arrRwy) return;
      w.automation.goAround(ac, 'ATC instruction');
      say(ac, `go around, climb and maintain ${altWords(ac.arrRwy.missedAlt || 3000)}, fly runway heading`, 'Going around');
    },
    expedite(ac) { ac.expedite = true; ac.manual.spd = false; ac.atcSpd = null; say(ac, 'expedite descent, no speed restriction', 'Expedite'); },
    emergency(ac) {
      if (ac.emergency) { ac.emergency = null; ac.squawk = ac.prevSquawk || ac.squawk; w.log(`${ac.callsign} emergency cancelled`, 'info', ac); return; }
      ac.emergency = 'MAYDAY'; ac.prevSquawk = ac.squawk; ac.squawk = '7700';
      w.log(`MAYDAY ${ac.callsign} — ${ac.dir === 'DEP' ? 'engine failure, requesting return' : 'medical emergency, requesting priority'}`, 'alert', ac);
      if (ac.dir === 'DEP' && !ac.onGround && w.airport(ac.from)) {
        ac.to = ac.from; ac.dir = 'ARR'; ac.arrJoinIdx = null;
        w.automation.planArrival(ac, ac.pos);
        ac.clearedAlt = Math.min(ac.alt, 8000); ac.cruiseAlt = ac.clearedAlt;
      }
      ac.priority = true; ac.seqFrozen = false;
      ui.toast(`MAYDAY MAYDAY MAYDAY ${radioName(ac, data)}`, 4000);
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
      w.log(`${ap.iata} RWY ${r.id}/${r.opp} ${r.closed ? 'CLOSED' : 'reopened'}`, r.closed ? 'alert' : 'warn');
      const locked = ap.configLocked; ap.configLocked = false;
      w.autoSelectConfig(ap);
      ap.configLocked = locked && !w.config(ap).arr.some((id) => ap.runways.get(id).closed);
      w.automation.onConfigChange(ap);
    },
    // ---------- ground ----------
    push(ac) { if (ac.phase === 'PARKED') { ac.pushHold = false; w.automation.beginPushback(ac); say(ac, 'pushback and start-up approved', 'Pushback approved'); } },
    pushHold(ac) { ac.pushHold = !ac.pushHold; say(ac, ac.pushHold ? 'standby for pushback, expect delay' : 'pushback at your discretion', ac.pushHold ? 'Standing by' : 'Roger'); },
    holdPos(ac) { if (ac.taxi) { ac.taxi.hold = !ac.taxi.hold; say(ac, ac.taxi.hold ? 'hold position' : 'continue taxi', ac.taxi.hold ? 'Holding position' : 'Continue taxi'); } },
    holdShort(ac) { ac.manualHold = !ac.manualHold; say(ac, ac.manualHold ? `hold short runway ${ac.depRwy.id}` : 'expect departure shortly', ac.manualHold ? `Holding short ${ac.depRwy.id}` : 'Roger'); },
    takeoff(ac) {
      const ap = ac.depRwy.airport, r = ac.depRwy;
      if (r.closed) { ui.toast('Runway closed'); return; }
      ap.depQueue = ap.depQueue.filter((a) => a !== ac);
      if (ac.phase === 'HOLD_SHORT') {
        const g = ap.ground; const { entry } = g.holdingVertex(r);
        const pts = [ac.pos, g.v[entry]]; if (dist(g.v[entry], r.start) > 0.03) pts.push(r.start);
        pts.push(project(r.start, r.trueHdg, 0.02));
        ac.taxi = { pts, i: 0, reverse: false, maxSpd: 12 }; ac.phase = 'LINEUP';
      }
      ac.takeoffCleared = true; r.occupiedBy = ac; ac.manualHold = false;
      w.log(`${ac.callsign} RWY ${r.id} cleared for take-off (manual)`, 'info', ac);
      say(ac, `runway ${r.id}, wind ${pad3(w.wind[ap.icao].dir)} at ${w.wind[ap.icao].spd}, cleared for take-off`, `Cleared for take-off runway ${r.id}`);
    },
    depRunway(ac, id) {
      const ap = w.airport(ac.from); const r = ap.runways.get(id);
      if (!r || r.closed) return;
      ap.depQueue = ap.depQueue.filter((a) => a !== ac);
      const cfg = w.config(ap); const save = cfg.dep; cfg.dep = [id];
      w.automation.planDeparture(ac);
      cfg.dep = save;
      if (['TAXI_OUT', 'HOLD_SHORT'].includes(ac.phase)) w.automation.beginTaxiOut(ac);
      say(ac, `runway ${id}, ${ac.sidName}`, `Runway ${id}`);
    },
    auto(ac) {
      ac.manual = { hdg: false, alt: false, spd: false }; ac.atcSpd = null; ac.noAutoApproach = false; ac.manualHold = false; ac.pushHold = false;
      if (ac.dir === 'ARR' && !ac.onGround && !(ac.appr && ac.appr.established)) w.automation.planArrival(ac, ac.pos);
      if (ac.dir === 'DEP' && !ac.onGround) { ac.lat = { mode: 'LNAV', hdg: null, turn: 0 }; ac.legStart = ac.pos; ac.clearedAlt = ac.cruiseAlt; }
      ui.toast(`${ac.callsign} returned to automation`);
    },
  };
}
