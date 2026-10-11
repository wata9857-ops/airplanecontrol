// Radio transcript: controller instructions and pilot readbacks per ATC unit.
// Messages are stored as (key, params) and rendered in the selected radio
// language, so switching the language re-renders the whole history.
// English is the operational standard for airline traffic in Japan; the
// Japanese rendering follows Japanese-language ATC phraseology (e.g. 離陸支障なし)
// and is provided as a reference / for domestic-style practice.
import { posCall, posFreq, posCallJa } from './positions.js';

const JA_TEL = { ANA: '全日空', JAL: '日本航空', SKY: 'スカイマーク', APJ: 'ピーチ', JJP: 'ジェットスター', SFJ: 'スターフライヤー', SNJ: 'ソラシド', ADO: 'エア・ドゥ', IBX: 'アイベックス', SJO: 'スプリング', TZP: 'ジップエア', JTA: 'ジェイ・ティー・エー', NCA: '日本貨物', HAC: '北海道エアシステム', ORC: 'オリエンタル', AJX: 'エアジャパン', JAC: 'ジャック' };

export function callsignSpoken(ac, data, lang) {
  const num = ac.callsign.replace(/^[A-Z]{3}/, '');
  if (lang === 'ja' && JA_TEL[ac.airline]) return JA_TEL[ac.airline] + num;
  const al = data.schedule.airlines.find((a) => a.icao === ac.airline);
  if (!al?.telephony) return ac.callsign;
  return al.telephony.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) + ' ' + num;
}

const altEn = (ft) => (ft >= 14000 ? `flight level ${Math.round(ft / 100)}` : `${Math.round(ft).toLocaleString('en-US')} feet`);
const altJa = (ft) => (ft >= 14000 ? `FL${Math.round(ft / 100)}` : `${Math.round(ft).toLocaleString('en-US')}フィート`);

