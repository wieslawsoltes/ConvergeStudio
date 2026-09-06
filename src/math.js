/** Column-major matrices; double precision on CPU, float32 at GPU upload. Y-up, metres. */
export const EPS = 1e-9;
export const vadd = (a, b) => a.map((x, i) => x + b[i]);
export const vsub = (a, b) => a.map((x, i) => x - b[i]);
export const vmul = (a, s) => a.map(x => x * s);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const length = a => Math.hypot(...a);
export const norm = a => vmul(a, 1 / (length(a) || 1));
export const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
export const identity = () => [1,0,0,0,0,1,0,0,0,1,0,0,0,0,1];
export function multiply(a,b){const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}return o;}
export function transform(m,p,w=1){return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12]*w,m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13]*w,m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]*w];}
export const emptyBox=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
export function extend(b,p){for(let i=0;i<3;i++){b.min[i]=Math.min(b.min[i],p[i]);b.max[i]=Math.max(b.max[i],p[i]);}return b;}
export const union=(a,b)=>{extend(a,b.min);extend(a,b.max);return a;};
export const validBox=b=>b&&b.min.every(Number.isFinite)&&b.max.every(Number.isFinite);
export const center=b=>b.min.map((v,i)=>(v+b.max[i])/2);
export const size=b=>b.max.map((v,i)=>v-b.min[i]);
export function transformBox(b,m){const o=emptyBox();for(let x of [b.min[0],b.max[0]])for(let y of [b.min[1],b.max[1]])for(let z of [b.min[2],b.max[2]])extend(o,transform(m,[x,y,z]));return o;}
export function trs(t=[0,0,0],q=[0,0,0,1],s=[1,1,1]){const[x,y,z,w]=q;return[(1-2*(y*y+z*z))*s[0],2*(x*y+z*w)*s[0],2*(x*z-y*w)*s[0],0,2*(x*y-z*w)*s[1],(1-2*(x*x+z*z))*s[1],2*(y*z+x*w)*s[1],0,2*(x*z+y*w)*s[2],2*(y*z-x*w)*s[2],(1-2*(x*x+y*y))*s[2],0,...t,1];}
export class Camera{constructor(){this.target=[0,0,0];this.distance=25;this.yaw=.7;this.pitch=.4;this.aspect=1;this.ortho=false;}serialize(){return{target:this.target,distance:this.distance,yaw:this.yaw,pitch:this.pitch,aspect:this.aspect,ortho:this.ortho};}restore(x){Object.assign(this,x||{});}fit(b){if(!validBox(b))return;this.target=center(b);this.distance=Math.max(...size(b))*2.2+1;}zoom(d){this.distance=Math.max(.1,this.distance*Math.exp(d*.001));}orbit(dx,dy){this.yaw+=dx*.008;this.pitch=clamp(this.pitch+dy*.008,-1.5,1.5);}pan(dx,dy,h){const s=this.distance/Math.max(h,1);this.target[0]-=dx*s;this.target[1]+=dy*s;}ray(){return{origin:[0,0,this.distance],direction:[0,0,-1]};}project(){return[0,0,0];}}
export class BVH{constructor(items=[]){this.items=items;}query(box,expand=0){return this.items.filter(i=>!(i.box.max[0]+expand<box.min[0]||i.box.min[0]-expand>box.max[0]||i.box.max[1]+expand<box.min[1]||i.box.min[1]-expand>box.max[1]||i.box.max[2]+expand<box.min[2]||i.box.min[2]-expand>box.max[2]));}}
