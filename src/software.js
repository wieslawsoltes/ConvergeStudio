/** Actual z-buffered software fallback for GPU-restricted environments; never advertised as GPU. */
import { transform, transform4, cross, vsub, norm, dot, clamp } from './math.js';
const DITHER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export class SoftwareRasterizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        if (!this.ctx)
            throw Error('No browser rendering context is available');
        this.scratch = document.createElement('canvas');
        this.context = this.scratch.getContext('2d', { alpha: false });
    }
    render(renderer, { solid = false } = {}) {
        const { store, camera } = renderer, canvas = this.canvas, scale = Math.min(1, 1000 / Math.max(canvas.width, canvas.height)), w = Math.max(1, Math.round(canvas.width * scale)), h = Math.max(1, Math.round(canvas.height * scale));
        this.width = w;
        this.height = h;
        if (!this.image || this.scratch.width !== w || this.scratch.height !== h) {
            this.scratch.width = w;
            this.scratch.height = h;
            this.image = this.context.createImageData(w, h);
            this.depth = new Float32Array(w * h);
            this.ids = new Uint32Array(w * h);
        }
        const pixels = this.image.data, depth = this.depth, ids = this.ids;
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 238;
            pixels[i + 1] = 241;
            pixels[i + 2] = 243;
            pixels[i + 3] = 255;
        }
        depth.fill(Infinity);
        ids.fill(0);
        const vp = camera.matrix, eye = camera.eye, light = norm([-.45, .85, .65]), section = store.doc.section;
        const items = store.instances.filter(i => i.visible);
        if (store.doc.display.grid)
            items.unshift({ geometryId: renderer.gridId, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], color: [.8, .83, .84, 1], pickId: 0, entityId: null });
        for (const item of items) {
            const g = item.geometryId === renderer.gridId ? renderer.grid : store.geometries.get(item.geometryId);
            if (!g)
                continue;
            const selected = store.selection.has(item.entityId);
            let color = [...item.color];
            if (store.clashPair) {
                if (item.entityId === store.clashPair[0])
                    color = [.94, .23, .24, 1];
                else if (item.entityId === store.clashPair[1])
                    color = [.15, .69, .4, 1];
                else if (store.doc.display.xray)
                    color = [.69, .75, .8, .18];
            }
            else if (store.doc.display.xray && !selected)
                color = [.72, .77, .81, .22];
            const vertices = Array.from({ length: g.positions.length / 3 }, (_, i) => {
                const world = transform(item.matrix, [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]]), q = transform4(vp, [...world, 1]);
                return { world, w: q[3], screen: [(q[0] / q[3] + 1) * w / 2, (1 - q[1] / q[3]) * h / 2, q[2] / q[3]] };
            });
            for (let k = 0; k < g.indices.length; k += 3) {
                const a = vertices[g.indices[k]], b = vertices[g.indices[k + 1]], c = vertices[g.indices[k + 2]];
                if (a.w <= 0 || b.w <= 0 || c.w <= 0)
                    continue;
                const [ax, ay, az] = a.screen, [bx, by, bz] = b.screen, [cx, cy, cz] = c.screen;
                if ((az > 1 && bz > 1 && cz > 1) || (az < -1 && bz < -1 && cz < -1))
                    continue;
                const minX = clamp(Math.floor(Math.min(ax, bx, cx)), 0, w - 1), maxX = clamp(Math.ceil(Math.max(ax, bx, cx)), 0, w - 1), minY = clamp(Math.floor(Math.min(ay, by, cy)), 0, h - 1), maxY = clamp(Math.ceil(Math.max(ay, by, cy)), 0, h - 1), area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
                if (Math.abs(area) < 1e-8)
                    continue;
                let n = norm(cross(vsub(b.world, a.world), vsub(c.world, a.world)));
                if (dot(n, vsub(eye, a.world)) < 0)
                    n = n.map(v => -v);
                const illum = .66 + .08 * n[1] + Math.max(0, dot(n, light)) * .34;
                let rgb = color.slice(0, 3).map(v => v * illum);
                if (selected && !store.clashPair)
                    rgb = rgb.map((v, i) => v * .42 + [.16, .72, .51][i] * .58);
                if (!item.pickId)
                    rgb = color.slice(0, 3);
                rgb = rgb.map(v => Math.round(clamp(v, 0, 1) * 255));
                const alpha = color[3] ?? 1;
                for (let y = minY; y <= maxY; y++)
                    for (let x = minX; x <= maxX; x++) {
                        const u = ((by - cy) * (x + .5 - cx) + (cx - bx) * (y + .5 - cy)) / area, v = ((cy - ay) * (x + .5 - cx) + (ax - cx) * (y + .5 - cy)) / area, t = 1 - u - v;
                        if (u < -1e-8 || v < -1e-8 || t < -1e-8)
                            continue;
                        const z = u * az + v * bz + t * cz, index = y * w + x;
                        if (z < -1 || z > 1 || z > depth[index])
                            continue;
                        if (alpha < .999 && alpha < (DITHER[(y % 4) * 4 + x % 4] + .5) / 16)
                            continue;
                        if (section.enabled && item.pickId) {
                            const inv = u / a.w + v / b.w + t / c.w;
                            let clipped = false;
                            for (let d = 0; d < 3; d++) {
                                const p = (u * a.world[d] / a.w + v * b.world[d] / b.w + t * c.world[d] / c.w) / inv;
                                if (p < section.min[d] || p > section.max[d]) {
                                    clipped = true;
                                    break;
                                }
                            }
                            if (clipped)
                                continue;
                        }
                        if (!solid && renderer.mode === 'wireframe' && item.pickId && Math.min(u, v, t) > .023)
                            continue;
                        depth[index] = z;
                        ids[index] = item.pickId;
                        const off = index * 4;
                        pixels[off] = rgb[0];
                        pixels[off + 1] = rgb[1];
                        pixels[off + 2] = rgb[2];
                    }
            }
        }
        this.context.putImageData(this.image, 0, 0);
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.drawImage(this.scratch, 0, 0, canvas.width, canvas.height);
    }
    pick(renderer, x, y) {
        this.render(renderer, { solid: true });
        const r = this.canvas.getBoundingClientRect(), px = clamp(Math.floor(x / r.width * this.width), 0, this.width - 1), py = clamp(Math.floor(y / r.height * this.height), 0, this.height - 1), id = this.ids[py * this.width + px];
        renderer.invalidate();
        return id;
    }
}
