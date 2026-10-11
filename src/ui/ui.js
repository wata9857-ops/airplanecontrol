// Touch UI: views, ATC positions, radio panel, filters, aircraft command panel,
// flight strips, settings, tutorial. iPad first (44 px targets, no hover);
// every extra panel is collapsible so the map can always go (near) full screen.
import { VIEWS } from './camera.js';
import { fmtAlt, pad3, bearing, trueToMag, dist, norm360 } from '../geo.js';
import { PERF } from '../sim/performance.js';
import { POSITIONS, POS, unitOf, posName } from '../sim/positions.js';
import { callsignSpoken } from '../sim/radio.js';
import { commands } from './commands.js';
import { t, getLang, setLang, phase, evText } from '../i18n.js';

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(k));
  return e;
};
const SPEEDS = [1, 2, 4, 8];
const AIRPORTS = ['RJBB', 'RJOO', 'RJBE', 'RJTT', 'RJAA'];
const store = {
  get(k, d) { try { const v = localStorage.getItem('atc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('atc.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export class UI {
  constructor(world, renderer, cam, data) {
    this.w = world; this.r = renderer; this.cam = cam; this.data = data;
    this.paused = false; this.speed = 1; this.sel = null; this.tab = 'ALT';
    this.mode = null; // 'vector' | 'wx'
    this.listTab = 'ARR'; this.listAirport = 'RJBB';
    this.hdgDraft = null;
    this.drawerMode = null; // 'lists' | 'pos' | 'filter'
    this.commsOpen = false; this.commsScope = 'mine';
    this.panelMin = false;
    this.flt = { ap: null, rel: 'any', traffic: 'all', state: 'all', unit: null, alerts: false, q: '' };
    // persisted settings
    const s = store.get('settings', {});
    this.radioLang = s.radioLang || 'en';
    this.dimOthers = s.dimOthers ?? true;
    this.manualClrPref = s.manualClr ?? true;
    Object.assign(this.r.opts, { theme: s.theme || 'dark', mode: s.mode || 'realistic', labelScale: s.labelScale || 1 }, s.layers || {});
    this.cmd = commands(world, this);
    this.r.isShown = (ac) => this.isShown(ac);
    this.r.isDim = (ac) => this.isDim(ac);
    this.lastEv = 0;
    this.applyTheme();
    this.buildStatic();
    this.bindCanvas();
    this.w.radio.listeners.add((m) => this.onRadio(m));
    this.t = 0; this.lastPanel = 0;
    if (!store.get('tutorialSeen', false)) setTimeout(() => this.tutorial(), 400);
  }

  saveSettings() {
    const o = this.r.opts;
    store.set('settings', { radioLang: this.radioLang, dimOthers: this.dimOthers, manualClr: this.manualClrPref, theme: o.theme, mode: o.mode, labelScale: o.labelScale, layers: { trails: o.trails, fixes: o.fixes, procs: o.procs, airways: o.airways, rings: o.rings, bounds: o.bounds, radarUpdate: o.radarUpdate } });
  }
  applyTheme() {
    document.body.classList.toggle('light', this.r.opts.theme === 'light');
    document.documentElement.lang = getLang();
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', this.r.opts.theme === 'light' ? '#e9edf1' : '#05090d');
  }
  iata(icao) { return this.data.iata[icao] || icao; }
  posLabel(id) { return id ? posName(id, getLang()) : t('global'); }
  cfgName(c) { return getLang() === 'ja' && c.ja ? c.ja : c.name; }

  // ================= static chrome (rebuilt on language change) =================
  buildStatic() {
    this.buildTopbar();
    this.buildMenu();
    this.renderDrawer();
    this.renderComms(true);
    this.renderLegend();
    this.renderPanel(true);
    this.updateFilterBadge();
  }

  buildTopbar() {
    const g = $('#areaBtns'); g.innerHTML = '';
    const vm = $('#viewMenu'); vm.innerHTML = '';
    const LV = { 1: t('lv1'), 2: t('lv2'), 3: t('lv3'), 4: t('lv4') };
    let lvl = 0, l2 = 0;
    for (const v of VIEWS) {
      if (v.level !== lvl) { if (lvl) g.append(h('span', { class: 'sep' })); lvl = v.level; }
      g.append(h('button', { 'data-v': v.id, title: v.label, onclick: () => this.setView(v) }, v.label));
      if (v.level !== l2) { vm.append(h('div', { class: 'lv' }, LV[v.level])); l2 = v.level; }
      vm.append(h('button', { 'data-v': v.id, onclick: () => { this.setView(v); vm.classList.add('hidden'); } }, v.label));
    }
    $('#btnView').onclick = () => vm.classList.toggle('hidden');
    $('#btnPause').onclick = () => { this.paused = !this.paused; $('#btnPause').textContent = this.paused ? '▶' : '❚❚'; $('#btnPause').classList.toggle('warn', this.paused); };
    $('#btnSpeed').onclick = () => { this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]; $('#btnSpeed').textContent = '×' + this.speed; };
    const setBtn = (id, icon, label, fn) => { const b = $(id); b.innerHTML = ''; b.append(h('span', { class: 'ic' }, icon), h('span', { class: 'lb' }, label)); b.title = label; b.onclick = fn; };
    setBtn('#btnPos', '🎧', this.posLabel(this.w.userPos), () => this.toggleDrawer('pos'));
    setBtn('#btnFilter', '⛃', t('filter'), () => this.toggleDrawer('filter'));
    setBtn('#btnComms', '📻', t('comms'), () => this.setComms(!this.commsOpen));
    setBtn('#btnLists', '☷', t('strips'), () => this.toggleDrawer('lists'));
    setBtn('#btnFull', '⤢', t('fullmap'), () => this.fullMap());
    $('#btnAlerts').onclick = () => { this.listTab = 'LOG'; this.toggleDrawer('lists', true); };
    $('#btnMenu').onclick = () => $('#menu').classList.toggle('hidden');
    $('#btnMenu').title = t('menu');
    $('#zIn').onclick = () => this.cam.zoomAt(this.cam.w / 2, this.cam.h / 2, 1.6);
    $('#zOut').onclick = () => this.cam.zoomAt(this.cam.w / 2, this.cam.h / 2, 1 / 1.6);
    if (this.view) this.markView(this.view);
    this.layoutTools();
    if (!this._lt) { this._lt = true; addEventListener('resize', () => this.layoutTools()); }
  }
  // On narrow screens move secondary buttons from the top bar to a floating
  // side toolbar so nothing is pushed off-screen.
  layoutTools() {
    const narrow = innerWidth < 640;
    const side = $('#sideTools'), grp = $('#topTools');
    for (const id of ['#btnAlerts', '#btnFilter', '#btnComms', '#btnLists', '#btnFull', '#btnSpeed']) {
      const el = $(id);
      if (narrow && el.parentNode !== side) side.append(el);
      if (!narrow && el.parentNode === side) (id === '#btnSpeed' ? $('#clockGrp') : grp).insertBefore(el, id === '#btnSpeed' ? null : $('#btnMenu'));
    }
    side.classList.toggle('hidden', !narrow);
  }
  setView(v, animate = true) {
    this.cam.goto(v, animate);
    this.view = v;
    if (v.airport) this.listAirport = v.airport;
    else if (/KANSAI/.test(v.id)) this.listAirport = 'RJBB';
    else if (/KANTO/.test(v.id)) this.listAirport = 'RJTT';
    this.markView(v);
  }
  markView(v) {
    document.querySelectorAll('#areaBtns button, #viewMenu button').forEach((b) => b.classList.toggle('on', b.dataset.v === v.id));
    const bv = $('#btnView'); if (bv) bv.textContent = v.label + ' ▾';
  }
  fullMap() {
    this.setDrawer(null); this.setComms(false); $('#menu').classList.add('hidden'); $('#viewMenu').classList.add('hidden');
    if (this.sel) { this.panelMin = true; this.renderPanel(true); }
  }

  toast(msg, ms = 3200) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.remove('show'), ms);
  }
  flash(ac) { this.r.flash(ac); }

  // ================= canvas input =================
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
        gesture = { type: 'tap', start: p, last: p, label: lab && lab.ac === this.sel ? lab : null };
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
      if (pts.size === 0) gesture = null; else if (gesture?.type === 'pinch') gesture = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); this.cam.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  onTap(p) {
    if (this.mode === 'vector' && this.sel) {
      const brg = bearing(this.sel, { x: this.cam.wx(p.x), y: this.cam.wy(p.y) });
      const ll = this.sel.latlon;
      const mag = Math.round(trueToMag(brg, ll.lat, ll.lon) / 5) * 5 || 360;
      if (this.canControl(this.sel)) this.cmd.heading(this.sel, mag, 0);
      this.mode = null; this.renderPanel(true);
      return;
    }
    if (this.mode === 'wx') {
      const c = { x: this.cam.wx(p.x), y: this.cam.wy(p.y), r: 7 + Math.random() * 6, top: 38000 + Math.floor(Math.random() * 8) * 1000 };
      this.w.weatherCells.push(c);
      this.w.log('wx', { fl: c.top / 100 }, 'warn');
      this.mode = null; this.toast(t('wxPlaced'));
      return;
    }
    this.select(this.r.pick(p.x, p.y));
  }

  select(ac) {
    this.sel = ac || null;
    this.r.selected = this.sel;
    this.hdgDraft = null; this.mode = null;
    if (this.sel) { this.tab = this.sel.onGround ? 'GND' : 'ALT'; this.panelMin = false; }
    this.renderPanel(true);
  }

  // ================= positions / permissions =================
  canControl(ac) { return !this.w.userPos || unitOf(this.w, ac) === this.w.userPos; }
  setPosition(id) {
    this.w.userPos = id || null;
    this.w.manualClr = !!id && this.manualClrPref;
    this.r.position = this.w.userPos;
    if (id) {
      const p = POS[id];
      this.cam.goto({ lat: p.view.lat, lon: p.view.lon, span: p.view.span });
      this.commsScope = 'mine';
      if (!this.isPortrait()) this.setComms(true);
      this.toast(t('posSet', { pos: this.posLabel(id) }));
    } else { this.toast(t('posGlobal')); this.commsScope = 'all'; }
    // aircraft that now need a clearance from the user re-request it
    for (const ac of this.w.aircraft) if (ac.req && !this.w.isUser(ac)) ac.req = null;
    this.buildTopbar(); this.renderDrawer(); this.renderComms(true); this.renderPanel(true);
  }
  isPortrait() { return innerHeight > innerWidth; }

  // ================= filters =================
  isShown(ac) {
    const f = this.flt, w = this.w;
    if (f.alerts && !(w.conflicts.alertsFor(ac).length || ac.emergency)) return false;
    if (f.traffic === 'arr' && ac.dir !== 'ARR') return false;
    if (f.traffic === 'dep' && ac.dir !== 'DEP') return false;
    if (f.traffic === 'ovf' && ac.dir !== 'OVF') return false;
    if (f.state === 'air' && ac.onGround) return false;
    if (f.state === 'gnd' && !ac.onGround) return false;
    if (f.ap) {
      const ap = f.ap;
      if (f.rel === 'arr' && ac.to !== ap) return false;
      if (f.rel === 'dep' && ac.from !== ap) return false;
      if (f.rel === 'any' && ac.to !== ap && ac.from !== ap) return false;
      if (f.rel === 'area') { const u = ac.unit || ''; const app = POS[u]?.type === 'APP' ? u : null; if (!(u.startsWith(ap) || (app && (ap === 'RJTT' ? app === 'RJTT_APP' : ap === 'RJAA' ? app === 'RJAA_APP' : app === 'KANSAI_APP')))) return false; }
    }
    if (f.unit === 'MINE' && this.w.userPos && ac.unit !== this.w.userPos) return false;
    if (f.unit && f.unit !== 'MINE' && ac.unit !== f.unit) return false;
    if (f.q) {
      const q = f.q.toUpperCase().trim();
      if (q && ![ac.callsign, ac.flight, ac.airline, ac.type, this.iata(ac.from), this.iata(ac.to)].some((s) => (s || '').toUpperCase().includes(q))) return false;
    }
    return true;
  }
  filterActive() { const f = this.flt; return !!(f.ap || f.traffic !== 'all' || f.state !== 'all' || f.unit || f.alerts || f.q); }
  isDim(ac) { return !!this.w.userPos && this.dimOthers && ac.unit !== this.w.userPos; }
  updateFilterBadge() {
    const on = this.filterActive();
    const hidden = on ? this.w.aircraft.filter((a) => !this.isShown(a)).length : 0;
    const b = $('#filterBadge');
    b.classList.toggle('hidden', !on);
    if (on) {
      if (!b.firstChild) b.append(h('span', {}), h('button', { onclick: () => this.resetFilters() }, '✕'));
      b.firstChild.textContent = t('fActive', { n: hidden });
    }
    $('#btnFilter').classList.toggle('on', on);
  }
  resetFilters() { this.flt = { ap: null, rel: 'any', traffic: 'all', state: 'all', unit: null, alerts: false, q: '' }; this.updateFilterBadge(); if (this.drawerMode === 'filter') this.renderDrawer(); }

  // ================= drawer (strips / positions / filters) =================
  toggleDrawer(mode, force) { this.setDrawer(force || this.drawerMode !== mode ? mode : null); }
  setDrawer(mode) {
    this.drawerMode = mode;
    const D = $('#drawer');
    D.classList.toggle('hidden', !mode);
    if (mode && this.isPortrait()) { this.setComms(false); if (this.sel) { this.panelMin = true; this.renderPanel(true); } }
    ['#btnPos', '#btnLists'].forEach((s) => $(s).classList.remove('open'));
    if (mode === 'pos') $('#btnPos').classList.add('open');
    if (mode === 'lists') $('#btnLists').classList.add('open');
    this.renderDrawer();
  }
  renderDrawer() {
    const D = $('#drawer');
    if (!this.drawerMode) { D.innerHTML = ''; return; }
    if (this.drawerMode === 'lists') return this.renderLists(true);
    D.innerHTML = '';
    const head = (title) => h('div', { class: 'dh' }, h('b', {}, title), h('button', { class: 'x', title: t('collapse'), onclick: () => this.setDrawer(null) }, '▾'));
    const body = h('div', { class: 'pbody' });
    if (this.drawerMode === 'pos') {
      D.append(head(t('posTitle')), body);
      const count = (id) => this.w.aircraft.filter((a) => a.unit === id).length;
      body.append(h('button', { class: 'posbtn ' + (!this.w.userPos ? 'on' : ''), onclick: () => { this.setPosition(null); this.setDrawer(null); } }, h('b', {}, t('global')), h('small', {}, t('posGlobalDesc'))));
      const groups = [['GND', t('grpGround')], ['TWR', t('grpTower')], ['APP', t('grpApproach')], ['ACC', t('grpArea')]];
      for (const [type, label] of groups) {
        body.append(h('div', { class: 'glabel' }, label));
        const grid = h('div', { class: 'posgrid' });
        for (const p of POSITIONS.filter((x) => x.type === type)) {
          grid.append(h('button', { class: 'posbtn ' + (this.w.userPos === p.id ? 'on' : ''), onclick: () => { this.setPosition(p.id); this.setDrawer(null); } },
            h('b', {}, posName(p.id, getLang())), h('small', {}, `${p.freq || ''}${p.depFreq ? ' / ' + p.depFreq : ''} · ${t('nAircraft', { n: count(p.id) })}`)));
        }
        body.append(grid);
      }
      const tog = (label, val, fn) => h('button', { class: 'tog ' + (val ? 'on' : ''), onclick: fn }, (val ? '☑ ' : '☐ ') + label);
      body.append(h('div', { class: 'row' }, tog(t('manualClr'), this.manualClrPref, () => { this.manualClrPref = !this.manualClrPref; this.w.manualClr = !!this.w.userPos && this.manualClrPref; this.saveSettings(); this.renderDrawer(); })));
      body.append(h('div', { class: 'note' }, t('manualClrDesc')));
      body.append(h('div', { class: 'row' }, tog(t('dimOthers'), this.dimOthers, () => { this.dimOthers = !this.dimOthers; this.saveSettings(); this.renderDrawer(); })));
      body.append(h('div', { class: 'note' }, t('posNote')));
    } else if (this.drawerMode === 'filter') {
      D.append(head(t('filterTitle')), body);
      const f = this.flt;
      const chip = (label, on, fn) => h('button', { class: on ? 'on' : '', onclick: () => { fn(); this.updateFilterBadge(); this.renderDrawer(); } }, label);
      const row = (label, ...kids) => h('div', { class: 'row' }, h('label', {}, label), ...kids);
      body.append(row(t('fAirport'), chip(t('fAll'), !f.ap, () => (f.ap = null)), ...AIRPORTS.map((a) => chip(this.iata(a), f.ap === a, () => (f.ap = a)))));
      if (f.ap) body.append(row(t('fRelation'), ...[['any', t('fAny')], ['arr', t('fArrTo')], ['dep', t('fDepFrom')], ['area', t('fInArea')]].map(([k, l]) => chip(l, f.rel === k, () => (f.rel = k)))));
      body.append(row(t('fTraffic'), ...[['all', t('fAll')], ['arr', t('fArrivals')], ['dep', t('fDepartures')], ['ovf', t('fOverflights')]].map(([k, l]) => chip(l, f.traffic === k, () => (f.traffic = k)))));
      body.append(row(t('fState'), ...[['all', t('fAll')], ['air', t('fAirborne')], ['gnd', t('fGround')]].map(([k, l]) => chip(l, f.state === k, () => (f.state = k)))));
      const units = [[null, t('fAny')], ...(this.w.userPos ? [['MINE', t('fMine')]] : []), ...POSITIONS.map((p) => [p.id, posName(p.id, getLang())])];
      body.append(row(t('fUnit'), ...units.map(([k, l]) => chip(l, f.unit === k, () => (f.unit = k)))));
      body.append(h('div', { class: 'row' }, chip((f.alerts ? '☑ ' : '☐ ') + t('fAlerts'), f.alerts, () => (f.alerts = !f.alerts))));
      const inp = h('input', { type: 'search', placeholder: t('fSearch'), value: f.q, class: 'search' });
      inp.addEventListener('input', () => { f.q = inp.value; this.updateFilterBadge(); });
      body.append(h('div', { class: 'row' }, inp));
      body.append(h('div', { class: 'row' }, h('button', { class: 'wide', onclick: () => this.resetFilters() }, t('fReset'))));
      body.append(h('div', { class: 'note' }, t('fNote')));
    }
  }

  // ================= radio / comms =================
  setComms(open) {
    this.commsOpen = open;
    document.body.classList.toggle('comms-open', open);
    $('#btnComms').classList.toggle('open', open);
    if (open && this.isPortrait()) { if (this.drawerMode) this.setDrawer(null); if (this.sel) { this.panelMin = true; this.renderPanel(true); } }
    this.renderComms(true);
  }
  commsMatch(m) { return this.commsScope === 'all' || !this.w.userPos || m.unit === this.w.userPos; }
  msgEl(m) {
    const ac = this.w.byId(m.ac);
    return h('div', { class: 'cm ' + (m.who === 'ATC' ? 'atc' : 'plt'), onclick: () => { if (ac) { this.select(ac); this.centerOn(ac); } } },
      h('span', { class: 'ct' }, this.w.clockStr(m.t).slice(0, 8)),
      h('span', { class: 'cw' }, m.who === 'ATC' ? t('atcLbl') : m.cs),
      h('span', { class: 'cx' }, this.w.radio.render(m, this.radioLang, this.data)));
  }
  renderComms(rebuild) {
    const P = $('#comms');
    const tick = $('#ticker');
    const last = [...this.w.radio.log].reverse().find((m) => this.commsMatch(m));
    tick.innerHTML = '';
    const pending = this.pendingRequests();
    tick.append(h('span', { class: 'tk-ic' }, '📻'), h('span', { class: 'tk-tx' }, last ? `${last.who === 'ATC' ? t('atcLbl') : last.cs}: ${this.w.radio.render(last, this.radioLang, this.data)}` : t('commsEmpty')));
    if (pending.length) tick.append(h('span', { class: 'tk-req' }, `◆ ${pending.length}`));
    tick.onclick = () => this.setComms(true);
    tick.classList.toggle('hidden', this.commsOpen);
    P.classList.toggle('hidden', !this.commsOpen);
    if (!this.commsOpen) return;
    if (rebuild || !this.commsList) {
      P.innerHTML = '';
      const freq = this.w.userPos ? `${POS[this.w.userPos].freq || ''}${POS[this.w.userPos].depFreq ? ' / ' + POS[this.w.userPos].depFreq : ''}` : '';
      P.append(h('div', { class: 'dh' },
        h('b', {}, `${t('commsTitle')} · ${this.posLabel(this.w.userPos)} ${freq}`),
        h('div', { class: 'seg' },
          h('button', { class: this.commsScope === 'mine' ? 'on' : '', disabled: !this.w.userPos, onclick: () => { this.commsScope = 'mine'; this.renderComms(true); } }, t('commsMine')),
          h('button', { class: this.commsScope === 'all' || !this.w.userPos ? 'on' : '', onclick: () => { this.commsScope = 'all'; this.renderComms(true); } }, t('commsAll')),
          h('button', { class: 'lang', onclick: () => { this.radioLang = this.radioLang === 'en' ? 'ja' : 'en'; this.saveSettings(); this.renderComms(true); } }, this.radioLang === 'en' ? 'EN' : '日本語')),
        h('button', { class: 'x', title: t('collapse'), onclick: () => this.setComms(false) }, '▾')));
      this.reqEl = h('div', { class: 'reqs' }); this._reqSig = null;
      this.commsList = h('div', { class: 'clist' });
      P.append(this.reqEl, this.commsList);
      const msgs = this.w.radio.log.filter((m) => this.commsMatch(m)).slice(-150);
      if (!msgs.length) this.commsList.append(h('div', { class: 'note' }, t('commsEmpty')));
      for (const m of msgs) this.commsList.append(this.msgEl(m));
      this.commsList.scrollTop = this.commsList.scrollHeight;
    }
    this.renderRequests();
  }
  onRadio(m) {
    if (!this.commsOpen || !this.commsList || !this.commsMatch(m)) { this._tickerDirty = true; return; }
    const atBottom = this.commsList.scrollHeight - this.commsList.scrollTop - this.commsList.clientHeight < 40;
    const note = this.commsList.querySelector('.note'); if (note) note.remove();
    this.commsList.append(this.msgEl(m));
    while (this.commsList.childElementCount > 250) this.commsList.firstChild.remove();
    if (atBottom) this.commsList.scrollTop = this.commsList.scrollHeight;
  }
  pendingRequests() { return this.w.userPos ? this.w.aircraft.filter((a) => a.req && unitOf(this.w, a) === this.w.userPos) : []; }
  reqLabel(a) {
    return { PUSH: t('approvePush'), TAXI: t('approveTaxi'), DEPART: t('clrTakeoff'), LAND: t('clrLand'), APP: t('clearedApp', { app: a.appName || 'ILS' }), CLIMB: t('climbTo', { alt: fmtAlt(a.req?.alt || a.cruiseAlt) }), TAXIIN: t('taxiToSpot') }[a.req?.type] || '✓';
  }
  renderRequests() {
    if (!this.reqEl) return;
    const list = this.pendingRequests().sort((a, b) => a.req.t - b.req.t);
    const sig = list.map((a) => a.id + a.req.type).join(',');
    if (sig === this._reqSig) return; this._reqSig = sig;
    this.reqEl.innerHTML = '';
    if (!this.w.userPos) return;
    this.reqEl.append(h('div', { class: 'glabel' }, `${t('requests')} (${list.length})`));
    if (!list.length) { this.reqEl.append(h('div', { class: 'note' }, this.w.manualClr ? t('noRequests') : t('manualClrDesc'))); return; }
    for (const a of list.slice(0, 8)) {
      const label = this.reqLabel(a);
      const extra = a.req.type === 'DEPART' ? h('button', { onclick: () => { this.cmd.lineUp(a); this._reqSig = null; } }, t('luaw')) : a.req.type === 'PUSH' ? h('button', { onclick: () => { this.cmd.pushHold(a); this._reqSig = null; } }, t('delayPush')) : null;
      this.reqEl.append(h('div', { class: 'req' },
        h('span', { class: 'rq', onclick: () => { this.select(a); this.centerOn(a); } }, h('b', {}, a.callsign), ' ', h('small', {}, t('req' + a.req.type))),
        h('button', { class: 'on', onclick: () => { this.cmd.approveRequest(a); this._reqSig = null; this.renderRequests(); } }, label), extra));
    }
  }

  // ================= aircraft panel =================
  renderPanel(rebuild = false) {
    const P = $('#panel');
    const ac = this.sel;
    if (!ac || !this.w.aircraft.includes(ac)) { P.classList.add('hidden'); this.sel = null; this.r.selected = null; return; }
    P.classList.remove('hidden');
    P.classList.toggle('min', this.panelMin);
    const ctl = this.canControl(ac);
    if (rebuild || this.panelFor !== ac.id || this.panelTab !== this.tab || this.panelGround !== ac.onGround || (this.panelPhase !== ac.phase && ac.onGround) || this.panelCtl !== ctl || this.panelReq !== ac.req?.type) {
      this.panelFor = ac.id; this.panelTab = this.tab; this.panelGround = ac.onGround; this.panelPhase = ac.phase; this.panelCtl = ctl; this.panelReq = ac.req?.type;
      P.innerHTML = '';
      const al = this.data.schedule.airlines.find((a) => a.icao === ac.airline);
      const pf = PERF[ac.type];
      P.append(h('div', { class: 'ph' },
        h('div', { onclick: () => { if (this.panelMin) { this.panelMin = false; this.renderPanel(true); } } }, h('div', { class: 'cs' }, ac.callsign, ac.req && this.w.isUser(ac) ? h('span', { class: 'reqdot' }, ' ◆') : null),
          h('div', { class: 'sub' }, `${al ? al.name : ac.airline} ${ac.flight} · “${callsignSpoken(ac, this.data, this.radioLang)}”`)),
        h('div', { class: 'sub hide-min' }, `${ac.type} ${pf ? pf.name : ''} · ${ac.wake}`, h('br'), `${this.iata(ac.from)} → ${this.iata(ac.to)} · SQ ${ac.squawk}`),
        h('button', { class: 'x', title: this.panelMin ? t('expand') : t('collapse'), onclick: () => { this.panelMin = !this.panelMin; this.renderPanel(true); } }, this.panelMin ? '▴' : '▾'),
        h('button', { class: 'x', title: t('close'), onclick: () => this.select(null) }, '✕')));
      if (this.panelMin) return;
      if (!ctl) P.append(h('div', { class: 'banner' }, t('monitorOnly', { unit: this.cmd.unitFor(ac).name })));
      let tabs = ac.onGround ? ['GND', 'INFO'] : ['ALT', 'HDG', 'SPD', 'ROUTE', 'APP', 'INFO'];
      if (!ctl) tabs = ['INFO'];
      if (!tabs.includes(this.tab)) this.tab = tabs[0];
      P.append(h('div', { class: 'tabs' }, tabs.map((k) => h('button', { class: k === this.tab ? 'on' : '', onclick: () => { this.tab = k; this.renderPanel(true); } }, t('tab' + k)))));
      this.kvEl = h('div', { class: 'kv' });
      const body = h('div', { class: 'pbody' }, this.kvEl);
      if (ac.req && this.w.isUser(ac)) body.append(h('div', { class: 'reqbar' }, h('span', {}, '◆ ' + t('req' + ac.req.type)), h('button', { class: 'on', onclick: () => { this.cmd.approveRequest(ac); this.renderPanel(true); } }, this.reqLabel(ac))));
      body.append(this.tabBody(ac));
      P.append(body);
    }
    if (!this.panelMin) this.updateKV(ac);
  }

  updateKV(ac) {
    if (!this.kvEl) return;
    const unit = this.cmd.unitFor(ac);
    const items = ac.onGround ? [
      ['kPHASE', phase(ac.phase)], ['kGS', Math.round(ac.gs) + 'kt'], ['kSTAND', ac.stand?.ref || '—'], ['kRWY', ac.dir === 'DEP' ? ac.depRwy?.id : ac.arrRwy?.id],
      ['kSIDSTAR', (ac.dir === 'DEP' ? ac.sidName : ac.starName) || '—'], ['kSTD', ac.sched?.timeLocal || '—'], ['kQUEUE', ac.dir === 'DEP' ? this.queuePos(ac) : '—'], ['kUNIT', unit.name],
    ] : [
      ['kALT', fmtAlt(ac.alt)], ['kCLR', ac.hold?.level != null && !ac.manual.alt ? fmtAlt(ac.hold.level) + ' ' + t('holdShort') : ac.vnav && !ac.manual.alt ? (ac.dir === 'ARR' ? t('viaStar') : t('viaSid')) : fmtAlt(ac.clearedAlt), true], ['kVS', (ac.vs > 0 ? '+' : '') + Math.round(ac.vs / 100) * 100], ['kHDG', pad3(ac.magHdg)],
      ['kASGHDG', ac.lat.mode === 'HDG' ? pad3(ac.assignedMagHdg) : ac.lat.mode, true], ['kIAS', Math.round(ac.ias)], ['kASGSPD', ac.atcSpd ? ac.atcSpd : ac.autoSpd ? 'a' + ac.autoSpd : '—', true], ['kGS', Math.round(ac.gs)],
      ['kPHASE', phase(ac.phase)], ['kRWY', ac.arrRwy?.id || ac.depRwy?.id || '—'], ['kSEQ', ac.dir === 'ARR' && ac.seq ? `#${ac.seq} ${Math.round((ac.delay || 0) / 60)}m` : '—'], ['kUNIT', unit.name],
    ];
    this.kvEl.innerHTML = '';
    for (const [k, v, asg] of items) this.kvEl.append(h('div', {}, h('b', {}, t(k)), h('span', { class: asg ? 'asg' : '' }, v ?? '—')));
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
    const btn = (label, fn, cls = '') => h('button', { class: cls, onclick: () => { fn(); this.renderPanel(true); } }, label);
    this.routeEl = null; this.hdgBig = null;

    if (this.tab === 'ALT') {
      const cur = ac.clearedAlt;
      const alts = [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000];
      const fls = [150, 170, 190, 210, 230, 250, 270, 290, 310, 330, 350, 370, 390, 410];
      frag.append(row(t('altRow'), ...alts.map((a) => btn(a >= 10000 ? (a / 1000) + 'k' : String(a), () => C.altitude(ac, a), a === cur ? 'on' : ''))));
      frag.append(row(t('flRow'), ...fls.map((f) => btn('FL' + f, () => C.altitude(ac, f * 100), f * 100 === cur ? 'on' : ''))));
      frag.append(row('', btn('+1000', () => C.altitude(ac, cur + 1000)), btn('−1000', () => C.altitude(ac, Math.max(1000, cur - 1000))),
        btn(ac.dir === 'ARR' ? t('vnavArr') : t('vnavDep'), () => C.via(ac), ac.vnav ? 'on' : '')));
      if (ac.req?.type === 'CLIMB') frag.append(row('', btn(t('climbTo', { alt: fmtAlt(ac.req.alt) }), () => C.climbApprove(ac), 'on')));
      frag.append(h('div', { class: 'note' }, t('taNote')));
    }
    if (this.tab === 'HDG') {
      this.hdgDraft = this.hdgDraft ?? Math.round(ac.magHdg / 5) * 5;
      this.hdgBig = h('span', { class: 'big' }, pad3(this.hdgDraft));
      const adj = (d) => { this.hdgDraft = norm360(this.hdgDraft + d) || 360; this.hdgBig.textContent = pad3(this.hdgDraft); };
      frag.append(row(t('hdgRow'), h('button', { onclick: () => adj(-30) }, '−30'), h('button', { onclick: () => adj(-10) }, '−10'), h('button', { onclick: () => adj(-5) }, '−5'), this.hdgBig,
        h('button', { onclick: () => adj(5) }, '+5'), h('button', { onclick: () => adj(10) }, '+10'), h('button', { onclick: () => adj(30) }, '+30')));
      frag.append(row('', btn(t('turnL'), () => C.heading(ac, this.hdgDraft, -1)), btn(t('flyHdg'), () => C.heading(ac, this.hdgDraft, 0), 'on'), btn(t('turnR'), () => C.heading(ac, this.hdgDraft, 1))));
      frag.append(row('', btn(t('presentHdg'), () => C.heading(ac, Math.round(ac.magHdg), 0)),
        h('button', { class: this.mode === 'vector' ? 'warn' : '', onclick: () => { this.mode = this.mode === 'vector' ? null : 'vector'; this.toast(this.mode ? t('tapVectorOn') : t('tapVectorOff')); this.renderPanel(true); } }, t('tapVector')),
        btn(t('resumeNav'), () => C.resumeNav(ac))));
      frag.append(row(t('orbitRow'), btn(t('orbitL'), () => C.orbit(ac, -1)), btn(t('orbitR'), () => C.orbit(ac, 1))));
    }
    if (this.tab === 'SPD') {
      const sp = [160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320];
      frag.append(row(t('spdRow'), ...sp.map((s) => btn(String(s), () => C.speed(ac, s), ac.atcSpd === s ? 'on' : ''))));
      frag.append(row('', btn(t('resumeSpd'), () => C.speed(ac, null)), btn(t('maintainSpd'), () => C.speed(ac, Math.round(ac.ias / 10) * 10))));
      frag.append(h('div', { class: 'note' }, t('spdNote', { vmin: ac.perf.vmin, vapp: ac.perf.vapp })));
    }
    if (this.tab === 'ROUTE') {
      this.routeEl = h('div', { class: 'route' });
      frag.append(row(t('routeRow', { proc: (ac.dir === 'ARR' ? ac.starName : ac.sidName) || '—' })), this.routeEl);
      const fixes = ac.route.slice(ac.routeIdx).filter((w) => w.kind !== 'VEC' && w.kind !== 'FNL' && w.kind !== 'THR' && this.w.fix(w.id));
      frag.append(row(t('directRow'), ...fixes.slice(0, 14).map((w) => btn(w.id, () => C.direct(ac, w.id)))));
      frag.append(row(t('holdRow'), ...fixes.slice(0, 8).map((w) => btn('HOLD ' + w.id, () => C.hold(ac, w.id))), btn(t('exitHold'), () => C.exitHold(ac))));
      if (ac.dir === 'ARR' && this.w.airport(ac.to)) {
        const stars = (this.w.procedures[ac.to]?.stars || []).filter((s) => ac.arrRwy && s.runways.includes(ac.arrRwy.id));
        frag.append(row(t('rerouteRow'), ...stars.slice(0, 10).map((s) => btn(s.name.replace(' ARRIVAL', ''), () => C.reroute(ac, s.name)))));
      }
    }
    if (this.tab === 'APP') {
      const ap = this.w.airport(ac.to);
      if (ap && ac.dir === 'ARR') {
        frag.append(row(t('lrwyRow'), ...[...ap.runways.values()].map((r) => btn(r.id, () => C.runway(ac, r.id), ac.arrRwy === r ? 'on' : ''))));
        frag.append(row(t('apprRow'), btn(t('clearedApp', { app: ac.appName || 'ILS' }), () => C.approach(ac), ac.appr?.cleared ? 'on' : ''), btn(t('cancelApp'), () => C.cancelApproach(ac))));
        frag.append(row(t('towerRow'), btn(t('clrLand'), () => C.clearLand(ac), ac.landClr ? 'on' : ''), btn(t('goAround'), () => C.goAround(ac), 'danger'), btn(t('expedite'), () => C.expedite(ac))));
        frag.append(h('div', { class: 'note' }, t('appNote')));
      } else frag.append(h('div', { class: 'note' }, t('depNote')));
      frag.append(row(t('emergRow'), btn(ac.emergency ? t('cancelEmerg') : t('declareEmerg'), () => C.emergency(ac), 'danger')));
    }
    if (this.tab === 'GND') {
      const ph = ac.phase;
      if (ph === 'PARKED' && ac.dir === 'DEP') frag.append(row(t('gndRow'), btn(t('approvePush'), () => C.push(ac), 'on'), btn(ac.pushHold ? t('release') : t('delayPush'), () => C.pushHold(ac))));
      if (ph === 'STARTUP') frag.append(row(t('gndRow'), btn(t('approveTaxi'), () => C.taxi(ac), 'on')));
      if (['TAXI_OUT', 'TAXI_IN', 'PUSHBACK'].includes(ph)) frag.append(row(t('gndRow'), btn(ac.taxi?.hold ? t('continueTaxi') : t('holdPosition'), () => C.holdPos(ac), ac.taxi?.hold ? 'warn' : ''), ph === 'TAXI_IN' && ac.req?.type === 'TAXIIN' ? btn(t('taxiToSpot'), () => C.taxiIn(ac), 'on') : null));
      if (ph === 'HOLD_SHORT' || ph === 'LINED_UP') frag.append(row(t('towerRow'), ph === 'HOLD_SHORT' ? btn(t('luaw'), () => C.lineUp(ac)) : null, btn(t('clrTakeoff'), () => C.takeoff(ac), 'on'), btn(ac.manualHold ? t('releaseAuto') : t('holdShortManual'), () => C.holdShort(ac))));
      if (ac.dir === 'DEP') {
        const ap = this.w.airport(ac.from);
        frag.append(row(t('depRwyRow'), ...this.w.config(ap).dep.concat([...ap.runways.keys()].filter((k) => !this.w.config(ap).dep.includes(k))).map((id) => btn(id, () => C.depRunway(ac, id), ac.depRwy?.id === id ? 'on' : ''))));
      }
      if (ac.taxiNames?.length) frag.append(h('div', { class: 'note' }, t('taxiRoute', { r: ac.taxiNames.join(' ') })));
    }
    if (this.tab === 'INFO' || this.tab === 'GND') {
      const sc = ac.sched;
      if (ac.dir === 'OVF') frag.append(h('div', { class: 'note' }, t('overflight', { flight: ac.flight, from: this.iata(ac.from), to: this.iata(ac.to), reg: ac.sched?.reg ? 'Reg ' + ac.sched.reg + ' · ' : '' })));
      else frag.append(h('div', { class: 'note' }, t('schedule', { flight: ac.flight, from: this.iata(ac.from), to: this.iata(ac.to), std: sc?.dir === 'DEP' ? 'STD' : 'STA', time: sc?.timeLocal ?? '—', reg: sc?.reg ? 'Reg ' + sc.reg + ' · ' : '' })));
      frag.append(h('div', { class: 'note' }, t('destOrigin', { dest: this.data.airportNames[ac.to] || ac.to, orig: this.data.airportNames[ac.from] || ac.from })));
      const u = this.cmd.unitFor(ac);
      frag.append(h('div', { class: 'note' }, t('cruiseUnit', { alt: fmtAlt(ac.cruiseAlt), unit: u.name, freq: u.freq || '' })));
      const msgs = this.w.radio.log.filter((m) => m.ac === ac.id).slice(-10);
      if (msgs.length) frag.append(h('div', { class: 'clist inline' }, msgs.map((m) => this.msgEl(m))));
      if (this.canControl(ac)) frag.append(row('', btn(t('returnAuto'), () => C.auto(ac))));
    }
    if (this.tab !== 'ROUTE' && !ac.onGround) { this.routeEl = h('div', { class: 'route' }); frag.append(h('div', { class: 'row' }, h('label', {}, t('tabROUTE'))), this.routeEl); }
    return frag;
  }

  // ================= strips =================
  renderLists(rebuild) {
    const L = $('#drawer');
    if (this.drawerMode !== 'lists') return;
    if (rebuild || !this.listBody || !L.contains(this.listBody)) {
      L.innerHTML = '';
      L.append(h('div', { class: 'dh' }, h('b', {}, t('strips')), h('button', { class: 'x', title: t('collapse'), onclick: () => this.setDrawer(null) }, '▾')));
      L.append(h('div', { class: 'tabs' }, AIRPORTS.map((a) => h('button', { class: a === this.listAirport ? 'on' : '', onclick: () => { this.listAirport = a; this.renderLists(true); } }, this.iata(a)))));
      L.append(h('div', { class: 'tabs' }, ['ARR', 'DEP', 'LOG'].map((k) => h('button', { class: k === this.listTab ? 'on' : '', onclick: () => { this.listTab = k; this.renderLists(true); } }, t(k.toLowerCase())))));
      this.listBody = h('div', { class: 'pbody' });
      L.append(this.listBody);
    }
    const B = this.listBody; B.innerHTML = '';
    const ap = this.w.airport(this.listAirport);
    if (this.listTab === 'ARR') {
      B.append(h('div', { class: 'note' }, `${ap.iata} ${this.cfgName(this.w.config(ap))}`));
      const arr = this.w.aircraft.filter((a) => a.to === ap.icao && a.dir === 'ARR' && !a.onGround && this.isShown(a)).sort((a, b) => (a.slot ?? 1e12) - (b.slot ?? 1e12));
      for (const a of arr) B.append(this.strip(a, `${a.arrRwy?.id || ''} #${a.seq || '-'}`, `${(a.starName || '').replace(' ARRIVAL', '')}`, `${fmtAlt(a.alt)} ${Math.round(a.gs)}kt`, a.slot ? `ETA ${this.w.clockStr((this.w.startClock + a.slot) % 86400).slice(0, 5)} +${Math.max(0, Math.round(a.delay / 60))}m` : ''));
      if (!arr.length) B.append(h('div', { class: 'note' }, t('noArrivals')));
      const ldg = this.w.aircraft.filter((a) => a.to === ap.icao && a.onGround);
      if (ldg.length) B.append(h('div', { class: 'note' }, t('onGroundArrived', { list: ldg.map((a) => a.callsign).join(' ') })));
    } else if (this.listTab === 'DEP') {
      const deps = this.w.aircraft.filter((a) => a.from === ap.icao && a.dir === 'DEP' && (a.onGround || dist(a, ap) < 40) && this.isShown(a));
      const order = { LINEUP: 0, LINED_UP: 0, TAKEOFF: 0, HOLD_SHORT: 1, TAXI_OUT: 2, STARTUP: 3, PUSHBACK: 3, PARKED: 4 };
      deps.sort((a, b) => (order[a.phase] ?? -1) - (order[b.phase] ?? -1) || (a.pushAt ?? 0) - (b.pushAt ?? 0));
      for (const a of deps) B.append(this.strip(a, `${a.depRwy?.id || ''} ${phase(a.phase)}`, a.sidName || '', `${this.iata(a.to)} ${a.type}`, a.onGround ? `STD ${a.sched?.timeLocal || ''} ${a.stand ? 'SPOT ' + a.stand.ref : ''}` : fmtAlt(a.alt)));
    } else {
      const ev = this.w.events.slice(-150).reverse();
      B.append(h('div', { class: 'log' }, ev.map((m) => h('div', { class: m.kind, onclick: () => { const a = this.w.byId(m.ac); if (a) this.select(a); } }, `${this.w.clockStr(m.t).slice(0, 5)} ${evText(m)}`))));
    }
  }
  strip(a, r1, l2, r2, l3) {
    const alert = this.w.conflicts.alertsFor(a).length || a.emergency;
    return h('div', { class: `strip ${a.dir === 'DEP' ? 'dep' : ''} ${alert ? 'alert' : ''} ${this.sel === a ? 'sel' : ''}`, onclick: () => { this.select(a); if (!a.onGround || this.cam.span < 10) this.centerOn(a); } },
      h('div', { class: 'c' }, a.callsign, a.req && this.w.isUser(a) ? ' ◆' : ''), h('div', { class: 'r' }, r1), h('div', {}, l2), h('div', { class: 'r' }, r2), l3 ? h('div', { class: 'msg' }, l3) : null);
  }
  centerOn(a) { this.cam.anim = { from: { x: this.cam.x, y: this.cam.y, scale: this.cam.scale }, to: { x: a.x, y: a.y, scale: this.cam.scale }, t: 0, dur: 0.6 }; }

  // ================= settings menu =================
  buildMenu() {
    const M = $('#menu'); M.innerHTML = '';
    const sec = (k) => M.append(h('h3', { class: 'sec', onclick: (e) => e.target.nextElementSibling.classList.toggle('hidden') }, t(k) + ' ▾'));
    const box = (...kids) => { const d = h('div', { class: 'secbody' }, ...kids); M.append(d); return d; };
    const seg = (opts, cur, fn) => h('div', { class: 'row' }, ...opts.map(([v, label]) => h('button', { class: v === cur ? 'on' : '', onclick: () => fn(v) }, label)));
    M.append(h('div', { class: 'row' }, h('button', { onclick: () => M.classList.add('hidden') }, '✕ ' + t('close'))));
    sec('secLanguage');
    box(seg([['ja', '日本語'], ['en', 'English']], getLang(), (v) => { setLang(v); this.applyTheme(); this.buildStatic(); $('#menu').classList.remove('hidden'); }));
    sec('secRadioLang');
    box(seg([['en', 'English (ICAO)'], ['ja', '日本語']], this.radioLang, (v) => { this.radioLang = v; this.saveSettings(); this.buildMenu(); this.renderComms(true); $('#menu').classList.remove('hidden'); }), h('p', {}, t('radioNote')));
    sec('secTheme');
    box(seg([['dark', t('themeDark')], ['light', t('themeLight')]], this.r.opts.theme, (v) => { this.r.opts.theme = v; this.applyTheme(); this.saveSettings(); this.buildMenu(); $('#menu').classList.remove('hidden'); }));
    sec('secDisplay');
    box(seg([['realistic', t('modeRealistic')], ['radar', t('modeRadar')], ['simple', t('modeSimple')], ['beginner', t('modeBeginner')]], this.r.opts.mode, (v) => { this.r.opts.mode = v; this.saveSettings(); this.renderLegend(); this.buildMenu(); $('#menu').classList.remove('hidden'); }), h('p', {}, t('modeNote')),
      h('div', { class: 'row' }, h('label', {}, t('labelSize')), ...[0.85, 1, 1.2, 1.4].map((s) => h('button', { class: this.r.opts.labelScale === s ? 'on' : '', onclick: () => { this.r.opts.labelScale = s; this.saveSettings(); this.buildMenu(); $('#menu').classList.remove('hidden'); } }, `${Math.round(s * 100)}%`)),
        h('button', { onclick: () => this.r.labelOffsets.clear() }, t('resetLabels'))));
    sec('layers');
    const tog = (k) => h('button', { class: this.r.opts[k] ? 'on' : '', onclick: (e) => { this.r.opts[k] = !this.r.opts[k]; e.target.classList.toggle('on', this.r.opts[k]); this.saveSettings(); } }, t(k === 'radarUpdate' ? 'sweep' : k));
    box(h('div', { class: 'row' }, tog('trails'), tog('fixes'), tog('procs'), tog('airways'), tog('rings'), tog('bounds'), tog('radarUpdate')));
    sec('secWind');
    this.cfgBox = box();
    sec('secAbnormal');
    box(h('div', { class: 'row' },
      h('button', { onclick: () => { this.mode = 'wx'; M.classList.add('hidden'); this.toast(t('tapWx')); } }, t('addCb')),
      h('button', { onclick: () => { this.w.weatherCells = []; this.toast(t('wxCleared')); } }, t('clearWx')),
      h('button', { onclick: () => this.cmd.randomEmergency() }, t('randomEmerg'))));
    sec('secTraffic');
    box(h('div', { class: 'row' }, ...[0.25, 0.5, 0.75, 1].map((d) => h('button', { class: this.w.traffic.density === d ? 'on' : '', onclick: (e) => { this.w.traffic.density = d; e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); } }, `${d * 100}%`))),
      h('p', {}, t('trafficNote')),
      h('div', { class: 'row' }, h('label', {}, t('restartAt')), ...['06:30', '08:00', '12:00', '16:00', '19:30', '23:00'].map((tm) => h('button', { onclick: () => { const u = new URL(location.href); u.searchParams.set('t', tm); location.href = u.toString(); } }, tm))));
    sec('secHelp');
    box(h('p', {}, t('help1')), h('p', {}, t('help2')), h('p', {}, t('help3')), h('div', { class: 'row' }, h('button', { onclick: () => { M.classList.add('hidden'); this.tutorial(); } }, t('tutorial'))));
    sec('secData');
    box(h('p', {}, t('dataVerified')), h('p', {}, t('dataApprox')),
      h('p', {}, h('a', { href: 'https://github.com/wata9857-ops/airplanecontrol', target: '_blank' }, t('source')), ' · Map: Natural Earth · Airport layouts: © OpenStreetMap contributors (ODbL) · Traffic: Flightradar24'));
    this.renderConfigBox();
  }

  renderConfigBox() {
    const box = this.cfgBox; if (!box) return; box.innerHTML = '';
    for (const ap of this.w.airports.values()) {
      const wd = this.w.wind[ap.icao];
      const wrap = h('div', { class: 'row' }, h('label', {}, t('windLine', { ap: ap.iata, dir: pad3(wd.dir), spd: wd.spd, cfg: this.cfgName(this.w.config(ap)), lock: ap.configLocked ? t('locked') : '' })));
      for (const d of [0, 45, 90, 135, 180, 225, 270, 315]) wrap.append(h('button', { class: Math.abs(((wd.dir - d + 540) % 360) - 180) < 23 ? 'on' : '', onclick: () => { wd.dir = d || 360; this.w.autoSelectConfig(ap); this.renderConfigBox(); } }, `${pad3(d || 360)}`));
      for (const sp of [5, 15, 25]) wrap.append(h('button', { class: wd.spd === sp ? 'on' : '', onclick: () => { wd.spd = sp; this.w.autoSelectConfig(ap); this.renderConfigBox(); } }, `${sp}kt`));
      box.append(wrap);
      const cfgRow = h('div', { class: 'row' });
      ap.configs.forEach((c, i) => cfgRow.append(h('button', { class: i === ap.configIdx ? 'on' : '', onclick: () => { ap.configLocked = true; if (ap.configIdx !== i) { ap.configIdx = i; this.w.log('cfgSet', { ap: ap.iata, cfg: c.name, cfgJa: c.ja || c.name }, 'warn'); this.w.automation.onConfigChange(ap); } this.renderConfigBox(); } }, this.cfgName(c))));
      cfgRow.append(h('button', { class: ap.configLocked ? 'warn' : '', onclick: () => { ap.configLocked = !ap.configLocked; this.w.autoSelectConfig(ap); this.renderConfigBox(); } }, ap.configLocked ? t('unlock') : t('autoWind')));
      box.append(cfgRow);
      const rw = h('div', { class: 'row' }, h('label', {}, t('rwyClosure')));
      const seen = new Set();
      for (const r of ap.runways.values()) {
        const k = [r.id, r.opp].sort().join('/'); if (seen.has(k)) continue; seen.add(k);
        rw.append(h('button', { class: r.closed ? 'danger' : '', onclick: () => { this.cmd.toggleRunway(ap, r); this.renderConfigBox(); } }, `${k}${r.closed ? ' ' + t('closed') : ''}`));
      }
      box.append(rw);
    }
  }

  // ================= beginner legend & tutorial =================
  renderLegend() {
    const L = $('#legend'); L.innerHTML = '';
    const show = this.r.opts.mode === 'beginner';
    L.classList.toggle('hidden', !show);
    if (!show) return;
    const open = store.get('legendOpen', true);
    L.append(h('button', { class: 'lhead', onclick: () => { store.set('legendOpen', !open); this.renderLegend(); } }, `${t('legend')} ${open ? '▾' : '▴'}`));
    if (!open) return;
    const item = (cls, label) => h('div', { class: 'li' }, h('span', { class: 'sw ' + cls }), label);
    L.append(item('arr', t('legArr')), item('dep', t('legDep')), item('ovf', t('legOvf')), item('gnd', t('legGnd')), item('alert', t('legAlert')));
  }
  tutorial(step = 1) {
    const T = $('#tutorial'); T.innerHTML = ''; T.classList.remove('hidden');
    const done = () => { T.classList.add('hidden'); store.set('tutorialSeen', true); };
    T.append(h('div', { class: 'card' },
      h('div', { class: 'tstep' }, `${step} / 4`),
      h('h2', {}, t(`tut${step}t`)), h('p', {}, t(`tut${step}b`)),
      h('div', { class: 'row' },
        h('button', { onclick: done }, t('tutSkip')),
        h('button', { class: 'seg2' }, h('span', { onclick: (e) => { e.stopPropagation(); setLang('ja'); this.applyTheme(); this.buildStatic(); this.tutorial(step); } }, '日本語'), ' / ', h('span', { onclick: (e) => { e.stopPropagation(); setLang('en'); this.applyTheme(); this.buildStatic(); this.tutorial(step); } }, 'EN')),
        h('button', { class: 'on', onclick: () => (step < 4 ? this.tutorial(step + 1) : done()) }, step < 4 ? t('tutNext') : t('tutDone')))));
  }

  // plain-language safety alerts (beginner) for new STCA / LOS events
  checkEvents() {
    const ev = this.w.events;
    for (let i = Math.max(this.lastEv, ev.length - 5); i < ev.length; i++) {
      const e = ev[i];
      if (this.r.opts.mode === 'beginner' && (e.k === 'los' || e.k === 'stca')) this.toast(t(e.k === 'los' ? 'plainLos' : 'plainStca', e.p), 5000);
    }
    this.lastEv = ev.length;
  }

  // ================= periodic =================
  tick(dt) {
    this.t += dt;
    $('#clock').textContent = this.w.clockStr();
    $('#alertCount').textContent = this.w.conflicts.list.length;
    $('#btnAlerts').classList.toggle('danger', this.w.conflicts.list.some((c) => c.level === 'LOS'));
    $('#btnAlerts').classList.toggle('warn', this.w.conflicts.list.length > 0);
    const s = this.w.stats;
    $('#levelBadge').textContent = t('badge', { l: this.cam.level, span: this.cam.span.toFixed(this.cam.span < 10 ? 1 : 0), air: this.w.aircraft.filter((a) => !a.onGround).length, ldg: s.arrivals, dep: s.departures, ga: s.goArounds, los: s.losses });
    if (this.t - this.lastPanel > 0.5) {
      this.lastPanel = this.t;
      this.renderPanel(false);
      this.checkEvents();
      if (Math.floor(this.t) % 2 === 0) { this.renderLists(false); this.updateFilterBadge(); }
      if (!this.commsOpen || this._tickerDirty) { this._tickerDirty = false; this.renderComms(false); } else this.renderRequests();
      const pend = this.pendingRequests().length;
      $('#btnComms').classList.toggle('warn', pend > 0);
      if (this.sel && this.sel.remove) this.select(null);
    }
  }
}
