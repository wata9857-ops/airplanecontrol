// ATC positions (control units) and jurisdiction, modelled on Japanese
// operations (JCAB):
//   Ground (グランド)  – stand, pushback/start-up, taxi to the runway holding
//                        point and taxi-in after vacating.
//   Tower (タワー)     – runway: holding point, line-up, take-off, landing
//                        clearance, roll-out, plus the immediate vicinity
//                        (departures to ~2,500 ft AGL / 6 NM, arrivals from
//                        ~8 NM final).
//   Approach/Departure (ターミナル・レーダー) – Tokyo Approach (Haneda and
//                        Narita sectors) and Kansai Approach (KIX/ITM/UKB):
//                        terminal airspace below ~16,000 ft.
//   Area control (航空交通管制部) – since the 2025 vertical split: Tokyo Control
//                        (lower, east), Kobe Control (lower, west), Fukuoka
//                        Control (upper airspace, FL335 and above).
// Frequencies are from the AIP charts / operations research (several marked
// unverified there). Terminal and sector boundaries are approximations.
import { dist, toXY } from '../geo.js';

export const POSITIONS = [
  { id: 'RJTT_GND', type: 'GND', ap: 'RJTT', call: 'Tokyo Ground', ja: '東京グランド', freq: '121.70', view: { lat: 35.551, lon: 139.787, span: 3.4 } },
  { id: 'RJTT_TWR', type: 'TWR', ap: 'RJTT', call: 'Tokyo Tower', ja: '東京タワー', freq: '118.10', view: { lat: 35.55, lon: 139.79, span: 16 } },
  { id: 'RJTT_APP', type: 'APP', ap: 'RJTT', call: 'Tokyo Approach', depCall: 'Tokyo Departure', ja: '東京アプローチ（羽田）', depJa: '東京ディパーチャー', freq: '119.10', depFreq: '126.00', view: { lat: 35.45, lon: 139.85, span: 80 } },
  { id: 'RJAA_GND', type: 'GND', ap: 'RJAA', call: 'Narita Ground', ja: '成田グランド', freq: '121.85', view: { lat: 35.770, lon: 140.384, span: 3.6 } },
  { id: 'RJAA_TWR', type: 'TWR', ap: 'RJAA', call: 'Narita Tower', ja: '成田タワー', freq: '118.20', view: { lat: 35.77, lon: 140.385, span: 16 } },
  { id: 'RJAA_APP', type: 'APP', ap: 'RJAA', call: 'Tokyo Approach', depCall: 'Tokyo Departure', ja: '東京アプローチ（成田）', depJa: '東京ディパーチャー（成田）', freq: '124.40', depFreq: '124.20', view: { lat: 35.75, lon: 140.4, span: 70 } },
  { id: 'RJBB_GND', type: 'GND', ap: 'RJBB', call: 'Kansai Ground', ja: '関西グランド', freq: '121.60', view: { lat: 34.437, lon: 135.233, span: 3.6 } },
  { id: 'RJBB_TWR', type: 'TWR', ap: 'RJBB', call: 'Kansai Tower', ja: '関西タワー', freq: '118.20', view: { lat: 34.435, lon: 135.235, span: 16 } },
  { id: 'KANSAI_APP', type: 'APP', ap: 'RJBB', call: 'Kansai Approach', depCall: 'Kansai Departure', ja: '関西アプローチ', depJa: '関西ディパーチャー', freq: '120.25', depFreq: '119.20', view: { lat: 34.55, lon: 135.35, span: 85 } },
  { id: 'RJOO_GND', type: 'GND', ap: 'RJOO', call: 'Osaka Ground', ja: '大阪グランド', freq: '121.70', view: { lat: 34.785, lon: 135.439, span: 2.6 } },
  { id: 'RJOO_TWR', type: 'TWR', ap: 'RJOO', call: 'Osaka Tower', ja: '大阪タワー', freq: '118.10', view: { lat: 34.785, lon: 135.44, span: 14 } },
  { id: 'RJBE_GND', type: 'GND', ap: 'RJBE', call: 'Kobe Ground', ja: '神戸グランド', freq: '122.075', view: { lat: 34.633, lon: 135.224, span: 2.4 } },
  { id: 'RJBE_TWR', type: 'TWR', ap: 'RJBE', call: 'Kobe Tower', ja: '神戸タワー', freq: '118.50', view: { lat: 34.633, lon: 135.224, span: 14 } },
  { id: 'TOKYO_ACC', type: 'ACC', call: 'Tokyo Control', ja: '東京コントロール（下層）', freq: '', view: { lat: 35.3, lon: 139.0, span: 300 } },
  { id: 'KOBE_ACC', type: 'ACC', call: 'Kobe Control', ja: '神戸コントロール（下層）', freq: '123.90', view: { lat: 34.6, lon: 135.2, span: 300 } },
  { id: 'FUKUOKA_ACC', type: 'ACC', call: 'Fukuoka Control', ja: '福岡コントロール（上層）', freq: '', view: { lat: 35.0, lon: 137.4, span: 420 } },
];
export const POS = Object.fromEntries(POSITIONS.map((p) => [p.id, p]));

