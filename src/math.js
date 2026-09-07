/** Column-major matrices; double precision on CPU, float32 at GPU upload. Y-up, metres. */
export const EPS = 1e-9;
export const vadd = (a, b) => a.map((x, i) => x + b[i]);
export const vsub = (a, b) => a.map((x, i) => x - b[i]);
export const vmul = (a, s) => a.map(x => x * s);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(...a);
export const norm = a => vmul(a, 1 / (length(a) || 1));
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function multiply(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++)
                s += a[k * 4 + r] * b[c * 4 + k];
            o[c * 4 + r] = s;
        }
    return o;
}
export function transform(m, p, w = 1) {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * w, m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * w, m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * w];
}
export function transform4(m, p) {
    return [0, 1, 2, 3].map(r => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * p[3]);
}
export function inverse(a) {
    const aug = Array.from({ length: 4 }, (_, r) => [...Array.from({ length: 4 }, (_, c) => a[c * 4 + r]), ...Array.from({ length: 4 }, (_, c) => r === c ? 1 : 0)]);
    for (let c = 0; c < 4; c++) {
        let p = c;
        for (let r = c + 1; r < 4; r++)
            if (Math.abs(aug[r][c]) > Math.abs(aug[p][c]))
                p = r;
        if (Math.abs(aug[p][c]) < 1e-20)
            throw Error('Singular transform');
        [aug[c], aug[p]] = [aug[p], aug[c]];
        let s = aug[c][c];
        for (let k = 0; k < 8; k++)
            aug[c][k] /= s;
        for (let r = 0; r < 4; r++)
            if (r !== c) {
                s = aug[r][c];
                for (let k = 0; k < 8; k++)
                    aug[r][k] -= s * aug[c][k];
            }
    }
    return Array.from({ length: 16 }, (_, i) => aug[i % 4][4 + Math.floor(i / 4)]);
}
export function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
    const [x, y, z, w] = q;
    return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0, 2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0, 2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, ...t, 1];
}
export function translation(t) {
    const a = identity();
    a.splice(12, 3, ...t);
    return a;
}
export function rotationY(a) {
    return trs([0, 0, 0], [0, Math.sin(a / 2), 0, Math.cos(a / 2)]);
}
export function lookAt(eye, target, up = [0, 1, 0]) {
    const z = norm(vsub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
export function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
export function orthographic(half, aspect, near, far) {
    return [1 / (half * aspect), 0, 0, 0, 0, 1 / half, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
}
export const emptyBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
export function extend(b, p) {
    for (let k = 0; k < 3; k++) {
        b.min[k] = Math.min(b.min[k], p[k]);
        b.max[k] = Math.max(b.max[k], p[k]);
    }
    return b;
}
export const union = (a, b) => {
    extend(a, b.min);
    extend(a, b.max);
    return a;
};
export const center = b => b.min.map((v, i) => (v + b.max[i]) / 2);
export const size = b => b.min.map((v, i) => b.max[i] - v);
export const validBox = b => b && b.min.every((v, i) => Number.isFinite(v) && Number.isFinite(b.max[i]) && v <= b.max[i]);
export function bounds(positions) {
    const b = emptyBox();
    for (let i = 0; i < positions.length; i += 3)
        extend(b, [positions[i], positions[i + 1], positions[i + 2]]);
    return b;
}
export function transformBox(b, m) {
    const o = emptyBox();
    for (let i = 0; i < 8; i++)
        extend(o, transform(m, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]));
    return o;
}
export const overlaps = (a, b, e = 0) => a.min.every((v, k) => v <= b.max[k] + e && a.max[k] + e >= b.min[k]);
export const boxDistance2 = (a, b) => a.min.reduce((s, v, k) => s + Math.max(0, v - b.max[k], b.min[k] - a.max[k]) ** 2, 0);
export function rayBox(o, d, b, max = Infinity) {
    let lo = 0, hi = max;
    for (let k = 0; k < 3; k++) {
        if (Math.abs(d[k]) < EPS) {
            if (o[k] < b.min[k] || o[k] > b.max[k])
                return null;
            continue;
        }
        let a = (b.min[k] - o[k]) / d[k], c = (b.max[k] - o[k]) / d[k];
        if (a > c)
            [a, c] = [c, a];
        lo = Math.max(lo, a);
        hi = Math.min(hi, c);
        if (lo > hi)
            return null;
    }
    return lo;
}
export function rayTriangle(o, d, a, b, c) {
    const e1 = vsub(b, a), e2 = vsub(c, a), p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12)
        return null;
    const f = 1 / det, t = vsub(o, a), u = dot(t, p) * f;
    if (u < -1e-9 || u > 1 + 1e-9)
        return null;
    const q = cross(t, e1), v = dot(d, q) * f;
    if (v < -1e-9 || u + v > 1 + 1e-9)
        return null;
    const distance = dot(e2, q) * f;
    return distance >= 0 ? distance : null;
}
/** Median-split BVH, reused for scene bounds and triangle bounds. */
export class BVH {
    constructor(items, leaf = 8) {
        this.leaf = leaf;
        this.root = this.build(items.slice());
    }
    build(items) {
        if (!items.length)
            return null;
        const box = emptyBox();
        items.forEach(i => union(box, i.box));
        if (items.length <= this.leaf)
            return { box, items };
        const d = size(box), axis = d.indexOf(Math.max(...d));
        items.sort((a, b) => center(a.box)[axis] - center(b.box)[axis]);
        const mid = items.length >> 1;
        return { box, left: this.build(items.slice(0, mid)), right: this.build(items.slice(mid)) };
    }
    query(box, margin = 0) {
        const out = [], stack = [this.root];
        while (stack.length) {
            const n = stack.pop();
            if (!n || !overlaps(n.box, box, margin))
                continue;
            if (n.items)
                for (const i of n.items) {
                    if (overlaps(i.box, box, margin))
                        out.push(i);
                }
            else
                stack.push(n.left, n.right);
        }
        return out;
    }
    ray(o, d, max = Infinity) {
        const out = [], stack = [this.root];
        while (stack.length) {
            const n = stack.pop();
            if (!n || rayBox(o, d, n.box, max) === null)
                continue;
            if (n.items)
                for (const i of n.items) {
                    if (rayBox(o, d, i.box, max) !== null)
                        out.push(i);
                }
            else
                stack.push(n.left, n.right);
        }
        return out;
    }
}
export class Camera {
    constructor() {
        this.target = [0, 4, 0];
        this.distance = 36;
        this.yaw = .76;
        this.pitch = .47;
        this.ortho = false;
        this.fov = Math.PI / 4;
        this.aspect = 1;
        this.scale = 30;
    }
    get eye() {
        const c = Math.cos(this.pitch);
        return vadd(this.target, vmul([Math.sin(this.yaw) * c, Math.sin(this.pitch), Math.cos(this.yaw) * c], this.distance));
    }
    get matrix() {
        const near = Math.max(.001, this.distance / 20000), far = Math.max(1000, this.distance * 40, this.scale * 20);
        return multiply(this.ortho ? orthographic(this.distance * .4, this.aspect, near, far) : perspective(this.fov, this.aspect, near, far), lookAt(this.eye, this.target));
    }
    fit(box) {
        if (!validBox(box))
            return;
        this.target = center(box);
        this.scale = Math.max(.1, length(size(box)));
        this.distance = this.scale / (2 * Math.sin(this.fov / 2)) * 1.08 / Math.min(this.aspect, 1);
    }
    orbit(dx, dy) {
        this.yaw -= dx * .008;
        this.pitch = clamp(this.pitch + dy * .008, -Math.PI * .495, Math.PI * .495);
    }
    pan(dx, dy, height) {
        const z = norm(vsub(this.eye, this.target)), x = norm(cross([0, 1, 0], z)), y = cross(z, x), s = this.distance * .85 / height;
        this.target = vadd(this.target, vadd(vmul(x, -dx * s), vmul(y, dy * s)));
    }
    zoom(delta) {
        this.distance = clamp(this.distance * Math.exp(delta * .001), .005, 1e9);
    }
    serialize() {
        return { target: [...this.target], distance: this.distance, yaw: this.yaw, pitch: this.pitch, ortho: this.ortho, scale: this.scale };
    }
    restore(v) {
        this.target = [...v.target];
        for (const key of ['distance', 'yaw', 'pitch', 'scale'])
            if (Number.isFinite(v[key]))
                this[key] = v[key];
        this.ortho = !!v.ortho;
    }
    project(p, width, height) {
        const q = transform4(this.matrix, [...p, 1]);
        if (q[3] <= 0)
            return null;
        return [(q[0] / q[3] + 1) * width / 2, (1 - q[1] / q[3]) * height / 2, q[2] / q[3]];
    }
    ray(x, y, width, height) {
        const m = inverse(this.matrix), a = transform4(m, [x / width * 2 - 1, 1 - y / height * 2, -1, 1]), b = transform4(m, [x / width * 2 - 1, 1 - y / height * 2, 1, 1]);
        const p = a.slice(0, 3).map(v => v / a[3]), q = b.slice(0, 3).map(v => v / b[3]);
        return { origin: p, direction: norm(vsub(q, p)) };
    }
}
