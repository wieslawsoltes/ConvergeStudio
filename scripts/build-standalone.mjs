/** Zero-dependency packaging only. The development source remains native ES modules. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), modules = new Map();
function resolve(from, spec) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
}
function compile(id) {
    if (modules.has(id))
        return;
    modules.set(id, '');
    let source = fs.readFileSync(path.join(root, id), 'utf8'), exports = [];
    source = source.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, spec) => {
        const target = resolve(id, spec);
        compile(target);
        return `const {${bindings.replace(/\s+as\s+/g, ':')}}=__require(${JSON.stringify(target)});`;
    });
    source = source.replace(/export\s+(async\s+)?(function|class)\s+(\w+)/g, (_, asyncWord, kind, name) => {
        exports.push(name);
        return `${asyncWord || ''}${kind} ${name}`;
    });
    source = source.replace(/export\s+(const|let|var)\s+(\w+)/g, (_, kind, name) => {
        exports.push(name);
        return `${kind} ${name}`;
    });
    source = source.replaceAll('import.meta.url', '__moduleURL');
    source += `\nObject.assign(__exports,{${exports.join(',')}});`;
    modules.set(id, source);
}
for (const id of ['src/app.js', 'src/clash-worker.js', 'src/import-worker.js'])
    compile(id);
const factories = `{${[...modules].map(([id, source]) => `${JSON.stringify(id)}:function(__exports,__require,__moduleURL){\n${source}\n}`).join(',\n')}}`;
const bootstrap = `const __factories=${factories};const __cache={};function __require(id){if(__cache[id])return __cache[id];const out={};__cache[id]=out;__factories[id](out,__require,new URL(id,__BASE__).href);return out;}`;
const workerSources = {};
for (const name of ['clash-worker', 'import-worker'])
    workerSources[name] = `(()=>{globalThis.__CONVERGE_STANDALONE__=true;const __BASE__="https://converge.local/";${bootstrap}__require("src/${name}.js");})();`;
const workerPatch = `const __NativeWorker=globalThis.Worker;const __workerSources=${JSON.stringify(workerSources)};globalThis.Worker=class extends __NativeWorker{constructor(url,options){const name=String(url).match(/(clash-worker|import-worker)\\.js/)?.[1];if(name){const blobURL=URL.createObjectURL(new Blob([__workerSources[name]],{type:'text/javascript'}));super(blobURL,{...options,type:'classic'});setTimeout(()=>URL.revokeObjectURL(blobURL),30000);}else super(url,options);}};`;
const code = `(()=>{globalThis.__CONVERGE_STANDALONE__=true;const __BASE__=/^(https?:|file:)/.test(document.baseURI)?document.baseURI:'https://converge.local/';${workerPatch}${bootstrap}__require('src/app.js');})();`;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<link\b[^>]*href=["']styles\.css["'][^>]*>/i, `<style>${fs.readFileSync(path.join(root, 'styles.css'), 'utf8')}</style>`).replace(/<script\b[^>]*src=["']src\/app\.js["'][^>]*>\s*<\/script>/i, () => `<script>${code.replaceAll('</script', '<\\/script')}</script>`);
const output = path.resolve(root, 'dist', 'converge-studio.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
console.log(`Standalone: ${output} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
