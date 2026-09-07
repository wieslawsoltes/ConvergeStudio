import { identity, trs } from './math.js';
import { boxGeometry, cylinderGeometry } from './geometry.js';
import { emptyDocument } from './core.js';
export function createDemo() {
    const doc = emptyDocument();
    doc.name = 'Harbor Point · Building A';
    const geometries = new Map([['demo-box', boxGeometry()], ['demo-cylinder', cylinderGeometry(24)]]);
    const disciplines = [['str', 'Structure', [.67, .70, .73, 1], 'HP_A_STR_R06.ifc'], ['mec', 'Mechanical', [.91, .50, .25, 1], 'HP_A_MEP_HVAC_R04.ifc'], ['plb', 'Plumbing', [.24, .56, .78, 1], 'HP_A_MEP_PLB_R03.ifc'], ['ele', 'Electrical', [.84, .69, .24, 1], 'HP_A_MEP_ELE_R02.ifc'], ['arc', 'Architecture', [.77, .85, .87, .28], 'HP_A_ARC_R08.ifc']];
    for (const [id, discipline, color, name] of disciplines)
        doc.models.push({ id, name, discipline, color, visible: true, matrix: identity(), source: 'Built-in coordination sample', units: 'm', imported: new Date().toISOString(), warnings: [], revision: name.match(/R\d+/)?.[0] });
    let seq = 0;
    function add(model, name, type, position, scale, level, opts = {}) {
        const id = `demo-${++seq}`, m = doc.models.find(m => m.id === model);
        doc.entities.push({ id, modelId: model, name, type, path: [level, type], matrix: trs(position, opts.rotation, scale), parts: [{ geometryId: opts.cylinder ? 'demo-cylinder' : 'demo-box', matrix: identity(), color: opts.color || m.color }], visible: true, properties: { Identity: { Name: name, Type: type, GlobalId: `DEMO_${model.toUpperCase()}_${String(seq).padStart(6, '0')}`, Tag: `${model.toUpperCase()}-${String(seq).padStart(3, '0')}` }, 'Design information': { Discipline: m.discipline, Level: level, Phase: 'Design coordination', Status: 'Issued for coordination' }, 'Geometry / specification': { Material: opts.material || ({ str: 'Reinforced concrete · C35/45', mec: 'Galvanized steel', plb: 'Carbon steel · painted', ele: 'Perforated steel tray', arc: 'Curtain glazing' }[model]), Width: scale[0].toFixed(3) + ' m', Height: scale[1].toFixed(3) + ' m', Length: scale[2].toFixed(3) + ' m' }, ...opts.properties } });
        return id;
    }
    const xs = [-10.5, -3.5, 3.5, 10.5], zs = [-6, 0, 6];
    for (let level = 0; level < 3; level++) {
        const name = `Level ${String(level).padStart(2, '0')}`, y = level * 3.8;
        for (const x of xs)
            for (const z of zs)
                add('str', `Column ${String.fromCharCode(65 + xs.indexOf(x))}${zs.indexOf(z) + 1} · ${name}`, 'Columns', [x, y + 1.9, z], [.5, 3.8, .5], name);
        for (const z of zs)
            add('str', `Primary beam ${zs.indexOf(z) + 1} · ${name}`, 'Beams', [0, y + 3.48, z], [21.7, .64, .42], name);
        for (const x of xs)
            add('str', `Secondary beam ${xs.indexOf(x) + 1} · ${name}`, 'Beams', [x, y + 3.48, 0], [.4, .64, 12.45], name);
        if (level === 0)
            add('str', 'Ground floor raft', 'Slabs', [0, -.14, 0], [22.1, .28, 12.7], name, { color: [.82, .83, .83, 1] });
        if (level < 2) {
            add('str', `Floor plate west · ${name}`, 'Slabs', [-7.2, y + 3.83, 0], [7.0, .16, 12.7], name, { color: [.84, .85, .85, 1] });
            add('str', `Floor plate east · ${name}`, 'Slabs', [7.2, y + 3.83, 0], [7.0, .16, 12.7], name, { color: [.84, .85, .85, 1] });
            add('str', `Core bridge · ${name}`, 'Slabs', [0, y + 3.83, -4.5], [7.4, .16, 3.7], name, { color: [.84, .85, .85, 1] });
        }
        if (level < 2) {
            const serviceY = y + 3.40;
            add('mec', `Supply air trunk · ${name}`, 'Supply ducts', [0, serviceY, 2.2], [25, .66, 1.04], name);
            add('mec', `Return air trunk · ${name}`, 'Return ducts', [0, serviceY - .83, -2.4], [24, .5, .75], name, { color: [.80, .43, .22, 1] });
            for (let k = 0; k < 6; k++) {
                const x = -9 + k * 3.6;
                add('mec', `Supply branch ${k + 1} · ${name}`, 'Branch ducts', [x, serviceY, 4.2], [.54, .42, 4.5], name);
                add('mec', `Supply diffuser ${k + 1} · ${name}`, 'Air terminals', [x, serviceY - .32, 5.8], [.8, .16, .8], name, { color: [.82, .83, .81, 1] });
            }
            for (let k = 0; k < 2; k++)
                add('plb', `Chilled water ${k ? 'return' : 'supply'} · ${name}`, 'Pipes', [0, serviceY - .4, -.9 - k * .55], [.2, 24, .2], name, { cylinder: true, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] });
            for (const x of [-8, 0, 8])
                add('plb', `Water branch ${x} · ${name}`, 'Pipes', [x, serviceY - .4, 1.2], [.14, 7.6, .14], name, { cylinder: true, rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] });
            add('ele', `Power distribution tray · ${name}`, 'Cable trays', [0, serviceY - .26, -4.65], [24, .15, .38], name);
            for (const x of [-8, -1, 6])
                add('ele', `Lighting branch tray ${x} · ${name}`, 'Cable trays', [x, serviceY - .3, 0], [.24, .1, 10], name);
        }
    }
    add('mec', 'Supply riser · AHU 01', 'Risers', [11.8, 4.9, 2.2], [.96, 9.3, 1.04], 'Roof / plant');
    add('mec', 'AHU 01 · fresh air handling unit', 'Plant equipment', [13.5, .75, 2.2], [2.8, 1.5, 2.6], 'Ground / external', { color: [.41, .52, .55, 1], properties: { Equipment: { Manufacturer: 'Sample equipment', Capacity: '18,000 m³/h', Reference: 'AHU-01' } } });
    for (let i = 0; i < 5; i++)
        add('mec', `AHU coil fin ${i + 1}`, 'Plant equipment', [13.5, .78, 1.1 + i * .5], [2.84, .8, .04], 'Ground / external', { color: [.27, .37, .41, 1] });
    for (const z of [-1.05, -1.6])
        add('plb', 'Chilled water vertical riser', 'Risers', [-11.3, 4, z], [.22, 8, .22], 'Vertical services', { cylinder: true });
    for (let l = 0; l < 2; l++)
        for (let i = 0; i < 6; i++) {
            add('arc', `Curtain panel south ${l + 1}.${i + 1}`, 'Curtain wall', [-8.75 + i * 3.5, 1.9 + l * 3.8, -6.3], [3.35, 3.45, .07], `Level 0${l}`);
            add('arc', `Facade mullion ${l + 1}.${i + 1}`, 'Mullions', [-10.5 + i * 3.5, 1.9 + l * 3.8, -6.35], [.055, 3.75, .09], `Level 0${l}`, { color: [.37, .43, .47, 1] });
        }
    doc.sets = [{ id: 'set-str', name: 'All structural elements', ids: doc.entities.filter(e => e.modelId === 'str').map(e => e.id) }, { id: 'set-mep', name: 'MEP · coordination scope', ids: doc.entities.filter(e => ['mec', 'plb', 'ele'].includes(e.modelId)).map(e => e.id) }, { id: 'set-l1', name: 'Level 01 · services', ids: doc.entities.filter(e => e.path[0] === 'Level 01' && e.modelId !== 'str').map(e => e.id) }];
    doc.tests = [{ id: 'test-structure', name: 'Structure vs. Mechanical', scopeA: 'model:str', scopeB: 'model:mec', mode: 'hard', clearance: .05 }, { id: 'test-clearance', name: 'MEP service clearance', scopeA: 'model:mec', scopeB: 'model:plb', mode: 'clearance', clearance: .15 }, { id: 'test-electrical', name: 'Structure vs. Electrical', scopeA: 'model:str', scopeB: 'model:ele', mode: 'hard', clearance: .05 }];
    doc.activity = [{ time: new Date().toISOString(), label: 'Opened built-in Harbor Point coordination sample' }];
    return { doc, geometries };
}
