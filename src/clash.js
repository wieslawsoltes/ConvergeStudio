export class ClashEngine {
  constructor(store){this.store=store;this.cache=new Map();}
  run({a=[],b=[],clearance=0}={}){
    const out=[];
    const seen=new Set();
    for(const idA of a){const ba=this.store.entityBounds.get(idA);if(!ba)continue;for(const idB of b){if(idA===idB)continue;const key=[idA,idB].sort().join('|');if(seen.has(key))continue;seen.add(key);const bb=this.store.entityBounds.get(idB);if(!bb)continue;const dx=Math.max(0,Math.max(ba.min[0]-bb.max[0],bb.min[0]-ba.max[0]));const dy=Math.max(0,Math.max(ba.min[1]-bb.max[1],bb.min[1]-ba.max[1]));const dz=Math.max(0,Math.max(ba.min[2]-bb.max[2],bb.min[2]-ba.max[2]));const distance=Math.hypot(dx,dy,dz);const hard=distance===0;if(hard||distance<=clearance)out.push({id:`clash-${out.length+1}`,a:idA,b:idB,distance,hard,status:'New',name:hard?'Hard clash':`Clearance ${Math.round(distance*1000)} mm`});}}
    return out;
  }
}
