/** One-time, checksummed recovery of the original delivered source archive. */
import { readFile, writeFile, readdir, mkdir, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, '.github/source-transfer');
const expected = {
  compressed: '4826d6ffb2bcb84dd8e42c9d6e8f8bba1b3c4ef3eabb94db98ab9633e5194fb3',
  json: '6ce102ea6c7f96c6a51af4a6fc7cdcb862f1a0b0245ac260c1b3ba14a7ec511e'
};
const parts = (await readdir(source)).filter(n => /^part-\d{2}\.b64$/.test(n)).sort();
if (parts.length !== 12) throw Error('Expected exactly twelve source-transfer parts');
const text = (await Promise.all(parts.map(n => readFile(path.join(source, n), 'utf8')))).join('').replace(/\s/g, '');
const compressed = Buffer.from(text, 'base64');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (hash(compressed) !== expected.compressed) throw Error('Compressed source checksum mismatch');
const decoded = brotliDecompressSync(compressed, { maxOutputLength: 400000 });
if (hash(decoded) !== expected.json) throw Error('Source JSON checksum mismatch');
const files = JSON.parse(decoded.toString('utf8'));
if (Object.keys(files).length !== 34) throw Error('Source file count mismatch');
for (const [name, contents] of Object.entries(files)) {
  if (typeof contents !== 'string' || name.includes('\\') || name.split('/').some(p => !p || p === '..' || p === '.github') || path.isAbsolute(name)) throw Error(`Unsafe source path: ${name}`);
  const destination = path.join(root, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}
// Publishing integration is separate from the unmodified application/engine sources.
const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
pkg.scripts['build:pages'] = 'node scripts/build-pages.mjs';
await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
await appendFile(path.join(root, '.gitignore'), '\n_site/\n.ci-web/\ndist/\n');
const readmePath = path.join(root, 'README.md');
const readme = await readFile(readmePath, 'utf8');
await writeFile(readmePath, readme.replace('# Converge Studio\n', '# Converge Studio\n\n[Open live application](https://wieslawsoltes.github.io/ConvergeStudio/) · [Publishing workflow](https://github.com/wieslawsoltes/ConvergeStudio/actions/workflows/pages.yml) · [Deployment guide](docs/DEPLOYMENT.md)\n'));
await mkdir(path.join(root, 'examples'), { recursive: true });
console.log('Recovered and verified all 34 original source files.');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'restored=true\n');
