import { identity, multiply, trs } from './math.js';
import { geometry } from './geometry.js';
import { uid } from './core.js';
const types = { 5120: { size: 1, get: 'getInt8', max: 127 }, 5121: { size: 1, get: 'getUint8', max: 255 }, 5122: { size: 2, get: 'getInt16', max: 32767 }, 5123: { size: 2, get: 'getUint16', max: 65535 }, 5125: { size: 4, get: 'getUint32', max: 4294967295 }, 5126: { size: 4, get: 'getFloat32', max: 1 } };
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
export function accessor(gltf, buffers, id) {
    const a = gltf.accessors?.[id];
    if (!a)
        throw Error(`Missing accessor ${id}`);
    const type = types[a.componentType], n = components[a.type];
    if (!type || !n || !Number.isInteger(a.count) || a.count < 0 || a.count > 100000000)
        throw Error('Unsupported or oversized accessor');
    const out = new Float64Array(a.count * n);
    function read(viewId, offset, count, width, dst, indexes = null, component = a.componentType, strideOverride = null) {
        const bv = gltf.bufferViews?.[viewId], t = types[component];
        if (!bv || !buffers[bv.buffer])
            throw Error('Missing buffer view');
        const buffer = buffers[bv.buffer], stride = strideOverride ?? bv.byteStride ?? width * t.size, start = (bv.byteOffset || 0) + offset, end = start + (count ? count - 1 : 0) * stride + width * t.size;
        if (start < 0 || end > buffer.byteLength || end > (bv.byteOffset || 0) + bv.byteLength || stride < width * t.size)
            throw Error('Accessor exceeds its buffer view');
        const view = new DataView(buffer);
        for (let i = 0; i < count; i++)
            for (let c = 0; c < width; c++) {
                let v = view[t.get](start + i * stride + c * t.size, true);
                if (a.normalized && component !== 5126)
                    v = Math.max(-1, v / t.max);
                dst[(indexes ? indexes[i] : i) * width + c] = v;
            }
    }
    if (a.bufferView !== undefined)
        read(a.bufferView, a.byteOffset || 0, a.count, n, out);
    if (a.sparse) {
        const sp = a.sparse;
        if (sp.count > a.count || ![5121, 5123, 5125].includes(sp.indices.componentType))
            throw Error('Invalid sparse accessor');
        const bv = gltf.bufferViews[sp.indices.bufferView], t = types[sp.indices.componentType], dv = new DataView(buffers[bv.buffer]), idx = [];
        let prev = -1;
        for (let i = 0; i < sp.count; i++) {
            const offset = (bv.byteOffset || 0) + (sp.indices.byteOffset || 0) + i * t.size;
            if (offset + t.size > (bv.byteOffset || 0) + bv.byteLength)
                throw Error('Sparse indices out of bounds');
            const v = dv[t.get](offset, true);
            if (v >= a.count || v <= prev)
                throw Error('Invalid sparse index ordering');
            idx.push(v);
            prev = v;
        }
        read(sp.values.bufferView, sp.values.byteOffset || 0, sp.count, n, out, idx, a.componentType, n * type.size);
    }
    if (out.some(x => !Number.isFinite(x)))
        throw Error('Accessor contains non-finite values');
    return out;
}
function dataBuffer(uri) {
    const comma = uri.indexOf(',');
    if (comma < 0)
        throw Error('Malformed data URI');
    const text = /;base64/i.test(uri.slice(0, comma)) ? atob(uri.slice(comma + 1)) : decodeURIComponent(uri.slice(comma + 1));
    return Uint8Array.from(text, c => c.charCodeAt(0)).buffer;
}
export function parseGLB(buffer) {
    if (buffer.byteLength < 20)
        throw Error('Truncated GLB');
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2 || dv.getUint32(8, true) !== buffer.byteLength)
        throw Error('Invalid GLB 2.0 header');
    let json = null, bin = null;
    for (let off = 12; off < buffer.byteLength;) {
        if (off + 8 > buffer.byteLength)
            throw Error('Truncated GLB chunk');
        const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
        off += 8;
        if (off + len > buffer.byteLength || len % 4)
            throw Error('Invalid GLB chunk');
        const chunk = buffer.slice(off, off + len);
        if (type === 0x4e4f534a) {
            if (json)
                throw Error('Duplicate GLB JSON');
            json = JSON.parse(new TextDecoder().decode(chunk).replace(/\0+$/, ''));
        }
        else if (type === 0x004e4942) {
            if (bin)
                throw Error('Duplicate GLB BIN');
            bin = chunk;
        }
        off += len;
    }
    if (!json)
        throw Error('GLB JSON missing');
    return { json, bin };
}
export async function importGLTF(file, sidecars = []) {
    const buffer = await file.arrayBuffer(), isGLB = file.name.toLowerCase().endsWith('.glb'), parsed = isGLB ? parseGLB(buffer) : { json: JSON.parse(new TextDecoder().decode(buffer)), bin: null }, json = parsed.json;
    if (!/^2\./.test(json.asset?.version || ''))
        throw Error('Only glTF 2.x static triangle geometry is supported');
    const required = json.extensionsRequired || [], supported = new Set(['KHR_materials_unlit', 'KHR_mesh_quantization', 'EXT_mesh_gpu_instancing']);
    for (const ext of required)
        if (!supported.has(ext))
            throw Error(`Required glTF extension ${ext} is unsupported. Export uncompressed glTF 2.0.`);
    const warnings = [], files = new Map();
    for (const f of sidecars) {
        files.set((f.webkitRelativePath || f.name).replaceAll('\\', '/'), f);
        if (!files.has(f.name))
            files.set(f.name, f);
    }
    const buffers = [];
    for (let i = 0; i < (json.buffers || []).length; i++) {
        const b = json.buffers[i];
        let data;
        if (!b.uri) {
            if (i !== 0 || !parsed.bin)
                throw Error('Buffer has no data');
            data = parsed.bin;
        }
        else if (b.uri.startsWith('data:'))
            data = dataBuffer(b.uri);
        else {
            const path = decodeURIComponent(b.uri).replace(/^\.\//, ''), f = files.get(path) || files.get(path.split('/').at(-1));
            if (!f)
                throw Error(`Select the sidecar buffer “${path}” together with the .gltf file. Network URLs are not fetched.`);
            data = await f.arrayBuffer();
        }
        if (data.byteLength < b.byteLength)
            throw Error('Truncated glTF buffer');
        buffers.push(data);
    }
    const model = { id: uid('model'), name: file.name, discipline: 'Imported', visible: true, matrix: identity(), source: 'glTF 2.0', units: 'm', imported: new Date().toISOString(), warnings }, geometries = new Map(), entities = [], meshCache = new Map();
    function getMesh(index) {
        if (meshCache.has(index))
            return meshCache.get(index);
        const mesh = json.meshes?.[index];
        if (!mesh)
            throw Error('Missing glTF mesh');
        const parts = [];
        for (let k = 0; k < mesh.primitives.length; k++) {
            const p = mesh.primitives[k];
            if (p.extensions?.KHR_draco_mesh_compression)
                throw Error('Draco compression needs an external decoder. Export uncompressed glTF.');
            if (p.attributes?.POSITION === undefined)
                throw Error('Mesh has no POSITION accessor');
            const positions = accessor(json, buffers, p.attributes.POSITION);
            if (json.accessors[p.attributes.POSITION].type !== 'VEC3')
                throw Error('POSITION must be VEC3');
            const normals = p.attributes.NORMAL !== undefined ? accessor(json, buffers, p.attributes.NORMAL) : null;
            const raw = p.indices !== undefined ? Array.from(accessor(json, buffers, p.indices)) : Array.from({ length: positions.length / 3 }, (_, i) => i);
            if (raw.some(i => !Number.isInteger(i) || i < 0))
                throw Error('Non-integer index');
            let ix = [];
            const mode = p.mode ?? 4;
            if (mode === 4)
                ix = raw;
            else if (mode === 5) {
                for (let i = 2; i < raw.length; i++)
                    ix.push(raw[i - 2 + (i % 2)], raw[i - 1 - (i % 2)], raw[i]);
            }
            else if (mode === 6) {
                for (let i = 2; i < raw.length; i++)
                    ix.push(raw[0], raw[i - 1], raw[i]);
            }
            else {
                warnings.push(`Skipped non-triangle primitive (mode ${mode}) in ${mesh.name || index}`);
                continue;
            }
            if (!ix.length)
                continue;
            const id = `${model.id}-mesh-${index}-${k}`;
            geometries.set(id, geometry(positions, ix, normals));
            const mat = json.materials?.[p.material], base = mat?.pbrMetallicRoughness?.baseColorFactor || [.66, .72, .78, 1];
            parts.push({ geometryId: id, matrix: identity(), color: [...base] });
            if (mat?.pbrMetallicRoughness?.baseColorTexture)
                warnings.push('Texture maps are not rendered; material baseColorFactor is used.');
            if (p.targets)
                warnings.push('Morph targets are imported in their undeformed base pose.');
        }
        meshCache.set(index, parts);
        return parts;
    }
    const childIds = new Set((json.nodes || []).flatMap(n => n.children || [])), roots = json.scenes?.[json.scene ?? 0]?.nodes || (json.nodes || []).map((_, i) => i).filter(i => !childIds.has(i));
    function node(index, parent, path, ancestors) {
        if (ancestors.has(index))
            throw Error('Cycle in glTF hierarchy');
        const n = json.nodes?.[index];
        if (!n)
            throw Error('Invalid node reference');
        const anc = new Set(ancestors);
        anc.add(index);
        const local = n.matrix || trs(n.translation, n.rotation, n.scale);
        if (local.length !== 16 || local.some(v => !Number.isFinite(v)))
            throw Error('Invalid node transform');
        const world = multiply(parent, local), name = n.name || `Node ${index}`, group = [...path, name];
        if (n.skin !== undefined)
            warnings.push('Skinned meshes are displayed in their static node pose; skeletal deformation is not evaluated.');
        if (n.mesh !== undefined) {
            const parts = getMesh(n.mesh), inst = n.extensions?.EXT_mesh_gpu_instancing?.attributes;
            let instances = [identity()];
            if (inst) {
                const t = inst.TRANSLATION === undefined ? null : accessor(json, buffers, inst.TRANSLATION), r = inst.ROTATION === undefined ? null : accessor(json, buffers, inst.ROTATION), s = inst.SCALE === undefined ? null : accessor(json, buffers, inst.SCALE), count = t ? t.length / 3 : r ? r.length / 4 : s ? s.length / 3 : 0;
                if ((t && t.length !== count * 3) || (r && r.length !== count * 4) || (s && s.length !== count * 3))
                    throw Error('Inconsistent instancing accessors');
                instances = Array.from({ length: count }, (_, i) => trs(t ? Array.from(t.slice(i * 3, i * 3 + 3)) : undefined, r ? Array.from(r.slice(i * 4, i * 4 + 4)) : undefined, s ? Array.from(s.slice(i * 3, i * 3 + 3)) : undefined));
            }
            for (let i = 0; i < instances.length; i++)
                if (parts.length)
                    entities.push({ id: uid('element'), modelId: model.id, name: name + (instances.length > 1 ? ` [${i + 1}]` : ''), type: 'Mesh', path: path.length ? path : ['Scene'], matrix: multiply(world, instances[i]), parts: structuredClone(parts), visible: true, properties: { Identity: { Name: name, Type: 'glTF mesh', Node: index, Mesh: n.mesh }, Metadata: n.extras || {}, Material: { Count: parts.length } } });
        }
        for (const child of n.children || [])
            node(child, world, group, anc);
    }
    for (const r of roots)
        node(r, identity(), [], new Set());
    if (!entities.length)
        throw Error('No supported triangle geometry in glTF');
    model.warnings = [...new Set(warnings)];
    return { model, entities, geometries: [...geometries] };
}
