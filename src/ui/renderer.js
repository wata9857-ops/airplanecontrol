// Canvas radar renderer: map layers adapt to the zoom level (wide area →
// terminal → airport surface). Labels use an ARTS-like three-line datablock.
import { toXY, project, fmtAlt, pad3, rad, dist } from '../geo.js';

const C = {
  land: '#0c1a22', landEdge: '#1f3a48', water: '#04080c',
  airway: 'rgba(80,120,150,0.22)', fix: '#4d7286', fixText: '#5f8798', navaid: '#5aa0c0',
  star: 'rgba(90,200,170,0.20)', sid: 'rgba(110,150,255,0.18)', app: 'rgba(240,200,90,0.32)',
  rwy: '#c9d6de', rwyClosed: '#ff4d4d', ctl: 'rgba(200,220,230,0.28)',
  taxi: '#2e4652', taxiEdge: '#3d5a68', apron: '#14232c', term: '#22394a', stand: '#4a6676',
  arr: '#7ee2b8', dep: '#7fb4ff', ovf: '#c9c9c9', ground: '#b7c7d1', sel: '#ffffff',
  stca: '#f6c343', los: '#ff4d4d', ring: 'rgba(120,160,180,0.14)', text: '#cfe3ee', emerg: '#ff5ad1',
};

