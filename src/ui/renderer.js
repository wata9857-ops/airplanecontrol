// Canvas radar renderer: map layers adapt to the zoom level (wide area →
// terminal → airport surface). Supports dark/light themes, four aircraft
// display modes (realistic, radar, simple, beginner), display-only filters,
// position (jurisdiction) overlays and command feedback.
import { toXY, project, fmtAlt, pad3, rad, dist } from '../geo.js';
import { TERMINALS, POS } from '../sim/positions.js';
import { t } from '../i18n.js';

const DARK = {
  land: '#0c1a22', landEdge: '#1f3a48', water: '#04080c', apLand: '#10212b',
  airway: 'rgba(80,120,150,0.22)', fix: '#4d7286', fixText: '#5f8798', navaid: '#5aa0c0',
  star: 'rgba(90,200,170,0.20)', sid: 'rgba(110,150,255,0.18)', app: 'rgba(240,200,90,0.32)',
  rwy: '#c9d6de', rwyClosed: '#ff4d4d', rwyOcc: '#ffd27a', ctl: 'rgba(200,220,230,0.28)', rwyDash: '#0b1218',
  rwyLblArr: '#7ee2b8', rwyLblDep: '#7fb4ff', rwyLbl: '#9fb3be', apLbl: '#e6f0f5', apLblMinor: '#9fb3be',
  taxi: '#2e4652', taxiLine: 'rgba(230,200,60,0.55)', taxiName: 'rgba(230,200,60,0.8)', apron: '#14232c', term: '#22394a', stand: '#4a6676', standText: '#6d8796',
  arr: '#7ee2b8', dep: '#7fb4ff', ovf: '#c9c9c9', ground: '#b7c7d1', sel: '#ffffff', selBg: 'rgba(255,255,255,0.08)',
  stca: '#f6c343', los: '#ff4d4d', ring: 'rgba(120,160,180,0.14)', ringText: 'rgba(120,160,180,0.35)', text: '#cfe3ee', emerg: '#ff5ad1',
  city: 'rgba(140,165,180,0.45)', wxText: 'rgba(255,220,220,0.8)', scale: '#6d8796', route: 'rgba(255,255,255,0.45)', routeText: 'rgba(255,255,255,0.7)', asg: '#4fd1c5',
  bound: 'rgba(79,209,197,0.55)', boundFill: 'rgba(79,209,197,0.05)', sector: 'rgba(160,140,220,0.35)', req: '#4fd1c5',
};
const LIGHT = {
  land: '#f1ede2', landEdge: '#b8b09a', water: '#cadceb', apLand: '#e4dfd1',
  airway: 'rgba(50,80,110,0.25)', fix: '#5b7385', fixText: '#3f5666', navaid: '#1f6a92',
  star: 'rgba(0,120,90,0.35)', sid: 'rgba(30,70,200,0.30)', app: 'rgba(170,110,0,0.50)',
  rwy: '#3d4752', rwyClosed: '#d40000', rwyOcc: '#c27a00', ctl: 'rgba(30,50,70,0.35)', rwyDash: '#e8e8e8',
  rwyLblArr: '#00704a', rwyLblDep: '#1446b8', rwyLbl: '#55626d', apLbl: '#14212b', apLblMinor: '#4c5a66',
  taxi: '#cbc7bb', taxiLine: 'rgba(170,130,0,0.75)', taxiName: 'rgba(130,95,0,0.95)', apron: '#dcd8cc', term: '#b9b3a3', stand: '#8d98a1', standText: '#55636e',
  arr: '#007a4d', dep: '#1450c8', ovf: '#4f4f4f', ground: '#2d3a46', sel: '#000000', selBg: 'rgba(0,0,0,0.07)',
  stca: '#b07400', los: '#d10000', ring: 'rgba(40,70,90,0.16)', ringText: 'rgba(40,70,90,0.5)', text: '#14212b', emerg: '#c0008a',
  city: 'rgba(60,70,80,0.6)', wxText: 'rgba(120,0,0,0.85)', scale: '#3f5666', route: 'rgba(0,0,0,0.5)', routeText: 'rgba(0,0,0,0.75)', asg: '#00838f',
  bound: 'rgba(0,130,143,0.7)', boundFill: 'rgba(0,130,143,0.06)', sector: 'rgba(90,60,170,0.4)', req: '#00838f',
};
let C = DARK;

