// Converts the researched one-day Flightradar24 airport boards (2026-10-11 JST,
// public airport schedule JSON) into research/schedules_full.json.
// Flights operated that day only (cancelled removed). Callsigns are the ones
// broadcast; where missing they are derived from ICAO airline code + number.
import fs from 'node:fs';

const RAW = 'research/schedules_raw';
const T0 = 1791644400; // 2026-10-11 00:00 JST
const ap = { hnd: 'RJTT', kix: 'RJBB', nrt: 'RJAA', itm: 'RJOO', ukb: 'RJBE' };

// IATA aircraft codes occasionally returned instead of ICAO designators
const TYPE_MAP = {
  '73F': 'B738', '320': 'A320', '737': 'B737', '74F': 'B744', '76F': 'B763', '32Q': 'A21N', CR7: 'CRJ7', '321': 'A321', E90: 'E190',
  '32N': 'A20N', '77X': 'B77L', E70: 'E170', '738': 'B738', '763': 'B763', '772': 'B772', '789': 'B789', '787': 'B788', '788': 'B788',
  '73H': 'B738', '74Y': 'B744', '74N': 'B748', '330': 'A333', '333': 'A333', '359': 'A359', '773': 'B773', '76Y': 'B763', DH4: 'DH8D',
  B741: 'B744', '77W': 'B77W', '32B': 'A321', '788F': 'B788',
};

function rowsFromRaw(code) {
  const rows = [];
  for (const mode of ['departures', 'arrivals']) for (const p of [1, 2, 3]) {
    const f = `${RAW}/fr_${code}_${mode}_${p}.json`;
    if (!fs.existsSync(f)) continue;
    const data = JSON.parse(fs.readFileSync(f, 'utf8')).result.response.airport.pluginData.schedule[mode].data || [];
    for (const x of data) {
      const fl = x.flight, dep = mode === 'departures';
      const t = fl.time.scheduled[dep ? 'departure' : 'arrival'];
      if (!(t >= T0 && t < T0 + 86400)) continue;
      const other = fl.airport[dep ? 'destination' : 'origin']?.code || {};
      const d = new Date((t + 9 * 3600) * 1000);
      rows.push({ dir: dep ? 'DEP' : 'ARR', time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`, flight: fl.identification.number.default, cs: fl.identification.callsign, al: fl.airline?.code?.icao || null, other: `${other.icao}/${other.iata}`, type: fl.aircraft?.model?.code || null, reg: fl.aircraft?.registration || '', status: fl.status?.text || '' });
    }
  }
  return rows;
}

const flights = [];
const seen = new Set();
const stats = {};
for (const [code, icao] of Object.entries(ap)) {
  const file = `${RAW}/rows_${code}.json`;
  const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : rowsFromRaw(code);
  let n = 0;
  for (const r of rows) {
    if (/Cancel/i.test(r.status)) continue;
    const [oIcao, oIata] = (r.other || '').split('/');
    if (!oIcao || oIcao === 'null' || oIcao === 'undefined') continue;
    let type = r.type ? (TYPE_MAP[r.type] || r.type) : null;
    if (!type || ['GLF6', 'GLEX', 'C68A', 'C25B'].includes(type)) continue; // skip business jets / unknown types
    const num = (r.flight || '').replace(/^[A-Z0-9]{2}/, '');
    let cs = r.cs;
    let derived = false;
    if (!cs) { if (!r.al) continue; cs = r.al + num; derived = true; }
    const from = r.dir === 'DEP' ? icao : oIcao, to = r.dir === 'DEP' ? oIcao : icao;
    const key = `${cs}|${from}|${to}`;
    if (seen.has(key)) continue; // HND–ITM etc. appear on both boards
    seen.add(key);
    flights.push({ airport: icao, dir: r.dir, flight: r.flight, callsign: cs, airline: r.al || cs.slice(0, 3), from, to, timeLocal: r.time, type, typeVerified: true, verified: true, csDerived: derived, reg: r.reg || '' });
    n++;
  }
  stats[icao] = n;
}
const prev = JSON.parse(fs.readFileSync('research/schedules.json', 'utf8'));
fs.writeFileSync('research/schedules_full.json', JSON.stringify({
  sources: [{ name: 'Flightradar24 public airport schedule JSON (operating day 2026-10-11 JST)', url: 'https://www.flightradar24.com/data/airports/' }, ...(prev.sources || [])],
  airlines: prev.airlines, flights,
  notes: 'All flights operated on 2026-10-11 (JST) at KIX/HND/NRT/ITM/UKB. Times are scheduled local times. Callsigns as broadcast unless csDerived=true. ' + (prev.notes || ''),
}, null, 0));
console.log('flights', flights.length, stats);
