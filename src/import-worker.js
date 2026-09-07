import { importGLTF } from './gltf.js';
import { importIFC } from './ifc.js';
self.onmessage = async ({ data }) => {
    try {
        const result = data.file.name.toLowerCase().endsWith('.ifc') ? await importIFC(data.file, { nativeOnly: data.nativeOnly, onProgress: progress => self.postMessage({ type: 'progress', progress }) }) : await importGLTF(data.file, data.files);
        const transfers = result.geometries.flatMap(([, g]) => [g.positions.buffer, g.normals.buffer, g.indices.buffer]);
        self.postMessage({ type: 'result', result }, transfers);
    }
    catch (error) {
        self.postMessage({ type: 'error', error: error.message, stack: error.stack });
    }
};
