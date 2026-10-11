// Fetches one operating day (2026-10-11) of departure boards (public
// Flightradar24 airport schedule JSON, no login) for airports whose flights
// may overfly the simulated Kansai/Kanto airspace without landing there.
// Output: research/raw/ovf_boards.json  (rows: flight, callsign, airline, type, from, to, dep UTC epoch)
import fs from 'node:fs';

const T0 = 1791644400; // 2026-10-11 00:00 JST
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const AIRPORTS = ['fuk', 'cts', 'oka', 'ngo', 'sdj', 'koj', 'kmj', 'hij', 'kmq', 'ngs', 'oit', 'kij', 'akj', 'hkd',
  'tpe', 'hkg', 'mnl', 'pvg', 'can', 'bkk', 'sin', 'sgn', 'icn', 'lax', 'sfo', 'sea', 'yvr', 'jfk', 'ord', 'anc', 'dfw'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
for (const ap of AIRPORTS) {
  for (let page = 1; page <= 8; page++) {
    const url = `https://api.flightradar24.com/common/v1/airport.json?code=${ap}&plugin[]=schedule&plugin-setting[schedule][mode]=departures&plugin-setting[schedule][timestamp]=${T0 - 6 * 3600}&page=${page}&limit=100`;
    let j;
    try { j = await (await fetch(url, { headers: { 'User-Agent': UA } })).json(); } catch (e) { console.error(ap, page, e.message); break; }
    const s = j?.result?.response?.airport?.pluginData?.schedule?.departures;
    const data = s?.data || [];
    const origin = j?.result?.response?.airport?.pluginData?.details?.code?.icao;
    for (const x of data) {
      const f = x.flight;
      const dest = f.airport?.destination?.code;
      if (!dest?.icao) continue;
      if (/Cancel/i.test(f.status?.text || '')) continue;
      rows.push({ flight: f.identification?.number?.default, cs: f.identification?.callsign, al: f.airline?.code?.icao, type: f.aircraft?.model?.code, reg: f.aircraft?.registration, from: origin, fromIata: ap.toUpperCase(), to: dest.icao, toIata: dest.iata, dep: f.time?.scheduled?.departure, arr: f.time?.scheduled?.arrival });
    }
    const last = data.at(-1)?.flight?.time?.scheduled?.departure || 0;
    process.stdout.write(`${ap} p${page} ${data.length}  `);
    if (!data.length || page >= (s?.page?.total || 1) || last > T0 + 24 * 3600) break;
    await sleep(1500);
  }
  await sleep(1500);
}
fs.writeFileSync('research/raw/ovf_boards.json', JSON.stringify(rows));
console.log('\nrows', rows.length);
