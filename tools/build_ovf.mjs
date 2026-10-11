// Builds research/overflights.json from the departure boards fetched by
// tools/fetch_ovf_boards.mjs: real flights (2026-10-11) between airports that
// are NOT simulated, whose great-circle route crosses the simulated domain.
// Entry time = scheduled departure + 15 min (taxi/climb) + distance to the
// domain edge at ~450 kt groundspeed (approximation; documented in-game).
import fs from 'node:fs';
import { gcDist, gcPoint, gcDomainCrossing } from '../src/geo.js';

const T0 = 1791644400; // 2026-10-11 00:00 JST
const SIM = new Set(['RJTT', 'RJAA', 'RJBB', 'RJOO', 'RJBE']);
const world = JSON.parse(fs.readFileSync('data/world.json', 'utf8'));
const box = world.domain;
const rows = JSON.parse(fs.readFileSync('research/raw/ovf_boards.json', 'utf8'));
const TYPE_MAP = { '73F': 'B738', '320': 'A320', '74F': 'B744', '76F': 'B763', '77X': 'B77L', '77F': 'B77L', '744': 'B744', '74N': 'B748', '333': 'A333', '359': 'A359', '789': 'B789', '788': 'B788', '747': 'B744', '74Y': 'B744', '77W': 'B77W', '32N': 'A20N', DH4: 'DH8D', CR7: 'CRJ7', '738': 'B738', '73H': 'B738', '321': 'A321', '320': 'A320', '332': 'A332', '763': 'B763', '772': 'B772', '773': 'B773', E90: 'E190', E70: 'E170', E75: 'E75S' };

// airport coordinates (OurAirports)
const csv = fs.readFileSync('research/raw/airports.csv', 'utf8').split('\n');
const head = csv[0].split(',').map((s) => s.replace(/"/g, ''));
const ix = (k) => head.indexOf(k);
const coords = {}, iata = {}, names = {};
for (let i = 1; i < csv.length; i++) {
  const r = csv[i].match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((s) => s.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  if (!r || r.length < 14) continue;
  const icao = r[ix('ident')];
  if (!/^[A-Z]{4}$/.test(icao)) continue;
  coords[icao] = [+r[ix('latitude_deg')], +r[ix('longitude_deg')]];
  if (r[ix('iata_code')]) iata[icao] = r[ix('iata_code')];
  names[icao] = r[ix('name')];
}
const byIata = { FUK: 'RJFF', CTS: 'RJCC', OKA: 'ROAH', NGO: 'RJGG', SDJ: 'RJSS', KOJ: 'RJFK', KMJ: 'RJFT', HIJ: 'RJOA', KMQ: 'RJNK', NGS: 'RJFU', OIT: 'RJFO', KIJ: 'RJSN', AKJ: 'RJEC', HKD: 'RJCH', TPE: 'RCTP', HKG: 'VHHH', MNL: 'RPLL', PVG: 'ZSPD', CAN: 'ZGGG', BKK: 'VTBS', SIN: 'WSSS', SGN: 'VVTS', ICN: 'RKSI', LAX: 'KLAX', SFO: 'KSFO', SEA: 'KSEA', YVR: 'CYVR', JFK: 'KJFK', ORD: 'KORD', ANC: 'PANC', DFW: 'KDFW' };
for (const r of rows) if (!r.from && r.fromIata) r.from = byIata[r.fromIata];
const inside = (p) => p[0] > box.minLat && p[0] < box.maxLat && p[1] > box.minLon && p[1] < box.maxLon;
const out = [];
const seen = new Set();
const airportsUsed = new Set();
for (const r of rows) {
  if (!r.from || !r.to || r.from === r.to || SIM.has(r.from) || SIM.has(r.to)) continue;
  const a = coords[r.from], b = coords[r.to];
  if (!a || !b || !r.dep) continue;
  const type = r.type ? (TYPE_MAP[r.type] || r.type) : null;
  if (!type) continue;
  const cs = (r.cs || (r.al && r.flight ? r.al + r.flight.replace(/^[A-Z0-9]{2}/, '') : '')).replace(/\s/g, '');
  if (!/^[A-Z]{3}\d/.test(cs)) continue;
  const key = `${cs}|${r.from}|${r.to}|${Math.round(r.dep / 3600)}`;
  if (seen.has(key)) continue;
  const x = gcDomainCrossing(a, b, box, 10);
  if (!x) continue;
  const total = x.total;
  const inNm = x.inF * total, outNm = x.outF * total;
  if (outNm - inNm < 60) continue; // just clipping a corner
  const startInside = inside(a), endInside = inside(b);
  // flights departing/arriving at a non-simulated airport inside the domain:
  // begin 40 NM after departure (climbing) / end 50 NM before arrival (descending)
  const sNm = startInside ? 40 : inNm, eNm = endInside ? total - 50 : outNm;
  if (eNm - sNm < 60) continue;
  const tIn = r.dep + 15 * 60 + sNm / 450 * 3600;
  const secOfDay = ((tIn - T0) % 86400 + 86400) % 86400;
  if (tIn < T0 - 6 * 3600 || tIn > T0 + 30 * 3600) continue;
  const path = [];
  for (let d = sNm; d < eNm; d += 40) { const p = gcPoint(a[0], a[1], b[0], b[1], d / total); path.push([+p.lat.toFixed(4), +p.lon.toFixed(4)]); }
  const pe = gcPoint(a[0], a[1], b[0], b[1], eNm / total); path.push([+pe.lat.toFixed(4), +pe.lon.toFixed(4)]);
  seen.add(key);
  airportsUsed.add(r.from); airportsUsed.add(r.to);
  out.push({ flight: r.flight, callsign: cs, airline: cs.slice(0, 3), type, reg: r.reg || '', from: r.from, to: r.to, tIn: Math.round(secOfDay), dur: Math.round((eNm - sNm) / 450 * 3600), path, startInside, endInside, dist: Math.round(total) });
}
out.sort((p, q) => p.tIn - q.tIn);
fs.writeFileSync('research/overflights.json', JSON.stringify({
  source: 'Flightradar24 public airport schedule boards, operating day 2026-10-11 (departures from FUK, CTS, OKA, NGO, SDJ, KOJ, KMJ, HIJ, KMQ, NGS, OIT, KIJ, AKJ, HKD, TPE, HKG, MNL, PVG, CAN, BKK, SIN, SGN, ICN, LAX, SFO, SEA, YVR, JFK, ORD, ANC, DFW)',
  note: 'Routes are great-circle approximations (real flights follow airways/PACOTS); entry time estimated from STD.',
  airports: Object.fromEntries([...airportsUsed].map((k) => [k, { ll: coords[k], iata: iata[k] || '', name: names[k] || '' }])),
  flights: out,
}));
const byHour = new Array(24).fill(0); for (const f of out) byHour[Math.floor(f.tIn / 3600)]++;
console.log('overflights', out.length, 'by JST hour', byHour.join(' '));
const intl = out.filter((f) => !f.from.startsWith('RJ') || !f.to.startsWith('RJ')).length;
console.log('international', intl, 'domestic', out.length - intl);
