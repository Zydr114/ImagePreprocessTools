import type { InferenceSession, Tensor } from 'onnxruntime-web';

export type Backend = 'webgpu' | 'webgl' | 'wasm';
export interface ModelManifest {
  runtimeVersion: string;
  files: Record<string, { bytes: number; sha256: string }>;
}
export type Progress = (fraction: number, label: string) => void;
export const CACHE_NAME = 'pixel-workshop-models-v1';
const base = new URL(import.meta.env.BASE_URL, self.location.href);
let manifestPromise: Promise<ModelManifest> | undefined;

export function manifest(): Promise<ModelManifest> {
  return manifestPromise ??= fetch(new URL('models/manifest.json', base)).then(async response => {
    if (!response.ok) throw new Error('模型清单加载失败，请刷新页面重试。');
    return response.json();
  }).catch(error => { manifestPromise = undefined; throw error; });
}

export async function modelBytes(name: string, progress?: Progress): Promise<ArrayBuffer> {
  const info = (await manifest()).files[name];
  if (!info) throw new Error(`未知模型文件：${name}`);
  const url = new URL(`models/${name}`, base);
  const key = new Request(`${url.href}?sha256=${info.sha256}`);
  const cache = await caches.open(CACHE_NAME).catch(() => undefined);
  const valid = async (data: ArrayBuffer) => {
    if (data.byteLength !== info.bytes) return false;
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('') === info.sha256;
  };
  const cached = await cache?.match(key);
  if (cached) {
    const data = await cached.arrayBuffer();
    if (await valid(data)) { progress?.(1, '模型已从本地缓存载入'); return data; }
    await cache?.delete(key);
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`模型下载失败（HTTP ${response.status}），请检查网络后重试。`);
  const reader = response.body.getReader();
  const data = new Uint8Array(info.bytes);
  let received = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    if (received + chunk.value.length > data.length) { await reader.cancel(); throw new Error('模型文件大小异常。'); }
    data.set(chunk.value, received);
    received += chunk.value.length;
    progress?.(received / info.bytes, `下载模型 ${(received / 1e6).toFixed(1)} / ${(info.bytes / 1e6).toFixed(1)} MB`);
  }
  if (received !== info.bytes || !await valid(data.buffer)) throw new Error('模型校验失败，请重新下载。');
  await cache?.put(key, new Response(data.slice(), { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => undefined);
  return data.buffer;
}

export async function loadRuntime(backend: Backend) {
  const ort = backend === 'webgl' ? await import('onnxruntime-web/webgl')
    : backend === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
  ort.env.wasm.wasmPaths = new URL('ort/', base).href;
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'warning';
  if (backend === 'webgl') ort.env.webgl.pack = true;
  return ort;
}

export async function openSession(name: string, backend: Backend, progress?: Progress) {
  const ort = await loadRuntime(backend);
  let data = await modelBytes(name, progress);
  if (backend === 'webgl') {
    // ONNX.js recognizes unknown dimensions encoded as numeric zero, but
    // rejects dim_param strings. Only the WebGL loader gets this metadata
    // adaptation: weights and computation remain the same verified graph.
    const { onnx } = await import('onnx-proto');
    const model = onnx.ModelProto.decode(new Uint8Array(data));
    for (const input of model.graph?.input ?? []) {
      for (const dim of input.type?.tensorType?.shape?.dim ?? []) {
        if (dim.dimParam) { delete dim.dimParam; dim.dimValue = 0; }
      }
    }
    data = onnx.ModelProto.encode(model).finish().slice().buffer;
  }
  progress?.(1, '正在编译模型，首次运行可能需要一些时间');
  const session = await ort.InferenceSession.create(data, {
    executionProviders: [backend],
    graphOptimizationLevel: backend === 'webgl' ? 'disabled' : 'all',
    // Shape operations are folded in the exported graphs. A GPU selection must
    // fail visibly when a computational op cannot run there, rather than hide CPU work.
    ...(backend === 'webgpu' ? { extra: { session: { disable_cpu_ep_fallback: '1' } } } : {}),
  });
  return { ort, session };
}

export async function runTensor(session: InferenceSession, feeds: Record<string, Tensor>): Promise<{ data: Float32Array; dims: readonly number[] }> {
  const output = await session.run(feeds);
  const tensor = output[session.outputNames[0]!]!;
  const value = { data: new Float32Array(await tensor.getData() as Float32Array), dims: tensor.dims };
  for (const item of Object.values(output)) item.dispose();
  return value;
}
