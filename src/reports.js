export const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function download(name, data, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
}
export function csvCell(value) {
    let s = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(s))
        s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
}
export function coordinationCSV(store) {
    const rows = [['Test', 'Mode', 'Clearance (m)', 'Element A', 'Element B', 'Classification', 'Surface distance (m)', 'Status', 'Run date', 'Model A', 'Model B']];
    for (const test of store.doc.tests) {
        const run = store.doc.results[test.id];
        if (!run)
            continue;
        for (const r of run.results) {
            const a = store.byId.get(r.a), b = store.byId.get(r.b);
            rows.push([test.name, run.test?.mode ?? test.mode, run.test?.clearance ?? test.clearance, a?.name || r.a, b?.name || r.b, r.kind, r.distance, r.status, run.date, store.doc.models.find(m => m.id === a?.modelId)?.name, store.doc.models.find(m => m.id === b?.modelId)?.name]);
        }
    }
    return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function reportHTML(store, snapshot = '') {
    const d = store.doc, e = escapeHTML, all = d.tests.flatMap(t => d.results[t.id]?.results || []), open = all.filter(r => !['Approved', 'Resolved'].includes(r.status)).length;
    const rows = (headers, data) => `<table><thead><tr>${headers.map(h => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${data.map(r => `<tr>${r.map(x => `<td>${e(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(d.name)} · Coordination report</title><style>body{margin:0;color:#293e32;background:#f4f7f4;font:13px system-ui,sans-serif;line-height:1.6}main{max-width:1120px;margin:35px auto;background:white;padding:45px 55px;border:1px solid #dbe6dc}header{border-bottom:3px solid #287557;padding-bottom:20px;margin-bottom:20px}h1{font-size:30px;line-height:1.2;letter-spacing:-1px}h2{margin-top:35px;font-size:20px;color:#2c6744}p,small{color:#77877a}table{width:100%;border-collapse:collapse;font-size:11px;margin:16px 0;overflow-wrap:anywhere}th,td{border:1px solid #dfe7e1;text-align:left;vertical-align:top;padding:8px}th{background:#edf5ef;font-weight:600}.kpis{display:flex;gap:35px;margin:25px 0}.kpis strong{display:block;font-size:29px;color:#286547}.kpis span{color:#819184;font-size:11px}img{width:100%;border:1px solid #dce7df}.note{background:#f9f6ed;border:1px solid #e9dfc7;padding:14px;color:#8b7a57}.brand{font-weight:650;letter-spacing:3px;color:#3e8560;font-size:11px}button{padding:10px 18px;background:#287557;color:white;border:0;border-radius:4px;cursor:pointer;float:right}@media print{body{background:white}main{margin:0;border:0;padding:0;max-width:none}button{display:none}tr,img{break-inside:avoid}h2{break-after:avoid}thead{display:table-header-group}}@page{size:A4 landscape;margin:15mm}</style></head><body><main><button onclick="window.print()">Print / Save as PDF</button><header><div class="brand">CONVERGE STUDIO / COORDINATION REPORT</div><h1>${e(d.name)}</h1><p>Issued ${e(new Date().toLocaleString())} · Local project snapshot · All dimensions in metres</p></header><div class="kpis"><div><strong>${d.models.length}</strong><span>Federated models</span></div><div><strong>${d.entities.length}</strong><span>Elements</span></div><div><strong>${all.length}</strong><span>Recorded conflicts</span></div><div><strong>${open}</strong><span>Unapproved / unresolved</span></div><div><strong>${d.issues.filter(i => i.status !== 'Closed').length}</strong><span>Open coordination issues</span></div></div>${snapshot ? `<img src="${e(snapshot)}" alt="Current coordination viewpoint">` : ''}<h2>Federation register</h2>${rows(['Model', 'Discipline', 'Source', 'Elements', 'Translation X/Y/Z (m)'], d.models.map(m => [m.name, m.discipline, m.source, d.entities.filter(x => x.modelId === m.id).length, m.matrix.slice(12, 15).map(x => Number(x).toFixed(4)).join(' / ')]))}${d.tests.map(t => {
        const run = d.results[t.id];
        return `<h2>${e(t.name)}</h2><p>${e((run?.test?.mode ?? t.mode) === 'hard' ? 'Triangle contact / intersection test' : 'Clearance test · ' + (run?.test?.clearance ?? t.clearance) + ' m')} · ${run ? `Run ${e(new Date(run.date).toLocaleString())} · ${run.stats.candidates} candidate pairs · ${run.stats.reused} reused results · ${run.stats.milliseconds.toFixed(1)} ms` : 'Not yet run'}</p>${run?.stale ? '<p class="note">STALE RUN: model geometry or test configuration changed after this test. Rerun before relying on these results.</p>' : ''}${run ? rows(['#', 'Element A', 'Element B', 'Classification', 'Distance (m)', 'Review status'], run.results.map((r, i) => [i + 1, store.byId.get(r.a)?.name || r.a, store.byId.get(r.b)?.name || r.b, r.kind, r.distance.toFixed(6), r.status])) : ''}`;
    }).join('')}<h2>Issue register</h2>${rows(['ID', 'Title', 'Status', 'Priority', 'Assignee', 'Due date', 'Description'], d.issues.map((i, n) => [i.reference || `ISS-${String(n + 1).padStart(3, '0')}`, i.title, i.status, i.priority, i.assignee, i.due || '—', i.description]))}<h2>Measurements</h2>${rows(['Name', 'Distance (m)', 'ΔX (m)', 'ΔY (m)', 'ΔZ (m)'], d.measurements.map(m => {
        const delta = m.b.map((v, i) => v - m.a[i]);
        return [m.name, Math.hypot(...delta).toFixed(6), ...delta.map(x => x.toFixed(6))];
    }))}<h2>Saved viewpoints</h2>${rows(['Viewpoint', 'Created', 'Selection count', 'Section box'], d.views.map(v => [v.name, new Date(v.created).toLocaleString(), v.selection?.length || 0, v.section.enabled ? 'Enabled' : 'Disabled']))}<h2>Method and interpretation</h2><div class="note">CPU double-precision triangle narrow phase after world-space BVH broad-phase filtering. Hard tests report surface contact/intersection within a 0.000001 m numerical epsilon, plus point-in-closed-mesh containment. Clearance reports the closest surface distance for non-overlapping meshes within the configured threshold. Hard results do not measure penetration depth or intersection volume. Open, non-manifold or degenerate geometry, floating-point tolerances and unsupported import features can affect results. Sectioning, hiding and X-ray display do not change clash test scope. This is a coordination aid, not a certified geometry or safety validation.</div>${d.models.some(m => m.warnings?.length) ? `<h2>Import warnings</h2>${d.models.filter(m => m.warnings?.length).map(m => `<h3>${e(m.name)}</h3><p>${m.warnings.map(e).join('<br>')}</p>`).join('')}` : ''}<p style="margin-top:35px;border-top:1px solid #dfe8e0;padding-top:12px">Generated locally by Converge Studio. No project data was uploaded. This report represents the saved test results at export time.</p></main></body></html>`;
}
