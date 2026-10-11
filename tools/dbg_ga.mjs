import fs from 'node:fs';
import { World, SIM_DT } from '../src/sim/world.js';
import { AirwayGraph } from '../src/sim/airways.js';
const rd = (f) => JSON.parse(fs.readFileSync(`data/${f}.json`, 'utf8'));
const w0 = rd('world');
const data = { ...w0, nav: rd('nav'), geo: rd('geo_land'), layouts: Object.fromEntries(['RJBB', 'RJTT', 'RJAA', 'RJOO', 'RJBE'].map((k) => [k, rd('layout_' + k)])) };
const world = new World(data); data.airwayGraph = new AirwayGraph(world);
world.startClock = (process.env.T ? +process.env.T : 8) * 3600; if (process.env.WIND) for (const ap of world.airports.values()) world.wind[ap.icao] = { dir: +process.env.WIND, spd: 12 }; for (const ap of world.airports.values()) world.autoSelectConfig(ap, true);
const orig = world.automation.goAround.bind(world.automation);
world.automation.goAround = (ac, reason) => {
  const r = ac.arrRwy;
  const st = (() => { const dx = ac.x - r.thr.x, dy = ac.y - r.thr.y; const c = dx * Math.cos(r.trueHdg * Math.PI / 180) - dy * Math.sin(r.trueHdg * Math.PI / 180); return c; })();
  console.log(world.clockStr().slice(0, 5), ac.callsign, r.airport.iata, r.id, reason, '| app', ac.appName, 'star', ac.starName, 'alt', Math.round(ac.alt), 'cross', st.toFixed(2), 'trk', Math.round(ac.trk), 'rwyHdg', Math.round(r.trueHdg), 'mode', ac.lat.mode, 'wp', ac.activeWp?.id, 'route', ac.route.slice(-5).map((w) => w.id).join(' '));
  orig(ac, reason);
};
for (let s = 0; s < (+process.env.M || 75) * 120; s++) world.step(SIM_DT);
