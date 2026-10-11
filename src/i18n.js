// Interface language (Japanese / English). Airline names, callsigns, airport
// identifiers, flight numbers and standard aviation abbreviations (ILS, STAR,
// SID, FL, RWY, QNH…) are deliberately kept as-is in both languages.
// Radio phraseology has its own language setting (see sim/radio.js).

const EN = {
  // top bar / general
  view: 'VIEW', global: 'Global (all)', filter: 'FILTER', comms: 'RADIO', strips: 'STRIPS', fullmap: 'Full map', menu: 'Menu', pos: 'POSITION',
  close: 'Close', collapse: 'Collapse', expand: 'Expand',
  badge: 'L{l} · {span} NM · {air} airborne · LDG {ldg} DEP {dep} GA {ga} LOS {los}',
  lv1: 'Level 1 — wide area', lv2: 'Level 2 — terminal', lv3: 'Level 3 — approach', lv4: 'Level 4 — airport',
  // aircraft panel
  tabALT: 'ALT', tabHDG: 'HDG', tabSPD: 'SPD', tabROUTE: 'ROUTE', tabAPP: 'APP', tabINFO: 'INFO', tabGND: 'GND', tabTWR: 'TWR',
  kALT: 'ALT', kCLR: 'CLEARED', kVS: 'V/S', kHDG: 'HDG', kASGHDG: 'ASG HDG', kIAS: 'IAS', kASGSPD: 'ASG SPD', kGS: 'GS', kPHASE: 'PHASE', kRWY: 'RWY', kSEQ: 'SEQ/DELAY', kUNIT: 'UNIT', kSTAND: 'SPOT', kSIDSTAR: 'SID/STAR', kSTD: 'STD', kQUEUE: 'QUEUE', kDEST: 'TO', kFROM: 'FROM',
  viaStar: 'VIA STAR', viaSid: 'VIA SID', holdShort: 'HLD',
  altRow: 'Altitude (ft, QNH) — tap to clear', flRow: 'Flight level (above TA 14,000 ft)', vnavArr: 'DESCEND VIA STAR', vnavDep: 'CLIMB VIA SID',
  taNote: 'Transition altitude 14,000 ft / transition level FL140 (Japan AIP). Altitudes below the TA are in feet.',
  hdgRow: 'Heading (magnetic)', turnL: '◀ TURN LEFT', flyHdg: 'FLY HDG', turnR: 'TURN RIGHT ▶', presentHdg: 'PRESENT HDG', tapVector: '⌖ TAP-TO-VECTOR',
  tapVectorOn: 'Tap the map to vector toward that point', tapVectorOff: 'Vector mode off', resumeNav: 'RESUME OWN NAV', orbitRow: 'Orbit', orbitL: '360 LEFT', orbitR: '360 RIGHT',
  spdRow: 'Indicated airspeed (kt)', resumeSpd: 'RESUME NORMAL SPEED', maintainSpd: 'MAINTAIN PRESENT',
  spdNote: 'Min clean ~{vmin} kt · final {vapp} kt. JCAB minimums for jets: 210 kt beyond 20 NM, 170 kt within 20 NM; 250 kt max at/below 10,000 ft in control zones and approach areas.',
  routeRow: 'Route (active in colour) — {proc}', directRow: 'Proceed direct', holdRow: 'Hold (as published, right turns)', exitHold: 'EXIT HOLD', rerouteRow: 'Re-route via STAR',
  lrwyRow: 'Landing runway (re-sequence)', apprRow: 'Approach', clearedApp: 'CLEARED {app}', cancelApp: 'CANCEL APP CLR', goAround: 'GO AROUND', expedite: 'EXPEDITE',
  appNote: 'Vectored aircraft intercept the localiser once cleared. Automation clears routine approaches unless you control this position with manual clearances.',
  depNote: 'Departure — approach options are available for arrivals.', emergRow: 'Emergency', declareEmerg: 'DECLARE EMERGENCY (7700)', cancelEmerg: 'CANCEL EMERGENCY',
  gndRow: 'Ground', approvePush: 'APPROVE PUSHBACK', delayPush: 'DELAY PUSHBACK', release: 'RELEASE', approveTaxi: 'TAXI TO RUNWAY', holdPosition: 'HOLD POSITION', continueTaxi: 'CONTINUE TAXI', taxiToSpot: 'TAXI TO SPOT',
  towerRow: 'Tower', luaw: 'LINE UP AND WAIT', clrTakeoff: 'CLEARED FOR TAKE-OFF', holdShortManual: 'HOLD SHORT', releaseAuto: 'RELEASE TO AUTO', clrLand: 'CLEARED TO LAND',
  depRwyRow: 'Departure runway', taxiRoute: 'Taxi route: {r}', climbTo: 'CLIMB {alt}',
  schedule: 'Schedule: {flight} {from}→{to} {std} {time} JST · {reg}real flight (FR24 board 2026-10-11)', overflight: 'Overflight: {flight} {from}→{to} · {reg}real flight (FR24 board 2026-10-11); route approximated as great circle',
  destOrigin: 'Destination: {dest} · Origin: {orig}', cruiseUnit: 'Cruise {alt} · Unit: {unit} {freq}', returnAuto: 'RETURN TO AUTOMATION',
  monitorOnly: 'Under {unit} — monitor only. Switch position or Global to control.', minimized: 'tap to expand',
  // lists
  arr: 'ARR', dep: 'DEP', log: 'LOG', noArrivals: 'No arrivals airborne.', onGroundArrived: 'Arrived, on ground: {list}',
  // menu
  secLanguage: 'Language', secRadioLang: 'Radio phraseology', radioNote: 'Airline traffic in Japan uses English. Japanese phraseology is provided for reference / practice.',
  secTheme: 'Map theme', themeDark: 'Dark', themeLight: 'Light', secDisplay: 'Aircraft display',
  modeRealistic: 'Realistic ✈', modeRadar: 'Radar (advanced)', modeSimple: 'Simple', modeBeginner: 'Beginner',
  modeNote: 'Realistic: aircraft silhouettes showing heading. Radar: ARTS-style symbols and datablocks. Simple: minimal labels and map. Beginner: large icons, plain-language labels, legend and explanations.',
  secWind: 'Wind & runway configuration', windLine: '{ap} — wind {dir}°/{spd}kt — {cfg}{lock}', locked: ' (locked)', unlock: 'Unlock (auto by wind)', autoWind: 'Auto by wind', rwyClosure: 'Runway closure', closed: 'CLOSED',
  secAbnormal: 'Abnormal situations', addCb: 'Add CB cell (tap map)', clearWx: 'Clear weather', randomEmerg: 'Random emergency',
  secTraffic: 'Traffic', trafficNote: 'Real schedule of 2026-10-11 (all flights operated at KIX/HND/NRT/ITM/UKB, from Flightradar24 boards) plus 650+ real overflights (domestic and Asia–North America/cargo flights crossing the area, from the boards of 31 other airports). Lower density skips flights evenly.',
  restartAt: 'Restart at time (JST)', layers: 'Map layers', trails: 'Trails', fixes: 'Fixes', procs: 'SID/STAR', airways: 'Airways', rings: 'Range rings', sweep: '4 s radar sweep', bounds: 'Sector boundaries',
  labelSize: 'Label size', resetLabels: 'Reset labels', secHelp: 'How to use', tutorial: 'Show tutorial',
  help1: 'Tap an aircraft (or its label) to select it; drag the selected label to move it. One finger pans, two fingers zoom. VIEW jumps between wide area, terminal, approach and airport views — zoom is continuous and every aircraft keeps flying in every view.',
  help2: 'POSITION lets you work a single real ATC position (Ground, Tower, Approach, Control). Aircraft under that position call you on the RADIO panel with requests; everything else keeps running under automation.',
  help3: 'Amber = predicted conflict (STCA, within 2 min), red = separation lost (3 NM terminal / 5 NM en route, 1,000 ft). FILTER changes only what is drawn — hidden aircraft keep flying and are still monitored.',
  secData: 'Data & realism notes',
  dataVerified: 'Verified: AIP Japan procedures (STAR/SID/approach fixes and constraints) for KIX, ITM, UKB, HND, NRT; runway thresholds (AIP/OSM); runway configurations (MLIT/JCAB); separation minima and speed rules (JCAB 管制業務処理規程); airline callsigns and the full real flight schedule including international, cargo and business flights; real overflights.',
  dataApprox: 'Approximations: aircraft performance (typical values), wind model, runway assignment within a configuration, stand allocation, airway point order (community data), LDA/visual approaches replaced by ILS, HND night configurations, terminal/sector boundaries and some frequencies, overflight routes (great circle) and their entry times.',
  source: 'Source on GitHub',
  // positions
  posTitle: 'ATC position', posGlobalDesc: 'Control everything (default)', grpGround: 'Ground', grpTower: 'Tower', grpApproach: 'Approach / Departure', grpArea: 'Area control (ACC)',
  manualClr: 'Manual clearances', manualClrDesc: 'You issue routine clearances for your position (pushback, taxi, take-off, landing, approach, climb). Off = automation assists, you intervene.',
  dimOthers: 'Dim traffic outside my position', posNote: 'Jurisdictions follow JCAB practice: Ground → stands and taxiways; Tower → runway and ~6–8 NM around the airport; Approach → terminal airspace below ~16,000 ft; Control → en-route (Tokyo/Kobe lower, Fukuoka upper ≥ FL335). Boundaries are approximate.',
  nAircraft: '{n} aircraft',
  // comms
  commsTitle: 'Radio', commsMine: 'My position', commsAll: 'All units', requests: 'Requests', noRequests: 'No pending requests',
  reqPUSH: 'Pushback request', reqTAXI: 'Taxi request', reqDEPART: 'Ready for departure', reqLAND: 'Landing clearance', reqAPP: 'Approach clearance', reqCLIMB: 'Climb request', reqTAXIIN: 'Taxi to spot',
  atcLbl: 'ATC', pltLbl: 'PILOT', commsEmpty: 'No transmissions yet.',
  // filters
  filterTitle: 'Display filter', fAirport: 'Airport', fAll: 'All', fRelation: 'Relation to airport', fAny: 'Any', fArrTo: 'Arriving', fDepFrom: 'Departing', fInArea: 'In its airspace',
  fTraffic: 'Traffic', fArrivals: 'Arrivals', fDepartures: 'Departures', fOverflights: 'Overflights', fState: 'State', fAirborne: 'Airborne', fGround: 'On ground',
  fUnit: 'ATC unit', fMine: 'My position', fAlerts: 'Alerts only', fSearch: 'Airline / flight / type…', fReset: 'Show all aircraft', fActive: 'Filter on · {n} hidden', fNote: 'Filters change only the display. Hidden aircraft keep flying, stay under automatic ATC and are still monitored by STCA.',
  // toasts
  wxPlaced: 'CB cell placed', wxCleared: 'Weather cleared', tapWx: 'Tap the map to place a thunderstorm cell', returnedAuto: '{cs} returned to automation', rwyNA: 'Runway not available', rwyClosedT: 'Runway closed',
  notYours: '{cs} is under {unit} — not your position', posSet: 'Position: {pos}', posGlobal: 'Global control (all aircraft)',
  // beginner
  legArr: 'Arriving', legDep: 'Departing', legOvf: 'Passing through', legGnd: 'On the ground', legAlert: 'Needs attention', legend: 'Legend',
  plainStca: '⚠ {a} and {b} may get too close in about {t} s — change altitude or heading of one of them.', plainLos: '⛔ {a} and {b} are too close ({dh} NM, {dv} ft) — separate them now!',
  bTo: 'to', bFrom: 'from', bClimb: 'climbing', bDesc: 'descending', bLevel: 'level',
  // tutorial
  tutNext: 'Next', tutDone: 'Start', tutSkip: 'Skip',
  tut1t: 'Welcome to JP ATC Sim', tut1b: 'Real Japanese airspace (Kansai and Kanto) with the real flights of one day. Automation handles routine traffic; you can take over at any time.',
  tut2t: 'Select & command', tut2b: 'Tap an aircraft to open its panel. Give headings, altitudes and speeds; the pilot reads back on the radio. "Return to automation" hands it back.',
  tut3t: 'Work a real ATC position', tut3b: 'Open POSITION and pick e.g. Tokyo Ground or Kansai Tower. Aircraft under that position call you with requests in the RADIO panel.',
  tut4t: 'Safety first', tut4b: 'Amber lines warn of predicted conflicts, red means separation is lost. Use FILTER to focus, and Menu → Aircraft display → Beginner for a friendlier view.',
  // phases
  ph_PARKED: 'At stand', ph_PUSHBACK: 'Pushback', ph_STARTUP: 'Engine start', ph_TAXI_OUT: 'Taxiing out', ph_HOLD_SHORT: 'Holding short', ph_LINEUP: 'Lining up', ph_LINED_UP: 'Lined up', ph_TAKEOFF: 'Take-off roll',
  ph_CLIMB: 'Climbing', ph_CRUISE: 'Cruise', ph_DESCENT: 'Descending', ph_APPROACH: 'Approach', ph_FINAL: 'Final', ph_GOAROUND: 'Go-around', ph_ROLLOUT: 'Landing roll', ph_TAXI_IN: 'Taxiing in', ph_OVERFLIGHT: 'Overflight',
};

