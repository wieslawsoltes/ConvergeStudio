/** Build an allow-listed, project-path-safe static GitHub Pages artifact. */
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '_site');
const required = ['index.html', 'styles.css', 'src/app.js', 'src/renderer.js', 'src/clash-worker.js', 'src/import-worker.js', 'vendor/web-ifc-api.js', 'vendor/web-ifc.wasm', 'vendor/web-ifc-LICENSE', 'dist/converge-studio.html', 'examples/coordination-sample.ifc', 'examples/coordination-sample.glb'];
for (const file of required) {
  const info = await stat(path.join(root, file));
  if (!info.isFile() || info.size === 0) throw Error(`Missing deployment asset: ${file}`);
}
const index = await readFile(path.join(root, 'index.html'), 'utf8');
if (!index.includes('src/app.js') || /http-equiv=["']refresh/i.test(index)) throw Error('Pages must serve the real application, not a redirect');
const wasm = await readFile(path.join(root, 'vendor/web-ifc.wasm'));
if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) throw Error('Invalid IFC WebAssembly binary');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'src', 'vendor', 'examples', 'LICENSE', 'THIRD_PARTY.md']) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true, dereference: false, errorOnExist: true, force: false });
}
await cp(path.join(root, 'dist/converge-studio.html'), path.join(output, 'standalone.html'));
await writeFile(path.join(output, '.nojekyll'), '');
let sourceCommit = process.env.GITHUB_SHA || 'local';
try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
const hashes = {};
for (const name of required.filter(n => !n.startsWith('dist/'))) hashes[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
await writeFile(path.join(output, 'deployment.json'), JSON.stringify({ application: 'Converge Studio', sourceCommit, builtAt: new Date().toISOString(), workflowRun: process.env.GITHUB_RUN_ID || null, assets: hashes }, null, 2) + '\n');
console.log(`Pages artifact: ${output}; source commit: ${sourceCommit}`);
