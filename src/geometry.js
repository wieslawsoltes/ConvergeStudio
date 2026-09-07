import { bounds, cross, vsub, norm, dot } from './math.js';
export function geometry(positions, indices, normals = null) {
    const p = positions instanceof Float32Array ? positions : new Float32Array(positions), ix = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
    if (!p.length || p.length % 3 || !ix.length || ix.length % 3)
        throw Error('Invalid triangle geometry');
    if (p.some(x => !Number.isFinite(x)) || ix.some(x => x >= p.length / 3))
        throw Error('Invalid vertex or index');
    let n = normals ? new Float32Array(normals) : new Float32Array(p.length);
    if (!normals) {
        for (let i = 0; i < ix.length; i += 3) {
            const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3, normal = cross([p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]);
            for (const v of [a, b, c])
                for (let k = 0; k < 3; k++)
                    n[v + k] += normal[k];
        }
        for (let i = 0; i < n.length; i += 3) {
            const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
            n[i] /= l;
            n[i + 1] /= l;
            n[i + 2] /= l;
        }
    }
    if (n.length !== p.length || n.some(x => !Number.isFinite(x)))
        throw Error('Invalid normals');
    return { positions: p, indices: ix, normals: n, box: bounds(p) };
}
export function boxGeometry() {
    const p = [], n = [], ix = [];
    const faces = [[[1, 0, 0], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]], [[-1, 0, 0], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-.5, -.5, -.5]], [[0, 1, 0], [-.5, .5, -.5], [-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5]], [[0, -1, 0], [-.5, -.5, .5], [-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5]], [[0, 0, 1], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5], [-.5, -.5, .5]], [[0, 0, -1], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5], [.5, -.5, -.5]]];
    for (const [normal, ...v] of faces) {
        const s = p.length / 3;
        v.forEach(a => {
            p.push(...a);
            n.push(...normal);
        });
        ix.push(s, s + 1, s + 2, s, s + 2, s + 3);
    }
    return geometry(p, ix, n);
}
export function cylinderGeometry(segments = 24) {
    const p = [], n = [], ix = [];
    for (let i = 0; i <= segments; i++) {
        const a = i / segments * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
        for (const y of [-.5, .5]) {
            p.push(x * .5, y, z * .5);
            n.push(x, 0, z);
        }
    }
    for (let i = 0; i < segments; i++) {
        const a = i * 2;
        ix.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    for (const y of [-.5, .5]) {
        const c = p.length / 3;
        p.push(0, y, 0);
        n.push(0, y * 2, 0);
        for (let i = 0; i <= segments; i++) {
            const a = i / segments * Math.PI * 2;
            p.push(Math.cos(a) * .5, y, Math.sin(a) * .5);
            n.push(0, y * 2, 0);
        }
        for (let i = 0; i < segments; i++) {
            if (y > 0)
                ix.push(c, c + i + 2, c + i + 1);
            else
                ix.push(c, c + i + 1, c + i + 2);
        }
    }
    return geometry(p, ix, n);
}
/** Ear clipping for simple planar polygons, no holes. */
export function triangulate(points) {
    if (points.length < 3)
        throw Error('Polygon needs three vertices');
    let normal = [0, 0, 0];
    for (let i = 1; i < points.length - 1; i++) {
        normal = cross(vsub(points[i], points[0]), vsub(points[i + 1], points[0]));
        if (dot(normal, normal) > 1e-20)
            break;
    }
    const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))), axes = [0, 1, 2].filter(x => x !== axis), p = points.map(v => axes.map(a => v[a]));
    const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let area = 0;
    for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        area += a[0] * b[1] - b[0] * a[1];
    }
    const sign = area >= 0 ? 1 : -1, ids = p.map((_, i) => i), out = [];
    let guard = 0;
    while (ids.length > 3 && guard++ < p.length * p.length) {
        let found = false;
        for (let j = 0; j < ids.length; j++) {
            const a = ids[(j + ids.length - 1) % ids.length], b = ids[j], c = ids[(j + 1) % ids.length];
            if (orient(p[a], p[b], p[c]) * sign <= 1e-12)
                continue;
            const inside = ids.some(i => i !== a && i !== b && i !== c && orient(p[a], p[b], p[i]) * sign >= -1e-12 && orient(p[b], p[c], p[i]) * sign >= -1e-12 && orient(p[c], p[a], p[i]) * sign >= -1e-12);
            if (inside)
                continue;
            out.push(a, b, c);
            ids.splice(j, 1);
            found = true;
            break;
        }
        if (!found)
            throw Error('Degenerate or self-intersecting polygon');
    }
    if (ids.length === 3)
        out.push(...ids);
    return out;
}
export function extrudePolygon(points, direction) {
    const p = [...points.flat(), ...points.map(a => a.map((v, k) => v + direction[k])).flat()], n = points.length, cap = triangulate(points), ix = [];
    for (let i = 0; i < cap.length; i += 3) {
        ix.push(cap[i + 2], cap[i + 1], cap[i], n + cap[i], n + cap[i + 1], n + cap[i + 2]);
    }
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        ix.push(i, j, j + n, i, j + n, i + n);
    }
    return flatGeometry(p, ix);
}
export function flatGeometry(p, ix) {
    const out = [], ind = [];
    for (const i of ix) {
        ind.push(out.length / 3);
        out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    }
    return geometry(out, ind);
}
export function wireGeometry(g) {
    const p = [], ix = [], n = [];
    for (let i = 0; i < g.indices.length; i += 3)
        for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
            const u = g.indices[i + a] * 3, v = g.indices[i + b] * 3;
            ix.push(p.length / 3, p.length / 3 + 1);
            p.push(...g.positions.slice(u, u + 3), ...g.positions.slice(v, v + 3));
            n.push(0, 1, 0, 0, 1, 0);
        }
    return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint32Array(ix), box: g.box };
}
