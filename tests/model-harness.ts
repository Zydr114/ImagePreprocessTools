import { openSession, runTensor } from '../src/inference/runtime';
import type { Backend } from '../src/inference/runtime';

declare global {
  interface Window { verifyModel: (backend: Backend, spec: { file: string; inputs: Record<string, { dims: number[]; data: number[] }>; output: number[] }) => Promise<unknown> }
}
window.verifyModel = async (backend, spec) => {
  const start = performance.now();
  const { ort, session } = await openSession(spec.file, backend);
  const feeds = Object.fromEntries(Object.entries(spec.inputs).map(([key, value]) => [key, new ort.Tensor('float32', Float32Array.from(value.data), value.dims)]));
  try {
    const output = await runTensor(session, feeds);
    let sum = 0, max = 0, byteSum = 0;
    for (let i = 0; i < output.data.length; i++) {
      const error = Math.abs(output.data[i]! - spec.output[i]!);
      sum += error; max = Math.max(max, error);
      byteSum += Math.abs(Math.round(Math.max(0, Math.min(1, output.data[i]!))*255) - Math.round(Math.max(0, Math.min(1, spec.output[i]!))*255));
    }
    return { backend, file: spec.file, length: output.data.length, mae: sum/output.data.length, max, byteMAE: byteSum/output.data.length, ms: performance.now()-start };
  } finally {
    Object.values(feeds).forEach(tensor => tensor.dispose());
    await session.release();
  }
};
