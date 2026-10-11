import fs from 'node:fs';
import { World, SIM_DT } from '../src/sim/world.js';
import { AirwayGraph } from '../src/sim/airways.js';
const rd = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const w0 = rd('world');
const data = { ...w0, nav: rd('nav'), geo: rd('geo_land'), layouts: Object.fromEntries(['RJBB', 'RJTT', 'RJAA', 'RJOO', 'RJBE'].map((k) => [k, rd('layout_' + k)])) };
const world = new World(data); data.airwayGraph = new AirwayGraph(world);
world.startClock = 8 * 3600;
const seen = new Set(); const cats = {};
const origLog = world.log.bind(world);
world.log = (msg, kind, ac) => { origLog(msg, kind, ac); if (/GO AROUND/.test(msg)) { const k = 'GA ' + msg.replace(/^.*\(/, '(').replace(/[\d.]+ NM/, 'x NM'); cats[k] = (cats[k] || 0) + 1; } };
for (let s = 0; s < 90 * 120; s++) {
  world.step(SIM_DT);
  for (const c of world.conflicts.list) {
    if (c.level !== 'LOS') continue;
    const k = [c.a.id, c.b.id].sort().join('-'); if (seen.has(k)) continue; seen.add(k);
    const d = (x) => `${x.dir}/${x.phase}/${x.appr?.established ? 'EST' : x.lat.mode}/${x.hold ? 'HOLD' : ''}`;
    const cat = [d(c.a), d(c.b)].sort().join(' vs ');
    cats[cat] = (cats[cat] || 0) + 1;
    if (seen.size % 6 === 0) console.log(world.clockStr().slice(0,5), c.a.callsign, d(c.a), Math.round(c.a.alt), c.a.activeWp?.id, c.a.to, '|', c.b.callsign, d(c.b), Math.round(c.b.alt), c.b.activeWp?.id, c.b.to, 'dh', c.dh.toFixed(1));
  }
}
console.log(Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => v + '  ' + k).join('\n'));
