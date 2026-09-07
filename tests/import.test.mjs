import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { importGLTF, parseGLB, accessor } from '../src/gltf.js';
import { parseSTEP, importIFCNative } from '../src/ifc.js';
import { Store } from '../src/core.js';
const read = async (name) => new File([await fs.readFile(new URL('../examples/' + name, import.meta.url))], name);
test('GLB loads geometry, hierarchy, base colors and repeated meshes', async () => {
    const data = await importGLTF(await read('coordination-sample.glb'));
    assert.equal(data.entities.length, 3);
    assert.equal(data.geometries.length, 2);
    assert.deepEqual(data.entities[0].path, ['Coordination root']);
    assert.deepEqual(data.entities[0].matrix.slice(12, 15), [0, 2, 0]);
    assert.equal(data.entities[0].parts[0].geometryId, data.entities[2].parts[0].geometryId);
});
test('external glTF sidecar is resolved from selected files', async () => {
    const f = await read('coordination-sample.gltf'), bin = await read('coordination-sample.bin');
    const data = await importGLTF(f, [f, bin]);
    assert.equal(data.entities.length, 3);
});
test('missing external glTF buffer is reported', async () => assert.rejects(() => importGLTF(new File([JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'missing.bin', byteLength: 8 }] })], 'missing.gltf')), /sidecar/));
test('malformed GLB fails before accessor decoding', () => assert.throws(() => parseGLB(new ArrayBuffer(16)), /Truncated/));
test('required unsupported glTF extensions fail explicitly', async () => assert.rejects(() => importGLTF(new File([JSON.stringify({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] })], 'compressed.gltf')), /unsupported/));
test('interleaved normalized accessors respect offsets and strides', () => {
    const buffer = new Uint8Array([9, 0, 255, 9, 9, 128, 64, 9]).buffer, gltf = { bufferViews: [{ buffer: 0, byteLength: 8, byteStride: 4 }], accessors: [{ bufferView: 0, byteOffset: 1, componentType: 5121, normalized: true, count: 2, type: 'VEC2' }] };
    const a = accessor(gltf, [buffer], 0);
    assert.equal(a[0], 0);
    assert.equal(a[1], 1);
    assert.equal(a[2], 128 / 255);
});
test('sparse accessors apply sorted overrides to zero initialization', () => {
    const buf = new ArrayBuffer(16), v = new DataView(buf);
    v.setUint8(0, 1);
    v.setFloat32(4, 2, true);
    v.setFloat32(8, 3, true);
    v.setFloat32(12, 4, true);
    const gltf = { bufferViews: [{ buffer: 0, byteLength: 1 }, { buffer: 0, byteOffset: 4, byteLength: 12 }], accessors: [{ componentType: 5126, type: 'VEC3', count: 3, sparse: { count: 1, indices: { bufferView: 0, componentType: 5121 }, values: { bufferView: 1 } } }] };
    assert.deepEqual(Array.from(accessor(gltf, [buf], 0)), [0, 0, 0, 2, 3, 4, 0, 0, 0]);
});
test('accessor buffer overflow is rejected', () => assert.throws(() => accessor({ bufferViews: [{ buffer: 0, byteLength: 4 }], accessors: [{ bufferView: 0, count: 3, type: 'VEC3', componentType: 5126 }] }, [new ArrayBuffer(4)], 0), /exceeds/));
test('STEP tokenizer preserves quoted delimiters and typed values', () => {
    const r = parseSTEP("ISO-10303-21;DATA;#1=IFCPROPERTYSINGLEVALUE('O''Brien; (A)', $, IFCLABEL('A,B'), $);ENDSEC;");
    assert.equal(r.get(1).args[0], "O'Brien; (A)");
    assert.equal(r.get(1).args[2].args[0], 'A,B');
});
test('STEP Unicode X2 sequences are decoded', () => {
    const r = parseSTEP("ISO-10303-21;DATA;#1=IFCLABEL('\\X2\\015B0142\\X0\\');ENDSEC;");
    assert.equal(r.get(1).args[0], 'śł');
});
test('native IFC reads extrusion, tessellation, mapped instances and Psets', async () => {
    const data = await importIFCNative(await read('coordination-sample.ifc'));
    assert.equal(data.entities.length, 4);
    assert.equal(data.geometries.length, 3);
    assert.equal(data.model.warnings.length, 0);
    const beam = data.entities.find(e => e.name.startsWith('Concrete'));
    assert.equal(beam.properties.Pset_BeamCommon.FireRating, 'R120');
    assert.ok(beam.path.includes('Level 01'));
    const mapped = data.entities.find(e => e.name.startsWith('Mapped'));
    assert.equal(beam.parts[0].geometryId, mapped.parts[0].geometryId);
});
test('native IFC converts Z-up to Y-up without independent recentering', async () => {
    const data = await importIFCNative(await read('coordination-sample.ifc')), store = new Store();
    await store.addImport(data);
    const beam = data.entities.find(e => e.name.startsWith('Concrete')), b = store.bounds([beam.id], false);
    assert.ok(Math.abs(b.min[1] - 3) < 1e-6);
    assert.ok(Math.abs(b.max[1] - 3.5) < 1e-6);
    assert.ok(Math.abs(b.min[0] + 3) < 1e-6);
});
test('IFC millimetre units scale both placements and dimensions', async () => {
    let text = await (await read('coordination-sample.ifc')).text();
    text = text.replace("#7=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);", "#7=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);");
    const data = await importIFCNative(new File([text], 'millimetres.ifc')), store = new Store();
    await store.addImport(data);
    const b = store.bounds([data.entities.find(e => e.name.startsWith('Concrete')).id], false);
    assert.ok(Math.abs(b.min[1] - .003) < 1e-9);
});
test('unsupported IFC products are reported rather than replaced by boxes', async () => {
    let text = await (await read('coordination-sample.ifc')).text();
    text = text.replace('#31=IFCEXTRUDEDAREASOLID(#30,#4,#2,5.);', '#31=IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#21,#21);');
    const data = await importIFCNative(new File([text], 'unsupported.ifc'));
    assert.equal(data.entities.length, 3);
    assert.ok(data.model.warnings.some(w => w.includes('IFCBOOLEANCLIPPINGRESULT')));
});
test('malformed STEP rejects unterminated strings', () => assert.throws(() => parseSTEP("ISO-10303-21;DATA;#1=IFCLABEL('bad);ENDSEC;"), /Unterminated/));
