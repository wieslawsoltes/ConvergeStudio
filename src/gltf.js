import { uid } from './core.js';
import { identity, trs } from './math.js';

export async function importGLTF(file) {
  let json;
  if (file.name.toLowerCase().endsWith('.gltf')) json = JSON.parse(await file.text());
  else throw new Error('GLB import requires the full source bundle build; use .gltf on this Pages runtime.');
  const modelId = uid('gltf-model');
  const geometries = [], entities = [];
  const meshGeometries = new Map();
  for (let i = 0; i < (json.meshes || []).length; i++) {
    const gid = uid('g');
    const g = box(gid, 2, 1, 1);
    geometries.push([gid, g]);
    meshGeometries.set(i, gid);
  }
  (json.nodes || []).forEach((node, i) => {
    if (node.mesh == null) return;
    entities.push({ id: uid('gltf'), modelId, name: node.name || `Node ${i}`, type: 'glTF Node', matrix: trs(node.translation || [0,0,0], node.rotation || [0,0,0,1], node.scale || [1,1,1]), parts: [{ geometryId: meshGeometries.get(node.mesh), color: [.58,.68,.72,1] }], properties: { ...(node.extras || {}), NodeIndex: i } });
  });
  if (!entities.length) throw new Error('No mesh nodes found in glTF.');
  return { model: { id: modelId, name: file.name, discipline: 'glTF', matrix: identity() }, entities, geometries };
}
function box(id,sx,sy,sz){const x=sx/2,y=sy/2,z=sz/2;return{id,positions:[-x,-y,-z,x,-y,-z,x,y,-z,-x,y,-z,-x,-y,z,x,-y,z,x,y,z,-x,y,z],normals:new Array(24).fill(0),indices:[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0],bounds:{min:[-x,-y,-z],max:[x,y,z]}};}
