// Entry point: loads data, builds the world, wires rendering and touch input.
import { World, SIM_DT } from './sim/world.js';
import { AirwayGraph } from './sim/airways.js';
import { Camera, VIEWS } from './ui/camera.js';
import { Renderer } from './ui/renderer.js';
import { UI } from './ui/ui.js';

const DATA_FILES = ['world', 'nav', 'geo_land', 'layout_RJBB', 'layout_RJTT', 'layout_RJAA', 'layout_RJOO', 'layout_RJBE'];
const VERSION = '0.1.0';

async function load() {
  const el = document.getElementById('loading');
  const got = {};
  let n = 0;
  await Promise.all(DATA_FILES.map(async (f) => {
    const r = await fetch(`data/${f}.json?v=${VERSION}`);
    if (!r.ok) throw new Error(`data/${f}.json: ${r.status}`);
    got[f] = await r.json();
    el.textContent = `Loading data… ${++n}/${DATA_FILES.length}`;
  }));
  const w = got.world;
  return {
    ...w, nav: got.nav, geo: got.geo_land,
    layouts: { RJBB: got.layout_RJBB, RJTT: got.layout_RJTT, RJAA: got.layout_RJAA, RJOO: got.layout_RJOO, RJBE: got.layout_RJBE },
  };
}

function startClockFromQuery() {
  const q = new URLSearchParams(location.search).get('t');
  if (q && /^\d{1,2}:\d{2}$/.test(q)) { const [h, m] = q.split(':').map(Number); return (h * 60 + m) * 60; }
  // default: current JST time
  const now = new Date();
  const jst = (now.getUTCHours() + 9) % 24;
  return (jst * 60 + now.getUTCMinutes()) * 60;
}

async function main() {
  let data;
  try { data = await load(); } catch (e) { document.getElementById('loading').textContent = 'Failed to load data: ' + e.message; throw e; }
  const world = new World(data);
  data.airwayGraph = new AirwayGraph(world);
  world.startClock = startClockFromQuery();
  for (const ap of world.airports.values()) world.autoSelectConfig(ap, true);

  const canvas = document.getElementById('radar');
  const cam = new Camera();
  const renderer = new Renderer(canvas, world, cam, data);
  renderer.resize();
  const ui = new UI(world, renderer, cam, data);
  const startView = VIEWS.find((v) => v.id === (new URLSearchParams(location.search).get('v') || 'L2-KANSAI')) || VIEWS[2];
  cam.goto(startView, false);
  ui.setView(startView, false);
  window.addEventListener('resize', () => { renderer.resize(); });
  document.getElementById('loading').classList.add('done');

  // prime traffic (aircraft already en route / on stands)
  world.step(0.01);

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dtReal = Math.min(0.25, (now - last) / 1000); last = now;
    if (!ui.paused) {
      acc += dtReal * ui.speed;
      let steps = 0;
      while (acc >= SIM_DT && steps < 64) { world.step(SIM_DT); acc -= SIM_DT; steps++; }
      if (steps >= 64) acc = 0;
    }
    cam.tick(dtReal);
    renderer.draw();
    ui.tick(dtReal);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__atc = { world, cam, renderer, ui }; // debugging handle
  const selQ = new URLSearchParams(location.search).get('sel');
  if (selQ) { const t = setInterval(() => { const a = world.aircraft.find((x) => x.callsign === selQ) || (selQ === 'any' && world.aircraft.find((x) => !x.onGround && x.dir === 'ARR')); if (a) { ui.select(a); clearInterval(t); } }, 300); }
}

main();
