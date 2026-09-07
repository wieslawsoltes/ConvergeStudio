import { Store, Persistence, emptyDocument, unpack, uid, clone } from './core.js';
import { Camera, identity, trs, center, size, validBox, length, vsub, clamp } from './math.js';
import { Renderer } from './renderer.js';
import { createDemo } from './demo.js';
import { icon } from './icons.js';
import { escapeHTML as esc, download, coordinationCSV, reportHTML } from './reports.js';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const store = new Store(), persistence = new Persistence(), camera = new Camera();
let renderer;
const ui = { ribbon: 'Home', left: 'models', right: 'properties', bottom: 'clashes', tool: 'select', expanded: new Set(['model:str', 'model:mec', 'group:str:Level 01', 'group:mec:Level 01']), test: null, result: null, filter: 'all', query: '', measureStart: null, sectionEditing: false, autosaveTimer: null, saving: Promise.resolve(), job: 0, busy: false, importBusy: false, saveError: false };
let clashWorker = new Worker(new URL('./clash-worker.js', import.meta.url), { type: 'module' }), syncedEpoch = -1, sentGeometries = new Set(), activeRun = null;
function hydrate(root = document) {
    for (const el of root.querySelectorAll('[data-icon]'))
        el.innerHTML = icon(el.dataset.icon);
}
function toast(message, error = false, timeout = 5500) {
    const div = document.createElement('div');
    div.className = 'toast' + (error ? ' error' : '');
    div.innerHTML = `${icon(error ? 'warning' : 'check')}<span>${esc(message)}</span><button aria-label="Dismiss">${icon('close', 13)}</button>`;
    div.querySelector('button').onclick = () => div.remove();
    $('#toastStack').append(div);
    setTimeout(() => div.remove(), timeout);
}
function dateText(value) {
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function formatNum(value, digits = 3) {
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function safeName() {
    return store.doc.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'converge-project';
}
function scopeName(scope) {
    if (scope === 'all')
        return 'All elements';
    const [kind, ...rest] = scope.split(':'), id = rest.join(':');
    return kind === 'model' ? store.doc.models.find(m => m.id === id)?.discipline || 'Missing model' : store.doc.sets.find(s => s.id === id)?.name || 'Missing set';
}
function scopeIDs(scope) {
    if (scope === 'all')
        return store.doc.entities.map(e => e.id);
    const [kind, ...rest] = scope.split(':'), id = rest.join(':');
    return kind === 'model' ? store.doc.entities.filter(e => e.modelId === id).map(e => e.id) : store.doc.sets.find(s => s.id === id)?.ids.filter(id => store.byId.has(id)) || [];
}
function currentTest() {
    return store.doc.tests.find(t => t.id === ui.test) || store.doc.tests[0];
}
function sectionBounds() {
    const b = store.bounds(null, false);
    return validBox(b) ? b : { min: [-10, -10, -10], max: [10, 10, 10] };
}
function markStale(d) {
    for (const run of Object.values(d.results))
        run.stale = true;
}
function commit(label, fn, geometryChanged = false) {
    store.doc.camera = camera.serialize();
    store.command(label, d => {
        fn(d);
        if (geometryChanged)
            markStale(d);
    }, { geometryChanged });
}
function requestSave() {
    clearTimeout(ui.autosaveTimer);
    $('#saveState').textContent = 'Unsaved changes';
    ui.autosaveTimer = setTimeout(() => saveLocal(), 650);
}
async function saveLocal(announce = false) {
    clearTimeout(ui.autosaveTimer);
    store.doc.camera = camera.serialize();
    const data = store.pack(), revision = store.revision;
    $('#saveState').textContent = 'Saving locally…';
    ui.saving = ui.saving.catch(() => {
    }).then(() => persistence.save(data));
    try {
        await ui.saving;
        if (revision === store.revision)
            $('#saveState').textContent = '✓ Saved on this device';
        ui.saveError = false;
        if (announce)
            toast('Project saved in this browser. Export a project file for a portable backup.');
    }
    catch (error) {
        $('#saveState').textContent = 'Storage unavailable · export to save';
        if (!ui.saveError)
            toast('Autosave failed: ' + error.message + '. Export a project file to keep your work.', true, 10000);
        ui.saveError = true;
    }
}
function showModal(title, body, onSubmit = null, { submit = 'Save', width = null } = {}) {
    const modal = $('#modal');
    if (modal.open)
        modal.close();
    modal.style.width = width || '510px';
    modal.innerHTML = `<form id="modalForm"><div class="modal-header"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-close-modal aria-label="Close">${icon('close')}</button></div><div class="modal-body">${body}<div class="form-error" id="formError" role="alert"></div></div><div class="modal-footer"><button type="button" class="small-button" data-close-modal>${onSubmit ? 'Cancel' : 'Close'}</button>${onSubmit ? `<button type="submit" class="small-button green">${esc(submit)}</button>` : ''}</div></form>`;
    for (const b of modal.querySelectorAll('[data-close-modal]'))
        b.onclick = () => modal.close();
    modal.querySelector('form').onsubmit = async (e) => {
        e.preventDefault();
        if (!onSubmit)
            return;
        try {
            await onSubmit(new FormData(e.currentTarget), e.currentTarget);
            modal.close();
        }
        catch (error) {
            $('#formError').textContent = error.message;
        }
    };
    modal.showModal();
    hydrate(modal);
    return modal;
}
const field = (name, label, value = '', type = 'text', attrs = '') => `<div class="field"><label for="f-${esc(name)}">${esc(label)}</label><input id="f-${esc(name)}" name="${esc(name)}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
function selectField(name, label, options, value) {
    return `<div class="field"><label for="f-${name}">${esc(label)}</label><select id="f-${name}" name="${name}">${options.map(o => {
        const [v, t] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(t)}</option>`;
    }).join('')}</select></div>`;
}
function requiredText(fd, name, label) {
    const v = String(fd.get(name) || '').trim();
    if (!v)
        throw Error(label + ' is required');
    return v;
}
function numeric(fd, name) {
    const v = Number(fd.get(name));
    if (!Number.isFinite(v))
        throw Error('A numeric field is invalid');
    return v;
}
const toolDefs = { append: ['append', 'Append model', 'primary'], save: ['save', 'Save project'], open: ['folder', 'Open project'], select: ['select', 'Select'], orbit: ['orbit', 'Orbit'], pan: ['pan', 'Pan'], fit: ['fit', 'Fit all'], focus: ['isolate', 'Focus'], isolate: ['isolate', 'Isolate'], hide: ['hide', 'Hide'], showAll: ['eye', 'Show all'], section: ['section', 'Section box'], measure: ['ruler', 'Measure'], clashes: ['clash', 'Clash tests', 'primary'], newIssue: ['issue', 'Create issue'], saveView: ['camera', 'Save viewpoint'], views: ['bookmark', 'Viewpoints'], report: ['report', 'Report', 'primary'], csv: ['download', 'Export CSV'], snapshot: ['camera', 'Snapshot'], sets: ['layers', 'Selection sets'], saveSet: ['plus', 'Save set'], properties: ['list', 'Properties'], xray: ['layers', 'X-ray'], align: ['transform', 'Transform'], modelSettings: ['settings', 'Federation'], grid: ['grid', 'Grid'], projection: ['box', 'Projection'], issues: ['issue', 'Issue register'], newTest: ['plus', 'New test'], run: ['play', 'Run test', 'primary'], color: ['color', 'Color override'], demo: ['home', 'Sample project'], export: ['download', 'Export project'], new: ['plus', 'New project'] };
const ribbonGroups = { Home: [['Project', ['append', 'save'], ['open', 'export']], ['Select & navigate', ['select', 'orbit', 'fit']], ['Visibility', ['isolate'], ['hide', 'showAll', 'xray']], ['Inspect', ['section', 'measure']], ['Coordinate', ['clashes', 'newIssue']], ['Viewpoints', ['saveView'], ['views', 'snapshot']]], Review: [['Selection', ['select', 'sets', 'saveSet']], ['Inspect', ['properties', 'measure', 'section']], ['Visibility', ['isolate', 'hide', 'showAll', 'xray']], ['Adjust', ['align', 'color']], ['Issues', ['newIssue', 'issues']]], Viewpoint: [['Camera', ['orbit', 'pan', 'fit', 'focus']], ['View', ['projection', 'grid', 'xray', 'section']], ['Viewpoints', ['saveView', 'views', 'snapshot']]], Coordination: [['Federation', ['append', 'modelSettings', 'align']], ['Clash detection', ['clashes', 'newTest', 'run']], ['Review', ['isolate', 'showAll', 'newIssue', 'issues']], ['Deliverables', ['report', 'csv']]], Output: [['Project', ['save', 'export', 'open']], ['Coordination reports', ['report', 'csv']], ['View capture', ['snapshot', 'saveView', 'views']], ['Workspace', ['demo', 'new']]] };
const actionMap = { showAll: 'show-all', newIssue: 'new-issue', saveView: 'save-view', saveSet: 'save-set', modelSettings: 'model-settings', newTest: 'new-test' };
function buttonHTML(key, mini = false) {
    const [ic, label, style] = toolDefs[key], action = actionMap[key] || key, active = ['select', 'orbit', 'pan'].includes(key) ? ui.tool === key : key === 'section' ? store.doc.section.enabled : key === 'xray' ? store.doc.display.xray : false;
    return `<button class="${mini ? '' : 'ribbon-tool'} ${style || ''} ${active ? 'active' : ''}" data-action="${action}" title="${label}">${icon(ic)}<span>${label}</span></button>`;
}
function renderRibbon() {
    for (const b of $$('#ribbonTabs [data-tab]'))
        b.classList.toggle('active', b.dataset.tab === ui.ribbon);
    $('#ribbon').innerHTML = ribbonGroups[ui.ribbon].map(([name, large, mini]) => `<div class="ribbon-group"><div class="ribbon-buttons">${large.map(k => buttonHTML(k)).join('')}${mini ? `<div class="ribbon-mini">${mini.map(k => buttonHTML(k, true)).join('')}</div>` : ''}</div><div class="ribbon-group-label">${name}</div></div>`).join('') + `<div class="ribbon-accent"><span class="accent-icon">${icon('layers', 26)}</span><div><h4>One coordinated picture.</h4><p>Bring models, people and decisions together.</p></div></div>`;
}
function entityMatches(e, q) {
    if (!q)
        return true;
    return (e.name + ' ' + e.type + ' ' + e.path.join(' ') + ' ' + JSON.stringify(e.properties)).toLowerCase().includes(q);
}
function renderTree() {
    const tree = $('#tree'), scroll = tree.scrollTop, q = ui.query.toLowerCase().trim();
    for (const b of $$('[data-left]'))
        b.classList.toggle('active', b.dataset.left === ui.left);
    $('#modelCount').textContent = store.doc.models.length;
    $('#federationSummary').textContent = `${store.doc.models.length} models · ${store.doc.entities.length.toLocaleString()} elements`;
    if (ui.left === 'sets') {
        tree.innerHTML = `<div class="sets-toolbar"><button class="small-button" data-action="save-set">${icon('plus')}Save selection</button></div>${store.doc.sets.filter(s => !q || s.name.toLowerCase().includes(q)).map(s => `<div class="set-card" data-set="${esc(s.id)}">${icon('layers')}<div><strong>${esc(s.name)}</strong><small>${s.ids.filter(id => store.byId.has(id)).length} elements</small></div><button class="icon-button" data-delete-set="${esc(s.id)}" title="Delete set" aria-label="Delete set">${icon('trash')}</button></div>`).join('')}${!store.doc.sets.length ? '<div class="empty-state"><p>Select objects and save your first selection set.</p></div>' : ''}`;
        return;
    }
    let html = '';
    for (const model of store.doc.models) {
        const all = store.doc.entities.filter(e => e.modelId === model.id), entities = all.filter(e => entityMatches(e, q));
        if (!entities.length && q && !model.name.toLowerCase().includes(q))
            continue;
        const key = 'model:' + model.id, expanded = ui.expanded.has(key) || !!q, c = model.color || [.56, .65, .7, 1];
        html += `<div class="tree-row model-row ${model.visible === false ? 'dim' : ''}" style="padding-left:7px" title="${esc(model.name)}" data-model-row="${esc(model.id)}"><button class="tree-toggle ${expanded ? 'open' : ''}" data-expand="${esc(key)}" aria-label="Expand model">${icon('chevron')}</button><span class="tree-swatch" style="background:rgb(${c.slice(0, 3).map(v => Math.round(v * 255)).join(',')})"></span><span class="tree-label">${esc(model.discipline || model.name)}</span><span class="tree-count">${all.length}</span><button class="tree-eye icon-button ${model.visible === false ? 'hidden-eye' : ''}" data-model-eye="${esc(model.id)}" title="Toggle model visibility" aria-label="Toggle model visibility">${icon(model.visible === false ? 'hide' : 'eye')}</button></div>`;
        if (!expanded)
            continue;
        const root = { children: new Map(), entities: [] };
        for (const e of entities) {
            let node = root;
            for (const segment of e.path || ['Elements']) {
                if (!node.children.has(segment))
                    node.children.set(segment, { children: new Map(), entities: [] });
                node = node.children.get(segment);
            }
            node.entities.push(e);
        }
        function branch(node, depth, path) {
            let result = '';
            for (const [name, child] of node.children) {
                const segments = [...path, name], key = `group:${model.id}:${segments.join('/')}`, open = ui.expanded.has(key) || !!q, ids = collect(child), selected = ids.length && ids.every(id => store.selection.has(id));
                result += `<div class="tree-row ${selected ? 'selected' : ''}" style="padding-left:${depth * 14 + 10}px" data-group-select="${esc(model.id + '|' + segments.join('/'))}" title="${esc(name)}"><button class="tree-toggle ${open ? 'open' : ''}" data-expand="${esc(key)}" aria-label="Expand group">${icon('chevron')}</button><span class="tree-folder-icon">${icon('folder')}</span><span class="tree-label">${esc(name)}</span><span class="tree-count">${ids.length}</span></div>`;
                if (open)
                    result += branch(child, depth + 1, segments);
            }
            for (const e of node.entities) {
                result += `<div class="tree-row ${store.selection.has(e.id) ? 'selected' : ''} ${e.visible === false ? 'dim' : ''}" style="padding-left:${depth * 14 + 27}px" data-entity="${esc(e.id)}" role="treeitem" aria-selected="${store.selection.has(e.id)}" title="${esc(e.name)}"><span class="tree-folder-icon">${icon('cube')}</span><span class="tree-label">${esc(e.name)}</span><button class="tree-eye icon-button ${e.visible === false ? 'hidden-eye' : ''}" data-entity-eye="${esc(e.id)}" title="Toggle element visibility" aria-label="Toggle element visibility">${icon(e.visible === false ? 'hide' : 'eye')}</button></div>`;
            }
            return result;
        }
        const collect = node => [...node.entities.map(e => e.id), ...[...node.children.values()].flatMap(collect)];
        html += branch(root, 1, []);
    }
    tree.innerHTML = html || `<div class="empty-state">${icon('layers')}<h3>${q ? 'No matches' : 'Start your federation'}</h3><p>${q ? 'Try another name, level or property value.' : 'Append IFC or glTF models to your project.'}</p><button class="small-button" data-action="append">${icon('append')}Append model</button></div>`;
    tree.scrollTop = scroll;
}
function propertyGroup(name, data) {
    return `<details class="property-group" open><summary>${esc(name)}</summary><table class="property-table"><tbody>${Object.entries(data || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`).join('')}</tbody></table></details>`;
}
function renderInspector() {
    const el = $('#inspectorContent'), scroll = el.scrollTop;
    for (const b of $$('[data-right]'))
        b.classList.toggle('active', b.dataset.right === ui.right);
    if (ui.right === 'views') {
        el.innerHTML = `<div class="view-list"><button class="small-button green" data-action="save-view" style="width:100%;margin-bottom:13px">${icon('camera')}Save current viewpoint</button>${store.doc.views.map(v => `<div class="view-item"><button data-view="${esc(v.id)}">${v.snapshot ? `<img src="${esc(v.snapshot)}" alt="${esc(v.name)}">` : `<span class="view-thumb">${icon('cube', 25)}</span>`}<div><strong>${esc(v.name)}</strong><small>${dateText(v.created)} · ${v.section.enabled ? 'Sectioned' : 'Full model'}</small></div></button><button class="icon-button delete-view" data-delete-view="${esc(v.id)}" title="Delete viewpoint" aria-label="Delete viewpoint">${icon('trash')}</button></div>`).join('')}${!store.doc.views.length ? `<div class="empty-state">${icon('camera')}<h3>Keep the useful perspectives.</h3><p>Viewpoints remember your camera, selection, visibility and section box.</p></div>` : ''}</div>`;
        return;
    }
    const selected = [...store.selection].map(id => store.byId.get(id)).filter(Boolean);
    if (!selected.length) {
        const d = store.doc;
        el.innerHTML = `<div class="project-card"><span class="eyebrow">PROJECT OVERVIEW</span><h3>${esc(d.name)}</h3><p>Design coordination / Federated model</p></div><div class="project-metrics"><div><strong>${d.models.length}</strong><span>DISCIPLINE MODELS</span></div><div><strong>${d.entities.length.toLocaleString()}</strong><span>MODEL ELEMENTS</span></div></div><div class="discipline-list">${d.models.map(m => `<div class="discipline-item"><span class="tree-swatch" style="background:rgb(${(m.color || [.59, .67, .71]).slice(0, 3).map(v => Math.round(v * 255)).join(',')})"></span><span>${esc(m.discipline)}</span><span class="title-spacer"></span><small>${d.entities.filter(e => e.modelId === m.id).length} objects</small></div>`).join('')}</div><div class="local-note"><strong>Your models stay on this device.</strong>Project data is processed locally. Click an object to inspect its properties or run a clash test below.</div>${d.models.some(m => m.warnings?.length) ? '<div class="local-note"><strong>Import warnings are present.</strong>Open Federation settings to review omitted or unsupported geometry.</div>' : ''}`;
        return;
    }
    const e = selected[0], model = store.doc.models.find(m => m.id === e.modelId), b = store.bounds(selected.map(e => e.id), false), dim = size(b);
    el.innerHTML = `<div class="selection-heading"><div class="type-label">${selected.length > 1 ? 'MULTIPLE ELEMENTS' : esc(e.type)}</div><h3>${selected.length > 1 ? selected.length + ' elements selected' : esc(e.name)}</h3><p>${selected.length > 1 ? 'Combined selection bounds below' : esc(model?.name)}</p><div class="selected-actions"><button class="small-button" data-action="focus">${icon('fit')}Focus</button><button class="small-button" data-action="new-issue">${icon('issue')}Issue</button><button class="small-button" data-action="edit-properties" title="Edit coordination properties">${icon('edit')}</button></div></div>${selected.length === 1 ? Object.entries(e.properties || {}).map(([k, v]) => propertyGroup(k, typeof v === 'object' && v !== null ? v : { Value: v })).join('') : propertyGroup('Selection', { Elements: selected.length, Models: new Set(selected.map(e => e.modelId)).size })}${propertyGroup('World-space bounds', { Width: formatNum(dim[0]) + ' m', Height: formatNum(dim[1]) + ' m', Depth: formatNum(dim[2]) + ' m', 'Min X / Y / Z': b.min.map(x => formatNum(x)).join(' / '), 'Max X / Y / Z': b.max.map(x => formatNum(x)).join(' / ') })}<div style="padding:12px"><button class="small-button" data-action="element-transform">${icon('transform')}Transform selected elements</button></div>`;
    el.scrollTop = scroll;
}
function renderClashes() {
    const t = currentTest();
    if (t)
        ui.test = t.id;
    const run = t ? store.doc.results[t.id] : null;
    let results = run?.results || [];
    if (ui.filter !== 'all')
        results = results.filter(r => r.status === ui.filter);
    const count = run?.results.length || 0;
    return `<div class="clash-layout"><aside class="test-list"><div class="subheading">CLASH TESTS <button class="icon-button" data-action="new-test" title="Create test" aria-label="Create test">${icon('plus')}</button></div>${store.doc.tests.map(test => `<div class="test-row ${t?.id === test.id ? 'selected' : ''}" data-test="${esc(test.id)}">${icon('clash')}<div><strong>${esc(test.name)}</strong><small>${test.mode === 'hard' ? 'Hard · triangle contact' : `Clearance · ${formatNum(test.clearance * 1000, 1)} mm`}</small></div><span class="test-pill">${store.doc.results[test.id]?.results.length ?? '—'}</span></div>`).join('')}<button class="add-test" data-action="new-test">${icon('plus')}Add clash test</button></aside><div class="results-pane"><div class="results-toolbar"><h4>${esc(t?.name || 'Clash coordination')}</h4><span class="toolbar-note">${t ? esc(scopeName(t.scopeA) + ' ↔ ' + scopeName(t.scopeB)) : ''}</span><div class="title-spacer"></div><select id="resultFilter" aria-label="Filter results">${['all', 'New', 'Active', 'Reviewed', 'Approved', 'Resolved'].map(s => `<option value="${s}" ${ui.filter === s ? 'selected' : ''}>${s === 'all' ? 'All statuses' : s}</option>`).join('')}</select><button class="icon-button" data-action="edit-test" title="Test settings" aria-label="Test settings">${icon('settings')}</button><button class="small-button green" data-action="${ui.busy ? 'cancel-test' : 'run'}" ${!t ? 'disabled' : ''}>${icon(ui.busy ? 'stop' : 'play')}${ui.busy ? 'Cancel' : 'Run test'}</button></div><div class="progress-track ${ui.busy ? '' : 'hidden'}" id="clashProgressTrack"><i id="clashProgressBar" style="width:0%"></i></div><div class="result-summary"><span class="clash-dot"></span><span id="runSummary" class="${run?.stale ? 'stale-warning' : ''}">${ui.busy ? 'Processing triangle geometry…' : run ? `${count} ${count === 1 ? 'conflict' : 'conflicts'} · ${run.results.filter(r => r.status === 'New').length} new${run.stale ? ' · Geometry or test changed — rerun required' : ''}` : 'Ready to coordinate. Run a test to find real geometry conflicts.'}</span><div class="title-spacer"></div>${run && !run.stale ? '<span>Triangle narrow phase</span>' : ''}</div><div class="result-table-wrap"><table class="data-table"><colgroup><col style="width:37px"><col style="width:27%"><col style="width:27%"><col style="width:110px"><col style="width:78px"><col style="width:92px"><col style="width:45px"></colgroup><thead><tr><th>#</th><th>ELEMENT A</th><th>ELEMENT B</th><th>TYPE</th><th>DISTANCE</th><th>STATUS</th><th></th></tr></thead><tbody>${results.map((r, i) => `<tr class="${ui.result === r.id ? 'active' : ''}" data-clash="${esc(r.id)}"><td class="number">${String(i + 1).padStart(2, '0')}</td><td title="${esc(store.byId.get(r.a)?.name || r.a)}"><i class="pair-swatch"></i>${esc(store.byId.get(r.a)?.name || r.a)}</td><td title="${esc(store.byId.get(r.b)?.name || r.b)}"><i class="pair-swatch b"></i>${esc(store.byId.get(r.b)?.name || r.b)}</td><td title="${esc(r.kind)}">${esc(r.kind)}</td><td>${formatNum(r.distance * 1000, 2)} mm</td><td><select class="result-status" data-clash-status="${esc(r.id)}" aria-label="Clash review status">${['New', 'Active', 'Reviewed', 'Approved', 'Resolved'].map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><button class="icon-button" data-issue-clash="${esc(r.id)}" title="Create issue from clash" aria-label="Create issue from clash">${icon('issue')}</button></td></tr>`).join('')}</tbody></table>${!results.length ? `<div class="empty-state" style="min-height:100px;padding:15px">${icon(run ? 'check' : 'clash', 28)}<h3>${run ? (ui.filter === 'all' ? 'No conflicts found in this scope.' : 'No results with this status.') : 'Check the spaces between disciplines.'}</h3><p>${run ? 'Change scope or clearance in test settings to inspect another condition.' : 'Spatial filtering, triangle contact, solid containment and clearance distance.'}</p></div>` : ''}</div><div class="table-footer"><span>${run ? `${run.stats.candidates} candidate pairs · ${run.stats.tested} evaluated · ${run.stats.reused} reused` : 'Visibility and section planes do not affect test scope.'}</span><span>${run ? `${run.stats.milliseconds.toFixed(1)} ms · ${new Date(run.date).toLocaleTimeString()}` : 'Double-click a result to focus the conflict'}</span></div></div></div>`;
}
function renderIssues() {
    return `<div class="issue-layout"><div class="results-toolbar"><h4>Coordination issues</h4><span class="toolbar-note">Decisions linked to model objects and viewpoints</span><div class="title-spacer"></div><button class="small-button" data-action="report">${icon('report')}Report</button><button class="small-button green" data-action="new-issue">${icon('plus')}Create issue</button></div><div class="scroll-content"><table class="data-table"><colgroup><col style="width:84px"><col style="width:31%"><col style="width:90px"><col style="width:85px"><col style="width:120px"><col style="width:100px"><col style="width:60px"></colgroup><thead><tr><th>REFERENCE</th><th>ISSUE TITLE</th><th>STATUS</th><th>PRIORITY</th><th>ASSIGNEE</th><th>DUE</th><th>OBJECTS</th></tr></thead><tbody>${store.doc.issues.map(i => `<tr data-issue="${esc(i.id)}"><td class="number">${esc(i.reference)}</td><td>${esc(i.title)}</td><td><span class="status-badge ${i.status.toLowerCase()}">${esc(i.status)}</span></td><td>${esc(i.priority)}</td><td>${esc(i.assignee || 'Unassigned')}</td><td>${esc(i.due || '—')}</td><td>${i.entityIds.length}</td></tr>`).join('')}</tbody></table>${!store.doc.issues.length ? `<div class="empty-state" style="min-height:125px">${icon('issue')}<h3>Turn a conflict into a decision.</h3><p>Select objects or a clash result, then create an issue with a captured viewpoint and an owner.</p></div>` : ''}</div></div>`;
}
function renderMeasurements() {
    return `<div class="measure-layout"><div class="results-toolbar"><h4>Point-to-point measurements</h4><span class="toolbar-note">World coordinates · metres · triangle surface picking</span><div class="title-spacer"></div><button class="small-button" data-action="clear-measurements">${icon('trash')}Clear</button><button class="small-button green" data-action="measure">${icon('ruler')}Measure</button></div><div class="scroll-content"><table class="data-table"><thead><tr><th>MEASUREMENT</th><th>DISTANCE</th><th>ΔX</th><th>ΔY</th><th>ΔZ</th><th> </th></tr></thead><tbody>${store.doc.measurements.map(m => {
        const delta = vsub(m.b, m.a);
        return `<tr data-measurement="${esc(m.id)}"><td>${esc(m.name)}</td><td>${formatNum(length(delta), 4)} m</td>${delta.map(v => `<td>${formatNum(v, 4)} m</td>`).join('')}<td><button class="icon-button" data-delete-measurement="${esc(m.id)}" aria-label="Delete measurement">${icon('trash')}</button></td></tr>`;
    }).join('')}</tbody></table>${!store.doc.measurements.length ? `<div class="empty-state" style="min-height:120px">${icon('ruler')}<h3>Measure what matters.</h3><p>Activate Measure, then click two model surfaces. Distances and axis deltas are saved with the project.</p></div>` : ''}</div></div>`;
}
function renderBottom() {
    for (const b of $$('[data-bottom]'))
        b.classList.toggle('active', b.dataset.bottom === ui.bottom);
    $('#clashCount').textContent = Object.values(store.doc.results).reduce((n, r) => n + r.results.length, 0);
    $('#issueCount').textContent = store.doc.issues.filter(i => i.status !== 'Closed').length;
    $('#bottomContent').innerHTML = ui.bottom === 'clashes' ? renderClashes() : ui.bottom === 'issues' ? renderIssues() : ui.bottom === 'measurements' ? renderMeasurements() : `<div class="activity-layout"><div class="results-toolbar"><h4>Project activity</h4><span class="toolbar-note">Undoable model coordination history</span><div class="title-spacer"></div><button class="small-button" data-action="undo">${icon('undo')}Undo</button><button class="small-button" data-action="redo">${icon('redo')}Redo</button></div><div class="scroll-content">${store.doc.activity.map(a => `<div class="activity-row">${icon('check')}<time>${new Date(a.time).toLocaleTimeString()}</time><span>${esc(a.label)}</span></div>`).join('')}</div></div>`;
}
function renderSection() {
    const panel = $('#sectionPanel'), s = store.doc.section;
    panel.classList.toggle('hidden', !s.enabled);
    if (!s.enabled)
        return;
    panel.innerHTML = `<header><span>Section box</span><button class="icon-button" data-action="section" title="Disable section" aria-label="Disable section">${icon('close')}</button></header><div class="section-labels"><span></span><span>MIN (m)</span><span>MAX (m)</span></div>${['X', 'Y', 'Z'].map((axis, k) => `<div class="section-row"><span>${axis}</span><input data-clip-axis="${k}" data-clip-bound="min" type="number" step=".1" value="${Number(s.min[k].toFixed(3))}" aria-label="Section minimum ${axis}"><input data-clip-axis="${k}" data-clip-bound="max" type="number" step=".1" value="${Number(s.max[k].toFixed(3))}" aria-label="Section maximum ${axis}"></div>`).join('')}<div style="display:flex;gap:6px;margin-top:9px"><button class="small-button" data-action="section-fit">Fit selection</button><button class="small-button" data-action="section-reset">Reset</button></div><p class="section-note">Six world-axis clipping planes. Clip faces are not capped. Clash scope stays unchanged.</p>`;
}
function renderStatus() {
    const n = store.selection.size;
    $('#selectionStatus').textContent = n ? `${n} element${n === 1 ? '' : 's'} selected` : 'Nothing selected';
    $('#visibleCount').textContent = `${new Set(store.instances.filter(i => i.visible).map(i => i.entityId)).size.toLocaleString()} visible`;
    $('#projectName').textContent = store.doc.name;
    $('#viewModeLabel').textContent = camera.ortho ? 'Orthographic' : 'Perspective';
    $('#sceneBadge').textContent = store.doc.section.enabled ? 'SECTIONED VIEW' : store.doc.display.xray ? 'X-RAY VIEW' : 'FEDERATED VIEW';
    const card = $('#selectionCard');
    card.classList.toggle('hidden', n === 0);
    if (n)
        card.innerHTML = `${icon(store.clashPair ? 'clash' : 'cube')}<div><strong>${store.clashPair ? 'Clash review · A / B' : n === 1 ? esc(store.byId.get([...store.selection][0])?.name) : n + ' elements selected'}</strong><small>${store.clashPair ? 'Red: element A · Green: element B' : n === 1 ? esc(store.doc.models.find(m => m.id === store.byId.get([...store.selection][0])?.modelId)?.discipline) : 'Ctrl / ⌘ + click to add or remove'}</small></div>`;
    for (const b of $$('[data-action=undo]'))
        b.disabled = !store.undoStack.length;
    for (const b of $$('[data-action=redo]'))
        b.disabled = !store.redoStack.length;
}
function renderAll() {
    renderRibbon();
    renderTree();
    renderInspector();
    renderBottom();
    renderSection();
    renderStatus();
    renderer?.invalidate();
}
function renderAnnotations() {
    const svg = $('#annotations'), r = $('#scene').getBoundingClientRect();
    let out = '';
    const draw = (m, temporary = false) => {
        const a = camera.project(m.a, r.width, r.height), b = camera.project(m.b, r.width, r.height);
        if (!a || !b || Math.abs(a[2]) > 1.001 || Math.abs(b[2]) > 1.001)
            return;
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], label = formatNum(length(vsub(m.b, m.a)), 3) + ' m';
        out += `<g><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#257455" stroke-width="1.5" ${temporary ? 'stroke-dasharray="4 3"' : ''}/><circle cx="${a[0]}" cy="${a[1]}" r="3.5" fill="#fff" stroke="#287757" stroke-width="1.5"/><circle cx="${b[0]}" cy="${b[1]}" r="3.5" fill="#fff" stroke="#287757" stroke-width="1.5"/><rect x="${mid[0] - 38}" y="${mid[1] - 11}" width="76" height="21" rx="4" fill="#fffffff0" stroke="#bad2c3"/><text x="${mid[0]}" y="${mid[1] + 3}" text-anchor="middle" fill="#347a56" font-family="Segoe UI,Arial,sans-serif" font-size="10">${esc(label)}</text></g>`;
    };
    for (const m of store.doc.measurements)
        draw(m);
    if (ui.measureStart) {
        const p = camera.project(ui.measureStart.point, r.width, r.height);
        if (p)
            out += `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="#41a77a" stroke="white" stroke-width="2"/>`;
    }
    svg.innerHTML = out;
    if (renderer) {
        $('#renderStats').textContent = `${renderer.stats.triangles.toLocaleString()} triangles · ${renderer.stats.draws} draws · ${renderer.stats.ms.toFixed(1)} ms CPU`;
    }
    $('#viewModeLabel').textContent = camera.ortho ? 'Orthographic' : 'Perspective';
}
function setTool(tool) {
    ui.tool = tool;
    ui.measureStart = null;
    $('#measureHint').classList.toggle('hidden', tool !== 'measure');
    $('#measureHint').textContent = 'Pick the first point on a model surface · Esc to cancel';
    for (const b of $$('[data-tool]'))
        b.classList.toggle('active', b.dataset.tool === tool);
    renderer.canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'measure' ? 'crosshair' : 'default';
    renderRibbon();
    renderer.invalidate();
}
function focus(ids = null) {
    const box = store.bounds(ids, ids ? false : true);
    if (!validBox(box)) {
        toast('There is no visible geometry to frame.');
        return;
    }
    camera.fit(box);
    renderer.invalidate();
    requestSave();
}
function captureView(name) {
    return { id: uid('view'), name, created: new Date().toISOString(), camera: camera.serialize(), section: clone(store.doc.section), display: clone(store.doc.display), selection: [...store.selection], clashPair: store.clashPair ? clone(store.clashPair) : null, hiddenEntities: store.doc.entities.filter(e => e.visible === false).map(e => e.id), hiddenModels: store.doc.models.filter(m => m.visible === false).map(m => m.id), snapshot: thumbnail() };
}
function thumbnail() {
    try {
        renderer.render();
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = Math.max(1, Math.round(360 * renderer.canvas.height / renderer.canvas.width));
        canvas.getContext('2d').drawImage(renderer.canvas, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', .74);
    }
    catch {
        return '';
    }
}
function restoreView(view) {
    if (!view)
        return;
    commit(`Restore viewpoint: ${view.name || 'Issue view'}`, d => {
        d.camera = clone(view.camera);
        d.section = clone(view.section);
        d.display = clone(view.display);
        const he = new Set(view.hiddenEntities || []), hm = new Set(view.hiddenModels || []);
        d.entities.forEach(e => e.visible = !he.has(e.id));
        d.models.forEach(m => m.visible = !hm.has(m.id));
    });
    camera.restore(view.camera);
    store.select(view.selection || []);
    store.clashPair = view.clashPair || null;
    store.sceneRevision++;
    $('#viewportTitle').textContent = view.name || 'Issue viewpoint';
    renderer.invalidate();
    renderStatus();
    requestSave();
}
function selectClash(id, zoom = false) {
    const t = currentTest(), r = store.doc.results[t?.id]?.results.find(r => r.id === id);
    if (!r)
        return;
    ui.result = id;
    store.select([r.a, r.b]);
    store.clashPair = [r.a, r.b];
    store.sceneRevision++;
    renderBottom();
    renderStatus();
    renderer.invalidate();
    if (zoom) {
        const a = store.index.query({ min: r.point, max: r.point }, .02);
        camera.target = [...r.point];
        camera.distance = Math.max(3, Math.min(12, length(size(store.bounds([r.a, r.b], false))) * .8));
        renderer.invalidate();
    }
    return r;
}
function testDialog(existing = null) {
    const options = [['all', 'All elements'], ...store.doc.models.map(m => ['model:' + m.id, m.discipline + ' · ' + m.name]), ...store.doc.sets.map(s => ['set:' + s.id, 'Set · ' + s.name])];
    showModal(existing ? 'Edit clash test' : 'Create clash test', `${field('name', 'Test name', existing?.name || 'New coordination test', 'text', 'required maxlength="120"')}<div class="field-row">${selectField('scopeA', 'Selection A', options, existing?.scopeA || options[1]?.[0] || 'all')}${selectField('scopeB', 'Selection B', options, existing?.scopeB || options[2]?.[0] || 'all')}</div><div class="field-row">${selectField('mode', 'Test method', [['hard', 'Hard · contact / intersection'], ['clearance', 'Clearance · minimum separation']], existing?.mode || 'hard')}${field('clearance', 'Required clearance (mm)', (existing?.clearance ?? .05) * 1000, 'number', 'min="0" step="0.1" max="100000"')}</div><div class="help-note">Hard tests use triangle contact (1 µm epsilon) and closed-solid containment. Clearance is the nearest surface distance, not a bounding-box gap. Hidden and sectioned geometry remains in the test scope.</div>${existing ? `<button type="button" class="small-button danger" data-delete-test="${esc(existing.id)}" style="margin-top:15px">${icon('trash')}Delete this test</button>` : ''}`, fd => {
        const value = { id: existing?.id || uid('test'), name: requiredText(fd, 'name', 'Test name'), scopeA: fd.get('scopeA'), scopeB: fd.get('scopeB'), mode: fd.get('mode'), clearance: numeric(fd, 'clearance') / 1000 };
        if (value.clearance < 0)
            throw Error('Clearance must not be negative');
        commit(existing ? 'Update clash test' : 'Create clash test', d => {
            if (existing)
                d.tests[d.tests.findIndex(t => t.id === existing.id)] = value;
            else
                d.tests.push(value);
            if (d.results[value.id])
                d.results[value.id].stale = true;
        });
        ui.test = value.id;
        ui.bottom = 'clashes';
        renderBottom();
    });
}
function syncClash() {
    if (syncedEpoch === store.geometryEpoch)
        return;
    const grouped = new Map();
    for (const i of store.instances) {
        if (!grouped.has(i.entityId))
            grouped.set(i.entityId, []);
        grouped.get(i.entityId).push(i);
    }
    const entities = [...grouped].map(([id, parts]) => {
        const b = store.entityBounds.get(id);
        return { id, box: b, parts: parts.map(p => ({ geometryId: p.geometryId, matrix: p.matrix })), stamp: parts.map(p => p.geometryId + ':' + p.matrix.map(v => v.toPrecision(16)).join(',')).join(';') };
    });
    const geometries = [...store.geometries].filter(([id]) => !sentGeometries.has(id));
    geometries.forEach(([id]) => sentGeometries.add(id));
    clashWorker.postMessage({ type: 'sync', payload: { entities, geometries, revision: store.geometryEpoch } });
    syncedEpoch = store.geometryEpoch;
}
async function runTest(id = null) {
    if (ui.busy) {
        toast('A clash test is already running.');
        return;
    }
    const t = id ? store.doc.tests.find(t => t.id === id) : currentTest();
    if (!t) {
        testDialog();
        return;
    }
    const idsA = scopeIDs(t.scopeA), idsB = scopeIDs(t.scopeB);
    if (!idsA.length || !idsB.length) {
        toast('Both test scopes must contain elements.', true);
        return;
    }
    syncClash();
    ui.busy = true;
    ui.test = t.id;
    ui.bottom = 'clashes';
    const job = ++ui.job;
    renderBottom();
    return new Promise(resolve => {
        activeRun = { job, epoch: store.geometryEpoch, testId: t.id, config: JSON.stringify(t), resolve };
        clashWorker.postMessage({ type: 'run', job, test: { ...t, idsA, idsB } });
    });
}
clashWorker.onmessage = ({ data }) => {
    if (!activeRun || data.job !== activeRun.job)
        return;
    if (data.type === 'progress') {
        const p = data.progress;
        if ($('#clashProgressBar'))
            $('#clashProgressBar').style.width = `${p.total ? p.done / p.total * 100 : 0}%`;
        if ($('#runSummary'))
            $('#runSummary').textContent = `${p.done} / ${p.total} pairs · ${p.found} conflicts · ${p.reused} reused`;
        return;
    }
    const run = activeRun;
    activeRun = null;
    ui.busy = false;
    const t = store.doc.tests.find(t => t.id === run.testId);
    if (data.type === 'error') {
        toast('Clash test failed: ' + data.error, true);
        renderBottom();
        run.resolve(null);
        return;
    }
    if (data.result.cancelled || run.epoch !== store.geometryEpoch || JSON.stringify(t) !== run.config) {
        toast('Clash run cancelled or invalidated by project changes.');
        renderBottom();
        run.resolve(null);
        return;
    }
    const old = new Map((store.doc.results[run.testId]?.results || []).map(r => [r.id, r.status]));
    for (const r of data.result.results)
        r.status = old.get(r.id) || 'New';
    commit('Run clash test: ' + t.name, d => {
        d.results[run.testId] = { ...data.result, stale: false };
    });
    toast(`${data.result.results.length} conflicts · ${data.result.stats.tested} evaluated, ${data.result.stats.reused} reused.`);
    run.resolve(data.result);
};
clashWorker.onerror = error => {
    ui.busy = false;
    activeRun?.resolve(null);
    activeRun = null;
    toast('Clash worker error: ' + error.message, true);
    renderBottom();
};
function cancelTest() {
    clashWorker.postMessage({ type: 'cancel' });
    ui.busy = false;
    activeRun?.resolve(null);
    activeRun = null;
    renderBottom();
}
function issueDialog(existing = null, clash = null) {
    const ids = existing?.entityIds || [...store.selection], view = existing?.view || captureView(clash ? 'Clash viewpoint' : 'Issue viewpoint');
    showModal(existing ? existing.reference + ' · Coordination issue' : 'Create coordination issue', `${field('title', 'Issue title', existing?.title || (clash ? 'Resolve ' + (store.byId.get(clash.a)?.name || 'element conflict') : 'New coordination issue'), 'text', 'required maxlength="180"')}<div class="field"><label for="issueDescription">Description / required action</label><textarea id="issueDescription" name="description" maxlength="10000">${esc(existing?.description || '')}</textarea></div><div class="field-row">${selectField('status', 'Status', ['Open', 'Active', 'Reviewed', 'Closed'], existing?.status || 'Open')}${selectField('priority', 'Priority', ['Low', 'Normal', 'High', 'Critical'], existing?.priority || 'Normal')}</div><div class="field-row">${field('assignee', 'Assigned to', existing?.assignee || '', 'text', 'maxlength="120"')}${field('due', 'Due date', existing?.due || '', 'date')}</div><div class="help-note">${ids.length} linked model element${ids.length === 1 ? '' : 's'} · Camera, visibility and section planes ${existing ? 'retained' : 'captured'} with this issue.</div>${existing ? `<div style="display:flex;gap:7px;margin-top:12px"><button type="button" class="small-button" data-restore-issue="${esc(existing.id)}">${icon('camera')}Restore viewpoint</button><button type="button" class="small-button danger" data-delete-issue="${esc(existing.id)}">${icon('trash')}Delete issue</button></div><div class="issue-comments"><div class="field"><label for="newComment">Add review comment</label><textarea id="newComment" name="comment" placeholder="Record a decision or follow-up…" maxlength="5000"></textarea></div>${(existing.comments || []).map(c => `<div class="comment">${esc(c.text)}<small>${esc(new Date(c.date).toLocaleString())}</small></div>`).join('')}</div>` : ''}`, fd => {
        const data = { id: existing?.id || uid('issue'), reference: existing?.reference || `ISS-${String(Math.max(0, ...store.doc.issues.map(i => Number(i.reference?.split('-')[1]) || 0)) + 1).padStart(3, '0')}`, title: requiredText(fd, 'title', 'Issue title'), description: String(fd.get('description') || ''), status: fd.get('status'), priority: fd.get('priority'), assignee: String(fd.get('assignee') || '').trim(), due: fd.get('due') || '', entityIds: ids, view, created: existing?.created || new Date().toISOString(), updated: new Date().toISOString(), clashId: existing?.clashId || clash?.id || null, comments: clone(existing?.comments || []) };
        const text = String(fd.get('comment') || '').trim();
        if (text)
            data.comments.unshift({ text, date: new Date().toISOString() });
        commit(existing ? 'Update issue: ' + data.reference : 'Create issue: ' + data.reference, d => {
            if (existing)
                d.issues[d.issues.findIndex(i => i.id === existing.id)] = data;
            else
                d.issues.push(data);
        });
        ui.bottom = 'issues';
        renderBottom();
    }, { submit: existing ? 'Save changes' : 'Create issue' });
}
function transformDialog(elementMode = false) {
    const selected = [...store.selection];
    if (elementMode && !selected.length) {
        toast('Select one or more elements first.');
        return;
    }
    const model = store.doc.models.find(m => m.id === store.byId.get(selected[0])?.modelId) || store.doc.models[0];
    if (!model) {
        toast('Append a model first.');
        return;
    }
    const scale = Math.hypot(...model.matrix.slice(0, 3)), yaw = Math.atan2(model.matrix[8], model.matrix[0]) * 180 / Math.PI;
    const modal = showModal(elementMode ? 'Transform selected elements' : 'Model federation & alignment', `${!elementMode ? selectField('model', 'Federated model', store.doc.models.map(m => [m.id, m.name]), model.id) : `<p class="help-note">Offsets are applied in each element's model coordinate frame. ${selected.length} elements selected. Geometry buffers remain shared.</p>`}<div class="field-row three">${['X', 'Y', 'Z'].map((a, i) => field('t' + i, elementMode ? 'Offset ' + a + ' (m)' : 'Translation ' + a + ' (m)', elementMode ? 0 : model.matrix[12 + i], 'number', 'step="any"')).join('')}</div>${!elementMode ? `<div class="field-row">${field('rotation', 'Rotation around Y (degrees)', yaw, 'number', 'step="any"')}${field('scale', 'Uniform scale', scale, 'number', 'step="any" min="0.000001"')}</div>` : ''}<div class="warning-note">These are coordination transforms, not edits to the source file. Moving geometry invalidates previous clash results. Alignment is absolute for a model and incremental for selected elements.</div>${!elementMode ? `<div id="modelWarnings" style="margin-top:13px">${model.warnings?.length ? `<div class="warning-note">${model.warnings.slice(0, 20).map(esc).join('<br>')}</div>` : ''}</div><button type="button" class="small-button danger" style="margin-top:13px" data-action="remove-model">${icon('trash')}Remove selected model</button>` : ''}`, fd => {
        const t = [0, 1, 2].map(i => numeric(fd, 't' + i));
        if (elementMode) {
            commit('Transform selected elements', d => {
                for (const e of d.entities)
                    if (store.selection.has(e.id))
                        for (let k = 0; k < 3; k++)
                            e.matrix[12 + k] += t[k];
            }, true);
        }
        else {
            const id = fd.get('model'), s = numeric(fd, 'scale'), a = numeric(fd, 'rotation') * Math.PI / 180;
            if (s <= 0)
                throw Error('Scale must be positive');
            commit('Align federated model', d => {
                const m = d.models.find(m => m.id === id);
                m.matrix = trs(t, [0, Math.sin(a / 2), 0, Math.cos(a / 2)], [s, s, s]);
            }, true);
        }
    }, { submit: 'Apply transform' });
    const select = modal.querySelector('[name=model]');
    if (select)
        select.onchange = () => {
            const m = store.doc.models.find(m => m.id === select.value);
            for (let k = 0; k < 3; k++)
                modal.querySelector(`[name=t${k}]`).value = m.matrix[12 + k];
            modal.querySelector('[name=rotation]').value = Math.atan2(m.matrix[8], m.matrix[0]) * 180 / Math.PI;
            modal.querySelector('[name=scale]').value = Math.hypot(...m.matrix.slice(0, 3));
            $('#modelWarnings').innerHTML = m.warnings?.length ? `<div class="warning-note">${m.warnings.slice(0, 20).map(esc).join('<br>')}</div>` : '';
        };
}
async function importFiles(files) {
    if (ui.importBusy) {
        toast('An import is already in progress.');
        return;
    }
    const list = Array.from(files), projects = list.filter(f => /\.(converge|json)$/i.test(f.name)), models = list.filter(f => /\.(ifc|gltf|glb)$/i.test(f.name));
    if (projects.length) {
        if (projects.length > 1 || models.length)
            throw Error('Open one Converge project at a time, separately from model imports.');
        const f = projects[0];
        if (f.size > 512 * 1024 * 1024)
            throw Error('Project exceeds the 512 MB input safety limit');
        const data = unpack(JSON.parse(await f.text()));
        cancelTest();
        renderer.resetResources();
        store.replace(data.doc, data.geometries);
        resetClashSync();
        camera.restore(store.doc.camera || new Camera().serialize());
        ui.test = store.doc.tests[0]?.id;
        renderAll();
        toast('Opened ' + f.name);
        return;
    }
    if (!models.length) {
        toast('Choose IFC, GLB, glTF + .bin sidecars, or a .converge project.', true);
        return;
    }
    ui.importBusy = true;
    let successes = 0;
    const overlay = $('#loadingOverlay');
    overlay.classList.remove('hidden');
    overlay.querySelector('h3').textContent = 'Appending models';
    try {
        for (const file of models) {
            if (file.size > 512 * 1024 * 1024) {
                toast(file.name + ' exceeds the 512 MB input safety limit.', true);
                continue;
            }
            overlay.querySelector('p').textContent = file.name;
            try {
                const data = await new Promise((resolve, reject) => {
                    const worker = new Worker(new URL('./import-worker.js', import.meta.url), { type: 'module' });
                    worker.onmessage = ({ data }) => {
                        if (data.type === 'progress') {
                            overlay.querySelector('p').textContent = `${file.name} · ${data.progress.elements || 0} elements`;
                            return;
                        }
                        worker.terminate();
                        if (data.type === 'error')
                            reject(Error(data.error));
                        else
                            resolve(data.result);
                    };
                    worker.onerror = e => {
                        worker.terminate();
                        reject(Error(e.message));
                    };
                    worker.postMessage({ file, files: list, nativeOnly: new URLSearchParams(location.search).get('ifc') === 'native' });
                });
                await store.addImport(data);
                ui.expanded.add('model:' + data.model.id);
                successes++;
                if (data.model.warnings?.length) {
                    toast(`${file.name}: imported with ${data.model.warnings.length} warning(s). Review Federation settings.`, true, 9000);
                }
                else
                    toast(`Appended ${file.name} · ${data.entities.length} elements`);
            }
            catch (error) {
                toast(file.name + ': ' + error.message, true, 12000);
            }
        }
        if (successes) {
            focus();
            ui.left = 'models';
            renderTree();
        }
    }
    finally {
        ui.importBusy = false;
        overlay.classList.add('hidden');
    }
}
function resetClashSync() {
    cancelTest();
    syncedEpoch = -1;
    sentGeometries.clear();
    clashWorker.postMessage({ type: 'sync', payload: { entities: [], geometries: [], revision: -1, reset: true } });
}
function projectMenu() {
    showModal('Project', `<div class="menu-list">${[['append', 'append', 'Append model', 'Federate IFC, glTF or GLB files'], ['open', 'folder', 'Open project', 'Restore a portable .converge project'], ['save', 'save', 'Save locally', 'Keep project state in this browser'], ['export', 'download', 'Export project file', 'Portable models, geometry and coordination data'], ['new', 'plus', 'New project', 'Start an empty coordination workspace'], ['demo', 'home', 'Open sample project', 'Explore Harbor Point · Building A']].map(([action, ic, title, sub]) => `<button type="button" data-action="${action}">${icon(ic, 23)}<div><strong>${title}</strong><small>${sub}</small></div></button>`).join('')}</div>`);
}
function helpDialog() {
    showModal('Converge Studio · Workbench guide', `<p class="help-note">A local-first coordination workbench. The viewport uses WebGPU when available, with WebGL2 and software fallbacks. No account or upload service is involved.</p><table class="shortcut-table">${[['Drag', 'Orbit the camera'], ['Right drag / Shift drag', 'Pan'], ['Scroll / pinch', 'Zoom'], ['Click', 'Pick an element (GPU ID pass where available)'], ['Ctrl / ⌘ + click', 'Extend the selection'], ['Double click', 'Focus the picked object'], ['V / O / P', 'Select / Orbit / Pan'], ['M', 'Measure two model surfaces'], ['F', 'Fit visible geometry'], ['H / Shift H', 'Hide selection / Show all'], ['I', 'Isolate selection'], ['B', 'Toggle six-plane section box'], ['Ctrl / ⌘ Z', 'Undo'], ['Ctrl / ⌘ Shift Z', 'Redo'], ['Ctrl / ⌘ S', 'Save in this browser'], ['Ctrl / ⌘ K', 'Command palette'], ['Escape', 'Cancel measurement or clear selection']].map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table><h3 style="font-size:12px;margin-top:20px">Format and geometry boundaries</h3><p class="help-note">Static glTF 2.0 triangle meshes, GLB, material base colors and mesh instancing. Texture maps, Draco/Meshopt compression, animation and skinning are not evaluated. IFC uses web-ifc after npm install; the bundled offline subset supports simple extrusions, faceted BReps, tessellations and mapped geometry, with explicit warnings for unsupported shapes or openings. Native Autodesk NWD/NWC/NWF files are not supported.</p><p class="help-note">Hard clashes are triangle contact/intersection or closed-mesh containment, not penetration-depth measurements. Validate results on your own models before using them in a professional delivery. Section cuts are not capped. This build has no multi-user synchronization.</p>`, null, { width: '590px' });
}
const actions = {
    'project-menu': projectMenu, append: () => {
        $('#modal').close();
        $('#fileInput').accept = '.ifc,.gltf,.glb,.bin';
        $('#fileInput').click();
    }, open: () => {
        $('#modal').close();
        $('#fileInput').accept = '.converge,.json';
        $('#fileInput').click();
    },
    save: () => {
        $('#modal').close();
        return saveLocal(true);
    }, export: () => {
        $('#modal').close();
        store.doc.camera = camera.serialize();
        download(safeName() + '.converge', JSON.stringify(store.pack(true)), 'application/json');
        toast('Portable project exported, including geometry and coordination data.');
    },
    undo: () => {
        store.undo();
        if (store.doc.camera)
            camera.restore(store.doc.camera);
        renderer.invalidate();
    }, redo: () => {
        store.redo();
        if (store.doc.camera)
            camera.restore(store.doc.camera);
        renderer.invalidate();
    }, rename: () => showModal('Rename project', field('name', 'Project name', store.doc.name, 'text', 'required maxlength="160"'), fd => commit('Rename project', d => d.name = requiredText(fd, 'name', 'Project name'))),
    new: () => showModal('Create a new project', `<p class="help-note">This replaces the current workspace and its autosave. Export the current project first to keep a portable copy.</p>${field('name', 'Project name', 'New coordination project', 'text', 'required maxlength="160"')}`, fd => {
        const d = emptyDocument();
        d.name = requiredText(fd, 'name', 'Project name');
        renderer.resetResources();
        store.replace(d, new Map());
        resetClashSync();
        camera.restore(new Camera().serialize());
        ui.test = null;
        renderAll();
    }, { submit: 'Create project' }),
    demo: () => showModal('Open sample project', '<p class="help-note">Replace the current workspace with the built-in Harbor Point sample? Export your current project first to keep a portable copy.</p>', () => {
        loadDemo();
        setTimeout(() => runTest(), 200);
    }, { submit: 'Open sample' }),
    select: () => setTool('select'), orbit: () => setTool('orbit'), pan: () => setTool('pan'), fit: () => focus(), focus: () => focus(store.selection.size ? [...store.selection] : null),
    hide: () => {
        if (!store.selection.size)
            return toast('Select elements to hide.');
        commit('Hide selected elements', d => d.entities.forEach(e => {
            if (store.selection.has(e.id))
                e.visible = false;
        }));
    },
    isolate: () => {
        if (!store.selection.size)
            return toast('Select elements to isolate.');
        commit('Isolate selected elements', d => {
            d.models.forEach(m => m.visible = true);
            d.entities.forEach(e => e.visible = store.selection.has(e.id));
        });
    },
    'show-all': () => commit('Show all models and elements', d => {
        d.models.forEach(m => m.visible = true);
        d.entities.forEach(e => e.visible = true);
    }),
    xray: () => commit('Toggle X-ray display', d => d.display.xray = !d.display.xray), grid: () => commit('Toggle reference grid', d => d.display.grid = !d.display.grid),
    section: () => commit('Toggle section box', d => {
        d.section.enabled = !d.section.enabled;
        if (d.section.enabled && d.section.min[0] === -1000) {
            const b = sectionBounds();
            d.section.min = b.min.map(v => v - .1);
            d.section.max = b.max.map(v => v + .1);
            d.section.max[1] = b.min[1] + (b.max[1] - b.min[1]) * .63;
        }
    }),
    'section-fit': () => commit('Fit section to selected elements', d => {
        const b = store.bounds(store.selection.size ? [...store.selection] : null, false);
        if (validBox(b)) {
            d.section.min = b.min.map(v => v - .1);
            d.section.max = b.max.map(v => v + .1);
        }
    }),
    'section-reset': () => commit('Reset section planes', d => {
        const b = sectionBounds();
        d.section.min = b.min.map(v => v - .1);
        d.section.max = b.max.map(v => v + .1);
    }),
    measure: () => {
        ui.bottom = 'measurements';
        setTool(ui.tool === 'measure' ? 'select' : 'measure');
        renderBottom();
    },
    'clear-measurements': () => commit('Clear all measurements', d => d.measurements = []),
    clashes: () => {
        ui.bottom = 'clashes';
        ui.ribbon = 'Coordination';
        renderRibbon();
        renderBottom();
    }, 'new-test': () => testDialog(), 'edit-test': () => currentTest() ? testDialog(currentTest()) : testDialog(), run: () => runTest(), 'cancel-test': cancelTest,
    'new-issue': () => issueDialog(), issues: () => {
        ui.bottom = 'issues';
        renderBottom();
    },
    'save-view': () => showModal('Save viewpoint', field('name', 'Viewpoint name', `View ${store.doc.views.length + 1}`, 'text', 'required maxlength="120"'), fd => {
        const view = captureView(requiredText(fd, 'name', 'Viewpoint name'));
        commit('Save viewpoint: ' + view.name, d => d.views.push(view));
        ui.right = 'views';
        renderInspector();
    }),
    views: () => {
        ui.right = 'views';
        $('.inspector').classList.toggle('mobile-inspector', true);
        renderInspector();
    }, properties: () => {
        ui.right = 'properties';
        $('.inspector').classList.toggle('mobile-inspector', true);
        renderInspector();
    },
    sets: () => {
        ui.left = 'sets';
        $('.model-dock').classList.toggle('mobile-dock', true);
        renderTree();
    },
    'save-set': () => {
        if (!store.selection.size)
            return toast('Select one or more objects before saving a set.');
        showModal('Save selection set', field('name', 'Set name', `Selection ${store.doc.sets.length + 1}`, 'text', 'required maxlength="120"'), fd => {
            commit('Save selection set', d => d.sets.push({ id: uid('set'), name: requiredText(fd, 'name', 'Set name'), ids: [...store.selection] }));
            ui.left = 'sets';
            renderTree();
        });
    },
    'model-settings': () => transformDialog(false), align: () => transformDialog(false), 'element-transform': () => transformDialog(true),
    'remove-model': () => {
        const id = $('#modal [name=model]')?.value;
        if (!id)
            return;
        const m = store.doc.models.find(m => m.id === id);
        showModal('Remove federated model', `<p class="help-note">Remove ${esc(m.name)} and its elements? Existing issues and results retain their references; affected sets are pruned. Undo restores the model.</p>`, () => {
            const removed = new Set(store.doc.entities.filter(e => e.modelId === id).map(e => e.id));
            commit('Remove model: ' + m.name, d => {
                d.models = d.models.filter(m => m.id !== id);
                d.entities = d.entities.filter(e => e.modelId !== id);
                d.sets.forEach(s => s.ids = s.ids.filter(id => !removed.has(id)));
            }, true);
        }, { submit: 'Remove model' });
    },
    'edit-properties': () => {
        const ids = [...store.selection], e = store.byId.get(ids[0]);
        if (!e)
            return toast('Select an element first.');
        showModal('Coordination properties', `${ids.length === 1 ? field('name', 'Element display name', e.name, 'text', 'required maxlength="180"') : ''}${field('status', 'Coordination status', e.properties?.Coordination?.Status || '', 'text', 'maxlength="120"')}<div class="field"><label for="coordNotes">Review notes</label><textarea id="coordNotes" name="notes" maxlength="10000">${esc(e.properties?.Coordination?.Notes || '')}</textarea></div><p class="help-note">Writes project metadata for ${ids.length} element(s). Source IFC/glTF files are not changed.</p>`, fd => commit('Edit coordination properties', d => {
            for (const e of d.entities)
                if (store.selection.has(e.id)) {
                    if (ids.length === 1)
                        e.name = requiredText(fd, 'name', 'Name');
                    e.properties.Coordination = { Status: String(fd.get('status')), Notes: String(fd.get('notes')) };
                }
        }));
    },
    color: () => {
        if (!store.selection.size)
            return toast('Select objects for the color override.');
        showModal('Override object appearance', `${field('color', 'Display color', '#419b75', 'color')}<label class="help-note"><input type="checkbox" name="reset"> Remove existing overrides</label>`, fd => commit('Override selection color', d => {
            const hex = String(fd.get('color')).slice(1), color = [0, 2, 4].map(k => parseInt(hex.slice(k, k + 2), 16) / 255);
            color.push(1);
            for (const e of d.entities)
                if (store.selection.has(e.id)) {
                    if (fd.has('reset'))
                        delete e.overrideColor;
                    else
                        e.overrideColor = color;
                }
        }));
    },
    iso: () => {
        camera.yaw = .78;
        camera.pitch = .43;
        camera.ortho = false;
        focus();
    }, top: () => {
        camera.pitch = Math.PI * .494;
        camera.yaw = 0;
        camera.ortho = true;
        focus();
    }, front: () => {
        camera.pitch = 0;
        camera.yaw = 0;
        camera.ortho = true;
        focus();
    }, right: () => {
        camera.pitch = 0;
        camera.yaw = Math.PI / 2;
        camera.ortho = true;
        focus();
    }, projection: () => {
        camera.ortho = !camera.ortho;
        renderStatus();
        renderer.invalidate();
        requestSave();
    },
    fullscreen: () => {
        $('#app').classList.toggle('maximized');
        renderer.invalidate();
    },
    snapshot: () => {
        download(safeName() + '-view.png', dataURItoBlob(renderer.snapshot()));
        toast('Viewport image exported.');
    },
    report: () => {
        download(safeName() + '-coordination-report.html', reportHTML(store, renderer.snapshot()), 'text/html');
        toast('Coordination report exported. Open it to review or print to PDF.');
    },
    csv: () => {
        download(safeName() + '-clashes.csv', coordinationCSV(store), 'text/csv;charset=utf-8');
        toast('Clash results exported as CSV.');
    }, help: helpDialog,
    commands: () => {
        const list = Object.entries(toolDefs).map(([key, [ic, label]]) => ({ action: actionMap[key] || key, ic, label }));
        const modal = showModal('Find a command', `<div class="field"><input id="commandSearch" placeholder="Type a command…" autocomplete="off" aria-label="Search commands"></div><div id="commandList" class="menu-list"></div>`);
        const draw = q => $('#commandList').innerHTML = list.filter(x => x.label.toLowerCase().includes(q.toLowerCase())).map(x => `<button type="button" data-command="${x.action}">${icon(x.ic)}<strong>${x.label}</strong></button>`).join('');
        draw('');
        $('#commandSearch').oninput = e => draw(e.target.value);
        $('#commandSearch').focus();
    }
};
function dataURItoBlob(uri) {
    const [head, data] = uri.split(','), binary = atob(data), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new Blob([bytes], { type: head.match(/data:([^;]+)/)[1] });
}
async function doAction(action) {
    try {
        const fn = actions[action];
        if (!fn)
            throw Error('Unknown command: ' + action);
        await fn();
    }
    catch (error) {
        console.error(error);
        toast(error.message, true, 8000);
    }
}
// Single delegated event router: every visible command maps to live project operations.
document.addEventListener('click', async (event) => {
    const target = event.target.closest('button,[data-entity],[data-model-row],[data-group-select],[data-set],[data-test],[data-clash],[data-issue],[data-measurement]');
    if (!target)
        return;
    const d = target.dataset;
    if (d.action) {
        await doAction(d.action);
        return;
    }
    if (d.command) {
        $('#modal').close();
        await doAction(d.command);
        return;
    }
    if (d.tab) {
        ui.ribbon = d.tab;
        renderRibbon();
        return;
    }
    if (d.left) {
        ui.left = d.left;
        renderTree();
        return;
    }
    if (d.right) {
        ui.right = d.right;
        renderInspector();
        return;
    }
    if (d.bottom) {
        ui.bottom = d.bottom;
        renderBottom();
        return;
    }
    if (d.tool) {
        setTool(d.tool);
        return;
    }
    if (d.expand) {
        ui.expanded.has(d.expand) ? ui.expanded.delete(d.expand) : ui.expanded.add(d.expand);
        renderTree();
        return;
    }
    if (d.modelEye) {
        commit('Toggle model visibility', doc => {
            const m = doc.models.find(m => m.id === d.modelEye);
            m.visible = m.visible === false;
        });
        return;
    }
    if (d.entityEye) {
        commit('Toggle element visibility', doc => {
            const e = doc.entities.find(e => e.id === d.entityEye);
            e.visible = e.visible === false;
        });
        return;
    }
    if (d.entity) {
        store.select([d.entity], event.ctrlKey || event.metaKey);
        return;
    }
    if (d.modelRow) {
        store.select(store.doc.entities.filter(e => e.modelId === d.modelRow).map(e => e.id));
        return;
    }
    if (d.groupSelect) {
        const [model, ...p] = d.groupSelect.split('|'), path = p.join('|').split('/');
        store.select(store.doc.entities.filter(e => e.modelId === model && path.every((v, k) => e.path[k] === v)).map(e => e.id));
        return;
    }
    if (d.set) {
        store.select(store.doc.sets.find(s => s.id === d.set)?.ids || []);
        return;
    }
    if (d.deleteSet) {
        commit('Delete selection set', doc => doc.sets = doc.sets.filter(s => s.id !== d.deleteSet));
        return;
    }
    if (d.test) {
        ui.test = d.test;
        ui.result = null;
        renderBottom();
        return;
    }
    if (d.clash) {
        if (event.target.closest('select'))
            return;
        selectClash(d.clash);
        return;
    }
    if (d.issueClash) {
        const r = selectClash(d.issueClash, true);
        if (r)
            issueDialog(null, r);
        return;
    }
    if (d.deleteTest) {
        commit('Delete clash test', doc => {
            doc.tests = doc.tests.filter(t => t.id !== d.deleteTest);
            delete doc.results[d.deleteTest];
        });
        $('#modal').close();
        ui.test = store.doc.tests[0]?.id;
        renderBottom();
        return;
    }
    if (d.view) {
        restoreView(store.doc.views.find(v => v.id === d.view));
        return;
    }
    if (d.deleteView) {
        commit('Delete viewpoint', doc => doc.views = doc.views.filter(v => v.id !== d.deleteView));
        return;
    }
    if (d.issue) {
        issueDialog(store.doc.issues.find(i => i.id === d.issue));
        return;
    }
    if (d.restoreIssue) {
        const i = store.doc.issues.find(i => i.id === d.restoreIssue);
        $('#modal').close();
        restoreView(i.view);
        return;
    }
    if (d.deleteIssue) {
        commit('Delete coordination issue', doc => doc.issues = doc.issues.filter(i => i.id !== d.deleteIssue));
        $('#modal').close();
        return;
    }
    if (d.deleteMeasurement) {
        commit('Delete measurement', doc => doc.measurements = doc.measurements.filter(m => m.id !== d.deleteMeasurement));
        return;
    }
    if (d.measurement) {
        const m = store.doc.measurements.find(m => m.id === d.measurement);
        camera.target = m.a.map((v, k) => (v + m.b[k]) / 2);
        camera.distance = Math.max(2, length(vsub(m.b, m.a)) * 3);
        renderer.invalidate();
        return;
    }
});
document.addEventListener('dblclick', event => {
    const row = event.target.closest('[data-clash],[data-entity]');
    if (row?.dataset.clash)
        selectClash(row.dataset.clash, true);
    if (row?.dataset.entity)
        focus([row.dataset.entity]);
});
document.addEventListener('change', event => {
    const el = event.target;
    try {
        if (el.id === 'resultFilter') {
            ui.filter = el.value;
            renderBottom();
        }
        if (el.dataset.clashStatus) {
            const id = el.dataset.clashStatus, value = el.value;
            commit('Review clash: ' + value, d => {
                const result = d.results[ui.test]?.results.find(r => r.id === id);
                if (result)
                    result.status = value;
            });
        }
        if (el.dataset.clipAxis !== undefined) {
            const axis = Number(el.dataset.clipAxis), bound = el.dataset.clipBound, value = Number(el.value);
            if (!Number.isFinite(value))
                throw Error('Section coordinates must be finite');
            if ((bound === 'min' && value > store.doc.section.max[axis]) || (bound === 'max' && value < store.doc.section.min[axis]))
                throw Error('Section minimum must not exceed maximum');
            commit('Move section plane', d => d.section[bound][axis] = value);
        }
        if (el.id === 'shadingMode') {
            renderer.mode = el.value;
            renderer.invalidate();
        }
    }
    catch (error) {
        toast(error.message, true);
        renderSection();
    }
});
$('#treeSearch').addEventListener('input', e => {
    ui.query = e.target.value;
    renderTree();
});
$('#fileInput').addEventListener('change', async (e) => {
    try {
        await importFiles(e.target.files);
    }
    catch (error) {
        toast(error.message, true, 10000);
    }
    finally {
        e.target.value = '';
    }
});
let dragDepth = 0;
document.addEventListener('dragenter', e => {
    if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        dragDepth++;
        $('#dropOverlay').classList.remove('hidden');
    }
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('dragleave', e => {
    e.preventDefault();
    if (--dragDepth <= 0) {
        dragDepth = 0;
        $('#dropOverlay').classList.add('hidden');
    }
});
document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropOverlay').classList.add('hidden');
    try {
        await importFiles(e.dataTransfer.files);
    }
    catch (error) {
        toast(error.message, true);
    }
});
function attachViewport() {
    const canvas = renderer.canvas, pointers = new Map();
    let gesture = null, pickSerial = 0, pinch = null;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
        canvas.focus();
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, [e.clientX, e.clientY]);
        if (pointers.size === 2) {
            const p = [...pointers.values()];
            pinch = { distance: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), center: [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2] };
            if (gesture)
                gesture.moved = true;
            return;
        }
        gesture = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, button: e.button, moved: false, shift: e.shiftKey };
    });
    canvas.addEventListener('pointermove', e => {
        if (!pointers.has(e.pointerId))
            return;
        pointers.set(e.pointerId, [e.clientX, e.clientY]);
        if (pointers.size === 2 && pinch) {
            const p = [...pointers.values()], distance = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), center = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
            camera.zoom(Math.log((pinch.distance || 1) / (distance || 1)) * 1000);
            camera.pan(center[0] - pinch.center[0], center[1] - pinch.center[1], canvas.clientHeight);
            pinch = { distance, center };
            renderer.invalidate();
            return;
        }
        if (!gesture)
            return;
        const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
        gesture.x = e.clientX;
        gesture.y = e.clientY;
        if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) > 4)
            gesture.moved = true;
        if (!gesture.moved)
            return;
        if (gesture.button === 2 || gesture.button === 1 || gesture.shift || ui.tool === 'pan')
            camera.pan(dx, dy, canvas.clientHeight);
        else
            camera.orbit(dx, dy);
        renderer.invalidate();
    });
    canvas.addEventListener('pointerup', async (e) => {
        pointers.delete(e.pointerId);
        const g = gesture;
        if (pinch) {
            pinch = null;
            gesture = null;
            requestSave();
            return;
        }
        gesture = null;
        if (!g)
            return;
        if (g.moved) {
            requestSave();
            return;
        }
        if (g.button !== 0)
            return;
        const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, serial = ++pickSerial, epoch = store.sceneRevision, cameraKey = JSON.stringify(camera.serialize());
        try {
            const pick = await renderer.pick(x, y);
            if (serial !== pickSerial || epoch !== store.sceneRevision || cameraKey !== JSON.stringify(camera.serialize()))
                return;
            const id = store.byPick.get(pick);
            if (ui.tool === 'measure') {
                if (!id) {
                    toast('Pick a visible model surface.');
                    return;
                }
                const ray = camera.ray(x, y, r.width, r.height), hit = store.raycast(ray.origin, ray.direction, id);
                if (!hit) {
                    toast('No measurable triangle at this point.');
                    return;
                }
                if (!ui.measureStart) {
                    ui.measureStart = hit;
                    $('#measureHint').textContent = 'Pick the second point · Esc to cancel';
                    renderer.invalidate();
                }
                else {
                    const first = ui.measureStart;
                    ui.measureStart = null;
                    commit('Add point-to-point measurement', d => d.measurements.push({ id: uid('measurement'), name: `Distance ${d.measurements.length + 1}`, a: first.point, b: hit.point, entityA: first.id, entityB: hit.id, created: new Date().toISOString() }));
                    $('#measureHint').textContent = 'Pick the first point on a model surface · Esc to cancel';
                }
                return;
            }
            store.select(id ? [id] : [], e.ctrlKey || e.metaKey);
        }
        catch (error) {
            toast('Picking failed: ' + error.message, true);
        }
    });
    canvas.addEventListener('pointercancel', e => {
        pointers.delete(e.pointerId);
        gesture = null;
        pinch = null;
    });
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        camera.zoom(clamp(e.deltaY, -220, 220));
        renderer.invalidate();
        requestSave();
    }, { passive: false });
    canvas.addEventListener('dblclick', async (e) => {
        if (ui.tool === 'measure')
            return;
        const r = canvas.getBoundingClientRect(), pick = await renderer.pick(e.clientX - r.left, e.clientY - r.top), id = store.byPick.get(pick);
        if (id) {
            store.select([id]);
            focus([id]);
        }
    });
    new ResizeObserver(() => renderer.invalidate()).observe($('#scene'));
}
function attachResize(id, variable, calc, min, max) {
    const el = $(id);
    el.addEventListener('pointerdown', e => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const move = ev => {
            document.documentElement.style.setProperty(variable, clamp(calc(ev), min, max) + 'px');
            renderer.invalidate();
        }, up = () => {
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
    });
}
attachResize('#leftResize', '--left', e => e.clientX, 170, 480);
attachResize('#rightResize', '--right', e => innerWidth - e.clientX, 220, 500);
attachResize('#bottomResize', '--bottom', e => innerHeight - e.clientY - 28, 130, 600);
document.addEventListener('keydown', e => {
    const typing = e.target.closest('input,textarea,select,[contenteditable=true]');
    if ($('#modal').open)
        return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        doAction('commands');
        return;
    }
    if (typing)
        return;
    const key = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && key === 'z') {
        e.preventDefault();
        doAction(e.shiftKey ? 'redo' : 'undo');
        return;
    }
    if (mod && key === 'y') {
        e.preventDefault();
        doAction('redo');
        return;
    }
    if (mod && key === 's') {
        e.preventDefault();
        doAction('save');
        return;
    }
    if (e.key === 'Escape') {
        setTool('select');
        store.select([]);
        $('.model-dock').classList.remove('mobile-dock');
        $('.inspector').classList.remove('mobile-inspector');
        return;
    }
    if (mod)
        return;
    const mapping = { v: 'select', o: 'orbit', p: 'pan', f: 'fit', m: 'measure', h: e.shiftKey ? 'show-all' : 'hide', i: 'isolate', b: 'section', '?': 'help' };
    if (mapping[key]) {
        e.preventDefault();
        doAction(mapping[key]);
    }
    if (e.key === '/') {
        e.preventDefault();
        $('#treeSearch').focus();
    }
});
store.addEventListener('change', () => {
    renderAll();
    requestSave();
});
store.addEventListener('selection', () => {
    renderTree();
    renderInspector();
    renderStatus();
    renderer?.invalidate();
});
function loadDemo() {
    const data = createDemo();
    renderer?.resetResources();
    store.replace(data.doc, data.geometries);
    resetClashSync();
    camera.yaw = .77;
    camera.pitch = .43;
    camera.ortho = false;
    camera.aspect = $('#scene').clientWidth / $('#scene').clientHeight;
    camera.fit(store.bounds(null, false));
    camera.distance *= .83;
    ui.test = store.doc.tests[0].id;
    ui.bottom = 'clashes';
    ui.right = 'properties';
    ui.left = 'models';
    ui.query = '';
    $('#treeSearch').value = '';
    store.doc.camera = camera.serialize();
    const view = { id: 'demo-overview', name: '01 · Federated overview', created: new Date().toISOString(), camera: camera.serialize(), section: clone(store.doc.section), display: clone(store.doc.display), selection: [], clashPair: null, hiddenEntities: [], hiddenModels: [], snapshot: '' };
    store.doc.views.push(view);
    const section = clone(view);
    section.id = 'demo-level01';
    section.name = '02 · Level 01 coordination';
    section.section = { enabled: true, min: [-15, -.5, -8], max: [16, 5, 8] };
    section.camera = { ...camera.serialize(), target: [0, 2, 0], distance: 34 };
    store.doc.views.push(section);
    renderAll();
}
async function start() {
    hydrate();
    try {
        renderer = new Renderer($('#canvas'), store, camera, (status, error = false) => {
            if (error) {
                toast(status, true, 12000);
                $('#engineStatus').textContent = 'Renderer error';
            }
            else
                $('#engineStatus').innerHTML = `<i class="status-dot"></i>${esc(status)}`;
        });
        await renderer.init(new URLSearchParams(location.search).get('renderer') === 'webgl');
        renderer.onRender = renderAnnotations;
        attachViewport();
        let saved;
        try {
            saved = await persistence.load();
        }
        catch (error) {
            ui.saveError = true;
            $('#saveState').textContent = 'Storage unavailable · export to save';
            toast('This context does not allow browser storage. Export a project file to save your work.', true, 8000);
        }
        if (saved) {
            try {
                const data = unpack(saved);
                store.replace(data.doc, data.geometries);
                camera.restore(store.doc.camera || new Camera().serialize());
                ui.test = store.doc.tests[0]?.id;
                resetClashSync();
                renderAll();
            }
            catch (error) {
                toast('Autosave could not be restored. Opening sample: ' + error.message, true);
                loadDemo();
            }
        }
        else
            loadDemo();
        $('#loadingOverlay').classList.add('hidden');
        renderer.invalidate();
        await saveLocal();
        window.converge = { store, camera, renderer, ui, actions, runTest, importFiles, focus, captureView, restoreView, saveLocal, selectClash };
        window.dispatchEvent(new Event('converge-ready'));
        if (!saved && store.doc.tests.length)
            setTimeout(() => runTest(), 300);
    }
    catch (error) {
        console.error(error);
        $('#loadingOverlay h3').textContent = 'Unable to open the 3D workspace';
        $('#loadingOverlay p').textContent = error.message;
        toast(error.message, true, 15000);
        window.convergeError = error.message;
    }
}
window.addEventListener('beforeunload', e => {
    if (ui.importBusy || ui.saveError) {
        e.preventDefault();
        e.returnValue = '';
    }
});
start();