export class Renderer {
  constructor(canvas, world, cam, data) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.w = world; this.cam = cam; this.data = data;
    this.opts = { trails: true, fixes: true, procs: true, airways: true, rings: true, labelScale: 1, radarUpdate: false };
    this.selected = null;
    this.labelOffsets = new Map(); // ac.id -> {dx, dy}
    this.hit = []; // {ac, x, y, r, box}
    this.landPaths = (data.geo.polygons || []).map((poly) => poly.map(([lo, la]) => toXY(la, lo)));
    this.cities = data.cities.map((c) => ({ ...c, ...toXY(c.lat, c.lon) }));
    this.buildProcLines();
    this.radarSnap = new Map();
    this.lastSweep = -99;
  }

  buildProcLines() {
    // cached polyline lists for STAR/SID/approach (per airport/runway)
    this.procLines = [];
    for (const [icao, p] of Object.entries(this.w.procedures)) {
      for (const kind of ['stars', 'sids', 'approaches']) for (const s of p[kind] || []) {
        const pts = (s.legs || []).map((l) => this.w.fix(l.fix)).filter(Boolean);
        if (pts.length >= 2) this.procLines.push({ icao, kind, name: s.name, rwys: s.runways || (s.runway ? [s.runway] : []), pts });
      }
    }
    this.airwayLines = (this.w.airways || []).map((a) => ({ id: a.id, pts: a.points.map((id) => this.w.fix(id)).filter(Boolean) })).filter((a) => a.pts.length > 1);
    // fixes referenced by procedures (to avoid clutter)
    this.procFixes = new Set();
    for (const l of this.procLines) for (const p of l.pts) this.procFixes.add(p.id);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    this.dpr = dpr; this.cam.resize(r.width, r.height);
  }

  draw() {
    const { ctx, cam } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.water; ctx.fillRect(0, 0, cam.w, cam.h);
    const lvl = cam.level, span = cam.span;
    this.drawLand();
    if (span < 9) this.drawSurface();
    if (this.opts.rings && span < 120 && span > 6) this.drawRings();
    if (this.opts.airways && span > 70) this.drawAirways();
    if (this.opts.procs && span < 220 && span > 4) this.drawProcedures(span);
    this.drawRunways(span);
    if (this.opts.fixes && span < 160) this.drawFixes(span);
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
      ctx.fillStyle = '#10212b';
      for (const ring of ap.ground.boundary) { this.path(ring); ctx.closePath(); ctx.fill(); }
    }
  }

  drawRings() {
    const { ctx, cam } = this;
    // range rings around major airports in view
    ctx.strokeStyle = C.ring; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(120,160,180,0.35)'; ctx.font = '10px Menlo, monospace';
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
        // extended centrelines for active arrival runways (10 NM, ticks each NM)
        if (span < 120 && act.arr.includes(r.id) && !r.closed) {
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
        ctx.strokeStyle = r.closed ? C.rwyClosed : (r.occupiedBy ? '#ffd27a' : C.rwy);
        ctx.lineWidth = span < 9 ? wpx : Math.max(2, Math.min(wpx, 4));
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(cam.sx(r.thr.x), cam.sy(r.thr.y)); ctx.lineTo(cam.sx(r.end.x), cam.sy(r.end.y)); ctx.stroke();
        if (span < 9) {
          // centreline dashes + designators
          ctx.strokeStyle = '#0b1218'; ctx.lineWidth = 1; ctx.setLineDash([8, 8]);
          ctx.beginPath(); ctx.moveTo(cam.sx(r.thr.x), cam.sy(r.thr.y)); ctx.lineTo(cam.sx(r.end.x), cam.sy(r.end.y)); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      if (span < 25) {
        ctx.fillStyle = '#e8f2f8'; ctx.font = `${span < 9 ? 13 : 11}px Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const r of ap.runways.values()) {
          const p = project(r.thr, r.trueHdg + 180, span < 9 ? 0.12 : 0.6);
          ctx.fillStyle = act.arr.includes(r.id) ? '#7ee2b8' : act.dep.includes(r.id) ? '#7fb4ff' : '#9fb3be';
          ctx.fillText(r.id, cam.sx(p.x), cam.sy(p.y));
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
      if (span > 25) {
        ctx.fillStyle = ap.major ? '#e6f0f5' : '#9fb3be'; ctx.font = `${ap.major ? 'bold ' : ''}11px Menlo, monospace`;
        ctx.fillText(ap.iata, cam.sx(ap.x) + 7, cam.sy(ap.y) + 14);
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
      ctx.strokeStyle = 'rgba(230,200,60,0.55)'; ctx.lineWidth = 1;
      for (const e of g.edges) { if (e.k === 'T') { this.path(e.pts); ctx.stroke(); } }
      ctx.strokeStyle = C.stand; ctx.lineWidth = 1;
      for (const e of g.edges) { if (e.k === 'P') { this.path(e.pts); ctx.stroke(); } }
      // taxiway names
      if (cam.span < 4) {
        ctx.fillStyle = 'rgba(230,200,60,0.8)'; ctx.font = '10px Menlo, monospace';
        const done = new Set();
        for (const e of g.edges) {
          if (e.k !== 'T' || !e.n || e.len < 0.06) continue;
          const key = e.n + Math.round(e.pts[0].x * 20) + Math.round(e.pts[0].y * 20);
          if (done.has(key)) continue; done.add(key);
          const m = e.pts[Math.floor(e.pts.length / 2)];
          ctx.fillText(e.n, cam.sx(m.x) + 2, cam.sy(m.y) - 2);
        }
        ctx.fillStyle = '#6d8796'; ctx.font = '9px Menlo, monospace';
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
      if (!isNav && /^[A-Z]{2}\d{3}$|^[A-Z]\d[A-Z]\d\d$|^RW/.test(f.id) && span > 30) continue; // coded RNAV points only when zoomed
      if (!isNav && span > 110) continue;
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
    ctx.font = '11px "Hiragino Sans", sans-serif'; ctx.fillStyle = 'rgba(140,165,180,0.45)';
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
      ctx.fillStyle = 'rgba(255,220,220,0.8)'; ctx.font = '10px Menlo, monospace'; ctx.fillText(`CB FL${Math.round(c.top / 100)}`, x - 22, y);
    }
  }

  drawConflicts() {
    const { ctx, cam } = this;
    for (const c of this.w.conflicts.list) {
      ctx.strokeStyle = c.level === 'LOS' ? C.los : C.stca; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(cam.sx(c.a.x), cam.sy(c.a.y)); ctx.lineTo(cam.sx(c.b.x), cam.sy(c.b.y)); ctx.stroke();
      ctx.setLineDash([]);
      const mx = (cam.sx(c.a.x) + cam.sx(c.b.x)) / 2, my = (cam.sy(c.a.y) + cam.sy(c.b.y)) / 2;
      ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 11px Menlo, monospace';
      ctx.fillText(`${c.dh.toFixed(1)}NM ${Math.round(c.dv / 100)}`, mx + 4, my - 4);
    }
  }

  // Display position: optionally quantised to a 4-second radar sweep.
  dispPos(ac) {
    if (!this.opts.radarUpdate) return ac;
    const s = this.radarSnap.get(ac.id);
    return s || ac;
  }
  sweep() {
    if (!this.opts.radarUpdate) return;
    if (this.w.time - this.lastSweep >= 4) {
      this.lastSweep = this.w.time;
      for (const ac of this.w.aircraft) this.radarSnap.set(ac.id, { x: ac.x, y: ac.y, hdg: ac.hdg, trk: ac.trk, gs: ac.gs, alt: ac.alt, vs: ac.vs });
    }
  }

  drawAircraft(span) {
    const { ctx, cam } = this;
    this.sweep();
    this.hit = [];
    const alerts = new Map();
    for (const c of this.w.conflicts.list) { for (const a of [c.a, c.b]) { if (alerts.get(a.id) !== 'LOS') alerts.set(a.id, c.level); } }
    const ls = this.opts.labelScale;
    const placed = [];
    // ground traffic first (only when zoomed in)
    const list = [...this.w.aircraft].sort((a, b) => (a.onGround === b.onGround ? 0 : a.onGround ? -1 : 1));
    for (const ac of list) {
      if (ac.onGround && span > 14) continue;
      const p = this.dispPos(ac);
      if (!this.visible(p, 120)) continue;
      const x = cam.sx(p.x), y = cam.sy(p.y);
      const sel = this.selected === ac;
      const al = alerts.get(ac.id);
      let col = ac.onGround ? C.ground : ac.dir === 'ARR' ? C.arr : ac.dir === 'DEP' ? C.dep : C.ovf;
      if (ac.emergency) col = C.emerg;
      if (al === 'STCA') col = C.stca;
      if (al === 'LOS') col = C.los;
      if (sel) col = C.sel;

      if (ac.onGround) { this.drawGroundAc(ac, x, y, col, sel, span); continue; }

      // history trail
      if (this.opts.trails) {
        ctx.fillStyle = col;
        ac.trail.forEach((t, i) => { ctx.globalAlpha = 0.15 + 0.5 * i / ac.trail.length; ctx.fillRect(cam.sx(t.x) - 1.2, cam.sy(t.y) - 1.2, 2.4, 2.4); });
        ctx.globalAlpha = 1;
      }
      // 1-minute velocity vector
      const v = project(p, p.trk ?? ac.trk, (p.gs ?? ac.gs) / 60);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cam.sx(v.x), cam.sy(v.y)); ctx.stroke();
      // symbol
      ctx.lineWidth = sel ? 2 : 1.4;
      ctx.beginPath();
      if (ac.dir === 'ARR') { ctx.rect(x - 4, y - 4, 8, 8); }
      else if (ac.dir === 'DEP') { ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.closePath(); }
      else { ctx.arc(x, y, 4.5, 0, Math.PI * 2); }
      ctx.stroke();
      if (al || ac.emergency) { ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke(); }

      // datablock
      const lines = this.datablock(ac, span);
      const fs = Math.round((span > 200 ? 10 : 11.5) * ls);
      ctx.font = `${fs}px Menlo, Consolas, monospace`;
      const lw = Math.max(...lines.map((l) => ctx.measureText(l.t).width));
      const lh = fs + 2, bh = lh * lines.length;
      let off = this.labelOffsets.get(ac.id);
      if (!off) off = this.autoOffset(x, y, lw, bh, placed);
      const bx = x + off.dx, by = y + off.dy;
      placed.push({ x: bx, y: by, w: lw, h: bh });
      // leader line
      ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
      const lx = off.dx >= 0 ? bx - 2 : bx + lw + 2, ly = by + bh / 2;
      ctx.beginPath(); ctx.moveTo(x + Math.sign(off.dx) * 5, y + Math.sign(off.dy) * 3); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.globalAlpha = 1;
      if (sel) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(bx - 3, by - 2, lw + 6, bh + 3); }
      lines.forEach((l, i) => { ctx.fillStyle = l.c || col; ctx.fillText(l.t, bx, by + lh * (i + 1) - 3); });
      this.hit.push({ ac, x, y, r: 22, box: { x: bx - 4, y: by - 4, w: lw + 8, h: bh + 8 } });
      // selected aircraft: draw remaining route
      if (sel) this.drawRoute(ac);
    }
  }

  autoOffset(x, y, w, h, placed) {
    const cands = [{ dx: 14, dy: -h - 6 }, { dx: 14, dy: 6 }, { dx: -w - 14, dy: -h - 6 }, { dx: -w - 14, dy: 6 }, { dx: 22, dy: -h / 2 }, { dx: -w - 22, dy: -h / 2 }];
    let best = cands[0], bs = Infinity;
    for (const c of cands) {
      const bx = x + c.dx, by = y + c.dy;
      let s = 0;
      for (const p of placed) {
        const ox = Math.max(0, Math.min(bx + w, p.x + p.w) - Math.max(bx, p.x));
        const oy = Math.max(0, Math.min(by + h, p.y + p.h) - Math.max(by, p.y));
        s += ox * oy;
      }
      if (s < bs) { bs = s; best = c; if (s === 0) break; }
    }
    return best;
  }

  datablock(ac, span) {
    const p = this.dispPos(ac);
    const alt = p.alt ?? ac.alt, vs = p.vs ?? ac.vs;
    const a3 = pad3(alt / 100);
    const arrow = vs > 300 ? '↑' : vs < -300 ? '↓' : ' ';
    const tgt = ac.hold?.level ?? (ac.vnav && !ac.manual.alt ? null : ac.clearedAlt);
    const cl = tgt != null && Math.abs(tgt - alt) > 150 ? pad3(tgt / 100) : (ac.vnav && !ac.manual.alt && Math.abs(vs) > 300 ? 'VIA' : '');
    const gs = String(Math.round((p.gs ?? ac.gs) / 10)).padStart(2, '0');
    const l1 = { t: ac.callsign + (ac.emergency ? ' EMRG' : '') + (ac.hold ? ' HLD' : '') };
    if (span > 200) return [l1, { t: `${a3}${arrow}` }];
    const l2 = { t: `${a3}${arrow}${cl}` };
    const dest = ac.dir === 'ARR' ? (ac.arrRwy ? ac.arrRwy.id : '') : (this.w.data.iata[ac.to] || ac.to);
    let l3 = { t: `${gs} ${ac.type} ${dest}` };
    if (ac.appr?.established) l3 = { t: `${gs} ${ac.type} ${ac.arrRwy.id}${ac.seq ? ' #' + ac.seq : ''}` };
    const lines = [l1, l2, l3];
    const asg = [];
    if (ac.lat.mode === 'HDG') asg.push('H' + pad3(ac.assignedMagHdg));
    if (ac.atcSpd) asg.push('S' + ac.atcSpd);
    if (asg.length && span < 140) lines.push({ t: asg.join(' '), c: '#4fd1c5' });
    return lines;
  }

  drawGroundAc(ac, x, y, col, sel, span) {
    const { ctx, cam } = this;
    const sc = Math.max(0.6, Math.min(2.5, cam.scale / 400));
    const L = { M: 38, H: 62, J: 72, L: 20 }[ac.wake] || 40;
    const len = Math.max(13, L / 1852 * cam.scale);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rad(ac.hdg));
    ctx.fillStyle = col; ctx.globalAlpha = sel ? 1 : 0.85;
    // simple aircraft silhouette (fuselage + wings + tail)
    ctx.beginPath();
    ctx.moveTo(0, -len / 2); ctx.lineTo(len * 0.06, -len * 0.38); ctx.lineTo(len * 0.06, -len * 0.08);
    ctx.lineTo(len * 0.5, len * 0.08); ctx.lineTo(len * 0.5, len * 0.14); ctx.lineTo(len * 0.06, len * 0.06);
    ctx.lineTo(len * 0.05, len * 0.36); ctx.lineTo(len * 0.2, len * 0.46); ctx.lineTo(len * 0.2, len * 0.5); ctx.lineTo(0, len * 0.46);
    ctx.lineTo(-len * 0.2, len * 0.5); ctx.lineTo(-len * 0.2, len * 0.46); ctx.lineTo(-len * 0.05, len * 0.36);
    ctx.lineTo(-len * 0.06, len * 0.06); ctx.lineTo(-len * 0.5, len * 0.14); ctx.lineTo(-len * 0.5, len * 0.08);
    ctx.lineTo(-len * 0.06, -len * 0.08); ctx.lineTo(-len * 0.06, -len * 0.38); ctx.closePath(); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
    if (span < 6) {
      ctx.font = `${Math.round(10 * this.opts.labelScale)}px Menlo, monospace`;
      ctx.fillStyle = col;
      const status = { PARKED: 'STND', PUSHBACK: 'PUSH', STARTUP: 'STUP', TAXI_OUT: 'TAXI', HOLD_SHORT: 'HOLD', LINEUP: 'LUP', LINED_UP: 'LUAW', TAKEOFF: 'T/O', ROLLOUT: 'LDG', TAXI_IN: 'TAXI' }[ac.phase] || ac.phase;
      const t1 = ac.callsign, t2 = `${status} ${ac.dir === 'DEP' ? ac.depRwy?.id || '' : ac.stand?.ref || ''}`;
      if (ac.phase !== 'PARKED' || span < 2.2 || sel) { ctx.fillText(t1, x + len / 2 + 3, y - 2); ctx.fillText(t2, x + len / 2 + 3, y + 9); }
      this.hit.push({ ac, x, y, r: Math.max(14, len / 2), box: { x: x + len / 2, y: y - 12, w: 60, h: 24 } });
    }
    if (sel && ac.taxi) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
      this.path([ac, ...ac.taxi.pts.slice(ac.taxi.i + 1)]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  drawRoute(ac) {
    const { ctx, cam } = this;
    const pts = [ac, ...ac.route.slice(ac.routeIdx)];
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
    this.path(pts); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '10px Menlo, monospace';
    for (const w of ac.route.slice(ac.routeIdx)) {
      if (w.kind === 'VEC' || w.kind === 'FNL') continue;
      if (!this.visible(w)) continue;
      ctx.fillText(w.id + (w.altMax != null || w.altMin != null ? ' ' + consStr(w) : ''), cam.sx(w.x) + 5, cam.sy(w.y) + 12);
    }
    if (ac.lat.mode === 'HDG') {
      const e = project(ac, ac.lat.hdg, 40);
      ctx.strokeStyle = 'rgba(79,209,197,0.6)'; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(cam.sx(ac.x), cam.sy(ac.y)); ctx.lineTo(cam.sx(e.x), cam.sy(e.y)); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  drawScale() {
    const { ctx, cam } = this;
    const nice = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
    let nm = nice.find((n) => n * cam.scale > 70) || 100;
    const px = nm * cam.scale, x0 = cam.w - 70 - px, y0 = cam.h - 16;
    ctx.strokeStyle = '#6d8796'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 4); ctx.stroke();
    ctx.fillStyle = '#6d8796'; ctx.font = '10px Menlo, monospace'; ctx.fillText(`${nm} NM`, x0 + px / 2 - 14, y0 - 6);
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
export { C as COLORS };
