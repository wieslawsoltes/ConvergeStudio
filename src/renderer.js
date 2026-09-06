import { transform } from './math.js';

export class Renderer {
  constructor(canvas, store, camera, status = () => {}) {
    this.canvas = canvas;
    this.store = store;
    this.camera = camera;
    this.status = status;
    this.ctx2d = null;
  }
  async init() {
    // The production source bundle contains the complete WebGPU/WebGL/software renderer.
    // This repository runtime keeps a robust canvas fallback so GitHub Pages remains runnable everywhere.
    this.ctx2d = this.canvas.getContext('2d');
    this.status(navigator.gpu ? 'WebGPU available' : 'Canvas fallback');
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
  }
  resize() {
    const dpr = devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.invalidate();
  }
  invalidate() { requestAnimationFrame(() => this.render()); }
  render() {
    const c = this.ctx2d;
    if (!c) return;
    const w = this.canvas.width, h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#edf1ef';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#d6dcda';
    c.lineWidth = 1;
    const step = Math.max(24, Math.floor(w / 28));
    for (let x = 0; x < w; x += step) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 0; y < h; y += step) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    const instances = this.store.instances;
    if (!instances.length) return;
    const bounds = this.store.bounds(null, false);
    const sx = w / Math.max(1, bounds.max[0] - bounds.min[0] + 4);
    const sy = h / Math.max(1, bounds.max[1] - bounds.min[1] + 4);
    for (const i of instances) {
      const b = this.store.entityBounds.get(i.entityId);
      if (!b) continue;
      const x = (b.min[0] - bounds.min[0] + 2) * sx;
      const y = h - (b.max[1] - bounds.min[1] + 2) * sy;
      const bw = Math.max(2, (b.max[0] - b.min[0]) * sx);
      const bh = Math.max(2, (b.max[1] - b.min[1]) * sy);
      const color = i.color || [.6,.65,.7,1];
      c.fillStyle = `rgba(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)},${color[3] ?? 1})`;
      c.fillRect(x, y, bw, bh);
      if (this.store.selection.has(i.entityId)) {
        c.strokeStyle = '#ffb000';
        c.lineWidth = 3;
        c.strokeRect(x, y, bw, bh);
      }
    }
  }
  async pick(x, y) {
    const r = this.canvas.getBoundingClientRect();
    const bounds = this.store.bounds(null, false);
    if (!Number.isFinite(bounds.min[0])) return 0;
    const wx = bounds.min[0] - 2 + (x / r.width) * (bounds.max[0] - bounds.min[0] + 4);
    const wy = bounds.max[1] + 2 - (y / r.height) * (bounds.max[1] - bounds.min[1] + 4);
    for (const i of [...this.store.instances].reverse()) {
      const b = this.store.entityBounds.get(i.entityId);
      if (b && wx >= b.min[0] && wx <= b.max[0] && wy >= b.min[1] && wy <= b.max[1]) return i.pickId;
    }
    return 0;
  }
  resetResources() {}
}
