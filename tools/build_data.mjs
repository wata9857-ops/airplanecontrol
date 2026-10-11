// Merges researched sources into the runtime data files under data/.
//   research/navdata_kansai.json, research/navdata_kanto.json  (AIP-derived navdata)
//   research/operations.json                                   (runway use, frequencies)
//   research/schedules.json                                    (real flights)
//   research/raw/airports.csv (OurAirports)                    (world airport positions)
//   data/layout_*.json (OpenStreetMap)                         (runway ends, surface)
// Usage: node tools/build_data.mjs
import fs from 'node:fs';

const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);
const KS = rd('research/navdata_kansai.json');
const KT = rd('research/navdata_kanto.json');

// ---------------- navdata ----------------
const navaids = new Map(), fixes = new Map();
for (const src of [KS, KT]) {
  for (const n of src.navaids || []) if (!navaids.has(n.id) && n.lat != null) navaids.set(n.id, { id: n.id, name: n.name, type: n.type, lat: +n.lat.toFixed(6), lon: +n.lon.toFixed(6), freq: n.freq, verified: !!n.verified });
  for (const f of src.fixes || []) if (!fixes.has(f.id) && !navaids.has(f.id) && f.lat != null) fixes.set(f.id, { id: f.id, lat: +f.lat.toFixed(6), lon: +f.lon.toFixed(6), verified: !!f.verified });
}
const airwayMap = new Map();
for (const src of [KS, KT]) for (const a of src.airways || []) {
  const key = a.id + ':' + a.points[0] + ':' + a.points.at(-1);
  if (!airwayMap.has(key)) airwayMap.set(key, { id: a.id, points: a.points.filter((p) => fixes.has(p) || navaids.has(p)) });
}

const cleanLegs = (legs) => (legs || []).map((l) => ({ fix: l.fix, altMin: l.altMin ?? null, altMax: l.altMax ?? null, speed: l.speed ?? null, role: l.role || null }));

// STAR runway refinement for Haneda north-wind flows (AIP RJTT STAR descriptions):
// "A" STARs end at ARLON (ILS Z RWY34L), "H" STARs end at CACAO (ILS Z RWY34R).
function refineStarRunways(icao, s) {
  if (icao === 'RJTT') {
    if (/ \d?A ARRIVAL/.test(s.name)) return ['34L'];
    if (/ \d?H ARRIVAL/.test(s.name)) return ['34R'];
    if (/ \d?[KC] ARRIVAL|NIGHT/.test(s.name)) return []; // short/visual/night variants not used by the automation
    if (/ V ARRIVAL/.test(s.name)) return [];
  }
  return s.runways || [];
}

function chainSids(sids) {
  // Combine SID runway portions with en-route transitions ("X TRANSITION").
  const base = sids.filter((s) => !/TRANSITION/.test(s.name));
  const trans = sids.filter((s) => /TRANSITION/.test(s.name));
  const out = base.map((s) => ({ name: s.name, runways: s.runways || [], legs: cleanLegs(s.legs), verified: s.verified }));
  for (const t of trans) {
    const first = t.legs[0]?.fix;
    for (const b of base) {
      if (b.legs.at(-1)?.fix !== first) continue;
      const stem = t.name.split(' ')[0];
      if (!stem.split('/').some((x) => b.name.startsWith(x.replace(/\d+$/, '')))) continue;
      out.push({ name: `${b.name}.${t.name.replace(/^.*?\s/, '').replace(' TRANSITION', '')}`, runways: b.runways || [], legs: [...cleanLegs(b.legs), ...cleanLegs(t.legs.slice(1))], verified: b.verified && t.verified });
    }
  }
  return out.filter((s) => s.runways.length);
}

const procedures = {};
for (const src of [KS, KT]) for (const [icao, p] of Object.entries(src.procedures || {})) {
  procedures[icao] = {
    stars: (p.stars || []).map((s) => ({ name: s.name, runways: refineStarRunways(icao, s), legs: cleanLegs(s.legs), verified: s.verified })).filter((s) => s.runways.length),
    sids: chainSids(p.sids || []),
    approaches: (p.approaches || []).map((a) => ({ name: a.name, runway: a.runway, legs: cleanLegs(a.legs), fafAlt: a.fafAlt ?? null, gpAngle: a.gpAngle ?? 3, locCourseMag: a.locCourseMag ?? null, verified: a.verified })),
  };
}
// verify references
let missing = new Set();
for (const p of Object.values(procedures)) for (const k of ['stars', 'sids', 'approaches']) for (const s of p[k]) for (const l of s.legs) if (!fixes.has(l.fix) && !navaids.has(l.fix)) missing.add(l.fix);
if (missing.size) console.warn('missing fixes:', [...missing].join(' '));

