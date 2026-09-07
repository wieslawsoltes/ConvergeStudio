import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, trs, transformBox } from '../src/math.js';
import { boxGeometry, geometry, cylinderGeometry } from '../src/geometry.js';
import { triangleDistance, closestSegments, worldMesh, meshDistance, pointInside, ClashEngine } from '../src/clash.js';
const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`), box = boxGeometry(), geos = new Map([['box', box]]);
const mesh = (t = [0, 0, 0], s = [1, 1, 1]) => worldMesh([{ geometryId: 'box', matrix: trs(t, undefined, s) }], geos);
const entity = (id, t = [0, 0, 0], stamp = '1') => ({ id, stamp, parts: [{ geometryId: 'box', matrix: trs(t) }], box: transformBox(box.box, trs(t)) });
test('triangle crossing is detected without shared vertices', () => {
    const hit = triangleDistance([[0, 0, 0], [2, 0, 0], [0, 2, 0]], [[.5, .5, -1], [.5, .5, 1], [1, 1, 1]]);
    near(hit.distance2, 0);
});
test('coplanar overlapping triangles are detected', () => near(triangleDistance([[0, 0, 0], [2, 0, 0], [0, 2, 0]], [[.2, .2, 0], [1, .2, 0], [.2, 1, 0]]).distance2, 0));
test('triangle clearance is exact for parallel planes', () => near(triangleDistance([[0, 0, 0], [2, 0, 0], [0, 2, 0]], [[0, 0, .3], [2, 0, .3], [0, 2, .3]]).distance2, .09));
test('segment distance handles points and parallel segments', () => {
    const [a, b] = closestSegments([0, 0, 0], [0, 0, 0], [2, 0, 0], [2, 2, 0]);
    assert.deepEqual(a, [0, 0, 0]);
    assert.deepEqual(b, [2, 0, 0]);
});
test('box topology is recognized as closed despite split vertex normals', () => assert.equal(mesh().components[0].closed, true));
test('closed mesh parity distinguishes interior and exterior', () => {
    const c = mesh().components[0];
    assert.equal(pointInside([.01, .02, .03], c), true);
    assert.equal(pointInside([1, 0, 0], c), false);
});
test('solid containment is not missed when surfaces do not touch', () => {
    const hit = meshDistance(mesh(), mesh([0, 0, 0], [4, 4, 4]), 0, true);
    assert.equal(hit.kind, 'containment');
    assert.equal(hit.distance, 0);
});
test('tangent boxes produce contact', () => assert.equal(meshDistance(mesh(), mesh([1, 0, 0]), 0, true).distance, 0));
test('separated boxes are not hard clashes', () => assert.equal(meshDistance(mesh(), mesh([1.1, 0, 0]), 0, true), null));
test('clearance computes surface separation, not overlap depth', () => {
    const hit = meshDistance(mesh(), mesh([1.2, 0, 0]), .25, false);
    near(hit.distance, .2);
    assert.equal(hit.kind, 'clearance');
});
test('clearance below separation returns no result', () => assert.equal(meshDistance(mesh(), mesh([1.2, 0, 0]), .15, false), null));
test('AABB false positives are rejected by triangle narrow phase', () => {
    const a = geometry([0, 0, 0, 2, 0, 0, 0, 2, 0], [0, 1, 2]), b = geometry([2, 2, 0, 2, .6, 0, .6, 2, 0], [0, 1, 2]), g = new Map([['a', a], ['b', b]]);
    const A = worldMesh([{ geometryId: 'a', matrix: identity() }], g), B = worldMesh([{ geometryId: 'b', matrix: identity() }], g);
    assert.equal(meshDistance(A, B, 0, true), null);
});
test('nonuniform transformed boxes retain correct clearance', () => {
    const hit = meshDistance(mesh([0, 0, 0], [2, 3, 4]), mesh([1.7, 0, 0]), .3);
    near(hit.distance, .2);
});
test('open surfaces do not acquire false containment semantics', () => {
    const g = geometry([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]), m = worldMesh([{ geometryId: 'tri', matrix: identity() }], new Map([['tri', g]]));
    assert.equal(m.components[0].closed, false);
    assert.equal(pointInside([.2, .2, .1], m.components[0]), false);
});
test('identical cylinders intersect with a triangle result', () => {
    const g = cylinderGeometry(12), m = worldMesh([{ geometryId: 'g', matrix: identity() }], new Map([['g', g]]));
    assert.ok(meshDistance(m, m, 0, true));
});
test('incremental rerun reuses unaffected pair results', async () => {
    const e = new ClashEngine();
    e.sync({ geometries: [['box', box]], entities: [entity('a'), entity('b', [.4, 0, 0])], revision: 1 });
    const t = { mode: 'hard', idsA: ['a'], idsB: ['b'] }, first = await e.run(t), second = await e.run(t);
    assert.equal(first.results.length, 1);
    assert.equal(first.stats.tested, 1);
    assert.equal(second.stats.tested, 0);
    assert.equal(second.stats.reused, 1);
});
test('changed transform invalidates cached geometry and result', async () => {
    const e = new ClashEngine();
    e.sync({ geometries: [['box', box]], entities: [entity('a'), entity('b', [.4, 0, 0])], revision: 1 });
    const t = { mode: 'hard', idsA: ['a'], idsB: ['b'] };
    await e.run(t);
    e.sync({ entities: [entity('a'), entity('b', [.7, 0, 0], '2')], revision: 2 });
    const changed = await e.run(t);
    assert.equal(changed.stats.tested, 1);
    assert.equal(changed.stats.reused, 0);
});
test('duplicate and self pairs are excluded for overlapping scopes', async () => {
    const e = new ClashEngine();
    e.sync({ geometries: [['box', box]], entities: [entity('a'), entity('b')] });
    const r = await e.run({ mode: 'hard', idsA: ['a', 'b'], idsB: ['a', 'b'] });
    assert.equal(r.stats.candidates, 1);
    assert.equal(r.results.length, 1);
});
test('run cancellation is observed between candidate pairs', async () => {
    const e = new ClashEngine();
    e.sync({ geometries: [['box', box]], entities: [entity('a'), entity('b')] });
    const r = await e.run({ mode: 'hard', idsA: ['a'], idsB: ['b'] }, { cancelled: () => true });
    assert.equal(r.cancelled, true);
});
test('reset clears old project caches', async () => {
    const e = new ClashEngine();
    e.sync({ geometries: [['box', box]], entities: [entity('a'), entity('b')] });
    await e.run({ mode: 'hard', idsA: ['a'], idsB: ['b'] });
    e.sync({ reset: true, entities: [] });
    assert.equal(e.cache.size, 0);
    assert.equal(e.geometries.size, 0);
});
