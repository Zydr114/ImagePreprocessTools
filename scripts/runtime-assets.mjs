import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Keep the JS entry point and WASM binaries on the exact same package version.
const source = resolve('node_modules/onnxruntime-web/dist');
const target = resolve('public/ort');
await mkdir(target, { recursive: true });
for (const name of await readdir(source)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(name)) await copyFile(`${source}/${name}`, `${target}/${name}`);
}
console.log('ONNX Runtime assets copied to public/ort');
