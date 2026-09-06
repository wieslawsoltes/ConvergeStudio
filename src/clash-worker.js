import { ClashEngine } from './clash.js';
let state={entityBounds:new Map()};
self.onmessage=e=>{const m=e.data;if(m.type==='sync')state.entityBounds=new Map(m.bounds||[]);if(m.type==='run'){const store={entityBounds:state.entityBounds};const items=new ClashEngine(store).run(m.test||{});postMessage({type:'result',id:m.id,items});}};