fs.writeFileSync('data/nav.json', JSON.stringify({
  sources: [...(KS.sources || []), ...(KT.sources || [])].map((s) => ({ name: s.name, url: s.url })),
  magVar: { kansai: KS.magVar?.value, kanto: KT.magVar?.value },
  navaids: [...navaids.values()], fixes: [...fixes.values()], airways: [...airwayMap.values()], procedures,
}));

// ---------------- airports ----------------
const csv = fs.readFileSync('research/raw/airports.csv', 'utf8').split('\n');
const head = parseCsvLine(csv[0]);
const idx = (k) => head.indexOf(k);
const worldAirports = {}, iata = {}, apNames = {};
for (let i = 1; i < csv.length; i++) {
  const r = parseCsvLine(csv[i]);
  if (r.length < 10) continue;
  const icao = r[idx('ident')] || '';
  if (!/^[A-Z]{4}$/.test(icao)) continue;
  const type = r[idx('type')];
  if (!['large_airport', 'medium_airport', 'small_airport'].includes(type)) continue;
  if (!r[idx('iata_code')] && type === 'small_airport') continue;
  worldAirports[icao] = [+(+r[idx('latitude_deg')]).toFixed(4), +(+r[idx('longitude_deg')]).toFixed(4)];
  if (r[idx('iata_code')]) iata[icao] = r[idx('iata_code')];
  apNames[icao] = r[idx('name')];
}

const OPS = rd('research/operations.json');
const layout = (icao) => rd(`data/layout_${icao}.json`);
const AIP_THR = KT.airports || {};

function runwaysFor(icao, elev, opts = {}) {
  const lay = layout(icao);
  const out = [];
  for (const r of lay.runways) {
    const [a, b] = r.ref.split('/');
    const aip = AIP_THR[icao]?.runways || {};
    const ends = { [a]: r.ends[0], [b]: r.ends[1] };
    for (const [id, opp] of [[a, b], [b, a]]) {
      const thrPhys = aip[id]?.thr || ends[id];
      const thrLand = aip[id]?.displacedThr || thrPhys;
      const oppPhys = aip[opp]?.thr || ends[opp];
      out.push({ id, opp, thr: thrLand, start: thrPhys, end: oppPhys, elev: aip[id]?.elevFt ?? elev, widthM: r.width || 45, lengthM: aip[id]?.lenM || r.length, gp: 3.0, missedAlt: opts.missedAlt?.[id] ?? 3000 });
    }
  }
  // crossing runways (segment intersection)
  for (const r of out) r.crossing = out.filter((o) => o.id !== r.id && o.id !== r.opp && segX(r.start, r.end, o.start, o.end)).map((o) => o.id);
  return out;
}

const freqs = (icao) => (OPS.airports[icao]?.frequencies || []).map((f) => ({ unit: f.unit, freq: f.freq, verified: !!f.verified }));

