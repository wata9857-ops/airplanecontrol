// Collects live-traffic snapshots over the simulation domain from the public
// Flightradar24 feed (no login) to build a realistic overflight sample.
// Usage: node tools/collect_ovf.mjs [snapshots=12] [intervalMin=15]
import fs from 'node:fs';

const N = +(process.argv[2] || 12), INT = +(process.argv[3] || 15);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const TILES = [];
for (let la = 31.5; la < 38.8; la += 2.5) for (let lo = 131; lo < 143.5; lo += 3.2) TILES.push([Math.min(la + 2.5, 38.8), la, lo, Math.min(lo + 3.2, 143.5)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('research/raw/ovf', { recursive: true });
for (let i = 0; i < N; i++) {
  const seen = {};
  for (const [n, s, w, e] of TILES) {
    const url = `https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=${n},${s},${w},${e}&faa=1&satellite=1&mlat=1&flarm=0&adsb=1&gnd=0&air=1&vehicles=0&estimated=0&maxage=14400&gliders=0&stats=0`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      const j = await r.json();
      for (const [k, v] of Object.entries(j)) if (Array.isArray(v)) seen[k] = v;
    } catch (err) { console.error('tile failed', err.message); }
    await sleep(1500);
  }
  const t = Date.now();
  fs.writeFileSync(`research/raw/ovf/snap_${t}.json`, JSON.stringify({ t, aircraft: Object.values(seen) }));
  console.log(new Date(t).toISOString(), 'aircraft', Object.keys(seen).length);
  if (i < N - 1) await sleep(INT * 60000);
}
