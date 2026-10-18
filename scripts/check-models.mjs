import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const args = ['--no-sandbox', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'];
const browser = await chromium.launch({ headless: true, args, executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') console.log('browser:', msg.text().slice(0,500)); });
await page.goto('http://127.0.0.1:5173/tests/model-harness.html');
await page.waitForFunction(() => typeof window.verifyModel === 'function');
const device = await page.evaluate(async () => {
  const adapter = await navigator.gpu?.requestAdapter();
  const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  const info=adapter?.info;
  return { webgpu: info ? {vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:info.isFallbackAdapter} : null, webgl: gl && debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null };
});
console.log('Device', JSON.stringify(device));
const cases = JSON.parse(await readFile('artifacts/models/cases.json','utf8'));
const results = [];
for (const backend of (process.env.BACKENDS || 'webgpu,webgl,wasm').split(',')) {
  for (const spec of cases) {
    if (process.env.MODEL_FILTER && !spec.file.includes(process.env.MODEL_FILTER)) continue;
    const input = {};
    for (const [name, value] of Object.entries(spec.inputs)) {
      const bytes = await readFile('artifacts/models/'+value.file);
      input[name] = { dims: value.dims, data: Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length/4)) };
    }
    const bytes = await readFile('artifacts/models/'+spec.output.file);
    const output = Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length/4));
    try {
      const result = await page.evaluate(({backend,file,inputs,output}) => window.verifyModel(backend,{file,inputs,output}), { backend, file: spec.file, inputs: input, output });
      results.push(result); console.log(JSON.stringify(result));
    } catch (error) {
      results.push({ backend, file: spec.file, error: String(error) }); console.log('FAILED', backend, spec.file, String(error).slice(0,1800));
    }
  }
}
await mkdir('artifacts/models',{recursive:true});
await writeFile('artifacts/models/browser-report.json', JSON.stringify({device,results}, null, 2));
await browser.close();
if (results.some(x => x.error || x.mae > 1e-4 || x.byteMAE > 1)) process.exitCode = 1;
