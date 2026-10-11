import fs from 'node:fs';
import { World, SIM_DT } from '../src/sim/world.js';
import { AirwayGraph } from '../src/sim/airways.js';
import { unitOf } from '../src/sim/positions.js';
const rd = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const w0 = rd('world');
const data = { ...w0, nav: rd('nav'), geo: rd('geo_land'), layouts: Object.fromEntries(['RJBB', 'RJTT', 'RJAA', 'RJOO', 'RJBE'].map((k) => [k, rd('layout_' + k)])) };
const world = new World(data); data.airwayGraph = new AirwayGraph(world);
world.startClock = 9 * 3600; world.step(0.01);
const pos = process.argv[2] || 'RJTT_GND';
world.userPos = pos; world.manualClr = true;
for (let s = 0; s < (+process.argv[3] || 10) * 120; s++) world.step(SIM_DT);
const units = {}; for (const a of world.aircraft) { const u = unitOf(world, a) || 'null'; units[u] = (units[u] || 0) + 1; }
console.log('units', JSON.stringify(units));
console.log('reqs', world.aircraft.filter((a) => a.req).map((a) => a.callsign + ':' + a.req.type + ':' + unitOf(world, a)).join(' '));
console.log('radio', world.radio.log.length, 'at pos', world.radio.log.filter((m) => m.unit === pos).length);
for (const m of world.radio.log.filter((m) => m.unit === pos).slice(-8)) console.log('  ', world.clockStr(m.t), m.who, world.radio.render(m, 'en', data), '|', world.radio.render(m, 'ja', data));
