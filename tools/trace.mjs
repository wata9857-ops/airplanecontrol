import fs from 'node:fs';
import { World, SIM_DT } from '../src/sim/world.js';
import { AirwayGraph } from '../src/sim/airways.js';
import { fmtAlt } from '../src/geo.js';
const rd = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const w0 = rd('world');
const data = { ...w0, nav: rd('nav'), geo: rd('geo_land'), layouts: Object.fromEntries(['RJBB', 'RJTT', 'RJAA', 'RJOO', 'RJBE'].map((k) => [k, rd('layout_' + k)])) };
const [hh, mm] = (process.argv[2] || '08:00').split(':').map(Number);
const filt = process.argv[3] || 'RJBB';
const world = new World(data); data.airwayGraph = new AirwayGraph(world);
world.startClock = (hh * 60 + mm) * 60;
world.step(0.01);
const pick = world.aircraft.filter(a => a.dir === 'ARR' && a.to === filt && !a.onGround).slice(0, +(process.argv[4]||2));
for (const a of pick) console.log(a.callsign, a.from, '->', a.to, a.starName, a.appName, a.arrRwy?.id, 'route', a.route.map(w=>w.id+(w.altMax!=null?'/'+w.altMax:'')).join(' '), 'idx', a.routeIdx);
for (let s = 0; s < (+(process.argv[5]||60)) * 60 / SIM_DT; s++) {
  world.step(SIM_DT);
  if (s % 120 === 0) for (const a of pick) if (world.aircraft.includes(a)) console.log(world.clockStr().slice(0,5), a.callsign, a.phase, fmtAlt(a.alt), 'clr', a.clearedAlt, 'ias', Math.round(a.ias), 'gs', Math.round(a.gs), 'wp', a.activeWp?.id, a.routeIdx+'/'+a.route.length, 'dtg', a.distToGo().toFixed(1), 'mode', a.lat.mode, 'appr', a.appr?JSON.stringify({c:a.appr.cleared,e:a.appr.established,g:a.appr.gsCaptured,d:+a.appr.distThr.toFixed(1)}):'-', 'dly', Math.round(a.delay||0), 'auto', a.autoSpd, a.hold?'HOLD':'', 'vnavC', Math.round(a.vnavCeiling(world)));
}
