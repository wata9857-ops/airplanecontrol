import fs from 'node:fs';
import { World, SIM_DT } from '../src/sim/world.js';
import { AirwayGraph } from '../src/sim/airways.js';
const rd = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const w0 = rd('world');
const data = { ...w0, nav: rd('nav'), geo: rd('geo_land'), layouts: Object.fromEntries(['RJBB', 'RJTT', 'RJAA', 'RJOO', 'RJBE'].map((k) => [k, rd('layout_' + k)])) };
const icao = process.argv[2] || 'RJTT';
const world = new World(data); data.airwayGraph = new AirwayGraph(world);
world.startClock = (process.env.T ? +process.env.T : 8) * 3600; if (process.env.WIND) for (const ap of world.airports.values()) world.wind[ap.icao] = { dir: +process.env.WIND, spd: 12 }; for (const ap of world.airports.values()) world.autoSelectConfig(ap, true);
for (let s = 0; s < (+(process.argv[3]||30)) * 120; s++) world.step(SIM_DT);
const ap = world.airport(icao);
console.log('config', world.config(ap).name);
for (const r of ap.runways.values()) console.log(r.id, 'occ', r.occupiedBy?.callsign, r.occupiedBy?.phase, 'lastDep', Math.round(world.time - r.lastDep), 'closed', r.closed, 'crossing', r.crossing);
console.log('queue', ap.depQueue.map(a => a.callsign + ':' + a.depRwy.id + ':' + a.phase).join(' '));
const g = ap.ground;
for (const a of world.aircraft.filter(a => a.onGround && a.airportIcao === icao && a.phase !== 'PARKED')) {
  const blocker = world.aircraft.find(o => o !== a && o.onGround && o.airportIcao === icao && Math.hypot(o.x-a.x,o.y-a.y) < 0.05);
  console.log(a.callsign, a.phase, a.depRwy?.id, 'gs', a.gsGround?.toFixed(1), 'taxi i', a.taxi?.i, '/', a.taxi?.pts.length, 'near', blocker?.callsign, blocker?.phase, blocker ? (Math.hypot(blocker.x-a.x,blocker.y-a.y)*1852).toFixed(0)+'m' : '');
}
const arr = world.aircraft.filter(a => a.to === icao && a.appr?.established).map(a => a.callsign + ':' + a.arrRwy.id + ':' + a.appr.distThr.toFixed(1));
console.log('established', arr.join(' '));
