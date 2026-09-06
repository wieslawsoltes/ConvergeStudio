import { identity, multiply, emptyBox, union, transformBox, validBox, BVH } from './math.js';
export function uid(prefix='id'){return `${prefix}-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;}
export const clone=o=>structuredClone(o);
export function emptyDocument(){return{schema:1,name:'Untitled coordination',models:[],entities:[],sets:[],views:[],issues:[],measurements:[],tests:[],results:{},section:{enabled:false,min:[-1e3,-1e3,-1e3],max:[1e3,1e3,1e3]},display:{xray:false,grid:true},camera:null,activity:[],hiddenEntities:[],hiddenModels:[]};}
export class Store extends EventTarget{
 constructor(){super();this.doc=emptyDocument();this.geometries=new Map();this.selection=new Set();this.undoStack=[];this.redoStack=[];this.byId=new Map();this.byPick=new Map();this.entityBounds=new Map();this.instances=[];this.index=new BVH([]);this.revision=0;}
 emit(type,detail={}){this.dispatchEvent(new CustomEvent(type,{detail}));}
 command(label,fn){const before=clone(this.doc);fn(this.doc);this.undoStack.push({before,after:clone(this.doc),label});this.redoStack=[];this.changed();}
 changed(){this.revision++;this.rebuild();this.emit('change');}
 undo(){const x=this.undoStack.pop();if(!x)return;this.doc=clone(x.before);this.redoStack.push(x);this.changed();}
 redo(){const x=this.redoStack.pop();if(!x)return;this.doc=clone(x.after);this.undoStack.push(x);this.changed();}
 replace(doc,geometries){this.doc=doc;this.geometries=geometries instanceof Map?geometries:new Map(geometries||[]);this.selection.clear();this.undoStack=[];this.redoStack=[];this.changed();}
 rebuild(){this.byId=new Map(this.doc.entities.map(e=>[e.id,e]));this.instances=[];this.entityBounds.clear();let pick=0;for(const e of this.doc.entities){const m=this.doc.models.find(x=>x.id===e.modelId);if(!m)continue;let eb=emptyBox();for(const p of e.parts||[]){const g=this.geometries.get(p.geometryId);if(!g)continue;const world=multiply(m.matrix||identity(),e.matrix||identity());const b=transformBox(g.bounds,world);union(eb,b);this.instances.push({entityId:e.id,geometryId:p.geometryId,world,color:p.color||e.color||[.7,.75,.78,1],pickId:++pick});this.byPick.set(pick,e.id);}if(validBox(eb))this.entityBounds.set(e.id,eb);}this.index=new BVH([...this.entityBounds].map(([id,box])=>({id,box})));}
 bounds(ids=null){const wanted=ids?new Set(ids):null,b=emptyBox();for(const [id,box] of this.entityBounds)if(!wanted||wanted.has(id))union(b,box);return b;}
 select(ids,toggle=false){if(!toggle)this.selection.clear();for(const id of ids){if(toggle&&this.selection.has(id))this.selection.delete(id);else if(this.byId.has(id))this.selection.add(id);}this.emit('selection');}
 async addImport(data){for(const [id,g] of data.geometries||[])this.geometries.set(id,g);this.doc.models.push(data.model);this.doc.entities.push(...data.entities);this.changed();}
 pack(){return JSON.stringify({doc:this.doc,geometries:[...this.geometries]});}
}
export function unpack(text){const x=typeof text==='string'?JSON.parse(text):text;return{doc:x.doc,geometries:new Map(x.geometries||[])};}
export class Persistence{constructor(){this.key='converge-studio-project';}async load(){return localStorage.getItem(this.key);}async save(data){localStorage.setItem(this.key,data);}}
