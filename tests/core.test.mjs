import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, unpack, uid } from '../src/core.js';
import { createDemo } from '../src/demo.js';
import { csvCell, reportHTML, coordinationCSV } from '../src/reports.js';
function demo() {
    const s = new Store(), d = createDemo();
    s.replace(d.doc, d.geometries);
    return s;
}
test('demo federates five models with two shared source geometries', () => {
    const s = demo();
    assert.equal(s.doc.models.length, 5);
    assert.equal(s.geometries.size, 2);
    assert.equal(s.doc.entities.length, 143);
    assert.equal(s.instances.length, 143);
});
test('command undo and redo preserve object visibility', () => {
    const s = demo(), id = s.doc.entities[0].id;
    s.command('Hide', d => d.entities[0].visible = false);
    assert.equal(s.byId.get(id).visible, false);
    s.undo();
    assert.equal(s.byId.get(id).visible, true);
    s.redo();
    assert.equal(s.byId.get(id).visible, false);
});
test('failed command restores state atomically', () => {
    const s = demo();
    assert.throws(() => s.command('Fail', d => {
        d.name = 'corrupted';
        throw Error('abort');
    }));
    assert.equal(s.doc.name, 'Harbor Point · Building A');
    assert.equal(s.undoStack.length, 0);
});
test('geometry epoch advances only for geometry mutations', () => {
    const s = demo(), epoch = s.geometryEpoch;
    s.command('Rename', d => d.name = 'Renamed');
    assert.equal(s.geometryEpoch, epoch);
    s.command('Move', d => d.models[0].matrix[12] = 2, { geometryChanged: true });
    assert.equal(s.geometryEpoch, epoch + 1);
});
test('portable project roundtrip restores typed geometry and coordinates', () => {
    const s = demo(), packed = JSON.parse(JSON.stringify(s.pack(true))), data = unpack(packed), second = new Store();
    second.replace(data.doc, data.geometries);
    assert.equal(second.doc.entities.length, s.doc.entities.length);
    assert.ok(second.geometries.get('demo-box').positions instanceof Float32Array);
    assert.deepEqual(second.bounds(null, false), s.bounds(null, false));
});
test('project validator rejects duplicate IDs', () => {
    const p = demo().pack(true);
    p.document.entities[1].id = p.document.entities[0].id;
    assert.throws(() => unpack(p), /Invalid element/);
});
test('project validator rejects invalid geometry indices', () => {
    const p = demo().pack(true);
    p.geometries[0][1].indices[0] = 9999999;
    assert.throws(() => unpack(p), /Invalid vertex or index/);
});
test('project validator rejects missing geometry references', () => {
    const p = demo().pack(true);
    p.document.entities[0].parts[0].geometryId = 'absent';
    assert.throws(() => unpack(p), /Invalid geometry reference/);
});
test('project validator rejects inverted section bounds', () => {
    const p = demo().pack(true);
    p.document.section.min = [9, 0, 0];
    p.document.section.max = [1, 1, 1];
    assert.throws(() => unpack(p), /Invalid section/);
});
test('selection removes deleted IDs and supports toggle semantics', () => {
    const s = demo(), id = s.doc.entities[0].id;
    s.select([id]);
    assert.equal(s.selection.size, 1);
    s.select([id], true);
    assert.equal(s.selection.size, 0);
    s.select([id]);
    s.command('Remove', d => d.entities = d.entities.filter(e => e.id !== id), { geometryChanged: true });
    assert.equal(s.selection.size, 0);
});
test('CSV protects against spreadsheet formula injection', () => {
    assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
    assert.equal(csvCell('Plain'), '"Plain"');
});
test('HTML report escapes untrusted model names', () => {
    const s = demo();
    s.doc.name = '<img src=x onerror=alert(1)>';
    const html = reportHTML(s);
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;img src=x'));
});
test('CSV export contains a stable header even without test results', () => assert.ok(coordinationCSV(demo()).startsWith('\uFEFF"Test","Mode"')));
test('history capacity is bounded', () => {
    const s = demo();
    for (let i = 0; i < 65; i++)
        s.command('Rename', d => d.name = 'P' + i);
    assert.equal(s.undoStack.length, 60);
});
test('entity-bound cache matches geometry bounds after transforms', () => {
    const s = demo(), id = s.doc.entities[0].id;
    assert.deepEqual(s.entityBounds.get(id), s.bounds([id], false));
    s.command('Move', d => d.models[0].matrix[12] = 14, { geometryChanged: true });
    assert.deepEqual(s.entityBounds.get(id), s.bounds([id], false));
});
test('UUIDs retain the full 122 random bits rather than truncated IDs', () => {
    const ids = Array.from({ length: 1000 }, () => uid('element'));
    assert.equal(new Set(ids).size, 1000);
    assert.ok(ids.every(id => /^element-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
});
test('malformed hierarchy rejects before replacing active project', () => {
    const p = demo().pack(true);
    p.document.entities[0].path = 'not an array';
    assert.throws(() => unpack(p), /Invalid element hierarchy/);
});
test('malformed measurement rejects non-finite coordinates', () => {
    const p = demo().pack(true);
    p.document.measurements = [{ a: [0, Infinity, 0], b: [0, 1, 2] }];
    assert.throws(() => unpack(p), /Invalid measurement/);
});
test('malformed saved camera rejects before GPU upload', () => {
    const p = demo().pack(true);
    p.document.camera = { target: [0, 0, 0], distance: NaN, yaw: 0, pitch: 0, scale: 1 };
    assert.throws(() => unpack(p), /Invalid project camera/);
});
test('import and result invalidation are one undoable transaction', async () => {
    const s = demo();
    s.doc.results.test = { results: [], stale: false };
    const m = structuredClone(s.doc.models[0]);
    m.id = 'another-model';
    await s.addImport({ model: m, entities: [], geometries: [] });
    assert.equal(s.doc.models.length, 6);
    assert.equal(s.doc.results.test.stale, true);
    s.undo();
    assert.equal(s.doc.models.length, 5);
    assert.equal(s.doc.results.test.stale, false);
});