const JA = {
  view: '表示', global: '全体管制（全機）', filter: 'フィルタ', comms: '無線', strips: 'ストリップ', fullmap: '地図を最大化', menu: 'メニュー', pos: '管制席',
  close: '閉じる', collapse: '折りたたむ', expand: '展開',
  badge: 'L{l} · {span} NM · 飛行中 {air} · 着陸 {ldg} 離陸 {dep} GA {ga} 間隔欠如 {los}',
  lv1: 'レベル1 — 広域', lv2: 'レベル2 — ターミナル', lv3: 'レベル3 — 進入管制', lv4: 'レベル4 — 空港',
  tabALT: '高度', tabHDG: '方位', tabSPD: '速度', tabROUTE: '経路', tabAPP: '進入', tabINFO: '情報', tabGND: '地上', tabTWR: '飛行場',
  kALT: '高度', kCLR: '許可高度', kVS: '昇降率', kHDG: '方位', kASGHDG: '指示方位', kIAS: '指示対気速度', kASGSPD: '指示速度', kGS: '対地速度', kPHASE: '状態', kRWY: '滑走路', kSEQ: '順位/遅延', kUNIT: '担当', kSTAND: 'スポット', kSIDSTAR: 'SID/STAR', kSTD: '出発予定', kQUEUE: '待ち順', kDEST: '目的地', kFROM: '出発地',
  viaStar: 'STAR降下', viaSid: 'SID上昇', holdShort: '待機',
  altRow: '高度（ft・QNH）— タップで指示', flRow: 'フライトレベル（転移高度14,000ft以上）', vnavArr: 'STARに従い降下', vnavDep: 'SIDに従い上昇',
  taNote: '転移高度14,000ft／転移レベルFL140（AIP Japan）。転移高度未満はフィートで表示。',
  hdgRow: '方位（磁方位）', turnL: '◀ 左旋回', flyHdg: 'この方位へ', turnR: '右旋回 ▶', presentHdg: '現在方位を維持', tapVector: '⌖ 地図タップで誘導',
  tapVectorOn: '地図をタップするとその地点へ誘導します', tapVectorOff: '誘導モード解除', resumeNav: '自機航法に復帰', orbitRow: '360度旋回', orbitL: '左360', orbitR: '右360',
  spdRow: '指示対気速度（kt）', resumeSpd: '通常速度に戻す', maintainSpd: '現在速度を維持',
  spdNote: '最小クリーン速度 約{vmin}kt・最終進入 {vapp}kt。JCABのジェット機最低指示速度：20NM以遠210kt、20NM以内170kt。管制圏・進入管制区の10,000ft以下は最大250kt。',
  routeRow: '経路（現在区間を色表示）— {proc}', directRow: '直行', holdRow: '待機（公示方式・右旋回）', exitHold: '待機終了', rerouteRow: 'STARの変更',
  lrwyRow: '着陸滑走路（順位再設定）', apprRow: '進入', clearedApp: '{app} 進入許可', cancelApp: '進入許可取消', goAround: 'ゴーアラウンド', expedite: '速やかに降下',
  appNote: 'レーダー誘導中の機は進入許可後にローカライザーに会合します。手動許可モードで担当していない限り、通常の進入許可は自動で発出されます。',
  depNote: '出発機 — 進入関連の指示は到着機で使用できます。', emergRow: '緊急事態', declareEmerg: '緊急事態宣言（7700）', cancelEmerg: '緊急事態を解除',
  gndRow: '地上管制', approvePush: 'プッシュバック承認', delayPush: 'プッシュバック待機', release: '解除', approveTaxi: '滑走路まで走行', holdPosition: 'その場で停止', continueTaxi: '走行継続', taxiToSpot: 'スポットへ走行',
  towerRow: '飛行場管制', luaw: '進入して待機', clrTakeoff: '離陸許可', holdShortManual: '滑走路手前で待機', releaseAuto: '自動に戻す', clrLand: '着陸許可',
  depRwyRow: '出発滑走路', taxiRoute: '走行経路：{r}', climbTo: '{alt}へ上昇',
  schedule: '運航：{flight} {from}→{to} {std} {time} JST · {reg}実在便（FR24 2026-10-11）', overflight: '上空通過：{flight} {from}→{to} · {reg}実在便（FR24 2026-10-11）、経路は大圏で近似',
  destOrigin: '目的地：{dest} · 出発地：{orig}', cruiseUnit: '巡航 {alt} · 担当：{unit} {freq}', returnAuto: '自動管制に戻す',
  monitorOnly: '{unit} の担当機 — 監視のみ。管制席を切り替えるか全体管制で操作できます。', minimized: 'タップで展開',
  arr: '到着', dep: '出発', log: '記録', noArrivals: '飛行中の到着機はありません。', onGroundArrived: '到着済み（地上）：{list}',
  secLanguage: '表示言語', secRadioLang: '無線交信の言語', radioNote: '日本の航空会社便の交信は英語が標準です。日本語の交信文は参考・練習用です。',
  secTheme: '地図テーマ', themeDark: 'ダーク', themeLight: 'ライト', secDisplay: '機体の表示',
  modeRealistic: 'リアル ✈', modeRadar: 'レーダー（上級）', modeSimple: 'シンプル', modeBeginner: '初心者',
  modeNote: 'リアル：機首方位を示す機体シルエット。レーダー：ARTS風のシンボルとデータブロック。シンプル：最小限のラベルと地図。初心者：大きなアイコン、わかりやすいラベル、凡例と解説。',
  secWind: '風と滑走路運用', windLine: '{ap} — 風 {dir}°/{spd}kt — {cfg}{lock}', locked: '（固定）', unlock: '固定解除（風で自動）', autoWind: '風で自動選択', rwyClosure: '滑走路閉鎖', closed: '閉鎖中',
  secAbnormal: '異常事態', addCb: '積乱雲を追加（地図をタップ）', clearWx: '気象をクリア', randomEmerg: 'ランダムに緊急事態',
  secTraffic: '交通量', trafficNote: '2026年10月11日の実際の運航（KIX/HND/NRT/ITM/UKBの全便、Flightradar24の空港発着情報）と、他の31空港の発着情報から抽出した650便以上の実在の上空通過便（国内線、アジア〜北米線、貨物便）。密度を下げると便を均等に間引きます。',
  restartAt: '指定時刻から再開（JST）', layers: '地図レイヤー', trails: '航跡', fixes: 'フィックス', procs: 'SID/STAR', airways: '航空路', rings: '距離環', sweep: '4秒レーダー更新', bounds: '管轄境界',
  labelSize: 'ラベルの大きさ', resetLabels: 'ラベル位置をリセット', secHelp: '使い方', tutorial: 'チュートリアルを表示',
  help1: '機体（またはラベル）をタップして選択します。選択中のラベルはドラッグで移動できます。1本指で移動、2本指で拡大縮小。「表示」で広域・ターミナル・進入・空港を切り替えます。ズームは連続的で、すべての機体はどの表示でも飛行を続けます。',
  help2: '「管制席」で実在の管制席（グランド、タワー、アプローチ、コントロール）を1つ担当できます。担当機は「無線」パネルでリクエストしてきます。それ以外は自動管制で動き続けます。',
  help3: '黄色＝コンフリクト予測（STCA、2分以内）、赤＝管制間隔の欠如（ターミナル3NM／航空路5NM、垂直1,000ft）。フィルタは表示だけを変えます。非表示の機体も飛行を続け、監視されています。',
  secData: 'データとリアリティについて',
  dataVerified: '検証済み：KIX・ITM・UKB・HND・NRTのAIP Japan方式（STAR/SID/進入のフィックスと制限）、滑走路末端（AIP/OSM）、滑走路運用（国土交通省/JCAB）、管制間隔と速度規則（管制業務処理規程）、航空会社コールサインと国際線・貨物便・ビジネス機を含む実際の全便スケジュール、実在の上空通過便。',
  dataApprox: '近似：機体性能（代表値）、風モデル、運用内での滑走路割当、スポット割当、航空路の点順（コミュニティデータ）、LDA/視認進入はILSで代替、羽田夜間運用、ターミナル/セクター境界と一部周波数、上空通過便の経路（大圏）と進入時刻。',
  source: 'GitHubのソース',
  posTitle: '管制席', posGlobalDesc: 'すべてを管制（標準）', grpGround: 'グランド（地上管制）', grpTower: 'タワー（飛行場管制）', grpApproach: 'アプローチ／ディパーチャー（進入管制）', grpArea: '航空路管制（ACC）',
  manualClr: '手動許可', manualClrDesc: '担当席の定常許可（プッシュバック・走行・離陸・着陸・進入・上昇）をあなたが発出します。オフ＝自動管制が補助し、必要時に介入。',
  dimOthers: '担当外の機体を薄く表示', posNote: '管轄はJCABの運用に準拠：グランド＝スポットと誘導路、タワー＝滑走路と空港周辺約6〜8NM、アプローチ＝約16,000ft以下のターミナル空域、コントロール＝航空路（東京/神戸＝下層、福岡＝上層FL335以上）。境界は近似です。',
  nAircraft: '{n}機',
  commsTitle: '無線', commsMine: '担当席', commsAll: '全管制機関', requests: 'リクエスト', noRequests: '保留中のリクエストはありません',
  reqPUSH: 'プッシュバック要求', reqTAXI: '走行要求', reqDEPART: '出発準備完了', reqLAND: '着陸許可', reqAPP: '進入許可', reqCLIMB: '上昇要求', reqTAXIIN: 'スポットへの走行',
  atcLbl: '管制', pltLbl: 'パイロット', commsEmpty: 'まだ交信はありません。',
  filterTitle: '表示フィルタ', fAirport: '空港', fAll: 'すべて', fRelation: '空港との関係', fAny: 'すべて', fArrTo: '到着', fDepFrom: '出発', fInArea: '空港の空域内',
  fTraffic: '交通', fArrivals: '到着機', fDepartures: '出発機', fOverflights: '上空通過', fState: '状態', fAirborne: '飛行中', fGround: '地上',
  fUnit: '管制機関', fMine: '担当席', fAlerts: '警報機のみ', fSearch: '航空会社・便名・機種…', fReset: '全機を表示', fActive: 'フィルタ中・{n}機非表示', fNote: 'フィルタは表示だけを変更します。非表示の機体も飛行・自動管制・STCA監視を継続します。',
  wxPlaced: '積乱雲を配置しました', wxCleared: '気象をクリアしました', tapWx: '地図をタップして積乱雲を配置', returnedAuto: '{cs} を自動管制に戻しました', rwyNA: 'その滑走路は使用できません', rwyClosedT: '滑走路閉鎖中',
  notYours: '{cs} は {unit} の担当です（担当外）', posSet: '管制席：{pos}', posGlobal: '全体管制（全機）',
  legArr: '到着機', legDep: '出発機', legOvf: '上空通過', legGnd: '地上', legAlert: '要注意', legend: '凡例',
  plainStca: '⚠ {a} と {b} が約{t}秒後に接近しすぎる可能性があります。どちらかの高度か方位を変えてください。', plainLos: '⛔ {a} と {b} が接近しすぎています（{dh}NM・{dv}ft）。すぐに間隔を空けてください！',
  bTo: '行き', bFrom: '発', bClimb: '上昇中', bDesc: '降下中', bLevel: '水平',
  tutNext: '次へ', tutDone: '開始', tutSkip: 'スキップ',
  tut1t: 'JP ATC Simへようこそ', tut1b: '実在の日本の空域（関西・関東）と、実際の1日分の便。定常の交通は自動管制が処理し、いつでもあなたが引き継げます。',
  tut2t: '選択して指示', tut2b: '機体をタップするとパネルが開きます。方位・高度・速度を指示すると、パイロットが無線で復唱します。「自動管制に戻す」で返却できます。',
  tut3t: '実在の管制席を担当', tut3b: '「管制席」から東京グランドや関西タワーなどを選びます。担当機は「無線」パネルでリクエストしてきます。',
  tut4t: '安全第一', tut4b: '黄色の線はコンフリクト予測、赤は間隔欠如です。フィルタで注目する機体を絞り込み、メニュー → 機体の表示 →「初心者」でわかりやすい表示にできます。',
  ph_PARKED: 'スポット', ph_PUSHBACK: 'プッシュバック', ph_STARTUP: 'エンジン始動', ph_TAXI_OUT: '出発走行', ph_HOLD_SHORT: '滑走路手前待機', ph_LINEUP: '滑走路進入', ph_LINED_UP: '滑走路上待機', ph_TAKEOFF: '離陸滑走',
  ph_CLIMB: '上昇', ph_CRUISE: '巡航', ph_DESCENT: '降下', ph_APPROACH: '進入', ph_FINAL: '最終進入', ph_GOAROUND: 'ゴーアラウンド', ph_ROLLOUT: '着陸滑走', ph_TAXI_IN: '到着走行', ph_OVERFLIGHT: '上空通過',
};

