import fs from 'node:fs';
import { World, SIM_DT } from '../src/sim/world.js';
import { AirwayGraph } from '../src/sim/airways.js';
const rd = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const w0 = rd('world');
const data = { ...w0, nav: rd('nav'), geo: rd('geo_land'), layouts: Object.fromEntries(['RJBB', 'RJTT', 'RJAA', 'RJOO', 'RJBE'].map((k) => [k, rd('layout_' + k)])) };
const world = new World(data); data.airwayGraph = new AirwayGraph(world);
world.startClock = (process.env.T ? +process.env.T : 8) * 3600;
const cs = process.argv[2]; const mins = +(process.argv[3] || 75); const every = +(process.argv[4] || 60);
let last = '';
for (let s = 0; s < mins * 120; s++) {
  world.step(SIM_DT);
  const a = world.aircraft.find((x) => x.callsign === cs);
  if (!a) continue;
  if (s % (every * 2) === 0) {
    const line = `${world.clockStr().slice(0,8)} ${a.phase} alt ${Math.round(a.alt)} vs ${Math.round(a.vs)} clr ${a.clearedAlt} tgt ${Math.round(a.tgtAltEff ?? -1)} ias ${Math.round(a.ias)} wp ${a.activeWp?.id}(${a.activeWp?.kind}) ${a.routeIdx}/${a.route.length} mode ${a.lat.mode} vnav ${a.vnav} appr ${a.appr ? [a.appr.cleared, a.appr.established, a.appr.gsCaptured, a.appr.distThr.toFixed(1)].join(',') : '-'} hold ${a.hold ? a.hold.fix.id + '@' + a.hold.level : '-'} r ${JSON.stringify(a.restrict || null)} dly ${Math.round(a.delay)} man ${JSON.stringify(a.manual)}`;
    if (line !== last) console.log(line); last = line;
  }
}
