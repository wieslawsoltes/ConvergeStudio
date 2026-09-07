import { ClashEngine } from './clash.js';
const engine = new ClashEngine();
let generation = 0;
self.onmessage = async ({ data }) => {
    if (data.type === 'cancel') {
        generation++;
        return;
    }
    if (data.type === 'sync') {
        generation++;
        engine.sync(data.payload);
        return;
    }
    if (data.type === 'run') {
        const token = ++generation;
        try {
            const result = await engine.run(data.test, { onProgress: progress => self.postMessage({ type: 'progress', job: data.job, progress }), cancelled: () => token !== generation });
            self.postMessage({ type: 'result', job: data.job, result });
        }
        catch (error) {
            self.postMessage({ type: 'error', job: data.job, error: error.message });
        }
    }
};
