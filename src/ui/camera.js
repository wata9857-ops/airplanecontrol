// Camera with continuous zoom + named presets for the four map levels.
import { toXY } from '../geo.js';

export const VIEWS = [
  { id: 'L1-KANSAI', level: 1, label: '関西 広域', short: 'KNS-W', lat: 34.55, lon: 135.55, span: 330 },
  { id: 'L1-KANTO', level: 1, label: '関東 広域', short: 'KNT-W', lat: 35.55, lon: 139.75, span: 330 },
  { id: 'L2-KANSAI', level: 2, label: '関西', short: 'KNS', lat: 34.55, lon: 135.35, span: 130 },
  { id: 'L2-KANTO', level: 2, label: '関東', short: 'KNT', lat: 35.55, lon: 140.0, span: 130 },
  { id: 'L3-RJBB', level: 3, label: 'KIX', short: 'KIX', lat: 34.43, lon: 135.23, span: 56, airport: 'RJBB' },
  { id: 'L3-RJTT', level: 3, label: 'HND', short: 'HND', lat: 35.55, lon: 139.80, span: 52, airport: 'RJTT' },
  { id: 'L3-RJAA', level: 3, label: 'NRT', short: 'NRT', lat: 35.77, lon: 140.39, span: 52, airport: 'RJAA' },
  { id: 'L4-RJBB', level: 4, label: 'KIX 空港', short: 'KIX⌂', lat: 34.437, lon: 135.233, span: 3.6, airport: 'RJBB' },
  { id: 'L4-RJTT', level: 4, label: 'HND 空港', short: 'HND⌂', lat: 35.551, lon: 139.787, span: 3.4, airport: 'RJTT' },
  { id: 'L4-RJAA', level: 4, label: 'NRT 空港', short: 'NRT⌂', lat: 35.770, lon: 140.384, span: 3.6, airport: 'RJAA' },
];

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.scale = 2; this.w = 800; this.h = 600; this.anim = null; this.rot = 0; }
  resize(w, h) { this.w = w; this.h = h; }
  // world (NM) -> screen px
  sx(x) { return this.w / 2 + (x - this.x) * this.scale; }
  sy(y) { return this.h / 2 - (y - this.y) * this.scale; }
  wx(px) { return this.x + (px - this.w / 2) / this.scale; }
  wy(py) { return this.y - (py - this.h / 2) / this.scale; }
  spanToScale(span) { return Math.min(this.w, this.h) / span; }
  goto(view, animate = true) {
    const c = toXY(view.lat, view.lon);
    const target = { x: c.x, y: c.y, scale: this.spanToScale(view.span) };
    if (!animate) { Object.assign(this, target); this.anim = null; return; }
    this.anim = { from: { x: this.x, y: this.y, scale: this.scale }, to: target, t: 0, dur: 0.9 };
  }
  tick(dt) {
    if (!this.anim) return false;
    const a = this.anim; a.t += dt;
    const k = Math.min(1, a.t / a.dur), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    // zoom in log space for smoothness
    const ls = Math.log(a.from.scale) + (Math.log(a.to.scale) - Math.log(a.from.scale)) * e;
    this.scale = Math.exp(ls);
    this.x = a.from.x + (a.to.x - a.from.x) * e;
    this.y = a.from.y + (a.to.y - a.from.y) * e;
    if (k >= 1) this.anim = null;
    return true;
  }
  zoomAt(px, py, factor) {
    const wx = this.wx(px), wy = this.wy(py);
    this.scale = Math.max(0.6, Math.min(4000, this.scale * factor));
    this.x = wx - (px - this.w / 2) / this.scale;
    this.y = wy + (py - this.h / 2) / this.scale;
    this.anim = null;
  }
  pan(dx, dy) { this.x -= dx / this.scale; this.y += dy / this.scale; this.anim = null; }
  // Derived map level from current scale (span of the shorter screen side)
  get span() { return Math.min(this.w, this.h) / this.scale; }
  get level() { const s = this.span; return s > 200 ? 1 : s > 80 ? 2 : s > 12 ? 3 : 4; }
}
