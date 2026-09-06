import { Store, Persistence, emptyDocument, unpack, uid, clone } from './core.js';
import { Camera, validBox } from './math.js';
import { Renderer } from './renderer.js';
import { createDemo } from './demo.js';
import { importIFC } from './ifc.js';
import { importGLTF } from './gltf.js';

const $ = s => document.querySelector(s);
const store = new Store();
const persistence = new Persistence();
const camera = new Camera();
let renderer;

function toast(message) {
  const host = $('#toastStack');
  if (!host) return;
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = message;
  host.append(div);
  setTimeout(() => div.remove(), 4000);
}

function renderTree() {
  const tree = $('#tree');
  if (!tree) return;
  const q = ($('#treeSearch')?.value || '').toLowerCase();
  tree.innerHTML = store.doc.models.map(model => {
    const entities = store.doc.entities.filter(e => e.modelId === model.id && (!q || (e.name + ' ' + JSON.stringify(e.properties || {})).toLowerCase().includes(q)));
    return `<section class="tree-model"><div class="tree-row"><strong>${model.name}</strong><span>${entities.length}</span></div>${entities.map(e => `<button class="tree-row entity ${store.selection.has(e.id) ? 'selected' : ''}" data-entity="${e.id}">${e.name}</button>`).join('')}</section>`;
  }).join('');
  tree.querySelectorAll('[data-entity]').forEach(b => b.onclick = ev => store.select([b.dataset.entity], ev.ctrlKey || ev.metaKey));
  $('#modelCount').textContent = store.doc.models.length;
  $('#federationSummary').textContent = `${store.doc.models.length} models · ${store.doc.entities.length} elements`;
}

function renderInspector() {
  const host = $('#inspectorBody');
  if (!host) return;
  const ids = [...store.selection];
  const e = ids.length === 1 ? store.byId.get(ids[0]) : null;
  host.innerHTML = e ? `<div class="property-card"><h3>${e.name}</h3><dl><dt>Type</dt><dd>${e.type || ''}</dd>${Object.entries(e.properties || {}).map(([k,v]) => `<dt>${k}</dt><dd>${String(v)}</dd>`).join('')}</dl></div>` : `<div class="empty">${ids.length ? ids.length + ' elements selected' : 'Select an element to inspect its properties.'}</div>`;
}

function renderStatus() {
  $('#projectName').textContent = store.doc.name;
  $('#viewportTitle').textContent = `${store.doc.models.length} federated models`;
  $('#sceneBadge').textContent = `${store.doc.entities.length} ELEMENTS`;
}

function renderAll() { renderTree(); renderInspector(); renderStatus(); renderer?.invalidate(); }

async function saveLocal() {
  store.doc.camera = camera.serialize();
  await persistence.save(store.pack());
  $('#saveState').textContent = '✓ Saved on this device';
}

async function importFiles(files) {
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    const data = ext === 'ifc' ? await importIFC(file) : (ext === 'gltf' || ext === 'glb') ? await importGLTF(file) : null;
    if (!data) throw new Error(`Unsupported format: ${ext}`);
    await store.addImport(data);
    toast(`Imported ${file.name}`);
  }
}

function focus(ids = [...store.selection]) {
  const bounds = store.bounds(ids.length ? ids : null, false);
  if (validBox(bounds)) { camera.fit(bounds); renderer.invalidate(); }
}

function loadDemo() {
  const data = createDemo();
  store.replace(data.doc, data.geometries);
  camera.aspect = $('#scene').clientWidth / $('#scene').clientHeight;
  camera.fit(store.bounds(null, false));
  store.doc.camera = camera.serialize();
}

async function action(name) {
  if (name === 'append') return $('#fileInput')?.click();
  if (name === 'save') return saveLocal();
  if (name === 'fit') return focus(store.doc.entities.map(e => e.id));
  if (name === 'focus') return focus();
  if (name === 'undo') return store.undo();
  if (name === 'redo') return store.redo();
  if (name === 'section') { store.command('Toggle section', d => d.section.enabled = !d.section.enabled); return; }
  if (name === 'show-all') { store.command('Show all', d => { d.hiddenEntities = []; d.hiddenModels = []; }); return; }
}

document.addEventListener('click', e => { const b = e.target.closest('[data-action]'); if (b) action(b.dataset.action); });
$('#treeSearch')?.addEventListener('input', renderTree);
$('#fileInput')?.addEventListener('change', async e => { try { await importFiles([...e.target.files]); } catch (err) { toast(err.message); } finally { e.target.value = ''; } });
store.addEventListener('change', () => { renderAll(); saveLocal().catch(() => {}); });
store.addEventListener('selection', renderAll);

async function start() {
  renderer = new Renderer($('#canvas'), store, camera, status => { if ($('#engineStatus')) $('#engineStatus').textContent = status; });
  await renderer.init(false);
  let restored = false;
  try {
    const saved = await persistence.load();
    if (saved) {
      const data = unpack(saved);
      store.replace(data.doc, data.geometries);
      camera.restore(store.doc.camera || new Camera().serialize());
      restored = true;
    }
  } catch {}
  if (!restored) loadDemo();
  renderAll();
  $('#loadingOverlay')?.classList.add('hidden');
  renderer.invalidate();
  window.converge = { store, camera, renderer, importFiles, focus, saveLocal };
  window.dispatchEvent(new Event('converge-ready'));
}
start();
