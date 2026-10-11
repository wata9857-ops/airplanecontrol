// Touch UI: view switching, aircraft selection, command panel, flight strips,
// event log, scenario menu. Designed for iPad first (44 px targets, no hover).
import { VIEWS } from './camera.js';
import { fmtAlt, pad3, bearing, trueToMag, dist, toXY, norm360 } from '../geo.js';
import { PERF } from '../sim/performance.js';
import { commands } from './commands.js';

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(k));
  return e;
};

const SPEEDS = [1, 2, 4, 8];

export class UI {
  constructor(world, renderer, cam, data) {
    this.w = world; this.r = renderer; this.cam = cam; this.data = data;
    this.paused = false; this.speed = 1; this.sel = null; this.tab = 'ALT';
    this.mode = null; // 'vector' | 'wx'
    this.cmd = commands(world, this);
    this.listTab = 'ARR'; this.listAirport = 'RJBB';
    this.hdgDraft = null; this.altDraft = null;
    this.buildTopbar();
    this.bindCanvas();
    this.buildMenu();
    this.t = 0; this.lastPanel = 0;
  }

  // ---------------- top bar ----------------
  buildTopbar() {
    const g = $('#areaBtns');
    let lvl = 0;
    for (const v of VIEWS) {
      if (v.level !== lvl) { if (lvl) g.append(h('span', { class: 'sep' })); lvl = v.level; }
      const b = h('button', { 'data-v': v.id, title: v.label, onclick: () => this.setView(v) }, v.label);
      g.append(b);
    }
    const vm = $('#viewMenu');
    const LV = { 1: 'Level 1 — wide area / 広域', 2: 'Level 2 — terminal', 3: 'Level 3 — approach', 4: 'Level 4 — airport' };
    let l2 = 0;
    for (const v of VIEWS) {
      if (v.level !== l2) { vm.append(h('div', { class: 'lv' }, LV[v.level])); l2 = v.level; }
      vm.append(h('button', { 'data-v': v.id, onclick: () => { this.setView(v); vm.classList.add('hidden'); } }, v.label));
    }
    $('#btnView').onclick = () => vm.classList.toggle('hidden');
    $('#btnPause').onclick = () => { this.paused = !this.paused; $('#btnPause').textContent = this.paused ? '▶' : '❚❚'; $('#btnPause').classList.toggle('warn', this.paused); };
    $('#btnSpeed').onclick = () => { this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]; $('#btnSpeed').textContent = '×' + this.speed; };
    $('#btnLists').onclick = () => this.toggleLists();
    $('#btnAlerts').onclick = () => { this.listTab = 'LOG'; this.toggleLists(true); };
    $('#btnMenu').onclick = () => $('#menu').classList.toggle('hidden');
    $('#zIn').onclick = () => this.cam.zoomAt(this.cam.w / 2, this.cam.h / 2, 1.6);
    $('#zOut').onclick = () => this.cam.zoomAt(this.cam.w / 2, this.cam.h / 2, 1 / 1.6);
  }
  setView(v, animate = true) {
    this.cam.goto(v, animate);
    this.view = v;
    if (v.airport) this.listAirport = v.airport;
    else if (/KANSAI/.test(v.id)) this.listAirport = 'RJBB';
    else if (/KANTO/.test(v.id)) this.listAirport = 'RJTT';
    document.querySelectorAll('#areaBtns button, #viewMenu button').forEach((b) => b.classList.toggle('on', b.dataset.v === v.id));
    const bv = $('#btnView'); if (bv) bv.textContent = v.label + ' ▾';
  }

  toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------------- canvas input (pointer events: touch + mouse + pencil) ----------------
  bindCanvas() {
    const cv = $('#radar');
    const pts = new Map();
    let gesture = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e); pts.set(e.pointerId, p);
      if (pts.size === 1) {
        const lab = this.r.pickLabel(p.x, p.y);
        gesture = { type: 'tap', start: p, last: p, t: performance.now(), label: lab && lab.ac === this.sel ? lab : null };
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pos(e); pts.set(e.pointerId, p);
      if (!gesture) return;
      if (gesture.type === 'pinch' && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.cam.pan(c.x - gesture.c.x, c.y - gesture.c.y);
        this.cam.zoomAt(c.x, c.y, d / gesture.d);
        gesture.d = d; gesture.c = c;
      } else if (gesture.type === 'tap' || gesture.type === 'pan' || gesture.type === 'label') {
        const moved = Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y);
        if (gesture.type === 'tap' && moved > 8) gesture.type = gesture.label ? 'label' : 'pan';
        if (gesture.type === 'pan') this.cam.pan(p.x - gesture.last.x, p.y - gesture.last.y);
        if (gesture.type === 'label') {
          const ac = gesture.label.ac;
          const o = this.r.labelOffsets.get(ac.id) || { dx: gesture.label.box.x + 4 - gesture.label.x, dy: gesture.label.box.y + 4 - gesture.label.y };
          this.r.labelOffsets.set(ac.id, { dx: o.dx + p.x - gesture.last.x, dy: o.dy + p.y - gesture.last.y });
        }
        gesture.last = p;
      }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (gesture && gesture.type === 'tap' && pts.size === 0) this.onTap(p);
      if (pts.size === 0) gesture = null;
      else if (gesture?.type === 'pinch') gesture = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); this.cam.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    // prevent iOS double-tap zoom / gesture events
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  onTap(p) {
    if (this.mode === 'vector' && this.sel) {
      const wx = this.cam.wx(p.x), wy = this.cam.wy(p.y);
      const brg = bearing(this.sel, { x: wx, y: wy });
      const ll = this.sel.latlon;
      const mag = Math.round(trueToMag(brg, ll.lat, ll.lon) / 5) * 5 || 360;
      this.cmd.heading(this.sel, mag, 0);
      this.mode = null; this.renderPanel(true);
      return;
    }
    if (this.mode === 'wx') {
      const c = { x: this.cam.wx(p.x), y: this.cam.wy(p.y), r: 7 + Math.random() * 6, top: 38000 + Math.floor(Math.random() * 8) * 1000 };
      this.w.weatherCells.push(c);
      this.w.log(`Thunderstorm cell reported, tops FL${c.top / 100}`, 'warn');
      this.mode = null; this.toast('CB cell placed');
      return;
    }
    const ac = this.r.pick(p.x, p.y);
    this.select(ac);
  }

  select(ac) {
    this.sel = ac || null;
    this.r.selected = this.sel;
    this.hdgDraft = null; this.altDraft = null; this.mode = null;
    if (this.sel) { this.tab = this.sel.onGround ? 'GND' : 'ALT'; }
    this.renderPanel(true);
  }

  // ---------------- aircraft panel ----------------
  renderPanel(rebuild = false) {
    const P = $('#panel');
    const ac = this.sel;
    if (!ac || !this.w.aircraft.includes(ac)) { P.classList.add('hidden'); this.sel = null; this.r.selected = null; return; }
    P.classList.remove('hidden');
    if (rebuild || this.panelFor !== ac.id || this.panelTab !== this.tab || this.panelGround !== ac.onGround || this.panelPhase !== ac.phase && ac.onGround) {
      this.panelFor = ac.id; this.panelTab = this.tab; this.panelGround = ac.onGround; this.panelPhase = ac.phase;
      P.innerHTML = '';
      const al = this.data.schedule.airlines.find((a) => a.icao === ac.airline);
      const pf = PERF[ac.type];
      P.append(h('div', { class: 'ph' },
        h('div', {}, h('div', { class: 'cs' }, ac.callsign), h('div', { class: 'sub' }, `${al ? al.name : ac.airline} ${ac.flight} · “${radioName(ac, this.data)}”`)),
        h('div', { class: 'sub' }, `${ac.type} ${pf ? pf.name : '(perf approx A320)'} · ${ac.wake}`, h('br'), `${this.iata(ac.from)} → ${this.iata(ac.to)} · SQ ${ac.squawk}`),
        h('button', { class: 'x', onclick: () => this.select(null) }, '✕')));
      const tabs = ac.onGround ? ['GND', 'INFO'] : ['ALT', 'HDG', 'SPD', 'ROUTE', 'APP', 'INFO'];
      if (!tabs.includes(this.tab)) this.tab = tabs[0];
      P.append(h('div', { class: 'tabs' }, tabs.map((t) => h('button', { class: t === this.tab ? 'on' : '', onclick: () => { this.tab = t; this.renderPanel(true); } }, t))));
      this.kvEl = h('div', { class: 'kv' });
      const body = h('div', { class: 'pbody' }, this.kvEl);
      body.append(this.tabBody(ac));
      P.append(body);
    }
    this.updateKV(ac);
  }

  iata(icao) { return this.data.iata[icao] || icao; }

  updateKV(ac) {
    const unit = this.cmd.unitFor(ac);
    const items = ac.onGround ? [
      ['PHASE', ac.phase.replace('_', ' ')], ['GS', Math.round(ac.gs) + 'kt'], ['STAND', ac.stand?.ref || '—'], ['RWY', ac.dir === 'DEP' ? ac.depRwy?.id : ac.arrRwy?.id],
      ['SID/STAR', ac.dir === 'DEP' ? ac.sidName : ac.starName], ['STD', ac.sched?.timeLocal || '—'], ['QUEUE', ac.dir === 'DEP' ? this.queuePos(ac) : '—'], ['UNIT', unit.name],
    ] : [
      ['ALT', fmtAlt(ac.alt)], ['CLR', ac.hold?.level != null && !ac.manual.alt ? fmtAlt(ac.hold.level) + ' HLD' : ac.vnav && !ac.manual.alt ? (ac.dir === 'ARR' ? 'VIA STAR' : 'VIA SID') : fmtAlt(ac.clearedAlt), true], ['VS', (ac.vs > 0 ? '+' : '') + Math.round(ac.vs / 100) * 100], ['HDG', pad3(ac.magHdg)],
      ['ASG HDG', ac.lat.mode === 'HDG' ? pad3(ac.assignedMagHdg) : ac.lat.mode === 'HOLD' ? 'HOLD' : ac.lat.mode, true], ['IAS', Math.round(ac.ias)], ['ASG SPD', ac.atcSpd ? ac.atcSpd : ac.autoSpd ? 'a' + ac.autoSpd : '—', true], ['GS', Math.round(ac.gs)],
      ['PHASE', ac.phase], ['RWY', ac.arrRwy?.id || ac.depRwy?.id || '—'], ['SEQ/DLY', ac.dir === 'ARR' && ac.seq ? `#${ac.seq} ${Math.round((ac.delay || 0) / 60)}m` : '—'], ['UNIT', unit.name],
    ];
    this.kvEl.innerHTML = '';
    for (const [k, v, asg] of items) this.kvEl.append(h('div', {}, h('b', {}, k), h('span', { class: asg ? 'asg' : '' }, v ?? '—')));
    if (this.routeEl) this.routeEl.innerHTML = this.routeHtml(ac);
    if (this.hdgBig) this.hdgBig.textContent = pad3(this.hdgDraft ?? Math.round(ac.magHdg / 5) * 5);
  }

  queuePos(ac) { const q = ac.depRwy?.airport.depQueue || []; const i = q.indexOf(ac); return i >= 0 ? `#${i + 1}` : '—'; }

  routeHtml(ac) {
    return ac.route.map((w, i) => {
      if (i < ac.routeIdx) return '';
      const cls = i === ac.routeIdx ? 'act' : w.kind === 'VEC' ? 'vec' : '';
      const c = w.altMin != null && w.altMin === w.altMax ? '@' + fmtAlt(w.altMin) : [w.altMin != null ? 'A' + fmtAlt(w.altMin) : '', w.altMax != null ? 'B' + fmtAlt(w.altMax) : ''].filter(Boolean).join('');
      return `<span class="${cls}">${w.id}${c ? '<small>/' + c + '</small>' : ''}${w.spd ? '<small>/' + w.spd + 'K</small>' : ''}</span>`;
    }).filter(Boolean).join(' › ');
  }

  tabBody(ac) {
    const C = this.cmd;
    const frag = document.createDocumentFragment();
    const row = (label, ...btns) => h('div', { class: 'row' }, label ? h('label', {}, label) : null, ...btns);
    const btn = (t, fn, cls = '') => h('button', { class: cls, onclick: () => { fn(); this.renderPanel(true); } }, t);
    this.routeEl = null; this.hdgBig = null;

    if (this.tab === 'ALT') {
      const cur = ac.clearedAlt;
      const alts = [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000];
      const fls = [150, 170, 190, 210, 230, 250, 270, 290, 310, 330, 350, 370, 390, 410];
      frag.append(row('Altitude (ft, QNH) — tap to clear', ...alts.map((a) => btn(a >= 10000 ? (a / 1000) + 'k' : String(a), () => C.altitude(ac, a), a === cur ? 'on' : ''))));
      frag.append(row('Flight level (above TA 14,000 ft)', ...fls.map((f) => btn('FL' + f, () => C.altitude(ac, f * 100), f * 100 === cur ? 'on' : ''))));
      frag.append(row('', btn('+1000', () => C.altitude(ac, cur + 1000)), btn('−1000', () => C.altitude(ac, Math.max(1000, cur - 1000))),
        btn(ac.dir === 'ARR' ? 'DESCEND VIA STAR' : 'CLIMB VIA SID', () => C.via(ac), ac.vnav ? 'on' : '')));
      frag.append(h('div', { class: 'note' }, 'Transition altitude 14,000 ft / transition level FL140 (Japan AIP). Altitudes below the TA are shown in feet.'));
    }
    if (this.tab === 'HDG') {
      this.hdgDraft = this.hdgDraft ?? Math.round(ac.magHdg / 5) * 5;
      this.hdgBig = h('span', { class: 'big' }, pad3(this.hdgDraft));
      const adj = (d) => { this.hdgDraft = norm360(this.hdgDraft + d) || 360; this.hdgBig.textContent = pad3(this.hdgDraft); };
      frag.append(row('Heading (magnetic)', h('button', { onclick: () => adj(-30) }, '−30'), h('button', { onclick: () => adj(-10) }, '−10'), h('button', { onclick: () => adj(-5) }, '−5'), this.hdgBig,
        h('button', { onclick: () => adj(5) }, '+5'), h('button', { onclick: () => adj(10) }, '+10'), h('button', { onclick: () => adj(30) }, '+30')));
      frag.append(row('', btn('◀ TURN LEFT', () => C.heading(ac, this.hdgDraft, -1)), btn('FLY HDG', () => C.heading(ac, this.hdgDraft, 0), 'on'), btn('TURN RIGHT ▶', () => C.heading(ac, this.hdgDraft, 1))));
      frag.append(row('', btn('PRESENT HDG', () => C.heading(ac, Math.round(ac.magHdg), 0)),
        h('button', { class: this.mode === 'vector' ? 'warn' : '', onclick: () => { this.mode = this.mode === 'vector' ? null : 'vector'; this.toast(this.mode ? 'Tap the map to vector toward that point' : 'Vector mode off'); this.renderPanel(true); } }, '⌖ TAP-TO-VECTOR'),
        btn('RESUME OWN NAV', () => C.resumeNav(ac))));
      frag.append(row('Orbit / hold', btn('ORBIT LEFT', () => C.orbit(ac, -1)), btn('ORBIT RIGHT', () => C.orbit(ac, 1))));
    }
    if (this.tab === 'SPD') {
      const sp = [160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320];
      frag.append(row('Indicated airspeed (kt)', ...sp.map((s) => btn(String(s), () => C.speed(ac, s), ac.atcSpd === s ? 'on' : ''))));
      frag.append(row('', btn('RESUME NORMAL SPEED', () => C.speed(ac, null)), btn('MAINTAIN PRESENT', () => C.speed(ac, Math.round(ac.ias / 10) * 10))));
      frag.append(h('div', { class: 'note' }, `Min clean ~${ac.perf.vmin} kt · final ${ac.perf.vapp} kt. JCAB minimums for jets: 210 kt beyond 20 NM, 170 kt within 20 NM. 250 kt max at or below 10,000 ft in control zones/approach areas.`));
    }
    if (this.tab === 'ROUTE') {
      this.routeEl = h('div', { class: 'route' });
      frag.append(row('Route (active in green) — STAR/SID: ' + (ac.dir === 'ARR' ? ac.starName : ac.sidName) || ''), this.routeEl);
      const fixes = ac.route.slice(ac.routeIdx).filter((w) => w.kind !== 'VEC' && w.kind !== 'FNL' && w.kind !== 'THR' && this.w.fix(w.id));
      frag.append(row('Proceed direct', ...fixes.slice(0, 14).map((w) => btn(w.id, () => C.direct(ac, w.id)))));
      frag.append(row('Hold (as published / right turns)', ...fixes.slice(0, 8).map((w) => btn('HOLD ' + w.id, () => C.hold(ac, w.id))), btn('EXIT HOLD', () => C.exitHold(ac))));
      if (ac.dir === 'ARR') {
        const ap = this.w.airport(ac.to);
        const stars = (this.w.procedures[ac.to]?.stars || []).filter((s) => ac.arrRwy && s.runways.includes(ac.arrRwy.id));
        frag.append(row('Re-route via STAR', ...stars.slice(0, 10).map((s) => btn(s.name.replace(' ARRIVAL', ''), () => C.reroute(ac, s.name)))));
        void ap;
      }
    }
    if (this.tab === 'APP') {
      const ap = this.w.airport(ac.to);
      if (ap && ac.dir === 'ARR') {
        frag.append(row('Landing runway (re-sequence)', ...[...ap.runways.values()].map((r) => btn(r.id, () => C.runway(ac, r.id), ac.arrRwy === r ? 'on' : ''))));
        frag.append(row('Approach', btn(`CLEARED ${ac.appName || 'ILS'}`, () => C.approach(ac), ac.appr?.cleared ? 'on' : ''), btn('CANCEL APP CLR', () => C.cancelApproach(ac))));
        frag.append(row('', btn('GO AROUND', () => C.goAround(ac), 'danger'), btn('EXPEDITE', () => C.expedite(ac))));
        frag.append(h('div', { class: 'note' }, 'Vectored aircraft intercept the localiser when cleared. Automation clears routine approaches; manual heading cancels automatic clearance.'));
      } else frag.append(h('div', { class: 'note' }, 'Departure — approach options become available for arrivals.'));
      frag.append(row('Emergency', btn(ac.emergency ? 'CANCEL EMERGENCY' : 'DECLARE EMERGENCY (7700)', () => C.emergency(ac), 'danger')));
    }
    if (this.tab === 'GND') {
      const ph = ac.phase;
      if (ph === 'PARKED' && ac.dir === 'DEP') frag.append(row('Clearance delivery / ground', btn('APPROVE PUSHBACK', () => C.push(ac), 'on'), btn(ac.pushHold ? 'RELEASE' : 'DELAY PUSHBACK', () => C.pushHold(ac))));
      if (['TAXI_OUT', 'TAXI_IN', 'PUSHBACK'].includes(ph)) frag.append(row('Ground', btn(ac.taxi?.hold ? 'CONTINUE TAXI' : 'HOLD POSITION', () => C.holdPos(ac), ac.taxi?.hold ? 'warn' : '')));
      if (ph === 'HOLD_SHORT' || ph === 'LINED_UP') frag.append(row('Tower', btn('CLEARED FOR TAKE-OFF', () => C.takeoff(ac), 'on'), btn(ac.manualHold ? 'RELEASE TO AUTO' : 'HOLD SHORT (manual)', () => C.holdShort(ac))));
      if (ac.dir === 'DEP') {
        const ap = this.w.airport(ac.from);
        frag.append(row('Departure runway', ...this.w.config(ap).dep.concat([...ap.runways.keys()].filter((k) => !this.w.config(ap).dep.includes(k))).map((id) => btn(id, () => C.depRunway(ac, id), ac.depRwy?.id === id ? 'on' : ''))));
      }
      if (ac.taxiNames?.length) frag.append(h('div', { class: 'note' }, 'Taxi route: ' + ac.taxiNames.join(' ')));
    }
    if (this.tab === 'INFO' || this.tab === 'GND') {
      const sc = ac.sched;
      frag.append(h('div', { class: 'note' }, `Schedule: ${ac.flight} ${this.iata(ac.from)}→${this.iata(ac.to)} ${sc?.dir === 'DEP' ? 'STD' : 'STA'} ${sc?.timeLocal ?? '—'} JST · ${sc?.reg ? 'Reg ' + sc.reg + ' · ' : ''}real flight (FR24 board 2026-10-11)`));
      frag.append(h('div', { class: 'note' }, `Destination: ${this.data.airportNames[ac.to] || ac.to} · Origin: ${this.data.airportNames[ac.from] || ac.from}`));
      frag.append(h('div', { class: 'note' }, `Cruise ${fmtAlt(ac.cruiseAlt)} · Unit: ${this.cmd.unitFor(ac).name} ${this.cmd.unitFor(ac).freq || ''}`));
      const msgs = this.w.events.filter((e) => e.ac === ac.id).slice(-8).reverse();
      frag.append(h('div', { class: 'log' }, msgs.map((m) => h('div', { class: m.kind }, `${this.w.clockStr(m.t).slice(0, 5)} ${m.msg}`))));
      frag.append(row('', btn('RETURN TO AUTOMATION', () => C.auto(ac))));
    }
    if (this.tab !== 'ROUTE' && !ac.onGround) { this.routeEl = h('div', { class: 'route' }); frag.append(h('div', { class: 'row' }, h('label', {}, 'Route')), this.routeEl); }
    return frag;
  }

  // ---------------- lists ----------------
  toggleLists(force) {
    const L = $('#lists');
    const show = force ?? L.classList.contains('hidden');
    L.classList.toggle('hidden', !show);
    if (show) this.renderLists(true);
  }
  renderLists(rebuild) {
    const L = $('#lists');
    if (L.classList.contains('hidden')) return;
    if (rebuild || !this.listBody) {
      L.innerHTML = '';
      const aps = ['RJBB', 'RJOO', 'RJBE', 'RJTT', 'RJAA'];
      L.append(h('div', { class: 'tabs' }, aps.map((a) => h('button', { class: a === this.listAirport ? 'on' : '', onclick: () => { this.listAirport = a; this.renderLists(true); } }, this.iata(a)))));
      L.append(h('div', { class: 'tabs' }, ['ARR', 'DEP', 'LOG'].map((t) => h('button', { class: t === this.listTab ? 'on' : '', onclick: () => { this.listTab = t; this.renderLists(true); } }, t)), h('button', { onclick: () => this.toggleLists(false) }, '✕')));
      this.listBody = h('div', { class: 'pbody' });
      L.append(this.listBody);
    }
    const B = this.listBody; B.innerHTML = '';
    const ap = this.w.airport(this.listAirport);
    if (this.listTab === 'ARR') {
      const cfg = this.w.config(ap);
      B.append(h('div', { class: 'note' }, `${ap.iata} ${cfg.name}`));
      const arr = this.w.aircraft.filter((a) => a.to === ap.icao && a.dir === 'ARR' && !a.onGround).sort((a, b) => (a.slot ?? 1e12) - (b.slot ?? 1e12));
      for (const a of arr) B.append(this.strip(a, `${a.arrRwy?.id || ''} #${a.seq || '-'}`, `${(a.starName || '').replace(' ARRIVAL', '')}`, `${fmtAlt(a.alt)} ${Math.round(a.gs)}kt`, a.slot ? `ETA ${this.w.clockStr((this.w.startClock + a.slot) % 86400).slice(0, 5)} +${Math.max(0, Math.round(a.delay / 60))}m` : ''));
      if (!arr.length) B.append(h('div', { class: 'note' }, 'No arrivals airborne.'));
      const ldg = this.w.aircraft.filter((a) => a.to === ap.icao && a.onGround);
      if (ldg.length) B.append(h('div', { class: 'note' }, `On ground (arrived): ${ldg.map((a) => a.callsign).join(' ')}`));
    } else if (this.listTab === 'DEP') {
      const deps = this.w.aircraft.filter((a) => a.from === ap.icao && a.dir === 'DEP' && (a.onGround || dist(a, ap) < 40));
      const order = { LINEUP: 0, LINED_UP: 0, TAKEOFF: 0, HOLD_SHORT: 1, TAXI_OUT: 2, STARTUP: 3, PUSHBACK: 3, PARKED: 4 };
      deps.sort((a, b) => (order[a.phase] ?? -1) - (order[b.phase] ?? -1) || (a.pushAt ?? 0) - (b.pushAt ?? 0));
      for (const a of deps) B.append(this.strip(a, `${a.depRwy?.id || ''} ${a.phase.replace('_', ' ')}`, a.sidName || '', `${this.iata(a.to)} ${a.type}`, a.onGround ? `STD ${a.sched?.timeLocal || ''} ${a.stand ? 'SPOT ' + a.stand.ref : ''}` : fmtAlt(a.alt)));
    } else {
      const ev = this.w.events.slice(-120).reverse();
      B.append(h('div', { class: 'log' }, ev.map((m) => h('div', { class: m.kind, onclick: () => { const a = this.w.byId(m.ac); if (a) this.select(a); } }, `${this.w.clockStr(m.t).slice(0, 5)} ${m.msg}`))));
    }
  }
  strip(a, r1, l2, r2, l3) {
    const alert = this.w.conflicts.alertsFor(a).length || a.emergency;
    return h('div', { class: `strip ${a.dir === 'DEP' ? 'dep' : ''} ${alert ? 'alert' : ''} ${this.sel === a ? 'sel' : ''}`, onclick: () => { this.select(a); if (!a.onGround || this.cam.span < 10) this.centerOn(a); } },
      h('div', { class: 'c' }, a.callsign), h('div', { class: 'r' }, r1), h('div', {}, l2), h('div', { class: 'r' }, r2), l3 ? h('div', { class: 'msg' }, l3) : null);
  }
  centerOn(a) { this.cam.anim = { from: { x: this.cam.x, y: this.cam.y, scale: this.cam.scale }, to: { x: a.x, y: a.y, scale: this.cam.scale }, t: 0, dur: 0.6 }; }

  // ---------------- menu ----------------
  buildMenu() {
    const M = $('#menu');
    const sec = (t) => h('h3', {}, t);
    M.append(h('div', { class: 'row' }, h('button', { onclick: () => M.classList.add('hidden') }, '✕ Close')));
    M.append(sec('Wind & runway configuration'));
    this.cfgBox = h('div');
    M.append(this.cfgBox);
    M.append(sec('Abnormal situations'));
    M.append(h('div', { class: 'row' },
      h('button', { onclick: () => { this.mode = 'wx'; M.classList.add('hidden'); this.toast('Tap the map to place a thunderstorm cell'); } }, 'Add CB cell (tap map)'),
      h('button', { onclick: () => { this.w.weatherCells = []; this.toast('Weather cleared'); } }, 'Clear weather'),
      h('button', { onclick: () => this.cmd.randomEmergency() }, 'Random emergency')));
    M.append(sec('Traffic'));
    M.append(h('div', { class: 'row' }, ...[0.25, 0.5, 0.75, 1].map((d) => h('button', { class: this.w.traffic.density === d ? 'on' : '', onclick: (e) => { this.w.traffic.density = d; e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); } }, `${d * 100}%`))));
    M.append(h('p', {}, 'Traffic is the real schedule of 2026-10-11 (all flights operated at KIX/HND/NRT/ITM/UKB, from Flightradar24 boards). Lower density skips flights evenly.'));
    M.append(h('div', { class: 'row' }, h('label', {}, 'Restart at time (JST)'), ...['06:30', '08:00', '12:00', '16:00', '19:30', '23:00'].map((t) => h('button', { onclick: () => { const u = new URL(location.href); u.searchParams.set('t', t); location.href = u.toString(); } }, t))));
    M.append(sec('Display'));
    const tog = (k, label) => h('button', { class: this.r.opts[k] ? 'on' : '', onclick: (e) => { this.r.opts[k] = !this.r.opts[k]; e.target.classList.toggle('on', this.r.opts[k]); } }, label);
    M.append(h('div', { class: 'row' }, tog('trails', 'Trails'), tog('fixes', 'Fixes'), tog('procs', 'SID/STAR'), tog('airways', 'Airways'), tog('rings', 'Range rings'), tog('radarUpdate', '4 s radar sweep')));
    M.append(h('div', { class: 'row' }, h('label', {}, 'Label size'), ...[0.85, 1, 1.2, 1.4].map((s) => h('button', { onclick: () => { this.r.opts.labelScale = s; } }, `${Math.round(s * 100)}%`)),
      h('button', { onclick: () => this.r.labelOffsets.clear() }, 'Reset labels')));
    M.append(sec('How to use'));
    M.append(h('p', {}, 'Tap an aircraft (or its label) to select. Drag the label of the selected aircraft to move it. One finger pans, two fingers zoom. Level buttons jump between wide area (広域), terminal (関西/関東), approach (KIX/HND/NRT) and airport views — zoom is continuous and all aircraft keep flying in every view.'));
    M.append(h('p', {}, 'Symbols: □ arrival, △ departure. Datablock: callsign / altitude in hundreds of feet + trend + cleared altitude / ground speed ÷10, type, runway & sequence. Cyan line = assigned heading/speed. Amber = STCA prediction, red = separation lost (3 NM terminal / 5 NM enroute, 1,000 ft).'));
    M.append(sec('Data & realism notes'));
    M.append(h('p', {}, 'Verified: AIP Japan procedures (STAR/SID/approach fixes and constraints) for KIX, ITM, UKB, HND, NRT; runway thresholds (AIP/OSM); runway configurations (MLIT/JCAB); separation minima and speed rules (JCAB 管制業務処理規程); airline callsigns and the full real flight schedule.'));
    M.append(h('p', {}, 'Approximations: aircraft performance (typical values), wind model, runway assignment within a configuration, stand allocation, airway point order (community data), LDA/visual approaches replaced by ILS, HND night configurations not modelled.'));
    M.append(h('p', {}, h('a', { href: 'https://github.com/wata9857-ops/airplanecontrol', target: '_blank' }, 'Source on GitHub'), ' · Map: Natural Earth · Airport layouts: © OpenStreetMap contributors (ODbL)'));
    this.renderConfigBox();
  }

  renderConfigBox() {
    const box = this.cfgBox; box.innerHTML = '';
    for (const ap of this.w.airports.values()) {
      const w = this.w.wind[ap.icao];
      const wrap = h('div', { class: 'row' }, h('label', {}, `${ap.iata} — wind ${pad3(w.dir)}°/${w.spd}kt — ${this.w.config(ap).name}${ap.configLocked ? ' (locked)' : ''}`));
      for (const d of [0, 45, 90, 135, 180, 225, 270, 315]) wrap.append(h('button', { class: Math.abs(((w.dir - d + 540) % 360) - 180) < 23 ? 'on' : '', onclick: () => { w.dir = d || 360; this.w.autoSelectConfig(ap); this.renderConfigBox(); } }, `${pad3(d || 360)}`));
      for (const s of [5, 15, 25]) wrap.append(h('button', { class: w.spd === s ? 'on' : '', onclick: () => { w.spd = s; this.w.autoSelectConfig(ap); this.renderConfigBox(); } }, `${s}kt`));
      box.append(wrap);
      const cfgRow = h('div', { class: 'row' });
      ap.configs.forEach((c, i) => cfgRow.append(h('button', { class: i === ap.configIdx ? 'on' : '', onclick: () => { ap.configLocked = true; if (ap.configIdx !== i) { ap.configIdx = i; this.w.log(`${ap.iata}: runway configuration set to ${c.name}`, 'warn'); this.w.automation.onConfigChange(ap); } this.renderConfigBox(); } }, c.name.split(' — ')[0] + (c.name.split(' — ')[1] ? ' ' + c.name.split(' — ')[1] : ''))));
      cfgRow.append(h('button', { class: ap.configLocked ? 'warn' : '', onclick: () => { ap.configLocked = !ap.configLocked; this.w.autoSelectConfig(ap); this.renderConfigBox(); } }, ap.configLocked ? 'Unlock (auto by wind)' : 'Auto by wind'));
      box.append(cfgRow);
      const rw = h('div', { class: 'row' }, h('label', {}, 'Runway closure'));
      const seenPair = new Set();
      for (const r of ap.runways.values()) {
        const k = [r.id, r.opp].sort().join('/'); if (seenPair.has(k)) continue; seenPair.add(k);
        rw.append(h('button', { class: r.closed ? 'danger' : '', onclick: () => { this.cmd.toggleRunway(ap, r); this.renderConfigBox(); } }, `${k}${r.closed ? ' CLOSED' : ''}`));
      }
      box.append(rw);
    }
  }

  // ---------------- periodic ----------------
  tick(dt) {
    this.t += dt;
    $('#clock').textContent = this.w.clockStr();
    $('#alertCount').textContent = this.w.conflicts.list.length;
    $('#btnAlerts').classList.toggle('danger', this.w.conflicts.list.some((c) => c.level === 'LOS'));
    $('#btnAlerts').classList.toggle('warn', this.w.conflicts.list.length > 0);
    const s = this.w.stats;
    $('#levelBadge').textContent = `L${this.cam.level} · ${this.cam.span.toFixed(this.cam.span < 10 ? 1 : 0)} NM · ${this.w.aircraft.filter((a) => !a.onGround).length} airborne · LDG ${s.arrivals} DEP ${s.departures} GA ${s.goArounds} LOS ${s.losses}`;
    if (this.t - this.lastPanel > 0.5) {
      this.lastPanel = this.t;
      this.renderPanel(false);
      if (Math.floor(this.t) % 2 === 0) this.renderLists(false);
      if (this.sel && this.sel.remove) this.select(null);
    }
  }
}

export function radioName(ac, data) {
  const al = data.schedule.airlines.find((a) => a.icao === ac.airline);
  const num = ac.callsign.replace(/^[A-Z]{3}/, '');
  if (!al?.telephony) return ac.callsign;
  const tel = al.telephony.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return `${tel} ${num}`;
}