// templates: [english, japanese]
const T = {
  push_req: [(p) => `${p.U}, ${p.CS}, spot ${p.spot}, request pushback`, (p) => `${p.U}、${p.CS}、スポット${p.spot}、プッシュバックをリクエストします`],
  push_ok: [(p) => `${p.CS}, push back approved`, (p) => `${p.CS}、プッシュバック承認`],
  push_ok_rb: [(p) => `Push back approved, ${p.CS}`, (p) => `プッシュバック承認、${p.CS}`],
  push_wait: [(p) => `${p.CS}, standby for pushback, expect delay`, (p) => `${p.CS}、プッシュバックはしばらくお待ちください`],
  push_wait_rb: [(p) => `Standing by, ${p.CS}`, (p) => `待機します、${p.CS}`],
  taxi_req: [(p) => `${p.U}, ${p.CS}, request taxi`, (p) => `${p.U}、${p.CS}、タキシーをリクエストします`],
  taxi_clr: [(p) => `${p.CS}, runway ${p.rwy}, taxi via ${p.via}, hold short of runway ${p.rwy}`, (p) => `${p.CS}、滑走路${p.rwy}、${p.via}経由で走行、滑走路${p.rwy}手前で待機`],
  taxi_clr_rb: [(p) => `Runway ${p.rwy} via ${p.via}, hold short runway ${p.rwy}, ${p.CS}`, (p) => `滑走路${p.rwy}、${p.via}経由、滑走路手前で待機、${p.CS}`],
  ready: [(p) => `${p.U}, ${p.CS}, holding point runway ${p.rwy}, ready for departure`, (p) => `${p.U}、${p.CS}、滑走路${p.rwy}、出発準備完了`],
  luaw: [(p) => `${p.CS}, runway ${p.rwy}, line up and wait`, (p) => `${p.CS}、滑走路${p.rwy}、進入して待機`],
  luaw_rb: [(p) => `Line up and wait runway ${p.rwy}, ${p.CS}`, (p) => `滑走路${p.rwy}、進入して待機、${p.CS}`],
  to_clr: [(p) => `${p.CS}, wind ${p.wind}, runway ${p.rwy}, cleared for take-off`, (p) => `${p.CS}、風${p.wind}、滑走路${p.rwy}、離陸支障なし`],
  to_clr_rb: [(p) => `Cleared for take-off runway ${p.rwy}, ${p.CS}`, (p) => `離陸支障なし、${p.CS}`],
  hold_short: [(p) => `${p.CS}, hold short of runway ${p.rwy}`, (p) => `${p.CS}、滑走路${p.rwy}手前で待機`],
  hold_short_rb: [(p) => `Holding short runway ${p.rwy}, ${p.CS}`, (p) => `滑走路${p.rwy}手前で待機、${p.CS}`],
  contact: [(p) => `${p.CS}, contact ${p.U2} ${p.f}`, (p) => `${p.CS}、${p.U2J} ${p.f}にコンタクトしてください`],
  contact_rb: [(p) => `${p.U2} ${p.f}, ${p.CS}`, (p) => `${p.U2J} ${p.f}、${p.CS}`],
  dep_checkin: [(p) => `${p.U}, ${p.CS}, passing ${altEn(p.alt)}, climbing ${altEn(p.clr)}`, (p) => `${p.U}、${p.CS}、${altJa(p.alt)}通過、${altJa(p.clr)}へ上昇中`],
  radar_dep: [(p) => `${p.CS}, ${p.U}, radar contact, climb and maintain ${altEn(p.clr)}`, (p) => `${p.CS}、${p.U}、レーダー捕捉、${altJa(p.clr)}へ上昇してください`],
  enr_checkin: [(p) => `${p.U}, ${p.CS}, ${altEn(p.alt)}`, (p) => `${p.U}、${p.CS}、${altJa(p.alt)}`],
  radar_enr: [(p) => `${p.CS}, ${p.U}, roger`, (p) => `${p.CS}、${p.U}、了解`],
  climb: [(p) => `${p.CS}, climb and maintain ${altEn(p.alt)}`, (p) => `${p.CS}、${altJa(p.alt)}へ上昇してください`],
  climb_rb: [(p) => `Climb and maintain ${altEn(p.alt)}, ${p.CS}`, (p) => `${altJa(p.alt)}へ上昇、${p.CS}`],
  descend: [(p) => `${p.CS}, descend and maintain ${altEn(p.alt)}`, (p) => `${p.CS}、${altJa(p.alt)}へ降下してください`],
  descend_rb: [(p) => `Descend and maintain ${altEn(p.alt)}, ${p.CS}`, (p) => `${altJa(p.alt)}へ降下、${p.CS}`],
  climb_req: [(p) => `${p.U}, ${p.CS}, request climb ${altEn(p.alt)}`, (p) => `${p.U}、${p.CS}、${altJa(p.alt)}への上昇をリクエストします`],
  arr_checkin: [(p) => `${p.U}, ${p.CS}, ${altEn(p.alt)}, descending via ${p.star}`, (p) => `${p.U}、${p.CS}、${altJa(p.alt)}、${p.star}で降下中`],
  arr_ack: [(p) => `${p.CS}, ${p.U}, radar contact, expect ${p.app}`, (p) => `${p.CS}、${p.U}、レーダー捕捉、${p.app}を予定してください`],
  hold: [(p) => `${p.CS}, hold at ${p.fix} as published, expect further clearance in ${p.min} minutes`, (p) => `${p.CS}、${p.fix}で公示方式により待機、約${p.min}分後に次の許可を予定`],
  hold_rb: [(p) => `Hold at ${p.fix}, ${p.CS}`, (p) => `${p.fix}で待機、${p.CS}`],
  exit_hold: [(p) => `${p.CS}, leave the hold, resume own navigation`, (p) => `${p.CS}、待機を終了、自機航法を再開してください`],
  exit_hold_rb: [(p) => `Leaving the hold, ${p.CS}`, (p) => `待機を終了、${p.CS}`],
  orbit: [(p) => `${p.CS}, make a ${p.dir} three-sixty${p.why ? ' for spacing' : ''}`, (p) => `${p.CS}、${p.dir === 'left' ? '左' : '右'}旋回で360度旋回してください${p.why ? '（間隔調整）' : ''}`],
  orbit_rb: [(p) => `${p.dir === 'left' ? 'Left' : 'Right'} three-sixty, ${p.CS}`, (p) => `${p.dir === 'left' ? '左' : '右'}360度旋回、${p.CS}`],
  app_clr: [(p) => `${p.CS}, cleared ${p.app} approach`, (p) => `${p.CS}、${p.app}進入を許可します`],
  app_clr_rb: [(p) => `Cleared ${p.app} approach, ${p.CS}`, (p) => `${p.app}進入許可、${p.CS}`],
  app_req: [(p) => `${p.U}, ${p.CS}, request approach runway ${p.rwy}`, (p) => `${p.U}、${p.CS}、滑走路${p.rwy}への進入をリクエストします`],
  twr_checkin: [(p) => `${p.U}, ${p.CS}, ${p.app}`, (p) => `${p.U}、${p.CS}、${p.app}進入中`],
  cont_app: [(p) => `${p.CS}, ${p.U}, runway ${p.rwy}, continue approach`, (p) => `${p.CS}、${p.U}、滑走路${p.rwy}、進入を継続してください`],
  land_clr: [(p) => `${p.CS}, wind ${p.wind}, runway ${p.rwy}, cleared to land`, (p) => `${p.CS}、風${p.wind}、滑走路${p.rwy}、着陸支障なし`],
  land_clr_rb: [(p) => `Cleared to land runway ${p.rwy}, ${p.CS}`, (p) => `着陸支障なし、${p.CS}`],
  ga_plt: [(p) => `${p.U}, ${p.CS}, going around`, (p) => `${p.U}、${p.CS}、ゴーアラウンドします`],
  ga_atc: [(p) => `${p.CS}, roger, fly runway heading, climb and maintain ${altEn(p.alt)}`, (p) => `${p.CS}、了解、滑走路方位を維持し${altJa(p.alt)}へ上昇してください`],
  go_around: [(p) => `${p.CS}, go around, fly runway heading, climb and maintain ${altEn(p.alt)}`, (p) => `${p.CS}、ゴーアラウンドしてください、滑走路方位を維持し${altJa(p.alt)}へ上昇`],
  go_around_rb: [(p) => `Going around, ${p.CS}`, (p) => `ゴーアラウンド、${p.CS}`],
  vacated: [(p) => `${p.U}, ${p.CS}, runway ${p.rwy} vacated, request taxi to spot ${p.spot}`, (p) => `${p.U}、${p.CS}、滑走路${p.rwy}を離脱、スポット${p.spot}への走行をリクエストします`],
  taxi_in: [(p) => `${p.CS}, taxi to spot ${p.spot}${p.via ? ' via ' + p.via : ''}`, (p) => `${p.CS}、${p.via ? p.via + '経由で' : ''}スポット${p.spot}へ走行してください`],
  taxi_in_rb: [(p) => `Taxi to spot ${p.spot}, ${p.CS}`, (p) => `スポット${p.spot}へ走行、${p.CS}`],
  hdg: [(p) => `${p.CS}, ${p.turn ? 'turn ' + p.turn + ' ' : 'fly '}heading ${p.hdg}`, (p) => `${p.CS}、${p.turn ? (p.turn === 'left' ? '左旋回で' : '右旋回で') : ''}方位${p.hdg}`],
  hdg_rb: [(p) => `${p.turn ? (p.turn === 'left' ? 'Left' : 'Right') + ' ' : ''}heading ${p.hdg}, ${p.CS}`, (p) => `方位${p.hdg}、${p.CS}`],
  spd: [(p) => `${p.CS}, maintain ${p.spd} knots`, (p) => `${p.CS}、${p.spd}ノットを維持してください`],
  spd_rb: [(p) => `Maintain ${p.spd} knots, ${p.CS}`, (p) => `${p.spd}ノット、${p.CS}`],
  spd_resume: [(p) => `${p.CS}, resume normal speed`, (p) => `${p.CS}、通常速度に戻してください`],
  spd_resume_rb: [(p) => `Resume normal speed, ${p.CS}`, (p) => `通常速度、${p.CS}`],
  direct: [(p) => `${p.CS}, proceed direct ${p.fix}`, (p) => `${p.CS}、${p.fix}へ直行してください`],
  direct_rb: [(p) => `Direct ${p.fix}, ${p.CS}`, (p) => `${p.fix}へ直行、${p.CS}`],
  resume_nav: [(p) => `${p.CS}, resume own navigation${p.fix ? ', direct ' + p.fix : ''}`, (p) => `${p.CS}、自機航法を再開${p.fix ? '、' + p.fix + 'へ直行' : ''}してください`],
  resume_nav_rb: [(p) => `Resume own navigation, ${p.CS}`, (p) => `自機航法再開、${p.CS}`],
  via_star: [(p) => `${p.CS}, descend via ${p.star}`, (p) => `${p.CS}、${p.star}に従い降下してください`],
  via_star_rb: [(p) => `Descend via ${p.star}, ${p.CS}`, (p) => `${p.star}で降下、${p.CS}`],
  via_sid: [(p) => `${p.CS}, climb via SID, maintain ${altEn(p.alt)}`, (p) => `${p.CS}、SIDに従い上昇、${altJa(p.alt)}を維持してください`],
  via_sid_rb: [(p) => `Climb via SID, ${altEn(p.alt)}, ${p.CS}`, (p) => `SIDで上昇、${altJa(p.alt)}、${p.CS}`],
  cancel_app: [(p) => `${p.CS}, cancel approach clearance, maintain present heading`, (p) => `${p.CS}、進入許可を取り消します、現在の方位を維持してください`],
  cancel_app_rb: [(p) => `Approach clearance cancelled, ${p.CS}`, (p) => `進入許可取り消し、${p.CS}`],
  expedite: [(p) => `${p.CS}, expedite descent, no speed restriction`, (p) => `${p.CS}、速やかに降下してください、速度制限なし`],
  expedite_rb: [(p) => `Expedite descent, ${p.CS}`, (p) => `速やかに降下、${p.CS}`],
  expect_rwy: [(p) => `${p.CS}, expect ${p.app}`, (p) => `${p.CS}、${p.app}を予定してください`],
  expect_rwy_rb: [(p) => `Expect ${p.app}, ${p.CS}`, (p) => `${p.app}予定、${p.CS}`],
  reroute: [(p) => `${p.CS}, cleared ${p.star}`, (p) => `${p.CS}、${p.star}を許可します`],
  reroute_rb: [(p) => `Cleared ${p.star}, ${p.CS}`, (p) => `${p.star}許可、${p.CS}`],
  hold_pos: [(p) => `${p.CS}, hold position`, (p) => `${p.CS}、その場で停止してください`],
  hold_pos_rb: [(p) => `Holding position, ${p.CS}`, (p) => `停止します、${p.CS}`],
  cont_taxi: [(p) => `${p.CS}, continue taxi`, (p) => `${p.CS}、走行を継続してください`],
  cont_taxi_rb: [(p) => `Continue taxi, ${p.CS}`, (p) => `走行継続、${p.CS}`],
  dep_rwy: [(p) => `${p.CS}, runway ${p.rwy}, ${p.sid}`, (p) => `${p.CS}、滑走路${p.rwy}、${p.sid}`],
  dep_rwy_rb: [(p) => `Runway ${p.rwy}, ${p.sid}, ${p.CS}`, (p) => `滑走路${p.rwy}、${p.sid}、${p.CS}`],
  mayday: [(p) => `MAYDAY MAYDAY MAYDAY, ${p.U}, ${p.CS}, ${p.nature}`, (p) => `メーデー、メーデー、メーデー、${p.U}、${p.CS}、${p.natureJa}`],
  mayday_ack: [(p) => `${p.CS}, ${p.U}, roger MAYDAY, you have priority`, (p) => `${p.CS}、${p.U}、メーデー了解、優先的に取り扱います`],
};

