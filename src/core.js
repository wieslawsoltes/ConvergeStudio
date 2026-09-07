import { identity, multiply, emptyBox, union, transformBox, validBox, BVH, transform, rayTriangle, vadd, vmul } from './math.js';
import { geometry } from './geometry.js';
/** Full 122-bit random UUID; getRandomValues also works in opaque/insecure fallback contexts. */
export function uid(prefix) {
    if (typeof crypto.randomUUID === 'function')
        return `${prefix}-${crypto.randomUUID()}`;
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
    return `${prefix}-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const clone = o => structuredClone(o);
export function emptyDocument() {
    return { schema: 1, name: 'Untitled coordination', models: [], entities: [], sets: [], views: [], issues: [], measurements: [], tests: [], results: {}, section: { enabled: false, min: [-1000, -1000, -1000], max: [1000, 1000, 1000] }, display: { xray: false, grid: true }, camera: null, activity: [] };
}
export class Store extends EventTarget {
    constructor() {
        super();
        this.doc = emptyDocument();
        this.geometries = new Map();
        this.selection = new Set();
        this.undoStack = [];
        this.redoStack = [];
        this.revision = 0;
        this.geometryEpoch = 0;
        this.sceneRevision = 0;
        this.instances = [];
        this.byId = new Map();
        this.byPick = new Map();
        this.entityBounds = new Map();
        this.clashPair = null;
        this.index = new BVH([]);
    }
    emit(type, detail = {}) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }
    command(label, fn, { geometryChanged = false } = {}) {
        const before = clone(this.doc);
        try {
            fn(this.doc);
            this.doc.activity.unshift({ time: new Date().toISOString(), label });
            this.doc.activity.length = Math.min(150, this.doc.activity.length);
            this.undoStack.push({ before, after: clone(this.doc), label, geometryChanged });
            if (this.undoStack.length > 60)
                this.undoStack.shift();
            this.redoStack = [];
            this.changed(geometryChanged);
        }
        catch (e) {
            this.doc = before;
            this.rebuild();
            throw e;
        }
    }
    changed(geometryChanged = false) {
        this.revision++;
        if (geometryChanged)
            this.geometryEpoch++;
        this.sceneRevision++;
        this.rebuild();
        this.emit('change', { geometryChanged });
    }
    undo() {
        const x = this.undoStack.pop();
        if (!x)
            return;
        this.doc = clone(x.before);
        this.redoStack.push(x);
        this.changed(x.geometryChanged);
    }
    redo() {
        const x = this.redoStack.pop();
        if (!x)
            return;
        this.doc = clone(x.after);
        this.undoStack.push(x);
        this.changed(x.geometryChanged);
    }
    replace(doc, geometries) {
        this.doc = doc;
        this.geometries = geometries;
        this.undoStack = [];
        this.redoStack = [];
        this.selection.clear();
        this.clashPair = null;
        this.changed(true);
    }
    rebuild() {
        this.instances = [];
        this.entityBounds.clear();
        this.byId = new Map(this.doc.entities.map(e => [e.id, e]));
        this.byPick.clear();
        const models = new Map(this.doc.models.map(m => [m.id, m]));
        let pick = 0;
        const items = [];
        for (const e of this.doc.entities) {
            const m = models.get(e.modelId);
            if (!m)
                continue;
            e.pickId = ++pick;
            this.byPick.set(pick, e.id);
            const eb = emptyBox(), world = multiply(m.matrix, e.matrix);
            for (const p of e.parts) {
                const g = this.geometries.get(p.geometryId);
                if (!g)
                    continue;
                const matrix = multiply(world, p.matrix || identity()), box = transformBox(g.box, matrix);
                union(eb, box);
                this.instances.push({ entityId: e.id, pickId: pick, geometryId: p.geometryId, matrix, box, color: e.overrideColor || p.color || e.color || [.65, .7, .75, 1], visible: m.visible !== false && e.visible !== false, modelId: m.id });
            }
            if (validBox(eb)) {
                this.entityBounds.set(e.id, eb);
                items.push({ id: e.id, box: eb });
            }
        }
        this.index = new BVH(items);
        this.selection = new Set([...this.selection].filter(id => this.byId.has(id)));
    }
    select(ids, add = false) {
        if (!add)
            this.selection.clear();
        for (const id of ids) {
            if (!this.byId.has(id))
                continue;
            if (add && this.selection.has(id))
                this.selection.delete(id);
            else
                this.selection.add(id);
        }
        this.clashPair = null;
        this.sceneRevision++;
        this.emit('selection');
    }
    bounds(ids = null, visible = true) {
        const b = emptyBox(), filter = ids ? new Set(ids) : null;
        for (const i of this.instances)
            if ((!visible || i.visible) && (!filter || filter.has(i.entityId)))
                union(b, i.box);
        return b;
    }
    raycast(origin, direction, id = null) {
        let nearest = Infinity, result = null;
        const ids = id ? new Set([id]) : new Set(this.index.ray(origin, direction).map(x => x.id)), s = this.doc.section;
        for (const it of this.instances) {
            if (!it.visible || !ids.has(it.entityId))
                continue;
            const g = this.geometries.get(it.geometryId), p = g.positions;
            for (let k = 0; k < g.indices.length; k += 3) {
                const pts = [0, 1, 2].map(j => {
                    const v = g.indices[k + j] * 3;
                    return transform(it.matrix, [p[v], p[v + 1], p[v + 2]]);
                });
                const d = rayTriangle(origin, direction, ...pts);
                if (d === null || d >= nearest)
                    continue;
                const point = vadd(origin, vmul(direction, d));
                if (s.enabled && point.some((v, k) => v < s.min[k] - 1e-6 || v > s.max[k] + 1e-6))
                    continue;
                nearest = d;
                result = { point, id: it.entityId, distance: d };
            }
        }
        return result;
    }
    async addImport(data) {
        for (const [id, g] of data.geometries)
            this.geometries.set(id, g);
        this.command(`Append ${data.model.name}`, d => {
            d.models.push(data.model);
            d.entities.push(...data.entities);
            for (const run of Object.values(d.results))
                run.stale = true;
        }, { geometryChanged: true });
    }
    pack(portable = false) {
        const needed = new Set(this.doc.entities.flatMap(e => e.parts.map(p => p.geometryId)));
        return { format: 'converge-studio', version: 1, document: clone(this.doc), geometries: [...needed].map(id => {
                const g = this.geometries.get(id);
                return [id, { positions: portable ? Array.from(g.positions) : g.positions, normals: portable ? Array.from(g.normals) : g.normals, indices: portable ? Array.from(g.indices) : g.indices }];
            }) };
    }
}
export function unpack(data) {
    if (data?.format !== 'converge-studio' || data.version !== 1 || data.document?.schema !== 1)
        throw Error('Not a supported Converge Studio project');
    const doc = clone(data.document);
    for (const key of ['models', 'entities', 'sets', 'views', 'issues', 'measurements', 'tests', 'activity'])
        if (!Array.isArray(doc[key]))
            throw Error(`Project is missing ${key}`);
    if (doc.entities.length > 2000000)
        throw Error('Project exceeds the 2M element safety limit');
    const geometries = new Map();
    for (const [id, g] of data.geometries || []) {
        if (geometries.has(id))
            throw Error('Duplicate geometry ID');
        geometries.set(id, geometry(g.positions, g.indices, g.normals));
    }
    const mids = new Set(), eids = new Set();
    const matrix = m => Array.isArray(m) && m.length === 16 && m.every(Number.isFinite) && Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]) + Math.abs(m[15] - 1) < 1e-8;
    for (const m of doc.models) {
        if (typeof m.id !== 'string' || !m.id || typeof m.name !== 'string' || mids.has(m.id) || !matrix(m.matrix))
            throw Error('Invalid model ID or affine transform');
        mids.add(m.id);
    }
    for (const e of doc.entities) {
        if (typeof e.id !== 'string' || !e.id || typeof e.name !== 'string' || eids.has(e.id) || !mids.has(e.modelId) || !matrix(e.matrix) || !Array.isArray(e.parts))
            throw Error('Invalid element reference or transform');
        eids.add(e.id);
        if (!Array.isArray(e.path) || !e.path.every(p => typeof p === 'string') || !e.properties || typeof e.properties !== 'object' || Array.isArray(e.properties))
            throw Error('Invalid element hierarchy or properties');
        for (const p of e.parts)
            if (!geometries.has(p.geometryId) || (p.matrix && !matrix(p.matrix)))
                throw Error('Invalid geometry reference');
    }
    if (!doc.section || !['min', 'max'].every(k => Array.isArray(doc.section[k]) && doc.section[k].length === 3 && doc.section[k].every(Number.isFinite)) || doc.section.min.some((x, i) => x > doc.section.max[i]))
        throw Error('Invalid section box');
    const vec3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    const camera = c => c && vec3(c.target) && ['yaw', 'pitch', 'distance', 'scale'].every(k => Number.isFinite(c[k])) && c.distance > 0 && c.scale > 0;
    const section = s => s && vec3(s.min) && vec3(s.max) && s.min.every((v, i) => v <= s.max[i]);
    const strings = v => Array.isArray(v) && v.every(x => typeof x === 'string');
    const view = v => {
        if (!v || !camera(v.camera) || !section(v.section) || !v.display || !strings(v.selection || []) || !strings(v.hiddenEntities || []) || !strings(v.hiddenModels || []))
            throw Error('Invalid saved viewpoint');
        if (v.snapshot && !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(v.snapshot))
            throw Error('Invalid viewpoint image');
    };
    if (doc.camera && !camera(doc.camera))
        throw Error('Invalid project camera');
    for (const v of doc.views)
        view(v);
    for (const s of doc.sets)
        if (typeof s.name !== 'string' || !strings(s.ids))
            throw Error('Invalid selection set');
    for (const m of doc.measurements)
        if (!vec3(m.a) || !vec3(m.b))
            throw Error('Invalid measurement');
    for (const t of doc.tests)
        if (typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.scopeA !== 'string' || typeof t.scopeB !== 'string' || !['hard', 'clearance'].includes(t.mode) || !Number.isFinite(t.clearance) || t.clearance < 0)
            throw Error('Invalid clash test');
    for (const i of doc.issues) {
        if (typeof i.title !== 'string' || !strings(i.entityIds) || !Array.isArray(i.comments))
            throw Error('Invalid coordination issue');
        if (i.view)
            view(i.view);
    }
    doc.results ??= {};
    if (typeof doc.results !== 'object' || Array.isArray(doc.results))
        throw Error('Invalid clash results');
    for (const run of Object.values(doc.results)) {
        if (!run || !Array.isArray(run.results))
            throw Error('Invalid clash result set');
        for (const hit of run.results)
            if (typeof hit.id !== 'string' || typeof hit.a !== 'string' || typeof hit.b !== 'string' || !Number.isFinite(hit.distance) || hit.distance < 0 || !vec3(hit.point))
                throw Error('Invalid clash result');
    }
    doc.display ??= { xray: false, grid: true };
    return { doc, geometries };
}
export class Persistence {
    async open() {
        if (this.db)
            return this.db;
        this.db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('converge-studio', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('projects');
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
        return this.db;
    }
    async save(data) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readwrite');
            tx.objectStore('projects').put(data, 'autosave');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || Error('Autosave aborted'));
        });
    }
    async load() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const r = db.transaction('projects').objectStore('projects').get('autosave');
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    }
}