export class Renderer {
  constructor(canvas, world, cam, data) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.w = world; this.cam = cam; this.data = data;
    this.opts = { trails: true, fixes: true, procs: true, airways: true, rings: true, bounds: true, labelScale: 1, radarUpdate: false, mode: 'realistic', theme: 'dark' };
    this.selected = null;
    this.labelOffsets = new Map(); // ac.id -> {dx, dy}
    this.hit = []; // {ac, x, y, r, box}
    this.landPaths = (data.geo.polygons || []).map((poly) => poly.map(([lo, la]) => toXY(la, lo)));
    this.cities = data.cities.map((c) => ({ ...c, ...toXY(c.lat, c.lon) }));
    this.buildProcLines();
    this.radarSnap = new Map();
    this.lastSweep = -99;
    this.flashes = new Map();
    this.isShown = () => true; // display filter (set by UI)
    this.isDim = () => false;  // outside selected position
    this.position = null;
  }

  get mode() { return this.opts.mode; }
  flash(ac) { this.flashes.set(ac.id, performance.now()); }

  buildProcLines() {
    this.procLines = [];
    for (const [icao, p] of Object.entries(this.w.procedures)) {
      for (const kind of ['stars', 'sids', 'approaches']) for (const s of p[kind] || []) {
        const pts = (s.legs || []).map((l) => this.w.fix(l.fix)).filter(Boolean);
        if (pts.length >= 2) this.procLines.push({ icao, kind, name: s.name, rwys: s.runways || (s.runway ? [s.runway] : []), pts });
      }
    }
    this.airwayLines = (this.w.airways || []).map((a) => ({ id: a.id, pts: a.points.map((id) => this.w.fix(id)).filter(Boolean) })).filter((a) => a.pts.length > 1);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    this.dpr = dpr; this.cam.resize(r.width, r.height);
  }

  draw() {
    const { ctx, cam } = this;
    C = this.opts.theme === 'light' ? LIGHT : DARK;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.water; ctx.fillRect(0, 0, cam.w, cam.h);
    const span = cam.span, simple = this.mode === 'simple';
    this.drawLand();
    if (span < 9) this.drawSurface();
    if (this.opts.rings && !simple && span < 120 && span > 6) this.drawRings();
    if (this.opts.airways && !simple && span > 70) this.drawAirways();
    if (this.opts.bounds && !simple) this.drawBounds(span);
    if (this.position) this.drawJurisdiction(this.position);
    if (this.opts.procs && !simple && span < 220 && span > 4) this.drawProcedures(span);
    this.drawRunways(span);
    if (this.opts.fixes && !simple && span < 160) this.drawFixes(span);
    this.drawCities(span);
    this.drawWeather();
    this.drawConflicts();
    this.drawAircraft(span);
    this.drawScale();
  }

  path(pts) {
    const { ctx, cam } = this;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(cam.sx(p.x), cam.sy(p.y)) : ctx.moveTo(cam.sx(p.x), cam.sy(p.y))));
  }

  visible(p, m = 50) { const x = this.cam.sx(p.x), y = this.cam.sy(p.y); return x > -m && y > -m && x < this.cam.w + m && y < this.cam.h + m; }

  drawLand() {
    const { ctx } = this;
    ctx.fillStyle = C.land; ctx.strokeStyle = C.landEdge; ctx.lineWidth = 1;
    for (const poly of this.landPaths) { this.path(poly); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    if (this.cam.span < 80) for (const ap of this.w.airports.values()) {
      if (!ap.ground || !this.visible(ap, 600)) continue;
      ctx.fillStyle = C.apLand;
      for (const ring of ap.ground.boundary) { this.path(ring); ctx.closePath(); ctx.fill(); }
    }
  }

  drawRings() {
    const { ctx, cam } = this;
    ctx.strokeStyle = C.ring; ctx.lineWidth = 1; ctx.fillStyle = C.ringText; ctx.font = '10px Menlo, monospace';
    for (const ap of this.w.airports.values()) {
      if (!ap.major || !this.visible(ap, 400)) continue;
      for (let r = 5; r <= 40; r += 5) {
        ctx.beginPath(); ctx.arc(cam.sx(ap.x), cam.sy(ap.y), r * cam.scale, 0, Math.PI * 2); ctx.stroke();
        if (r % 10 === 0 && cam.span < 70) ctx.fillText(r, cam.sx(ap.x) + 2, cam.sy(ap.y) - r * cam.scale - 2);
      }
    }
  }

  drawAirways() {
    const { ctx } = this;
    ctx.strokeStyle = C.airway; ctx.lineWidth = 1; ctx.setLineDash([]);
    for (const a of this.airwayLines) { this.path(a.pts); ctx.stroke(); }
  }

  // Terminal-area (approach) boundaries and the Kobe/Tokyo ACC split, faint, at wide zoom
  drawBounds(span) {
    if (span < 40) return;
    const { ctx, cam } = this;
    ctx.strokeStyle = C.sector; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
    for (const tm of TERMINALS) for (const [icao, r] of tm.centres) {
      const a = this.w.airport(icao); if (!a) continue;
      ctx.beginPath(); ctx.arc(cam.sx(a.x), cam.sy(a.y), r * cam.scale, 0, Math.PI * 2); ctx.stroke();
    }
    if (span > 120) {
      const a = toXY(38.8, 136.6), b = toXY(34.25, 136.6), c = toXY(34.25, 135.35), d = toXY(31.5, 135.35);
      this.path([a, b, c, d]); ctx.stroke();
      ctx.fillStyle = C.sector; ctx.font = '10px Menlo, monospace';
      const p1 = toXY(36.2, 135.6), p2 = toXY(36.2, 137.0);
      ctx.fillText('KOBE ACC', cam.sx(p1.x), cam.sy(p1.y)); ctx.fillText('TOKYO ACC', cam.sx(p2.x), cam.sy(p2.y));
    }
    ctx.setLineDash([]);
  }

  // Highlight the selected position's area of responsibility
  drawJurisdiction(id) {
    const p = POS[id]; if (!p) return;
    const { ctx, cam } = this;
    ctx.strokeStyle = C.bound; ctx.fillStyle = C.boundFill; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
    const circ = (a, r) => { ctx.beginPath(); ctx.arc(cam.sx(a.x), cam.sy(a.y), r * cam.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
    if (p.type === 'TWR') circ(this.w.airport(p.ap), 6);
    if (p.type === 'GND') { const g = this.w.airport(p.ap)?.ground; if (g) for (const ring of g.boundary) { this.path(ring); ctx.closePath(); ctx.fill(); ctx.stroke(); } }
    if (p.type === 'APP') { const tm = TERMINALS.find((x) => x.pos === id); for (const [icao, r] of tm?.centres || []) circ(this.w.airport(icao), r); }
    ctx.setLineDash([]);
  }

  activeRunwaysFor(icao) {
    const ap = this.w.airport(icao); if (!ap) return { arr: [], dep: [] };
    const c = this.w.config(ap); return { arr: c.arr, dep: c.dep };
  }

  drawProcedures(span) {
    const { ctx } = this;
    ctx.lineWidth = 1.2;
    for (const l of this.procLines) {
      const act = this.activeRunwaysFor(l.icao);
      const list = l.kind === 'sids' ? act.dep : act.arr;
      if (l.rwys.length && !l.rwys.some((r) => list.includes(r))) continue;
      if (/NIGHT|\bV ARRIVAL/.test(l.name)) continue;
      if (span > 150 && l.kind === 'approaches') continue;
      ctx.strokeStyle = l.kind === 'stars' ? C.star : l.kind === 'sids' ? C.sid : C.app;
      ctx.setLineDash(l.kind === 'sids' ? [6, 5] : []);
      this.path(l.pts); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  drawRunways(span) {
    const { ctx, cam } = this;
    for (const ap of this.w.airports.values()) {
      if (!this.visible(ap, 300)) continue;
      const act = this.w.config(ap);
      const usedR = new Set();
      for (const r of ap.runways.values()) {
        const key = [r.id, r.opp].sort().join('/');
        if (span < 120 && act.arr.includes(r.id) && !r.closed && this.mode !== 'simple') {
          ctx.strokeStyle = C.ctl; ctx.lineWidth = 1;
          const e = project(r.thr, r.trueHdg + 180, 15);
          ctx.beginPath(); ctx.moveTo(cam.sx(r.thr.x), cam.sy(r.thr.y)); ctx.lineTo(cam.sx(e.x), cam.sy(e.y)); ctx.stroke();
          if (span < 70) for (let k = 1; k <= 15; k++) {
            const p = project(r.thr, r.trueHdg + 180, k), a = project(p, r.trueHdg + 90, k % 5 === 0 ? 0.5 : 0.25), b = project(p, r.trueHdg - 90, k % 5 === 0 ? 0.5 : 0.25);
            ctx.beginPath(); ctx.moveTo(cam.sx(a.x), cam.sy(a.y)); ctx.lineTo(cam.sx(b.x), cam.sy(b.y)); ctx.stroke();
          }
        }
        if (usedR.has(key)) continue; usedR.add(key);
        const wpx = Math.max(2, (r.widthM || 60) / 1852 * cam.scale);
        ctx.strokeStyle = r.closed ? C.rwyClosed : (r.occupiedBy ? C.rwyOcc : C.rwy);
        ctx.lineWidth = span < 9 ? wpx : Math.max(2, Math.min(wpx, 4));
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(cam.sx(r.thr.x), cam.sy(r.thr.y)); ctx.lineTo(cam.sx(r.end.x), cam.sy(r.end.y)); ctx.stroke();
        if (span < 9) {
          ctx.strokeStyle = C.rwyDash; ctx.lineWidth = 1; ctx.setLineDash([8, 8]);
          ctx.beginPath(); ctx.moveTo(cam.sx(r.thr.x), cam.sy(r.thr.y)); ctx.lineTo(cam.sx(r.end.x), cam.sy(r.end.y)); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      if (span < 25) {
        ctx.font = `${span < 9 ? 13 : 11}px Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const r of ap.runways.values()) {
          const p = project(r.thr, r.trueHdg + 180, span < 9 ? 0.12 : 0.6);
          ctx.fillStyle = act.arr.includes(r.id) ? C.rwyLblArr : act.dep.includes(r.id) ? C.rwyLblDep : C.rwyLbl;
          ctx.fillText(r.id, cam.sx(p.x), cam.sy(p.y));
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
      if (span > 25) {
        ctx.fillStyle = ap.major ? C.apLbl : C.apLblMinor; ctx.font = `${ap.major ? 'bold ' : ''}${this.mode === 'beginner' ? 13 : 11}px Menlo, monospace`;
        ctx.fillText(this.mode === 'beginner' ? `${ap.iata} ${ap.nameJa && document.documentElement.lang === 'ja' ? ap.nameJa : ap.name}` : ap.iata, cam.sx(ap.x) + 7, cam.sy(ap.y) + 14);
      }
    }
  }

  drawSurface() {
    const { ctx, cam } = this;
    for (const ap of this.w.airports.values()) {
      const g = ap.ground; if (!g || !this.visible(ap, 2000)) continue;
      ctx.fillStyle = C.apron;
      for (const a of g.aprons) { this.path(a.pts); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = C.term;
      for (const a of g.terminals) { this.path(a.pts); ctx.closePath(); ctx.fill(); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const tw = Math.max(1.5, 23 / 1852 * cam.scale);
      ctx.strokeStyle = C.taxi; ctx.lineWidth = tw;
      for (const e of g.edges) { if (e.k === 'T') { this.path(e.pts); ctx.stroke(); } }
      ctx.strokeStyle = C.taxiLine; ctx.lineWidth = 1;
      for (const e of g.edges) { if (e.k === 'T') { this.path(e.pts); ctx.stroke(); } }
      ctx.strokeStyle = C.stand; ctx.lineWidth = 1;
      for (const e of g.edges) { if (e.k === 'P') { this.path(e.pts); ctx.stroke(); } }
      if (cam.span < 4 && this.mode !== 'simple') {
        ctx.fillStyle = C.taxiName; ctx.font = '10px Menlo, monospace';
        const done = new Set();
        for (const e of g.edges) {
          if (e.k !== 'T' || !e.n || e.len < 0.06) continue;
          const key = e.n + Math.round(e.pts[0].x * 20) + Math.round(e.pts[0].y * 20);
          if (done.has(key)) continue; done.add(key);
          const m = e.pts[Math.floor(e.pts.length / 2)];
          ctx.fillText(e.n, cam.sx(m.x) + 2, cam.sy(m.y) - 2);
        }
        ctx.fillStyle = C.standText; ctx.font = '9px Menlo, monospace';
        if (cam.span < 2.5) for (const s of g.stands) ctx.fillText(s.ref, cam.sx(s.pos.x) + 2, cam.sy(s.pos.y) + 3);
      }
      ctx.lineCap = 'butt';
    }
  }

  activeFixSet() {
    const sig = [...this.w.airports.values()].map((a) => a.configIdx).join(',') + (this.selected ? '|' + this.selected.id + ':' + this.selected.routeIdx : '');
    if (sig === this._fixSig) return this._fixSet;
    const set = new Set();
    for (const l of this.procLines) {
      const act = this.activeRunwaysFor(l.icao);
      const list = l.kind === 'sids' ? act.dep : act.arr;
      if (l.rwys.length && !l.rwys.some((r) => list.includes(r))) continue;
      if (/NIGHT|\bV ARRIVAL/.test(l.name)) continue;
      for (const p of l.pts) set.add(p.id);
    }
    if (this.selected) for (const w of this.selected.route) set.add(w.id);
    this._fixSig = sig; this._fixSet = set;
    return set;
  }

  drawFixes(span) {
    const { ctx, cam } = this;
    ctx.font = '10px Menlo, monospace';
    const active = this.activeFixSet();
    for (const f of this.w.fixes.values()) {
      if (!this.visible(f, 10)) continue;
      const isNav = f.kind === 'NAVAID';
      if (!isNav && !active.has(f.id)) continue;
      if (!isNav && /^[A-Z]{2}\d{3}$|^[A-Z]\d[A-Z]\d\d$|^RW/.test(f.id) && span > 30) continue;
      if (!isNav && span > 110) continue;
      if (this.mode === 'beginner' && !isNav && !this.selected?.route.some((w) => w.id === f.id)) continue;
      const x = cam.sx(f.x), y = cam.sy(f.y);
      ctx.strokeStyle = isNav ? C.navaid : C.fix; ctx.fillStyle = isNav ? C.navaid : C.fixText; ctx.lineWidth = 1;
      ctx.beginPath();
      if (isNav) { for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.lineTo(x + 5 * Math.cos(a), y + 5 * Math.sin(a)); } ctx.closePath(); }
      else { ctx.moveTo(x, y - 4); ctx.lineTo(x + 3.5, y + 3); ctx.lineTo(x - 3.5, y + 3); ctx.closePath(); }
      ctx.stroke();
      if (span < 45 || isNav || this.selected?.route.some((w) => w.id === f.id)) ctx.fillText(f.id, x + 5, y - 4);
    }
  }

  drawCities(span) {
    if (span < 6) return;
    const { ctx, cam } = this;
    ctx.font = '11px "Hiragino Sans", sans-serif'; ctx.fillStyle = C.city;
    for (const c of this.cities) {
      if (c.minSpan && span < c.minSpan) continue;
      if (c.maxSpan && span > c.maxSpan) continue;
      if (!this.visible(c)) continue;
      ctx.fillRect(cam.sx(c.x) - 1.5, cam.sy(c.y) - 1.5, 3, 3);
      ctx.fillText(c.name, cam.sx(c.x) + 4, cam.sy(c.y) + 4);
    }
  }

  drawWeather() {
    const { ctx, cam } = this;
    for (const c of this.w.weatherCells) {
      const x = cam.sx(c.x), y = cam.sy(c.y), r = c.r * cam.scale;
      const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
      g.addColorStop(0, 'rgba(255,60,60,0.45)'); g.addColorStop(0.5, 'rgba(255,190,40,0.28)'); g.addColorStop(1, 'rgba(60,200,60,0.12)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.wxText; ctx.font = '10px Menlo, monospace'; ctx.fillText(`CB FL${Math.round(c.top / 100)}`, x - 22, y);
    }
  }

  drawConflicts() {
    const { ctx, cam } = this;
    // conflicts are drawn even if one aircraft is hidden by a filter (safety first)
    for (const c of this.w.conflicts.list) {
      ctx.strokeStyle = c.level === 'LOS' ? C.los : C.stca; ctx.lineWidth = this.mode === 'beginner' ? 2.5 : 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(cam.sx(c.a.x), cam.sy(c.a.y)); ctx.lineTo(cam.sx(c.b.x), cam.sy(c.b.y)); ctx.stroke();
      ctx.setLineDash([]);
      const mx = (cam.sx(c.a.x) + cam.sx(c.b.x)) / 2, my = (cam.sy(c.a.y) + cam.sy(c.b.y)) / 2;
      ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 11px Menlo, monospace';
      ctx.fillText(`${c.dh.toFixed(1)}NM ${Math.round(c.dv / 100)}`, mx + 4, my - 4);
    }
  }

  dispPos(ac) {
    if (!this.opts.radarUpdate) return ac;
    return this.radarSnap.get(ac.id) || ac;
  }
  sweep() {
    if (!this.opts.radarUpdate) return;
    if (this.w.time - this.lastSweep >= 4) {
      this.lastSweep = this.w.time;
      for (const ac of this.w.aircraft) this.radarSnap.set(ac.id, { x: ac.x, y: ac.y, hdg: ac.hdg, trk: ac.trk, gs: ac.gs, alt: ac.alt, vs: ac.vs });
    }
  }

  colorFor(ac, al) {
    let col = ac.onGround ? C.ground : ac.dir === 'ARR' ? C.arr : ac.dir === 'DEP' ? C.dep : C.ovf;
    if (ac.emergency) col = C.emerg;
    if (al === 'STCA') col = C.stca;
    if (al === 'LOS') col = C.los;
    if (this.selected === ac) col = C.sel;
    return col;
  }

  drawAircraft(span) {
    const { ctx, cam } = this;
    this.sweep();
    this.hit = [];
    const alerts = new Map();
    for (const c of this.w.conflicts.list) { for (const a of [c.a, c.b]) { if (alerts.get(a.id) !== 'LOS') alerts.set(a.id, c.level); } }
    const ls = this.opts.labelScale * (this.mode === 'beginner' ? 1.12 : 1);
    const placed = [];
    const now = performance.now();
    const list = [...this.w.aircraft].sort((a, b) => (a.onGround === b.onGround ? 0 : a.onGround ? -1 : 1));
    for (const ac of list) {
      if (ac.onGround && span > 14) continue;
      if (!this.isShown(ac) && this.selected !== ac) continue;
      const p = this.dispPos(ac);
      if (!this.visible(p, 120)) continue;
      const x = cam.sx(p.x), y = cam.sy(p.y);
      const sel = this.selected === ac;
      const al = alerts.get(ac.id);
      const col = this.colorFor(ac, al);
      const dim = !sel && !al && this.isDim(ac);
      ctx.globalAlpha = dim ? 0.3 : 1;
      // command feedback ring
      const fl = this.flashes.get(ac.id);
      if (fl && now - fl < 1400) {
        const k = (now - fl) / 1400;
        ctx.strokeStyle = C.asg; ctx.lineWidth = 2; ctx.globalAlpha = 1 - k;
        ctx.beginPath(); ctx.arc(x, y, 8 + k * 26, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = dim ? 0.3 : 1;
      } else if (fl) this.flashes.delete(ac.id);
      // pending request to the user's position: pulsing ring
      if (ac.req && this.w.isUser(ac, ac.unit)) {
        ctx.strokeStyle = C.req; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 14 + 3 * Math.sin(now / 200), 0, Math.PI * 2); ctx.stroke();
      }
      if (ac.onGround) { this.drawGroundAc(ac, x, y, col, sel, span); ctx.globalAlpha = 1; continue; }

      if (this.opts.trails && this.mode !== 'simple') {
        ctx.fillStyle = col;
        ac.trail.forEach((tp, i) => { ctx.globalAlpha = (dim ? 0.1 : 0.15) + (dim ? 0.15 : 0.5) * i / ac.trail.length; ctx.fillRect(cam.sx(tp.x) - 1.2, cam.sy(tp.y) - 1.2, 2.4, 2.4); });
        ctx.globalAlpha = dim ? 0.3 : 1;
      }
      // 1-minute velocity vector (not in simple mode)
      if (this.mode !== 'simple') {
        const v = project(p, p.trk ?? ac.trk, (p.gs ?? ac.gs) / 60);
        ctx.strokeStyle = col; ctx.lineWidth = this.mode === 'beginner' ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cam.sx(v.x), cam.sy(v.y)); ctx.stroke();
      }
      this.drawSymbol(ac, x, y, col, sel, p.hdg ?? ac.hdg);
      if (al || ac.emergency) {
        ctx.strokeStyle = col; ctx.lineWidth = this.mode === 'beginner' ? 2.5 : 1.4;
        const pr = this.mode === 'beginner' ? 16 + 3 * Math.sin(now / 180) : 11;
        ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.stroke();
      }

      // datablock
      const lines = this.datablock(ac, span);
      const fs = Math.round((span > 200 ? 10 : 11.5) * ls);
      ctx.font = `${this.mode === 'beginner' ? 'bold ' : ''}${fs}px Menlo, Consolas, monospace`;
      const lw = Math.max(...lines.map((l) => ctx.measureText(l.t).width));
      const lh = fs + 2, bh = lh * lines.length;
      let off = this.labelOffsets.get(ac.id);
      if (!off) off = this.autoOffset(x, y, lw, bh, placed);
      const bx = x + off.dx, by = y + off.dy;
      placed.push({ x: bx, y: by, w: lw, h: bh });
      ctx.strokeStyle = col; ctx.globalAlpha = dim ? 0.25 : 0.7; ctx.lineWidth = 1;
      const lx = off.dx >= 0 ? bx - 2 : bx + lw + 2, ly = by + bh / 2;
      ctx.beginPath(); ctx.moveTo(x + Math.sign(off.dx) * 6, y + Math.sign(off.dy) * 4); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.globalAlpha = dim ? 0.3 : 1;
      if (sel || this.mode === 'beginner') { ctx.fillStyle = this.mode === 'beginner' && !sel ? (this.opts.theme === 'light' ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.55)') : C.selBg; ctx.fillRect(bx - 3, by - 2, lw + 6, bh + 3); }
      lines.forEach((l, i) => { ctx.fillStyle = l.c || col; ctx.fillText(l.t, bx, by + lh * (i + 1) - 3); });
      ctx.globalAlpha = 1;
      this.hit.push({ ac, x, y, r: this.mode === 'beginner' ? 26 : 22, box: { x: bx - 4, y: by - 4, w: lw + 8, h: bh + 8 } });
      if (sel) this.drawRoute(ac);
    }
    ctx.globalAlpha = 1;
  }

  // Aircraft symbol by display mode
  drawSymbol(ac, x, y, col, sel, hdg) {
    const { ctx } = this;
    const m = this.mode;
    if (m === 'radar') {
      ctx.strokeStyle = col; ctx.lineWidth = sel ? 2 : 1.4;
      ctx.beginPath();
      if (ac.dir === 'ARR') ctx.rect(x - 4, y - 4, 8, 8);
      else if (ac.dir === 'DEP') { ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.closePath(); }
      else ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    if (m === 'simple') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, sel ? 5 : 3.6, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // realistic / beginner: airplane silhouette rotated to heading
    const len = m === 'beginner' ? 24 : (ac.wake === 'H' || ac.wake === 'J' ? 18 : 15);
    this.plane(x, y, hdg, len, col, m === 'beginner' || sel);
  }

  plane(x, y, hdg, len, col, outline) {
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rad(hdg));
    ctx.beginPath();
    ctx.moveTo(0, -len / 2); ctx.lineTo(len * 0.07, -len * 0.38); ctx.lineTo(len * 0.07, -len * 0.1);
    ctx.lineTo(len * 0.5, len * 0.08); ctx.lineTo(len * 0.5, len * 0.16); ctx.lineTo(len * 0.07, len * 0.06);
    ctx.lineTo(len * 0.06, len * 0.34); ctx.lineTo(len * 0.22, len * 0.45); ctx.lineTo(len * 0.22, len * 0.5); ctx.lineTo(0, len * 0.45);
    ctx.lineTo(-len * 0.22, len * 0.5); ctx.lineTo(-len * 0.22, len * 0.45); ctx.lineTo(-len * 0.06, len * 0.34);
    ctx.lineTo(-len * 0.07, len * 0.06); ctx.lineTo(-len * 0.5, len * 0.16); ctx.lineTo(-len * 0.5, len * 0.08);
    ctx.lineTo(-len * 0.07, -len * 0.1); ctx.lineTo(-len * 0.07, -len * 0.38); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    if (outline) { ctx.lineWidth = 1; ctx.strokeStyle = this.opts.theme === 'light' ? '#ffffff' : '#000000'; ctx.stroke(); }
    ctx.restore();
  }

  autoOffset(x, y, w, h, placed) {
    const cands = [{ dx: 14, dy: -h - 6 }, { dx: 14, dy: 6 }, { dx: -w - 14, dy: -h - 6 }, { dx: -w - 14, dy: 6 }, { dx: 22, dy: -h / 2 }, { dx: -w - 22, dy: -h / 2 },
      { dx: 14, dy: -h - 30 }, { dx: 14, dy: 30 }, { dx: -w - 14, dy: -h - 30 }, { dx: -w - 14, dy: 30 }, { dx: -w / 2, dy: -h - 20 }, { dx: -w / 2, dy: 18 }];
    let best = cands[0], bs = Infinity;
    for (const [i, c] of cands.entries()) {
      const bx = x + c.dx, by = y + c.dy;
      let s = i * 5; // prefer near positions
      for (const p of placed) {
        const ox = Math.max(0, Math.min(bx + w, p.x + p.w) - Math.max(bx, p.x));
        const oy = Math.max(0, Math.min(by + h, p.y + p.h) - Math.max(by, p.y));
        s += ox * oy;
      }
      if (s < bs) { bs = s; best = c; if (s <= i * 5) break; }
    }
    return best;
  }

  datablock(ac, span) {
    const p = this.dispPos(ac);
    const alt = p.alt ?? ac.alt, vs = p.vs ?? ac.vs;
    const a3 = pad3(alt / 100);
    const arrow = vs > 300 ? '↑' : vs < -300 ? '↓' : ' ';
    const iata = (icao) => this.w.data.iata[icao] || icao;
    if (this.mode === 'simple') return [{ t: `${ac.callsign} ${a3}${arrow.trim()}` }];
    if (this.mode === 'beginner') {
      const where = ac.dir === 'ARR' ? `→ ${iata(ac.to)}` : ac.dir === 'DEP' ? `${iata(ac.from)} → ${iata(ac.to)}` : `${iata(ac.from)} → ${iata(ac.to)}`;
      const trend = vs > 300 ? t('bClimb') : vs < -300 ? t('bDesc') : t('bLevel');
      const l = [{ t: `${ac.callsign}${ac.emergency ? ' MAYDAY' : ''}` }, { t: where }];
      if (span < 260) l.push({ t: `${fmtAlt(alt)}${alt < 14000 ? 'ft' : ''} ${trend}` });
      return l;
    }
    const tgt = ac.hold?.level ?? (ac.vnav && !ac.manual.alt ? null : ac.clearedAlt);
    const cl = tgt != null && Math.abs(tgt - alt) > 150 ? pad3(tgt / 100) : (ac.vnav && !ac.manual.alt && Math.abs(vs) > 300 ? 'VIA' : '');
    const gs = String(Math.round((p.gs ?? ac.gs) / 10)).padStart(2, '0');
    const l1 = { t: ac.callsign + (ac.emergency ? ' EMRG' : '') + (ac.hold ? ' HLD' : '') + (ac.req && this.w.isUser(ac, ac.unit) ? ' ◆' : '') };
    if (span > 200) return [l1, { t: `${a3}${arrow}` }];
    const l2 = { t: `${a3}${arrow}${cl}` };
    const dest = ac.dir === 'ARR' ? (ac.arrRwy ? ac.arrRwy.id : '') : iata(ac.to);
    let l3 = { t: `${gs} ${ac.type} ${dest}` };
    if (ac.appr?.established) l3 = { t: `${gs} ${ac.type} ${ac.arrRwy.id}${ac.seq ? ' #' + ac.seq : ''}` };
    const lines = [l1, l2, l3];
    const asg = [];
    if (ac.lat.mode === 'HDG') asg.push('H' + pad3(ac.assignedMagHdg));
    if (ac.atcSpd) asg.push('S' + ac.atcSpd);
    if (asg.length && span < 140) lines.push({ t: asg.join(' '), c: C.asg });
    return lines;
  }

  drawGroundAc(ac, x, y, col, sel, span) {
    const { ctx, cam } = this;
    const L = { M: 38, H: 62, J: 72, L: 20 }[ac.wake] || 40;
    const len = Math.max(this.mode === 'beginner' ? 18 : 13, L / 1852 * cam.scale);
    this.plane(x, y, ac.hdg, len, col, sel || this.mode === 'beginner');
    if (span < 6) {
      ctx.font = `${Math.round(10 * this.opts.labelScale)}px Menlo, monospace`;
      ctx.fillStyle = col;
      const status = this.mode === 'beginner' ? t('ph_' + ac.phase) : ({ PARKED: 'STND', PUSHBACK: 'PUSH', STARTUP: 'STUP', TAXI_OUT: 'TAXI', HOLD_SHORT: 'HOLD', LINEUP: 'LUP', LINED_UP: 'LUAW', TAKEOFF: 'T/O', ROLLOUT: 'LDG', TAXI_IN: 'TAXI' }[ac.phase] || ac.phase);
      const t1 = ac.callsign + (ac.req && this.w.isUser(ac, ac.unit) ? ' ◆' : ''), t2 = `${status} ${ac.dir === 'DEP' ? ac.depRwy?.id || '' : ac.stand?.ref || ''}`;
      if (ac.phase !== 'PARKED' || span < 2.2 || sel || ac.req) { ctx.fillText(t1, x + len / 2 + 3, y - 2); if (this.mode !== 'simple') ctx.fillText(t2, x + len / 2 + 3, y + 9); }
      this.hit.push({ ac, x, y, r: Math.max(14, len / 2), box: { x: x + len / 2, y: y - 12, w: 60, h: 24 } });
    }
    if (sel && ac.taxi) {
      ctx.strokeStyle = C.route; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
      this.path([ac, ...ac.taxi.pts.slice(ac.taxi.i + 1)]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  drawRoute(ac) {
    const { ctx, cam } = this;
    const pts = [ac, ...ac.route.slice(ac.routeIdx)];
    ctx.strokeStyle = C.route; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
    this.path(pts); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.routeText; ctx.font = '10px Menlo, monospace';
    for (const w of ac.route.slice(ac.routeIdx)) {
      if (w.kind === 'VEC' || w.kind === 'FNL') continue;
      if (!this.visible(w)) continue;
      ctx.fillText(w.id + (w.altMax != null || w.altMin != null ? ' ' + consStr(w) : ''), cam.sx(w.x) + 5, cam.sy(w.y) + 12);
    }
    if (ac.lat.mode === 'HDG') {
      const e = project(ac, ac.lat.hdg, 40);
      ctx.strokeStyle = C.asg; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(cam.sx(ac.x), cam.sy(ac.y)); ctx.lineTo(cam.sx(e.x), cam.sy(e.y)); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  drawScale() {
    const { ctx, cam } = this;
    const nice = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
    const nm = nice.find((n) => n * cam.scale > 70) || 100;
    const px = nm * cam.scale, x0 = cam.w - 70 - px, y0 = cam.h - 16;
    ctx.strokeStyle = C.scale; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 4); ctx.stroke();
    ctx.fillStyle = C.scale; ctx.font = '10px Menlo, monospace'; ctx.fillText(`${nm} NM`, x0 + px / 2 - 14, y0 - 6);
  }

  pick(px, py) {
    let best = null, bd = Infinity;
    for (const h of this.hit) {
      const d = Math.hypot(px - h.x, py - h.y);
      if (d < h.r && d < bd) { bd = d; best = h.ac; }
      const b = h.box;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h && bd > 5) { best = h.ac; bd = 5; }
    }
    return best;
  }
  pickLabel(px, py) {
    for (const h of this.hit) { const b = h.box; if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return h; }
    return null;
  }
}

function consStr(w) {
  if (w.altMin != null && w.altMax != null && w.altMin === w.altMax) return '@' + fmtAlt(w.altMin);
  const s = [];
  if (w.altMin != null) s.push('A' + fmtAlt(w.altMin));
  if (w.altMax != null) s.push('B' + fmtAlt(w.altMax));
  return s.join(' ');
}
void dist;