export class Radio {
  constructor(world) { this.w = world; this.log = []; this.seq = 0; this.listeners = new Set(); }
  // who: 'ATC' | 'PLT'
  say(ac, unit, who, key, p = {}) {
    if (!unit || !T[key]) return;
    const m = { id: ++this.seq, t: this.w.clock, unit, ac: ac?.id, cs: ac?.callsign || '', who, key, p, dir: ac?.dir };
    this.log.push(m);
    if (this.log.length > 4000) this.log.splice(0, 1000);
    for (const fn of this.listeners) fn(m);
    return m;
  }
  // instruction + readback in one go
  exchange(ac, unit, key, p = {}) { this.say(ac, unit, 'ATC', key, p); if (T[key + '_rb']) this.say(ac, unit, 'PLT', key + '_rb', p); }

  render(m, lang, data) {
    const ac = this.w.byId(m.ac);
    const L = lang === 'ja' ? 1 : 0;
    const CS = ac ? callsignSpoken(ac, data, lang) : m.cs;
    const U = lang === 'ja' ? posCallJa(m.unit, m.dir) : posCall(m.unit, m.dir);
    const p = { ...m.p, CS, U };
    if (p.u2) { p.U2 = posCall(p.u2, m.dir); p.U2J = posCallJa(p.u2, m.dir); p.f = posFreq(p.u2, m.dir); }
    try { return T[m.key][L](p); } catch { return m.key; }
  }
}
