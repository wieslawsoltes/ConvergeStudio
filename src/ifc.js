import { identity, multiply, trs, transform, norm, cross, vsub, vmul } from './math.js';
import { geometry, flatGeometry, extrudePolygon, triangulate } from './geometry.js';
import { uid } from './core.js';
const ref = x => x && typeof x === 'object' && !Array.isArray(x) && Number.isInteger(x.ref) ? x.ref : null;
export const unwrap = x => x?.value !== undefined ? unwrap(x.value) : x?.typed ? unwrap(x.args[0]) : Array.isArray(x) ? x.map(unwrap) : x;
function stepString(s) {
    return s.replace(/\\X2\\([\da-f]+)\\X0\\/gi, (_, x) => x.match(/.{4}/g).map(h => String.fromCharCode(parseInt(h, 16))).join('')).replace(/\\X\\([\da-f]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16)));
}
/** ISO-10303-21 tokenizer: quoted strings, typed values, nested lists and references. */
export function parseSTEP(text) {
    const records = new Map();
    let pos = 0;
    function ws() {
        while (pos < text.length) {
            if (/\s/.test(text[pos])) {
                pos++;
                continue;
            }
            if (text.slice(pos, pos + 2) === '/*') {
                const end = text.indexOf('*/', pos + 2);
                if (end < 0)
                    throw Error('Unterminated STEP comment');
                pos = end + 2;
                continue;
            }
            break;
        }
    }
    function val() {
        ws();
        const c = text[pos++];
        if (c === "'") {
            let out = '';
            while (pos < text.length) {
                const t = text[pos++];
                if (t === "'") {
                    if (text[pos] === "'") {
                        out += "'";
                        pos++;
                    }
                    else
                        return stepString(out);
                }
                else
                    out += t;
            }
            throw Error('Unterminated STEP string');
        }
        if (c === '(') {
            const a = [];
            ws();
            if (text[pos] === ')') {
                pos++;
                return a;
            }
            while (pos < text.length) {
                a.push(val());
                ws();
                const x = text[pos++];
                if (x === ')')
                    return a;
                if (x !== ',')
                    throw Error('Malformed STEP list');
            }
            throw Error('Unterminated STEP list');
        }
        if (c === '#') {
            let s = '';
            while (/\d/.test(text[pos] || ''))
                s += text[pos++];
            return { ref: Number(s) };
        }
        if (c === '$' || c === '*')
            return null;
        if (c === '.' && /[A-Za-z]/.test(text[pos] || '')) {
            let s = '';
            while (pos < text.length && text[pos] !== '.')
                s += text[pos++];
            pos++;
            return s.toUpperCase();
        }
        let s = c;
        while (pos < text.length && !/[\s,();]/.test(text[pos]))
            s += text[pos++];
        if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(s))
            return Number(s);
        ws();
        if (text[pos] === '(')
            return { typed: s.toUpperCase(), args: val() };
        return s;
    }
    const dataStart = text.indexOf('DATA;');
    if (dataStart < 0 || !text.includes('ISO-10303-21'))
        throw Error('Not an IFC STEP file');
    pos = dataStart + 5;
    while (pos < text.length) {
        ws();
        if (text.startsWith('ENDSEC', pos))
            break;
        if (text[pos] !== '#') {
            pos++;
            continue;
        }
        pos++;
        let id = '';
        while (/\d/.test(text[pos] || ''))
            id += text[pos++];
        ws();
        if (text[pos++] !== '=')
            throw Error('Malformed IFC entity');
        ws();
        let type = '';
        while (/[A-Za-z0-9_]/.test(text[pos] || ''))
            type += text[pos++];
        const args = val();
        ws();
        if (text[pos++] !== ';' || !Array.isArray(args))
            throw Error('Malformed IFC record');
        records.set(Number(id), { id: Number(id), type: type.toUpperCase(), args });
    }
    return records;
}
function spatialProperties(records) {
    const parent = new Map(), psets = new Map();
    for (const r of records.values()) {
        const a = r.args;
        if (r.type === 'IFCRELAGGREGATES') {
            for (const child of a[5] || [])
                parent.set(ref(child), ref(a[4]));
        }
        if (r.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') {
            for (const child of a[4] || [])
                parent.set(ref(child), ref(a[5]));
        }
        if (r.type === 'IFCRELDEFINESBYPROPERTIES') {
            const p = records.get(ref(a[5]));
            if (p?.type !== 'IFCPROPERTYSET')
                continue;
            const props = {};
            for (const x of p.args[4] || []) {
                const v = records.get(ref(x));
                if (v?.type === 'IFCPROPERTYSINGLEVALUE')
                    props[v.args[0]] = unwrap(v.args[2]);
            }
            for (const x of a[4] || []) {
                const id = ref(x);
                if (!psets.has(id))
                    psets.set(id, {});
                psets.get(id)[p.args[2] || 'Property set'] = props;
            }
        }
    }
    const path = id => {
        const out = [], seen = new Set();
        let p = parent.get(id);
        while (p && !seen.has(p)) {
            seen.add(p);
            const r = records.get(p);
            if (r)
                out.unshift(r.args[2] || r.type);
            p = parent.get(p);
        }
        return out.length ? out : ['Unassigned'];
    };
    return { path, psets };
}
const IFC_TO_Y = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
/** Explicitly scoped offline geometry reader. Does not pretend to evaluate booleans. */
export async function importIFCNative(file) {
    const text = await file.text(), records = parseSTEP(text), meta = spatialProperties(records), warnings = [], model = { id: uid('model'), name: file.name, discipline: 'Imported IFC', source: 'IFC · native subset', units: 'm', visible: true, matrix: identity(), imported: new Date().toISOString(), warnings };
    let unit = 1;
    for (const r of records.values()) {
        if (r.type === 'IFCSIUNIT' && r.args[1] === 'LENGTHUNIT') {
            const prefixes = { MILLI: .001, CENTI: .01, DECI: .1, KILO: 1000, MICRO: .000001 };
            if (r.args[3] !== 'METRE')
                throw Error('Native IFC requires SI metre units');
            unit = r.args[2] ? prefixes[r.args[2]] : 1;
            if (!unit)
                throw Error('Unsupported SI length prefix');
        }
        if (r.type === 'IFCCONVERSIONBASEDUNIT' && r.args[1] === 'LENGTHUNIT')
            throw Error('Conversion-based IFC units require web-ifc; run npm install.');
    }
    const base = multiply(IFC_TO_Y, trs([0, 0, 0], undefined, [unit, unit, unit])), geometries = new Map(), placements = new Map(), itemCache = new Map();
    const get = x => records.get(ref(x) ?? x);
    const point = x => {
        const r = get(x);
        return r?.args?.[0] || [0, 0, 0];
    };
    const dir = x => norm([...point(x), 0].slice(0, 3));
    function axis(x) {
        const r = get(x);
        if (!r)
            return identity();
        if (r.type === 'IFCAXIS2PLACEMENT2D') {
            const t = point(r.args[0]), v = r.args[1] ? point(r.args[1]) : [1, 0], a = Math.atan2(v[1], v[0]);
            return trs([t[0], t[1], 0], [0, 0, Math.sin(a / 2), Math.cos(a / 2)]);
        }
        const t = point(r.args[0]), z = r.args[1] ? dir(r.args[1]) : [0, 0, 1], xr = r.args[2] ? dir(r.args[2]) : [1, 0, 0], y = norm(cross(z, xr)), xx = norm(cross(y, z));
        return [...xx, 0, ...y, 0, ...z, 0, t[0] || 0, t[1] || 0, t[2] || 0, 1];
    }
    function placement(x, seen = new Set()) {
        const id = ref(x);
        if (!id)
            return identity();
        if (placements.has(id))
            return placements.get(id);
        if (seen.has(id))
            throw Error('Cycle in IFC placement');
        seen.add(id);
        const r = get(x);
        if (r?.type !== 'IFCLOCALPLACEMENT')
            throw Error(`Unsupported placement ${r?.type}`);
        const m = multiply(placement(r.args[0], seen), axis(r.args[1]));
        placements.set(id, m);
        return m;
    }
    function profile(x) {
        const r = get(x);
        if (!r)
            throw Error('Missing profile');
        let pts;
        if (r.type === 'IFCRECTANGLEPROFILEDEF') {
            const w = r.args[3] / 2, h = r.args[4] / 2;
            pts = [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]];
        }
        else if (r.type === 'IFCCIRCLEPROFILEDEF') {
            const radius = r.args[3];
            pts = Array.from({ length: 32 }, (_, i) => [Math.cos(i * Math.PI / 16) * radius, Math.sin(i * Math.PI / 16) * radius, 0]);
        }
        else if (r.type === 'IFCARBITRARYCLOSEDPROFILEDEF') {
            const curve = get(r.args[2]);
            if (curve?.type !== 'IFCPOLYLINE')
                throw Error('Native arbitrary profile supports IFCPolyline only');
            pts = curve.args[0].map(p => {
                const v = point(p);
                return [v[0], v[1], v[2] || 0];
            });
            if (pts.length > 3 && pts[0].every((v, i) => Math.abs(v - pts.at(-1)[i]) < 1e-10))
                pts.pop();
            return pts;
        }
        else
            throw Error(`Unsupported profile ${r.type}`);
        const m = axis(r.args[2]);
        return pts.map(p => transform(m, p));
    }
    function mappedTransform(x) {
        const r = get(x);
        if (!r || !r.type.startsWith('IFCCARTESIANTRANSFORMATIONOPERATOR3D'))
            throw Error('Unsupported mapped transform');
        const a = r.args, xx = a[0] ? dir(a[0]) : [1, 0, 0], yy = a[1] ? dir(a[1]) : [0, 1, 0], zz = a[4] ? dir(a[4]) : norm(cross(xx, yy)), t = point(a[2]), s = a[3] ?? 1, s2 = a[5] ?? s, s3 = a[6] ?? s;
        return [...vmul(xx, s), 0, ...vmul(yy, s2), 0, ...vmul(zz, s3), 0, ...t, 1];
    }
    function item(x, depth = 0) {
        if (depth > 60)
            throw Error('IFC representation nesting too deep');
        const id = ref(x);
        if (itemCache.has(id))
            return itemCache.get(id);
        const r = get(x);
        if (!r)
            throw Error('Missing representation item');
        const a = r.args;
        let g, matrix = identity(), parts = [];
        if (r.type === 'IFCEXTRUDEDAREASOLID') {
            g = extrudePolygon(profile(a[0]), vmul(dir(a[2]), a[3]));
            matrix = axis(a[1]);
        }
        else if (r.type === 'IFCTRIANGULATEDFACESET') {
            const coord = get(a[0]);
            if (coord?.type !== 'IFCCARTESIANPOINTLIST3D')
                throw Error('Missing point list');
            const coords = coord.args[0], map = a[4], ix = a[3].flat().map(i => (map ? map[i - 1] : i) - 1);
            g = flatGeometry(coords.flat(), ix);
        }
        else if (r.type === 'IFCPOLYGONALFACESET') {
            const coords = get(a[0])?.args[0];
            const ix = [];
            for (const f of a[2]) {
                const face = get(f);
                if (face?.type !== 'IFCINDEXEDPOLYGONALFACE')
                    throw Error('Polygonal faces with voids require web-ifc');
                const ids = face.args[0].map(i => (a[3] ? a[3][i - 1] : i) - 1);
                ix.push(...triangulate(ids.map(i => coords[i])).map(i => ids[i]));
            }
            g = flatGeometry(coords.flat(), ix);
        }
        else if (r.type === 'IFCFACETEDBREP' || r.type === 'IFCFACEBASEDSURFACEMODEL' || r.type === 'IFCSHELLBASEDSURFACEMODEL') {
            const shells = r.type === 'IFCFACETEDBREP' ? [a[0]] : a[0], p = [], ix = [];
            for (const s of shells) {
                const shell = get(s);
                for (const fr of shell?.args[0] || []) {
                    const face = get(fr);
                    if (face?.args[0]?.length !== 1)
                        throw Error('BRep faces with inner bounds require web-ifc');
                    const bound = get(face.args[0][0]), loop = get(bound?.args[0]);
                    if (loop?.type !== 'IFCPOLYLOOP')
                        throw Error('Unsupported BRep loop');
                    let points = loop.args[0].map(point);
                    if (bound.args[1] === 'F')
                        points = points.reverse();
                    const start = p.length / 3;
                    p.push(...points.flat());
                    ix.push(...triangulate(points).map(i => i + start));
                }
            }
            g = flatGeometry(p, ix);
        }
        else if (r.type === 'IFCMAPPEDITEM') {
            throw Error('Mapped item must be resolved through items()');
        }
        else
            throw Error(`Unsupported geometry ${r.type}`);
        if (g) {
            const gid = `${model.id}-g-${id}`;
            geometries.set(gid, g);
            parts = [{ geometryId: gid, matrix, color: [.68, .73, .77, 1] }];
        }
        itemCache.set(id, parts);
        return parts;
    }
    // Resolve mapped instances separately so geometry remains shared.
    const rawItem = item;
    function items(x, depth = 0) {
        const r = get(x);
        if (r?.type === 'IFCMAPPEDITEM') {
            if (depth > 60)
                throw Error('Cyclic mapped representation');
            const map = get(r.args[0]);
            if (map?.type !== 'IFCREPRESENTATIONMAP')
                throw Error('Invalid representation map');
            const rep = get(map.args[1]), m = multiply(mappedTransform(r.args[1]), invertAffine(axis(map.args[0])));
            return (rep?.args[3] || []).flatMap(child => items(child, depth + 1).map(p => ({ ...p, matrix: multiply(m, p.matrix) })));
        }
        return rawItem(x, depth);
    }
    const entities = [];
    let omitted = 0;
    for (const r of records.values()) {
        const a = r.args;
        if (!ref(a[5]) || !ref(a[6]) || get(a[6])?.type !== 'IFCPRODUCTDEFINITIONSHAPE' || r.type === 'IFCOPENINGELEMENT' || r.type === 'IFCSPACE')
            continue;
        try {
            const shape = get(a[6]), parts = [];
            for (const rr of shape.args[2] || []) {
                const rep = get(rr);
                if (!rep || !['Body', 'Facetation', null].includes(rep.args[1]))
                    continue;
                for (const x of rep.args[3] || [])
                    parts.push(...items(x));
            }
            if (!parts.length) {
                omitted++;
                continue;
            }
            entities.push({ id: uid('element'), modelId: model.id, name: a[2] || `${r.type} #${r.id}`, type: r.type, path: meta.path(r.id), matrix: multiply(base, placement(a[5])), parts, visible: true, properties: { Identity: { Name: a[2] || r.type, Type: r.type, GlobalId: a[0], ExpressID: r.id, Description: a[3] || '' }, ...meta.psets.get(r.id) } });
        }
        catch (error) {
            omitted++;
            warnings.push(`#${r.id} ${r.type}: ${error.message}`);
        }
    }
    if ([...records.values()].some(r => r.type === 'IFCRELVOIDSELEMENT'))
        warnings.unshift('Offline reader does not subtract opening/void relationships. Install web-ifc for opening geometry.');
    if (omitted)
        warnings.unshift(`${omitted} product(s) omitted because geometry was unsupported.`);
    if (!entities.length)
        throw Error('No supported IFC geometry. Run npm install to enable the web-ifc geometry engine. ' + warnings.slice(0, 2).join(' '));
    model.warnings = warnings;
    return { model, entities, geometries: [...geometries] };
}
// Local inverse for the 4x4 affine mapping origin, imported statically below.
import { inverse as invertAffine } from './math.js';
export async function importIFC(file, { nativeOnly = false, onProgress = () => {
} } = {}) {
    if (nativeOnly || globalThis.__CONVERGE_STANDALONE__ === true)
        return importIFCNative(file);
    const url = new URL('../vendor/web-ifc-api.js', import.meta.url), controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 3000);
    let available = false;
    try {
        const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
        available = response.ok;
    }
    catch {
    }
    finally {
        clearTimeout(timeout);
    }
    if (!available)
        return importIFCNative(file);
    const web = await import(url.href), api = new web.IfcAPI();
    api.SetWasmPath(new URL('../vendor/', import.meta.url).href, true);
    await api.Init(undefined, true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mid = null;
    try {
        mid = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
        if (mid < 0)
            throw Error('web-ifc could not open model');
        const records = parseSTEP(new TextDecoder().decode(bytes)), meta = spatialProperties(records), model = { id: uid('model'), name: file.name, discipline: 'Imported IFC', source: 'IFC · web-ifc 0.0.77', units: 'm', visible: true, matrix: identity(), imported: new Date().toISOString(), warnings: [] }, geometries = new Map(), entities = [];
        api.StreamAllMeshes(mid, mesh => {
            const row = api.GetLine(mid, mesh.expressID, false), parts = [];
            for (let i = 0; i < mesh.geometries.size(); i++) {
                const pg = mesh.geometries.get(i), gid = `${model.id}-g-${pg.geometryExpressID}`;
                if (!geometries.has(gid)) {
                    const g = api.GetGeometry(mid, pg.geometryExpressID);
                    try {
                        const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize()), ix = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize()), p = new Float32Array(v.length / 2), n = new Float32Array(v.length / 2);
                        for (let k = 0; k < v.length; k += 6) {
                            p.set(v.subarray(k, k + 3), k / 2);
                            n.set(v.subarray(k + 3, k + 6), k / 2);
                        }
                        if (ix.length)
                            geometries.set(gid, geometry(p, new Uint32Array(ix), n));
                    }
                    finally {
                        g.delete();
                    }
                }
                if (geometries.has(gid))
                    parts.push({ geometryId: gid, matrix: Array.from(pg.flatTransformation), color: [pg.color.x, pg.color.y, pg.color.z, pg.color.w] });
            }
            if (parts.length)
                entities.push({ id: uid('element'), modelId: model.id, name: unwrap(row.Name) || `IFC #${mesh.expressID}`, type: records.get(mesh.expressID)?.type || 'IFC Element', path: meta.path(mesh.expressID), matrix: identity(), parts, visible: true, properties: { Identity: { Name: unwrap(row.Name) || '', Type: records.get(mesh.expressID)?.type || '', GlobalId: unwrap(row.GlobalId), ExpressID: mesh.expressID, Description: unwrap(row.Description) || '' }, ...meta.psets.get(mesh.expressID) } });
            if (entities.length % 100 === 0)
                onProgress({ elements: entities.length });
        });
        if (!entities.length)
            throw Error('web-ifc returned no mesh geometry');
        return { model, entities, geometries: [...geometries] };
    }
    finally {
        if (mid !== null && mid >= 0)
            api.CloseModel(mid);
        api.Dispose?.();
    }
}
