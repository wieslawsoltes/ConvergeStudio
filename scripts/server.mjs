import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), port = Number(process.env.PORT || 8080), host = process.env.HOST || '127.0.0.1';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ifc': 'application/octet-stream', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
    try {
        if (!['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(405);
            res.end();
            return;
        }
        const url = new URL(req.url, 'http://localhost');
        let relative = decodeURIComponent(url.pathname);
        if (relative.endsWith('/'))
            relative += 'index.html';
        const file = path.resolve(root, '.' + relative);
        if (file !== root && !file.startsWith(root + path.sep)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        if (relative.split('/').some(p => p.startsWith('.') || p === 'node_modules')) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        const st = await stat(file);
        if (!st.isFile())
            throw Error('Not a file');
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    }
    catch (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
});
server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Start with a different PORT environment variable.` : error.message);
    process.exitCode = 1;
});
server.listen(port, host, () => console.log(`Converge Studio: http://${host}:${port}\nCtrl+C to stop.`));
