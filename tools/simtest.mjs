// Headless simulation test: runs the world for N simulated minutes and reports
// throughput, go-arounds, separation losses and stuck aircraft.
// Usage: node tools/simtest.mjs [startHH:MM] [minutes]
import fs from 'node:fs';
import { World, SIM_DT } from '../src/sim/world.js';
import { AirwayGraph } from '../src/sim/airways.js';

const rd = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const w0 = rd('world');
const data = { ...w0, nav: rd('nav'), geo: rd('geo_land'), layouts: Object.fromEntries(['RJBB', 'RJTT', 'RJAA', 'RJOO', 'RJBE'].map((k) => [k, rd('layout_' + k)])) };
const [hh, mm] = (process.argv[2] || '08:00').split(':').map(Number);
const minutes = +(process.argv[3] || 90);

const world = new World(data);
data.airwayGraph = new AirwayGraph(world);
world.startClock = (hh * 60 + mm) * 60;
if (process.env.WIND) for (const ap of world.airports.values()) { world.wind[ap.icao] = { dir: +process.env.WIND, spd: 12 }; }
for (const ap of world.airports.values()) world.autoSelectConfig(ap, true);
console.log('configs', [...world.airports.values()].map((a) => a.iata + ': ' + world.config(a).name).join(' | '));

const t0 = Date.now();
const firstSeen = new Map();
let maxAir = 0;
for (let s = 0; s < minutes * 60 / SIM_DT; s++) {
  world.step(SIM_DT);
  for (const ac of world.aircraft) if (!firstSeen.has(ac.id)) firstSeen.set(ac.id, world.time);
  if (s % 120 === 0) maxAir = Math.max(maxAir, world.aircraft.filter((a) => !a.onGround).length);
  if (s % (600 / SIM_DT) === 0) {
    const air = world.aircraft.filter((a) => !a.onGround).length, gnd = world.aircraft.length - air;
    console.log(world.clockStr(), `air ${air} gnd ${gnd}`, JSON.stringify(world.stats));
  }
}
console.log('runtime', ((Date.now() - t0) / 1000).toFixed(1), 's for', minutes, 'min');
console.log('final', JSON.stringify(world.stats), 'maxAirborne', maxAir);
// suspicious aircraft
const now = world.time;
const issues = [];
for (const ac of world.aircraft) {
  const age = (now - firstSeen.get(ac.id)) / 60;
  if (ac.dir === 'ARR' && !ac.onGround && age > 75) issues.push(`${ac.callsign} airborne arrival for ${age.toFixed(0)} min phase ${ac.phase} alt ${Math.round(ac.alt)} wp ${ac.activeWp?.id} mode ${ac.lat.mode} hold ${!!ac.hold}`);
  if (ac.onGround && ['TAXI_OUT', 'TAXI_IN', 'HOLD_SHORT', 'STARTUP', 'PUSHBACK'].includes(ac.phase) && ac.gsGround < 0.5 && age > 40) issues.push(`${ac.callsign} ground ${ac.phase} stationary, age ${age.toFixed(0)} min @${ac.airportIcao}`);
}
console.log('issues', issues.length); issues.slice(0, 40).forEach((i) => console.log('  ' + i));
const kinds = {};
for (const e of world.events) if (e.kind !== 'info') kinds[e.msg.split(' ').slice(0, 2).join(' ')] = (kinds[e.msg.split(' ').slice(0, 2).join(' ')] || 0) + 1;
console.log('recent warn/alert events', world.events.filter((e) => e.kind !== 'info').slice(-25).map((e) => world.clockStr(e.t).slice(0, 5) + ' ' + e.msg).join('\n'));
const top = world.aircraft.filter((a) => a.dir === 'ARR' && !a.onGround).sort((a, b) => b.delay - a.delay).slice(0, 8);
console.log('top delays:\n' + top.map((a) => `  ${a.callsign} ${a.to} rwy ${a.arrRwy?.id} delay ${Math.round(a.delay)}s seq ${a.seq} hold ${a.hold ? a.hold.fix.id + '@' + a.hold.level + (a.hold.exit ? ' EXIT' : '') : '-'} wp ${a.activeWp?.id} dtg ${a.distToGo().toFixed(0)} alt ${Math.round(a.alt)}`).join('\n'));
const q = {}; for (const a of world.aircraft) if (a.dir === 'ARR' && !a.onGround && a.arrRwy) { const k = a.to + ' ' + a.arrRwy.id; q[k] = (q[k] || 0) + 1; }
console.log('arrivals airborne per runway', JSON.stringify(q));