// Event log templates
const EV = {
  en: {
    cfgChanged: '{ap}: runway configuration changed to {cfg}', cfgSet: '{ap}: runway configuration set to {cfg}', leftArea: '{cs} left the simulation area — handed off', rolling: '{cs} rolling RWY {rwy}',
    onStand: '{cs} on spot {spot}', noTaxiRoute: '{cs}: no taxi route from spot {spot}', noTaxi: '{cs}: taxi route unavailable', pushback: '{cs} pushback approved, RWY {rwy}',
    taxiOut: '{cs} taxi to holding point RWY {rwy} {via}', airborne: '{cs} airborne RWY {rwy}, {sid}', landed: '{cs} landed RWY {rwy}', goAround: '{cs} GO AROUND RWY {rwy} ({reason})',
    inbound: '{cs} inbound {ap}, {star}', appClr: '{cs} cleared {app} approach', hold: '{cs} holding at {fix} (delay {min} min)', orbit: '{cs} 360 for spacing behind {lead}',
    toClr: '{cs} RWY {rwy} cleared for take-off', luaw: '{cs} RWY {rwy} line up and wait', los: 'SEPARATION LOSS {a} / {b} {dh} NM {dv} ft', stca: 'STCA {a} / {b} in {t}s',
    emergency: 'MAYDAY {cs} — {nature}', emergencyOff: '{cs} emergency cancelled', rwyClosed: '{ap} RWY {rwy} CLOSED', rwyOpen: '{ap} RWY {rwy} reopened', wx: 'Thunderstorm cell reported, tops FL{fl}',
    cmd: '→ {cs}: {text}', entered: '{cs} entered the area ({from}→{to})', handedOver: '{cs} handed over for approach to {to} (not simulated)',
  },
  ja: {
    cfgChanged: '{ap}：滑走路運用を「{cfgJa}」に変更', cfgSet: '{ap}：滑走路運用を「{cfgJa}」に設定', leftArea: '{cs} がシミュレーション範囲外へ（移管）', rolling: '{cs} 滑走路{rwy}で離陸滑走開始',
    onStand: '{cs} スポット{spot}に到着', noTaxiRoute: '{cs}：スポット{spot}からの走行経路なし', noTaxi: '{cs}：走行経路を作成できません', pushback: '{cs} プッシュバック承認（滑走路{rwy}）',
    taxiOut: '{cs} 滑走路{rwy}の待機点へ走行 {via}', airborne: '{cs} 滑走路{rwy}から離陸、{sid}', landed: '{cs} 滑走路{rwy}に着陸', goAround: '{cs} ゴーアラウンド 滑走路{rwy}（{reason}）',
    inbound: '{cs} {ap}へ到着経路、{star}', appClr: '{cs} {app}進入許可', hold: '{cs} {fix}で待機（遅延{min}分）', orbit: '{cs} {lead}との間隔調整のため360度旋回',
    toClr: '{cs} 滑走路{rwy} 離陸許可', luaw: '{cs} 滑走路{rwy} 進入して待機', los: '管制間隔欠如 {a} / {b} {dh}NM {dv}ft', stca: 'STCA {a} / {b} {t}秒後',
    emergency: 'メーデー {cs} — {nature}', emergencyOff: '{cs} 緊急事態解除', rwyClosed: '{ap} 滑走路{rwy} 閉鎖', rwyOpen: '{ap} 滑走路{rwy} 再開', wx: '積乱雲を観測、雲頂FL{fl}',
    cmd: '→ {cs}：{text}', entered: '{cs} が範囲内に進入（{from}→{to}）', handedOver: '{cs} {to}への進入のため移管（非シミュレーション空港）',
  },
};
const REASON_JA = { 'runway occupied': '滑走路占有', spacing: '間隔不足', 'not established': '進入未確立', 'unstable (high)': '不安定進入（高い）', 'runway closed': '滑走路閉鎖', 'no landing clearance': '着陸許可なし', 'ATC instruction': '管制指示' };
const NATURE_JA = { 'engine failure, requesting return': 'エンジン故障、引き返しを要求', 'medical emergency, requesting priority': '急病人発生、優先着陸を要求' };

