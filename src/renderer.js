import { SoftwareRasterizer } from './software.js';
import { identity, transform, center, length, vsub } from './math.js';
import { geometry, wireGeometry } from './geometry.js';
const WGSL = `
struct Globals { vp:mat4x4<f32>, clipMin:vec4<f32>, clipMax:vec4<f32>, eye:vec4<f32> };
struct Instance { model:mat4x4<f32>, color:vec4<f32>, meta:vec4<f32> };
@group(0) @binding(0) var<uniform> globals:Globals;
@group(0) @binding(1) var<storage,read> instances:array<Instance>;
struct VertexOut { @builtin(position) position:vec4<f32>, @location(0) world:vec3<f32>, @location(1) normal:vec3<f32>, @location(2) color:vec4<f32>, @location(3) @interpolate(flat) meta:vec4<f32> };
@vertex fn vs(@location(0) position:vec3<f32>,@location(1) normal:vec3<f32>,@builtin(instance_index) i:u32)->VertexOut {
 let inst=instances[i];let world=inst.model*vec4(position,1.0);let a=inst.model[0].xyz;let b=inst.model[1].xyz;let c=inst.model[2].xyz;let det=dot(a,cross(b,c));
 var out:VertexOut;out.position=globals.vp*world;out.position.z=(out.position.z+out.position.w)*0.5;out.world=world.xyz;
 out.normal=normalize(mat3x3(cross(b,c),cross(c,a),cross(a,b))*normal/select(1.0,det,abs(det)>0.00000001));out.color=inst.color;out.meta=inst.meta;return out;
}
fn clipped(in:VertexOut)->bool {
 if(in.meta.x>0.0&&globals.clipMin.w>0.5&&(any(in.world<globals.clipMin.xyz)||any(in.world>globals.clipMax.xyz))){return true;}
 let x=u32(in.position.x)%4u;let y=u32(in.position.y)%4u;var dither=array<f32,16>(0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
 return in.color.a<0.999 && in.color.a<(dither[y*4u+x]+0.5)/16.0;
}
@fragment fn fs(in:VertexOut,@builtin(front_facing) front:bool)->@location(0) vec4<f32>{
 if(clipped(in)){discard;}var n=normalize(in.normal);if(!front){n=-n;}
 let light=normalize(vec3(-0.45,0.85,0.65));let diffuse=max(0.,dot(n,light));let hemi=0.66+0.08*n.y;let eye=normalize(globals.eye.xyz-in.world);let rim=pow(1.-abs(dot(n,eye)),3.)*.07;
 var col=in.color.rgb*(hemi+diffuse*.34)+rim; if(in.meta.y>0.5){col=mix(col,vec3(.16,.72,.51),.58)+rim;} if(in.meta.x<0.5){col=in.color.rgb;}
 return vec4(col,1.);
}
@fragment fn pick(in:VertexOut)->@location(0) u32{if(clipped(in)){discard;}return u32(in.meta.x);}
`;
const glVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;layout(location=1) in vec3 normal;layout(location=2) in mat4 model;layout(location=6) in vec4 color;layout(location=7) in vec4 meta;
uniform mat4 vp;out vec3 world;out vec3 nrm;out vec4 col;flat out vec4 props;
void main(){vec4 w=model*vec4(position,1.);world=w.xyz;gl_Position=vp*w;vec3 a=model[0].xyz,b=model[1].xyz,c=model[2].xyz;float d=dot(a,cross(b,c));nrm=normalize(mat3(cross(b,c),cross(c,a),cross(a,b))*normal/(abs(d)>1e-8?d:1.));col=color;props=meta;}`;
const glCommon = `precision highp float;in vec3 world;in vec3 nrm;in vec4 col;flat in vec4 props;uniform vec4 clipMin;uniform vec4 clipMax;uniform vec3 eye;out vec4 frag;
bool clipped(){if(props.x>.5&&clipMin.w>.5&&(any(lessThan(world,clipMin.xyz))||any(greaterThan(world,clipMax.xyz))))return true;int x=int(gl_FragCoord.x)%4,y=int(gl_FragCoord.y)%4;float d[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);return col.a<.999&&col.a<(d[y*4+x]+.5)/16.;}`;
const glFragment = `#version 300 es
${glCommon}
void main(){if(clipped())discard;vec3 n=normalize(nrm)*(gl_FrontFacing?1.:-1.);float diffuse=max(0.,dot(n,normalize(vec3(-.45,.85,.65))));float rim=pow(1.-abs(dot(n,normalize(eye-world))),3.)*.07;vec3 c=col.rgb*(.66+.08*n.y+diffuse*.34)+rim;if(props.y>.5)c=mix(c,vec3(.16,.72,.51),.58)+rim;if(props.x<.5)c=col.rgb;frag=vec4(c,1.);}`;
const glPick = `#version 300 es
${glCommon}
void main(){if(clipped())discard;uint id=uint(props.x);frag=vec4(float(id&255u),float((id>>8u)&255u),float((id>>16u)&255u),255.)/255.;}`;
function interleave(g) {
    const a = new Float32Array(g.positions.length * 2);
    for (let i = 0; i < g.positions.length / 3; i++) {
        a.set(g.positions.subarray(i * 3, i * 3 + 3), i * 6);
        a.set(g.normals.subarray(i * 3, i * 3 + 3), i * 6 + 3);
    }
    return a;
}
function gridGeometry(extent = 60, step = 2) {
    const p = [], ix = [];
    for (let x = -extent; x <= extent; x += step) {
        const w = Math.abs(x) < .001 ? .023 : .009;
        for (const axis of [0, 1]) {
            let q = axis === 0 ? [[x - w, -.23, -extent], [x + w, -.23, -extent], [x + w, -.23, extent], [x - w, -.23, extent]] : [[-extent, -.23, x - w], [extent, -.23, x - w], [extent, -.23, x + w], [-extent, -.23, x + w]];
            const s = p.length / 3;
            p.push(...q.flat());
            ix.push(s, s + 1, s + 2, s, s + 2, s + 3);
        }
    }
    return geometry(p, ix);
}
export class Renderer {
    constructor(canvas, store, camera, onStatus = () => {
    }) {
        this.canvas = canvas;
        this.store = store;
        this.camera = camera;
        this.onStatus = onStatus;
        this.cache = new Map();
        this.lastRevision = -1;
        this.stats = { draws: 0, triangles: 0, instances: 0, ms: 0 };
        this.mode = 'shaded';
        this.framePending = false;
        this.grid = gridGeometry();
        this.gridId = '__grid';
        this.store.geometries.set(this.gridId, this.grid);
        this.backend = 'Starting';
        this.disposed = false;
    }
    async init(forceGL = false) {
        if (!forceGL && navigator.gpu) {
            try {
                const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
                if (!adapter)
                    throw Error('No WebGPU adapter');
                this.device = await adapter.requestDevice();
                this.device.lost.then(info => {
                    if (!this.disposed && this.backend === 'WebGPU')
                        this.onStatus(`GPU device lost: ${info.message}. Reload to recover.`, true);
                });
                this.device.addEventListener('uncapturederror', event => this.onStatus(event.error.message, true));
                await this.initGPU();
                this.backend = 'WebGPU';
                this.onStatus('WebGPU');
                return;
            }
            catch (e) {
                console.warn('WebGPU initialization failed:', e);
                this.device?.destroy();
                this.device = null;
            }
        }
        // A canvas cannot change context type after a failed WebGPU configuration.
        if (this.context) {
            const old = this.canvas, newCanvas = old.cloneNode();
            old.replaceWith(newCanvas);
            this.canvas = newCanvas;
        }
        try {
            this.initGL();
            this.backend = 'WebGL2';
            this.onStatus('WebGL2 fallback');
        }
        catch (error) {
            console.warn('WebGL2 unavailable; using software rendering:', error.message);
            if (this.gl) {
                const old = this.canvas, next = old.cloneNode();
                old.replaceWith(next);
                this.canvas = next;
                this.gl = null;
            }
            this.software = new SoftwareRasterizer(this.canvas);
            this.backend = 'Software';
            this.onStatus('Software renderer · no GPU');
        }
    }
    async initGPU() {
        const d = this.device;
        this.context = this.canvas.getContext('webgpu');
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({ device: d, format: this.format, alphaMode: 'opaque' });
        this.uniform = d.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.instanceCapacity = 96;
        this.instanceBuffer = d.createBuffer({ size: 96, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.layout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }] });
        const layout = d.createPipelineLayout({ bindGroupLayouts: [this.layout] });
        const shader = d.createShaderModule({ code: WGSL });
        const info = await shader.getCompilationInfo();
        if (info.messages.some(m => m.type === 'error'))
            throw Error(info.messages.map(m => m.message).join('\n'));
        const vertex = { module: shader, entryPoint: 'vs', buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }] };
        this.pipeline = await d.createRenderPipelineAsync({ layout, vertex, fragment: { module: shader, entryPoint: 'fs', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' }, multisample: { count: 4 } });
        this.linePipeline = await d.createRenderPipelineAsync({ layout, vertex, fragment: { module: shader, entryPoint: 'fs', targets: [{ format: this.format }] }, primitive: { topology: 'line-list' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' }, multisample: { count: 4 } });
        this.pickPipeline = await d.createRenderPipelineAsync({ layout, vertex, fragment: { module: shader, entryPoint: 'pick', targets: [{ format: 'r32uint' }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' } });
        this.bindGPU();
    }
    bindGPU() {
        this.bindGroup = this.device.createBindGroup({ layout: this.layout, entries: [{ binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: { buffer: this.instanceBuffer } }] });
    }
    initGL() {
        const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
        if (!gl)
            throw Error('WebGPU and WebGL2 are unavailable in this browser.');
        this.gl = gl;
        this.program = this.glProgram(glVertex, glFragment);
        this.pickProgram = this.glProgram(glVertex, glPick);
        this.instanceBufferGL = gl.createBuffer();
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
    }
    glProgram(v, f) {
        const gl = this.gl, sh = (type, source) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, source);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
                throw Error(gl.getShaderInfoLog(s));
            return s;
        };
        const p = gl.createProgram(), vs = sh(gl.VERTEX_SHADER, v), fs = sh(gl.FRAGMENT_SHADER, f);
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
            throw Error(gl.getProgramInfoLog(p));
        return p;
    }
    resize() {
        const r = this.canvas.getBoundingClientRect(), scale = Math.min(devicePixelRatio || 1, 2), w = Math.max(1, Math.round(r.width * scale)), h = Math.max(1, Math.round(r.height * scale));
        this.camera.aspect = r.width / Math.max(1, r.height);
        if (this.canvas.width === w && this.canvas.height === h && (this.backend === 'Software' || (this.backend === 'WebGPU' ? this.pickTexture : this.pickFramebuffer)))
            return;
        this.canvas.width = w;
        this.canvas.height = h;
        this.lastRevision = -1;
        if (this.backend === 'WebGPU') {
            for (const name of ['depth', 'msaa', 'pickTexture', 'pickDepth'])
                this[name]?.destroy();
            const d = this.device;
            this.depth = d.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
            this.msaa = d.createTexture({ size: [w, h], format: this.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
            this.pickTexture = d.createTexture({ size: [w, h], format: 'r32uint', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
            this.pickDepth = d.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        }
        if (this.gl) {
            const gl = this.gl;
            if (this.pickFramebuffer) {
                gl.deleteFramebuffer(this.pickFramebuffer);
                gl.deleteTexture(this.pickTexGL);
                gl.deleteRenderbuffer(this.pickDepthGL);
            }
            this.pickFramebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
            this.pickTexGL = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.pickTexGL);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTexGL, 0);
            this.pickDepthGL = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepthGL);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepthGL);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
                throw Error('Picking framebuffer incomplete');
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
    }
    buffers(id, lines = false) {
        const key = id + (lines ? ':lines' : '');
        if (this.cache.has(key))
            return this.cache.get(key);
        let g = id === this.gridId ? this.grid : this.store.geometries.get(id);
        if (!g)
            return null;
        if (lines)
            g = wireGeometry(g);
        const vert = interleave(g);
        let data = { count: g.indices.length };
        if (this.backend === 'WebGPU') {
            const d = this.device;
            data.vertex = d.createBuffer({ size: Math.max(4, vert.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
            data.index = d.createBuffer({ size: Math.max(4, g.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
            d.queue.writeBuffer(data.vertex, 0, vert);
            d.queue.writeBuffer(data.index, 0, g.indices);
        }
        else {
            const gl = this.gl;
            data.vertex = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, data.vertex);
            gl.bufferData(gl.ARRAY_BUFFER, vert, gl.STATIC_DRAW);
            data.index = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, data.index);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.indices, gl.STATIC_DRAW);
        }
        this.cache.set(key, data);
        return data;
    }
    resetResources() {
        for (const b of this.cache.values()) {
            if (this.backend === 'WebGPU') {
                b.vertex.destroy();
                b.index.destroy();
            }
            else {
                this.gl.deleteBuffer(b.vertex);
                this.gl.deleteBuffer(b.index);
            }
        }
        this.cache.clear();
        this.lastRevision = -1;
    }
    prepare() {
        if (this.lastRevision === this.store.sceneRevision)
            return;
        this.lastRevision = this.store.sceneRevision;
        const groups = new Map(), s = this.store;
        const items = s.instances.filter(i => i.visible);
        if (s.doc.display.grid)
            items.unshift({ geometryId: this.gridId, matrix: identity(), color: [.79, .82, .84, 1], pickId: 0, entityId: null });
        for (const it of items) {
            if (!groups.has(it.geometryId))
                groups.set(it.geometryId, []);
            groups.get(it.geometryId).push(it);
        }
        this.batches = [];
        const data = new Float32Array(Math.max(1, items.length) * 24);
        let base = 0, triangles = 0;
        for (const [id, list] of groups) {
            const start = base;
            for (const it of list) {
                const offset = base * 24, selected = s.selection.has(it.entityId);
                let color = [...it.color];
                if (s.clashPair) {
                    if (it.entityId === s.clashPair[0])
                        color = [.94, .23, .24, 1];
                    else if (it.entityId === s.clashPair[1])
                        color = [.15, .69, .4, 1];
                    else if (s.doc.display.xray)
                        color = [.69, .75, .8, .18];
                }
                else if (s.doc.display.xray && !selected)
                    color = [.72, .77, .81, .22];
                data.set(it.matrix, offset);
                data.set([color[0], color[1], color[2], color[3] ?? 1], offset + 16);
                data.set([it.pickId, selected && !s.clashPair ? 1 : 0, 0, 0], offset + 20);
                base++;
            }
            this.batches.push({ id, start, count: list.length });
            const g = id === this.gridId ? this.grid : s.geometries.get(id);
            if (id !== this.gridId)
                triangles += g.indices.length / 3 * list.length;
        }
        this.stats.triangles = triangles;
        this.stats.instances = items.filter(i => i.pickId).length;
        this.stats.draws = groups.size;
        if (this.backend === 'Software')
            return;
        if (this.backend === 'WebGPU') {
            if (data.byteLength > this.instanceCapacity) {
                this.instanceBuffer.destroy();
                this.instanceCapacity = 2 ** Math.ceil(Math.log2(data.byteLength));
                const max = this.device.limits.maxStorageBufferBindingSize;
                if (this.instanceCapacity > max)
                    throw Error(`Instance data exceeds GPU storage binding limit (${max} bytes)`);
                this.instanceBuffer = this.device.createBuffer({ size: this.instanceCapacity, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
                this.bindGPU();
            }
            this.device.queue.writeBuffer(this.instanceBuffer, 0, data);
        }
        else {
            const gl = this.gl;
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBufferGL);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        }
    }
    uniforms() {
        const a = new Float32Array(28), s = this.store.doc.section;
        a.set(this.camera.matrix);
        a.set([...s.min, s.enabled ? 1 : 0], 16);
        a.set([...s.max, 0], 20);
        a.set([...this.camera.eye, 0], 24);
        return a;
    }
    invalidate() {
        if (this.framePending || this.disposed)
            return;
        this.framePending = true;
        requestAnimationFrame(() => {
            this.framePending = false;
            try {
                this.render();
                this.onRender?.();
            }
            catch (e) {
                this.onStatus(e.message, true);
                console.error(e);
            }
        });
    }
    render() {
        if (!['WebGPU', 'WebGL2', 'Software'].includes(this.backend))
            return;
        const start = performance.now();
        this.resize();
        this.prepare();
        if (this.backend === 'Software') {
            this.software.render(this);
            this.stats.ms = performance.now() - start;
            return;
        }
        if (this.backend === 'WebGPU') {
            this.device.queue.writeBuffer(this.uniform, 0, this.uniforms());
            const enc = this.device.createCommandEncoder();
            const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'discard', clearValue: { r: .932, g: .945, b: .951, a: 1 } }], depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' } });
            this.drawGPU(pass, false);
            pass.end();
            this.device.queue.submit([enc.finish()]);
        }
        else
            this.drawGL(false);
        this.stats.ms = performance.now() - start;
    }
    drawGPU(pass, pick) {
        pass.setBindGroup(0, this.bindGroup);
        for (const b of this.batches) {
            if (pick && b.id === this.gridId)
                continue;
            const lines = !pick && this.mode === 'wireframe' && b.id !== this.gridId, buf = this.buffers(b.id, lines);
            pass.setPipeline(pick ? this.pickPipeline : lines ? this.linePipeline : this.pipeline);
            pass.setVertexBuffer(0, buf.vertex);
            pass.setIndexBuffer(buf.index, 'uint32');
            pass.drawIndexed(buf.count, b.count, 0, 0, b.start);
        }
    }
    drawGL(pick) {
        const gl = this.gl, p = pick ? this.pickProgram : this.program;
        gl.bindFramebuffer(gl.FRAMEBUFFER, pick ? this.pickFramebuffer : null);
        if (pick)
            gl.disable(gl.DITHER);
        else
            gl.enable(gl.DITHER);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(pick ? 0 : .932, pick ? 0 : .945, pick ? 0 : .951, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(p);
        const u = this.uniforms();
        gl.uniformMatrix4fv(gl.getUniformLocation(p, 'vp'), false, u.subarray(0, 16));
        gl.uniform4fv(gl.getUniformLocation(p, 'clipMin'), u.subarray(16, 20));
        gl.uniform4fv(gl.getUniformLocation(p, 'clipMax'), u.subarray(20, 24));
        gl.uniform3fv(gl.getUniformLocation(p, 'eye'), u.subarray(24, 27));
        for (const b of this.batches) {
            if (pick && b.id === this.gridId)
                continue;
            const lines = !pick && this.mode === 'wireframe' && b.id !== this.gridId, buf = this.buffers(b.id, lines);
            gl.bindBuffer(gl.ARRAY_BUFFER, buf.vertex);
            for (let i = 0; i < 2; i++) {
                gl.enableVertexAttribArray(i);
                gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 24, i * 12);
                gl.vertexAttribDivisor(i, 0);
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBufferGL);
            for (let i = 0; i < 6; i++) {
                const loc = 2 + i;
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 96, b.start * 96 + i * 16);
                gl.vertexAttribDivisor(loc, 1);
            }
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.index);
            gl.drawElementsInstanced(lines ? gl.LINES : gl.TRIANGLES, buf.count, gl.UNSIGNED_INT, 0, b.count);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    async pick(x, y) {
        this.resize();
        this.prepare();
        if (this.backend === 'Software')
            return this.software.pick(this, x, y);
        const rect = this.canvas.getBoundingClientRect(), px = Math.min(this.canvas.width - 1, Math.max(0, Math.floor(x / rect.width * this.canvas.width))), py = Math.min(this.canvas.height - 1, Math.max(0, Math.floor(y / rect.height * this.canvas.height)));
        if (this.backend === 'WebGPU') {
            this.device.queue.writeBuffer(this.uniform, 0, this.uniforms());
            const enc = this.device.createCommandEncoder(), pass = enc.beginRenderPass({ colorAttachments: [{ view: this.pickTexture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }], depthStencilAttachment: { view: this.pickDepth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' } });
            pass.setScissorRect(px, py, 1, 1);
            this.drawGPU(pass, true);
            pass.end();
            const read = this.device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
            enc.copyTextureToBuffer({ texture: this.pickTexture, origin: { x: px, y: py } }, { buffer: read, bytesPerRow: 256 }, { width: 1, height: 1 });
            this.device.queue.submit([enc.finish()]);
            try {
                await read.mapAsync(GPUMapMode.READ);
                return new Uint32Array(read.getMappedRange())[0];
            }
            finally {
                read.unmap();
                read.destroy();
            }
        }
        this.drawGL(true);
        const gl = this.gl, a = new Uint8Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFramebuffer);
        gl.readPixels(px, this.canvas.height - py - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return a[0] + a[1] * 256 + a[2] * 65536;
    }
    snapshot() {
        this.render();
        return this.canvas.toDataURL('image/png');
    }
}