const APP_FOR = { RJTT: 'RJTT_APP', RJAA: 'RJAA_APP', RJBB: 'KANSAI_APP', RJOO: 'KANSAI_APP', RJBE: 'KANSAI_APP' };
// terminal (approach) areas: centre airport, radius (NM), ceiling (ft)
export const TERMINALS = [
  { pos: 'KANSAI_APP', centres: [['RJBB', 40], ['RJOO', 32], ['RJBE', 25]], ceil: 16000 },
  { pos: 'RJTT_APP', centres: [['RJTT', 45]], ceil: 16000 },
  { pos: 'RJAA_APP', centres: [['RJAA', 40]], ceil: 16000 },
];
const GND_PHASES = new Set(['PARKED', 'PUSHBACK', 'STARTUP', 'TAXI_OUT', 'TAXI_IN']);
const TWR_GND_PHASES = new Set(['HOLD_SHORT', 'LINEUP', 'LINED_UP', 'TAKEOFF', 'ROLLOUT']);

// Which unit currently controls the aircraft (null: not on frequency, e.g. parked after arrival)
export function unitOf(w, ac) {
  if (ac.onGround) {
    const ap = ac.airportIcao;
    if (TWR_GND_PHASES.has(ac.phase)) return ap + '_TWR';
    if (GND_PHASES.has(ac.phase)) {
      if (ac.phase === 'PARKED' && ac.dir !== 'DEP') return null;
      return ap + '_GND';
    }
    return null;
  }
  const own = w.airport(ac.dir === 'DEP' ? ac.from : ac.to);
  if (own) {
    const agl = ac.alt - (own.elev || 0);
    if (ac.dir === 'DEP' && dist(ac, own) < 6 && agl < 2500) return own.icao + '_TWR';
    if (ac.dir === 'ARR' && ac.appr?.established && ac.appr.distThr < 8) return own.icao + '_TWR';
    if (ac.phase === 'GOAROUND' && dist(ac, own) < 6 && agl < 2500) return own.icao + '_TWR';
  }
  // terminal: the approach unit of the aircraft's own airport has priority
  if (own && ac.alt < 16000) {
    const t = TERMINALS.find((x) => x.pos === APP_FOR[own.icao]);
    if (t && inTerminal(w, ac, t)) return t.pos;
  }
  for (const t of TERMINALS) if (ac.alt < t.ceil && inTerminal(w, ac, t)) return t.pos;
  return accFor(ac);
}

function inTerminal(w, ac, t) {
  return t.centres.some(([icao, r]) => { const a = w.airport(icao); return a && dist(ac, a) < r; });
}

export function accFor(ac) {
  if (ac.alt >= 33500) return 'FUKUOKA_ACC';
  const ll = ac.latlon;
  // Kobe ACC: lower airspace of west Japan; the Kii peninsula belongs to Tokyo ACC
  const kii = ll.lat < 34.25 && ll.lon > 135.35;
  return ll.lon < 136.6 && !kii ? 'KOBE_ACC' : 'TOKYO_ACC';
}

export function posName(id, lang, dir) {
  const p = POS[id]; if (!p) return id || '—';
  if (dir === 'DEP' && p.depCall) return lang === 'ja' ? p.depJa : p.depCall;
  return lang === 'ja' ? p.ja : p.call;
}
export function posCall(id, dir) { const p = POS[id]; if (!p) return ''; return dir === 'DEP' && p.depCall ? p.depCall : p.call; }
export function posFreq(id, dir) { const p = POS[id]; if (!p) return ''; return dir === 'DEP' && p.depFreq ? p.depFreq : p.freq; }
export function posCallJa(id, dir) { const p = POS[id]; if (!p) return ''; const n = dir === 'DEP' && p.depJa ? p.depJa : p.ja; return n.replace(/（.*）/, ''); }
export const centreXY = (p) => toXY(p.view.lat, p.view.lon);
