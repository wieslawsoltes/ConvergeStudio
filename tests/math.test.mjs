import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, trs, multiply, inverse, transform, transformBox, Camera, BVH, rayTriangle, rayBox, boxDistance2 } from '../src/math.js';
const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);
test('matrix composition and inversion preserve points', () => {
    const m = trs([13, -4, 7], [0, Math.sin(.6), 0, Math.cos(.6)], [2, .5, 3]), p = [4, 5, -2], q = transform(inverse(m), transform(m, p));
    q.forEach((v, i) => near(v, p[i]));
    multiply(m, inverse(m)).forEach((v, i) => near(v, identity()[i]));
});
test('singular matrices reject inversion', () => assert.throws(() => inverse(new Array(16).fill(0)), /Singular/));
test('transformed bounds include nonuniform scaling and translation', () => {
    const b = transformBox({ min: [-1, -1, -1], max: [1, 1, 1] }, trs([2, 3, 4], undefined, [2, 3, 4]));
    assert.deepEqual(b, { min: [0, 0, 0], max: [4, 6, 8] });
});
test('BVH query returns only overlapping leaves', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, box: { min: [i * 2, 0, 0], max: [i * 2 + 1, 1, 1] } })), bvh = new BVH(items);
    assert.deepEqual(bvh.query({ min: [20.1, 0, 0], max: [20.5, 1, 1] }).map(i => i.id), [10]);
});
test('BVH expanded query supports clearance broad phase', () => {
    const bvh = new BVH([{ id: 1, box: { min: [2, 0, 0], max: [3, 1, 1] } }]);
    assert.equal(bvh.query({ min: [0, 0, 0], max: [1, 1, 1] }, 1).length, 1);
});
test('ray-box handles parallel axes', () => {
    const b = { min: [0, 0, 0], max: [1, 1, 1] };
    near(rayBox([.5, .5, -2], [0, 0, 1], b), 2);
    assert.equal(rayBox([2, .5, -2], [0, 0, 1], b), null);
});
test('ray-triangle returns a precise surface hit', () => near(rayTriangle([.2, .2, 2], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0]), 2));
test('camera projection and unprojection agree', () => {
    const camera = new Camera();
    camera.aspect = 1.6;
    const screen = camera.project(camera.target, 800, 500);
    near(screen[0], 400);
    near(screen[1], 250);
    const ray = camera.ray(400, 250, 800, 500);
    const expected = camera.target.map((v, i) => v - camera.eye[i]), l = Math.hypot(...expected);
    ray.direction.forEach((v, i) => near(v, expected[i] / l));
});
test('orthographic rays are parallel', () => {
    const c = new Camera();
    c.ortho = true;
    const a = c.ray(10, 10, 800, 500), b = c.ray(700, 400, 800, 500);
    a.direction.forEach((v, i) => near(v, b.direction[i]));
});
test('box distance is Euclidean rather than axis maximum', () => near(boxDistance2({ min: [0, 0, 0], max: [1, 1, 1] }, { min: [2, 2, 1], max: [3, 3, 2] }), 2));
