import { uid } from './core.js';
import { identity } from './math.js';

export async function importIFC(file) {
  const text = await file.text();
  const entities = [];
  const geometries = [];
  const modelId = uid('ifc-model');
  const productRe = /#(\d+)\s*=\s*IFC(BEAM|COLUMN|WALL|SLAB|PIPESEGMENT|DUCTSEGMENT|BUILDINGELEMENTPROXY)\s*\(([^;]+)\);/gi;
  let match, n = 0;
  while ((match = productRe.exec(text))) {
    const type = `Ifc${match[2][0]}${match[2].slice(1).toLowerCase()}`;
    const quoted = [...match[3].matchAll(/'([^']*)'/g)].map(x => x[1]);
    const name = quoted[2] || quoted[1] || `${type} ${match[1]}`;
    const gid = uid('g');
    const sx = type.includes('Pipe') ? .3 : 2.5, sy = type.includes('Pipe') ? 3 : .45, sz = .5;
    geometries.push([gid, box(gid, sx, sy, sz)]);
    entities.push({ id: uid('ifc'), modelId, name, type, matrix: translated((n % 8) * 3 - 10, Math.floor(n / 8) * 2.6 + 1, 0), parts: [{ geometryId: gid, color: [.62,.68,.72,1] }], properties: { ExpressID: match[1], Source: file.name } });
    n++;
  }
  if (!entities.length) throw new Error('No supported IFC products found in this file.');
  return { model: { id: modelId, name: file.name, discipline: 'IFC', matrix: identity(), warnings: [] }, entities, geometries };
}

export async function importIFCNative(file) { return importIFC(file); }
export function parseSTEP(text) { if (!/ISO-10303-21/i.test(text)) throw new Error('Invalid STEP/IFC stream'); return text.split(';').filter(Boolean); }

function translated(x,y,z){const m=identity();m[12]=x;m[13]=y;m[14]=z;return m;}
function box(id,sx,sy,sz){const x=sx/2,y=sy/2,z=sz/2;return{id,positions:[-x,-y,-z,x,-y,-z,x,y,-z,-x,y,-z,-x,-y,z,x,-y,z,x,y,z,-x,y,z],normals:new Array(24).fill(0),indices:[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0],bounds:{min:[-x,-y,-z],max:[x,y,z]}};}