const airports = [
  {
    icao: 'RJBB', iata: 'KIX', name: 'Kansai International', nameJa: '関西国際空港', major: true, elev: 26,
    configs: [
      { name: 'North wind (06) — A arr / B dep', arr: ['06R'], dep: ['06L'], preferred: true, note: 'Current since 2025-03-20 (verified)' },
      { name: 'South wind (24) — A arr / B dep', arr: ['24L'], dep: ['24R'], note: 'Current since 2025-03-20 (verified)' },
      { name: 'Legacy 06 (2013–2025) — B arr / A dep', arr: ['06L'], dep: ['06R'], manualOnly: true },
      { name: 'Legacy 24 (2013–2025) — B arr / A dep', arr: ['24R'], dep: ['24L'], manualOnly: true },
    ],
    defaultWind: { dir: 40, spd: 8 }, curfew: null,
    standRules: [{ airlines: ['APJ', 'JJP', 'SJO'], stands: '^(1[4-9]|[2-9]\\d)$' }],
  },
  {
    icao: 'RJTT', iata: 'HND', name: 'Tokyo Haneda', nameJa: '東京国際空港（羽田）', major: true, elev: 21,
    configs: [
      { name: 'North wind — arr 34L/34R, dep 05/34R', arr: ['34L', '34R'], dep: ['34R', '05'], preferred: true, depSplit: [{ from: 300, to: 110, rwy: '34R' }, { from: 110, to: 300, rwy: '05' }], note: 'MLIT configuration 1–4 (verified); departure split by direction is an approximation' },
      { name: 'South wind — arr 22/23, dep 16L/16R', arr: ['22', '23'], dep: ['16R', '16L'], depSplit: [{ from: 180, to: 360, rwy: '16R' }, { from: 0, to: 180, rwy: '16L' }], note: 'MLIT configuration 5/6 (verified). Primary LDA W 22/23 not modelled — ILS 22 / ILS Z 23 used.' },
      { name: 'South wind new routes — arr 16L/16R, dep 22/16R', arr: ['16L', '16R'], dep: ['22', '16R'], time: [15 * 3600, 19 * 3600], depSplit: [{ from: 180, to: 360, rwy: '16R' }, { from: 0, to: 180, rwy: '22' }], note: 'MLIT configuration 7/8, ~3 h within 15:00–19:00 (verified)' },
    ],
    defaultWind: { dir: 350, spd: 10 },
  },
  {
    icao: 'RJAA', iata: 'NRT', name: 'Narita International', nameJa: '成田国際空港', major: true, elev: 135,
    configs: [
      { name: 'North wind — 34L/34R mixed', arr: ['34L', '34R'], dep: ['34L', '34R'], preferred: true, mixed: ['34L', '34R'], depSplit: [{ from: 180, to: 360, rwy: '34L' }, { from: 0, to: 180, rwy: '34R' }], note: 'Simultaneous parallel mixed operations (verified); per-runway split approximate' },
      { name: 'South wind — 16R/16L mixed', arr: ['16R', '16L'], dep: ['16R', '16L'], mixed: ['16R', '16L'], depSplit: [{ from: 180, to: 360, rwy: '16R' }, { from: 0, to: 180, rwy: '16L' }] },
    ],
    defaultWind: { dir: 350, spd: 8 }, curfew: [0, 6 * 3600],
  },
  {
    icao: 'RJOO', iata: 'ITM', name: 'Osaka Itami', nameJa: '大阪国際空港（伊丹）', major: true, elev: 39,
    configs: [
      { name: '32 operation — ILS 32L', arr: ['32L'], dep: ['32L'], preferred: true, mixed: ['32L'], tailwindLimit: 10, bias: 14, note: 'Normal operation (verified); ~97% of the time' },
      { name: '14 operation (circling)', arr: ['14R'], dep: ['14R'], mixed: ['14R'], note: 'Rare (~3%); circling from ILS 32L not modelled — vectors to 14R' },
    ],
    defaultWind: { dir: 320, spd: 6 }, curfew: [21 * 3600, 7 * 3600],
  },
  {
    icao: 'RJBE', iata: 'UKB', name: 'Kobe', nameJa: '神戸空港', major: false, elev: 22,
    configs: [
      { name: 'Runway 09', arr: ['09'], dep: ['09'], preferred: true, mixed: ['09'] },
      { name: 'Runway 27', arr: ['27'], dep: ['27'], mixed: ['27'], note: 'No published RWY27 instrument approach in data — vectors' },
    ],
    defaultWind: { dir: 90, spd: 5 }, curfew: [23 * 3600, 7 * 3600],
  },
];
for (const a of airports) {
  const ll = worldAirports[a.icao];
  a.lat = AIP_THR[a.icao]?.arp?.[0] ?? ll[0]; a.lon = AIP_THR[a.icao]?.arp?.[1] ?? ll[1];
  a.runways = runwaysFor(a.icao, a.elev);
  a.frequencies = freqs(a.icao);
  a.ops = { runwayUse: OPS.airports[a.icao]?.runwayUse || '', capacity: OPS.airports[a.icao]?.capacityPerHour?.value ?? null, daily: OPS.airports[a.icao]?.dailyMovements?.value ?? null };
}

