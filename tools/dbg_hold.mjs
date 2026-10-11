import fs from 'node:fs';
import { World, SIM_DT } from '../src/sim/world.js';
import { AirwayGraph } from '../src/sim/airways.js';
const rd = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const w0 = rd('world');
const data = { ...w0, nav: rd('nav'), geo: rd('geo_land'), layouts: Object.fromEntries(['RJBB', 'RJTT', 'RJAA', 'RJOO', 'RJBE'].map((k) => [k, rd('layout_' + k)])) };
const world = new World(data); data.airwayGraph = new AirwayGraph(world);
world.startClock = (process.env.T ? +process.env.T : 8) * 3600; if (process.env.WIND) for (const ap of world.airports.values()) world.wind[ap.icao] = { dir: +process.env.WIND, spd: 12 }; for (const ap of world.airports.values()) world.autoSelectConfig(ap, true);
const seen = new Set(); let n = 0;
for (let s = 0; s < 75 * 120 && n < 14; s++) {
  world.step(SIM_DT);
  for (const c of world.conflicts.list) {
    if (c.level !== 'LOS' || !(c.a.hold || c.b.hold)) continue;
    const k = [c.a.id, c.b.id].sort().join('-'); if (seen.has(k)) continue; seen.add(k); n++;
    const d = (x) => `${x.callsign} ${x.hold ? 'HOLD@' + x.hold.fix.id + ' ph=' + x.hold.phase + ' lvl=' + x.hold.level : 'LNAV→' + x.activeWp?.id} alt=${Math.round(x.alt)} vs=${Math.round(x.vs)} clr=${x.clearedAlt} r=${JSON.stringify(x.restrict||null)} dly=${Math.round(x.delay)}`;
    console.log(world.clockStr().slice(0, 5), d(c.a), ' || ', d(c.b), 'dh', c.dh.toFixed(1));
  }
}
