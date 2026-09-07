import { mkdir, copyFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'vendor'), { recursive: true });
for (const name of ['web-ifc-api.js', 'web-ifc.wasm']) {
    const source = path.join(root, 'node_modules', 'web-ifc', name);
    try {
        await access(source);
        await copyFile(source, path.join(root, 'vendor', name));
        console.log('Vendored', name);
    }
    catch (error) {
        console.error('Install web-ifc with npm install before vendoring. ' + error.message);
        process.exitCode = 1;
    }
}
for (const name of ['LICENSE.md', 'LICENSE']) {
    try {
        await copyFile(path.join(root, 'node_modules', 'web-ifc', name), path.join(root, 'vendor', 'web-ifc-LICENSE'));
        break;
    }
    catch {
    }
}
