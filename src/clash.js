/** Double-precision triangle distance and BVH narrow phase. No AABB-only final results. */
import { vadd, vsub, vmul, dot, cross, length, transform, emptyBox, extend, union, boxDistance2, BVH, rayTriangle, rayBox } from './math.js';
const sq = a => dot(a, a);
export function closestPointTriangle(p, a, b, c) {
    const ab = vsub(b, a), ac = vsub(c, a), ap = vsub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0)
        return a;
    const bp = vsub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3)
        return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0)
        return vadd(a, vmul(ab, d1 / (d1 - d3)));
    const cp = vsub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6)
        return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0)
        return vadd(a, vmul(ac, d2 / (d2 - d6)));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0)
        return vadd(b, vmul(vsub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
    const denom = va + vb + vc;
    if (Math.abs(denom) < 1e-30)
        return a;
    const inv = 1 / denom;
    return vadd(a, vadd(vmul(ab, vb * inv), vmul(ac, vc * inv)));
}
export function closestSegments(p1, q1, p2, q2) {
    const d1 = vsub(q1, p1), d2 = vsub(q2, p2), r = vsub(p1, p2), a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
    let s = 0, t = 0;
    const cl = x => Math.min(1, Math.max(0, x));
    if (a <= 1e-24 && e <= 1e-24)
        return [p1, p2];
    if (a <= 1e-24)
        t = cl(f / e);
    else {
        const c = dot(d1, r);
        if (e <= 1e-24)
            s = cl(-c / a);
        else {
            const b = dot(d1, d2), den = a * e - b * b;
            s = Math.abs(den) > 1e-24 ? cl((b * f - c * e) / den) : 0;
            t = (b * s + f) / e;
            if (t < 0) {
                t = 0;
                s = cl(-c / a);
            }
            else if (t > 1) {
                t = 1;
                s = cl((b - c) / a);
            }
        }
    }
    return [vadd(p1, vmul(d1, s)), vadd(p2, vmul(d2, t))];
}
export function triangleDistance(A, B) {
    let best = { distance2: Infinity, a: null, b: null };
    const take = (a, b) => {
        const d = sq(vsub(a, b));
        if (d < best.distance2)
            best = { distance2: d, a, b };
    };
    for (let i = 0; i < 3; i++) {
        const dir = vsub(A[(i + 1) % 3], A[i]), t = rayTriangle(A[i], dir, ...B);
        if (t !== null && t <= 1 + 1e-10) {
            const p = vadd(A[i], vmul(dir, t));
            return { distance2: 0, a: p, b: p };
        }
        const dir2 = vsub(B[(i + 1) % 3], B[i]), t2 = rayTriangle(B[i], dir2, ...A);
        if (t2 !== null && t2 <= 1 + 1e-10) {
            const p = vadd(B[i], vmul(dir2, t2));
            return { distance2: 0, a: p, b: p };
        }
    }
    for (const p of A)
        take(p, closestPointTriangle(p, ...B));
    for (const p of B)
        take(closestPointTriangle(p, ...A), p);
    for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++)
            take(...closestSegments(A[a], A[(a + 1) % 3], B[b], B[(b + 1) % 3]));
    return best;
}
function isClosed(tris) {
    const edges = new Map();
    const key = p => p.map(x => Math.round(x * 1e8)).join(',');
    for (const t of tris) {
        const p = t.points.map(key);
        for (let k = 0; k < 3; k++) {
            const a = p[k], b = p[(k + 1) % 3];
            if (a === b)
                continue;
            const id = a < b ? a + '|' + b : b + '|' + a;
            edges.set(id, (edges.get(id) || 0) + 1);
        }
    }
    return edges.size > 0 && [...edges.values()].every(n => n === 2);
}
export function worldMesh(parts, geometries) {
    const triangles = [], components = [];
    let index = 0;
    for (const p of parts) {
        const g = geometries.get(p.geometryId);
        if (!g)
            continue;
        const pos = g.positions, vertices = Array.from({ length: pos.length / 3 }, (_, i) => transform(p.matrix, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]])), start = triangles.length;
        for (let i = 0; i < g.indices.length; i += 3) {
            const points = [vertices[g.indices[i]], vertices[g.indices[i + 1]], vertices[g.indices[i + 2]]];
            if (sq(cross(vsub(points[1], points[0]), vsub(points[2], points[0]))) < 1e-24)
                continue;
            const box = emptyBox();
            points.forEach(v => extend(box, v));
            triangles.push({ id: index++, points, box });
        }
        const tris = triangles.slice(start);
        components.push({ point: vertices[0], closed: isClosed(tris), triangles: tris });
    }
    return { triangles, components, bvh: new BVH(triangles, 6) };
}
/** Parity only used for closed mesh components. Duplicate edge/vertex hits are coalesced. */
export function pointInside(point, component) {
    if (!component.closed || !component.triangles.length)
        return false;
    const d = [.87287156094, .43643578047, .21821789023], hits = [];
    for (const t of component.triangles) {
        const k = rayTriangle(point, d, ...t.points);
        if (k !== null && k > 1e-8)
            hits.push(k);
    }
    hits.sort((a, b) => a - b);
    let count = 0, prev = -Infinity;
    for (const h of hits)
        if (Math.abs(h - prev) > 1e-7 * Math.max(1, Math.abs(h))) {
            count++;
            prev = h;
        }
    return count % 2 === 1;
}
export function meshDistance(A, B, threshold = 0, hard = false) {
    const epsilon = 1e-6, limit = hard ? epsilon : threshold;
    let best = { distance2: Infinity, a: null, b: null };
    const stack = [[A.bvh.root, B.bvh.root]];
    while (stack.length) {
        const [a, b] = stack.pop();
        if (!a || !b)
            continue;
        const lower = boxDistance2(a.box, b.box);
        if (lower > Math.min(best.distance2, limit * limit))
            continue;
        if (a.items && b.items) {
            for (const t of a.items)
                for (const u of b.items) {
                    if (boxDistance2(t.box, u.box) > Math.min(best.distance2, limit * limit))
                        continue;
                    const hit = triangleDistance(t.points, u.points);
                    if (hit.distance2 < best.distance2)
                        best = hit;
                    if (best.distance2 <= epsilon * epsilon)
                        return { ...best, distance: 0, kind: 'contact / intersection' };
                }
        }
        else {
            let children;
            if (a.items)
                children = [[a, b.left], [a, b.right]];
            else if (b.items)
                children = [[a.left, b], [a.right, b]];
            else
                children = [[a.left, b.left], [a.left, b.right], [a.right, b.left], [a.right, b.right]];
            children.sort((x, y) => boxDistance2(y[0].box, y[1].box) - boxDistance2(x[0].box, x[1].box));
            stack.push(...children);
        }
    }
    // Surface distance alone misses a solid entirely contained in another solid.
    for (const a of A.components)
        for (const b of B.components) {
            if (a.point && pointInside(a.point, b))
                return { distance: 0, distance2: 0, a: a.point, b: a.point, kind: 'containment' };
            if (b.point && pointInside(b.point, a))
                return { distance: 0, distance2: 0, a: b.point, b: b.point, kind: 'containment' };
        }
    if (best.distance2 <= limit * limit)
        return { ...best, distance: Math.sqrt(best.distance2), kind: 'clearance' };
    return null;
}
export class ClashEngine {
    constructor() {
        this.geometries = new Map();
        this.entities = new Map();
        this.meshes = new Map();
        this.cache = new Map();
        this.revision = 0;
    }
    sync({ geometries = [], entities = [], revision = 0, reset = false }) {
        if (reset) {
            this.geometries.clear();
            this.entities.clear();
            this.meshes.clear();
            this.cache.clear();
        }
        if (geometries.some(([id]) => this.geometries.has(id))) {
            this.meshes.clear();
            this.cache.clear();
        }
        for (const [id, g] of geometries)
            this.geometries.set(id, g);
        const next = new Map();
        for (const e of entities) {
            next.set(e.id, e);
            const old = this.entities.get(e.id);
            if (!old || old.stamp !== e.stamp)
                this.meshes.delete(e.id);
        }
        for (const id of this.entities.keys())
            if (!next.has(id))
                this.meshes.delete(id);
        this.entities = next;
        this.index = new BVH(entities);
        this.revision = revision;
    }
    mesh(e) {
        if (!this.meshes.has(e.id))
            this.meshes.set(e.id, worldMesh(e.parts, this.geometries));
        return this.meshes.get(e.id);
    }
    async run(test, { onProgress = () => {
    }, cancelled = () => false } = {}) {
        const started = performance.now(), hard = test.mode === 'hard', threshold = hard ? 1e-6 : Math.max(0, Number(test.clearance) || 0), setA = new Set(test.idsA), setB = new Set(test.idsB), pairs = [], seen = new Set();
        let broadYield = performance.now();
        for (const id of setA) {
            if (cancelled())
                return { cancelled: true };
            const a = this.entities.get(id);
            if (!a)
                continue;
            for (const b of this.index.query(a.box, threshold)) {
                if (a.id === b.id || !setB.has(b.id))
                    continue;
                const key = [a.id, b.id].sort().join('|');
                if (seen.has(key))
                    continue;
                seen.add(key);
                pairs.push([a, b, key]);
                if (pairs.length > 2000000)
                    throw Error('More than 2M candidate pairs. Narrow the test scopes or clearance.');
            }
            if (performance.now() - broadYield > 18) {
                onProgress({ done: 0, total: pairs.length, tested: 0, reused: 0, found: 0, phase: 'broad' });
                await new Promise(r => setTimeout(r, 0));
                broadYield = performance.now();
            }
        }
        const results = [];
        let tested = 0, reused = 0, lastYield = performance.now();
        for (const [a, b, key] of pairs) {
            if (cancelled())
                return { cancelled: true };
            const cacheKey = `${key}|${a.stamp}|${b.stamp}|${test.mode}|${threshold}`;
            let hit;
            if (this.cache.has(cacheKey)) {
                hit = this.cache.get(cacheKey);
                reused++;
            }
            else {
                hit = meshDistance(this.mesh(a), this.mesh(b), threshold, hard);
                this.cache.set(cacheKey, hit);
                tested++;
            }
            if (hit)
                results.push({ id: key, a: a.id, b: b.id, distance: hit.distance, point: hit.a, pointB: hit.b, kind: hit.kind, status: 'New' });
            if (performance.now() - lastYield > 18) {
                onProgress({ done: tested + reused, total: pairs.length, tested, reused, found: results.length });
                await new Promise(r => setTimeout(r, 0));
                lastYield = performance.now();
            }
        }
        if (this.cache.size > 100000)
            this.cache.clear();
        onProgress({ done: pairs.length, total: pairs.length, tested, reused, found: results.length });
        return { results, stats: { candidates: pairs.length, tested, reused, milliseconds: performance.now() - started }, revision: this.revision, date: new Date().toISOString(), test: structuredClone(test) };
    }
}
