// utils/fingerprint.ts

const getBrowserMode = async (): Promise<string> => {
    if (typeof window === 'undefined') return 'public';
    try {
        // اختبار المساحة التخزينية (أدق طريقة لكشف الخفي حالياً)
        if (navigator.storage && navigator.storage.estimate) {
            const { quota } = await navigator.storage.estimate();
            if (quota && quota < 120000000) return 'private'; 
        }
    } catch (e) { return 'public'; }
    return 'public';
};

let cachedFingerprint: string | null = null;
let pendingPromise: Promise<string> | null = null;

export const getHardwareFingerprint = async (): Promise<string> => {
    if (typeof window === 'undefined') return 'ssr';
    if (cachedFingerprint) return cachedFingerprint;

    // إذا كان هناك طلب قيد التنفيذ، انتظر نفس النتيجة
    if (pendingPromise) return pendingPromise;

    pendingPromise = (async () => {
        try {
            const cpuCores = navigator.hardwareConcurrency || 0;
            const gpu = await getGPURenderer();
            const browserInfo = navigator.userAgent;
            const language = navigator.language;

            const rawData = `hw:${cpuCores}|gpu:${gpu}|browser:${browserInfo}|lang:${language}`;

            let hash = 0;
            for (let i = 0; i < rawData.length; i++) {
                hash = ((hash << 5) - hash) + rawData.charCodeAt(i);
                hash |= 0;
            }

            const result = `dv-${Math.abs(hash).toString(16)}`;
            cachedFingerprint = result;
            return result;
        } finally {
            pendingPromise = null;
        }
    })();

    return pendingPromise;
};

async function getGPURenderer() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (!gl) return "no-gpu";
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "generic-gpu";
    const loseContext = gl.getExtension('WEBGL_lose_context');
    loseContext?.loseContext();
    return renderer;
}