let lang = 'en';
try { lang = localStorage.getItem('atc.lang') || ((navigator.language || 'en').startsWith('ja') ? 'ja' : 'en'); } catch { /* no storage (node) */ }
export const getLang = () => lang;
export function setLang(l) { lang = l === 'ja' ? 'ja' : 'en'; try { localStorage.setItem('atc.lang', lang); } catch { /* ignore */ } }

const fill = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? ''));
export function t(k, p = {}) { const d = lang === 'ja' ? JA : EN; const s = d[k] ?? EN[k]; return s == null ? k : fill(s, p); }
export function phase(ph) { return t('ph_' + ph); }
export function fmtEvent(l, k, p = {}) {
  const d = EV[l] || EV.en;
  const s = d[k];
  if (!s) return k;
  let q = p;
  if (l === 'ja') {
    q = { ...p };
    if (p.reason) { const key = Object.keys(REASON_JA).find((r) => p.reason.startsWith(r)); if (key) q.reason = REASON_JA[key] + p.reason.slice(key.length); }
    if (p.nature && NATURE_JA[p.nature]) q.nature = NATURE_JA[p.nature];
  }
  return fill(s, q);
}
export const evText = (e) => (e.k ? fmtEvent(lang, e.k, e.p || {}) : e.msg);
export const DICTS = { EN, JA };