const cities = [
  ['大阪', 34.6937, 135.5023], ['神戸', 34.6901, 135.1955], ['京都', 35.0116, 135.7681], ['奈良', 34.6851, 135.8048], ['和歌山', 34.2260, 135.1675],
  ['姫路', 34.8151, 134.6853], ['徳島', 34.0703, 134.5548], ['堺', 34.5733, 135.4830], ['淡路', 34.43, 134.85],
  ['東京', 35.6812, 139.7671], ['横浜', 35.4437, 139.6380], ['千葉', 35.6074, 140.1065], ['川崎', 35.5308, 139.7029], ['さいたま', 35.8617, 139.6455],
  ['成田', 35.7767, 140.3183], ['木更津', 35.3764, 139.9169], ['銚子', 35.7347, 140.8267], ['水戸', 36.3418, 140.4468], ['宇都宮', 36.5551, 139.8828],
  ['名古屋', 35.1815, 136.9066], ['静岡', 34.9756, 138.3828], ['浜松', 34.7108, 137.7261], ['甲府', 35.6622, 138.5683], ['津', 34.7303, 136.5086],
  ['岡山', 34.6551, 133.9195], ['高松', 34.3428, 134.0466], ['岐阜', 35.4233, 136.7606], ['伊豆大島', 34.75, 139.36], ['八丈島', 33.10, 139.79], ['新潟', 37.9161, 139.0364], ['金沢', 36.5613, 136.6562], ['高知', 33.5597, 133.5311], ['広島', 34.3853, 132.4553], ['仙台', 38.2682, 140.8694],
].map(([name, lat, lon]) => ({ name, lat, lon, minSpan: ['堺', '川崎', '木更津'].includes(name) ? 0 : 0, maxSpan: ['堺', '川崎', '木更津', '淡路'].includes(name) ? 160 : null }));

// ---------------- schedule ----------------
let schedule = { flights: [], airlines: [] };
if (exists('research/schedules_full.json')) {
  const S = rd('research/schedules_full.json');
  const seen = new Set();
  const flights = [];
  for (const f of S.flights || []) {
    if (!f.callsign || !f.from || !f.to || !f.timeLocal) continue;
    const key = `${f.callsign}|${f.from}|${f.to}|${f.dir}`;
    if (seen.has(key)) continue; seen.add(key);
    flights.push({ dir: f.dir, airport: f.airport, flight: f.flight, callsign: f.callsign.replace(/\s/g, ''), airline: f.airline, from: f.from, to: f.to, timeLocal: f.timeLocal, type: f.type, typeVerified: !!f.typeVerified, verified: !!f.verified });
  }
  schedule = { flights, airlines: (S.airlines || []).map((a) => ({ icao: a.icao, iata: a.iata, name: a.name, telephony: a.telephony, fleet: a.fleet, verified: !!a.verified })), sources: (S.sources || []).map((s) => ({ name: s.name, url: s.url })) };
  for (const f of flights) for (const k of [f.from, f.to]) if (!worldAirports[k]) console.warn('unknown airport in schedule', k);
}

const needed = new Set(airports.map((a) => a.icao));
for (const f of schedule.flights) { needed.add(f.from); needed.add(f.to); }
const wa = {}, ia = {}, nm = {};
for (const k of needed) if (worldAirports[k]) { wa[k] = worldAirports[k]; if (iata[k]) ia[k] = iata[k]; nm[k] = apNames[k]; }

fs.writeFileSync('data/world.json', JSON.stringify({
  domain: { minLat: 31.5, maxLat: 38.8, minLon: 131.0, maxLon: 143.5 },
  airports, worldAirports: wa, iata: ia, airportNames: nm, cities, schedule,
  operations: { separation: OPS.separation, speedControl: OPS.speedControl, altimetry: OPS.altimetry, phraseology: (OPS.phraseology || []).slice(0, 60), acc: OPS.acc, sources: (OPS.sources || []).map((s) => ({ name: s.name, url: s.url })) },
}));
console.log('fixes', fixes.size, 'navaids', navaids.size, 'airways', airwayMap.size, 'procs', Object.entries(procedures).map(([k, p]) => `${k}:${p.stars.length}/${p.sids.length}/${p.approaches.length}`).join(' '), 'flights', schedule.flights.length);
for (const a of airports) console.log(a.icao, a.runways.map((r) => `${r.id}${r.crossing.length ? 'x' + r.crossing.join(',') : ''}`).join(' '));

function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur.replace(/\r$/, ''));
  return out;
}
function segX(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
