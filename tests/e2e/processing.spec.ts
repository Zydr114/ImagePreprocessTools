import {test,expect} from '@playwright/test';
import type {Backend} from '../../src/inference/runtime';
const limits={edge:8192,pixels:64000000};
test.beforeEach(async({page})=>{await page.goto('/tests/processing-harness.html');await page.waitForFunction(()=>!!window.harness);});
for(const backend of ['webgpu','webgl','wasm'] as Backend[]){
 test(`${backend}: all SR models, native 4x CUGAN and cutout`,async({page})=>{
  if(backend==='webgpu')test.skip(!await page.evaluate(async()=>!!await navigator.gpu?.requestAdapter()),'No WebGPU adapter');
  const results=await page.evaluate(async({backend,limits})=>{
   const records=[];
   for(const model of ['realcugan','realesr-photo','realesr-anime'] as const){
    const r=await window.execute({type:'upscale',model,scale:1.7,tile:32,limits},backend);
    records.push({model,width:r.image.width,height:r.image.height,backend:r.backend,alpha:[r.image.data[3],r.image.data.at(-1)],finite:[...r.image.data].every(Number.isFinite),ms:r.ms});
   }
   const four=await window.execute({type:'upscale',model:'realcugan',scale:4,tile:32,limits},backend);
   const cut=await window.execute({type:'cutout',options:{invert:false,shift:0,feather:0}},backend);
   return {records,four:{width:four.image.width,height:four.image.height,native:four.nativeScale},cut:{w:cut.image.width,h:cut.image.height,mask:cut.mask?.data.length,min:Math.min(...cut.mask!.data),max:Math.max(...cut.mask!.data),backend:cut.backend}};
  },{backend,limits});
  for(const r of results.records){expect([r.width,r.height]).toEqual([114,83]);expect(r.backend).toBe(backend);expect(r.finite).toBe(true);expect(r.alpha[0]).toBeLessThan(5);expect(r.alpha[1]).toBeGreaterThan(250);}
  expect(results.four).toEqual({width:268,height:196,native:4});expect(results.cut).toEqual({w:67,h:49,mask:102400,min:0,max:1,backend});
  await test.info().attach(`${backend}-timing.json`,{body:JSON.stringify(results,null,2),contentType:'application/json'});
 });
}
test('SRVGG multi-tile output matches independent full-frame inference',async({page})=>{
 const diff=await page.evaluate(async({limits})=>{
  const h=window.harness,source=h.makeImage(103,69),tiled=await h.client.run(source,{type:'upscale',model:'realesr-photo',scale:4,tile:32,limits},'wasm',()=>{});
  const {ort,session}=await h.openSession('realesr-general-x4v3.onnx','wasm'),area=source.width*source.height,data=new Float32Array(area*3);
  for(let p=0;p<area;p++)for(let c=0;c<3;c++)data[c*area+p]=source.data[p*4+c]!/255;
  const input=new ort.Tensor('float32',data,[1,3,source.height,source.width]);
  try{const full=await h.runTensor(session,{input});let max=0,sum=0,seamMax=0;const w=source.width*4,outArea=w*source.height*4;
   for(let p=0;p<outArea;p++)for(let c=0;c<3;c++){if(tiled.image.data[p*4+3]===0)continue;const d=Math.abs(tiled.image.data[p*4+c]!-Math.round(Math.max(0,Math.min(1,full.data[c*outArea+p]!))*255));max=Math.max(max,d);sum+=d;if(p%w%128<2)seamMax=Math.max(seamMax,d);}
   return {max,mae:sum/(outArea*3),seamMax};
  }finally{input.dispose();await session.release();}
 },{limits});
 expect(diff.max).toBeLessThanOrEqual(1);expect(diff.seamMax).toBeLessThanOrEqual(1);expect(diff.mae).toBeLessThan(.02);
});
test('GPU tone agrees with CPU, including tile boundaries and alpha',async({page})=>{
 const diff=await page.evaluate(async()=>{
  const h=window.harness,source=h.makeImage(519,17),curves=h.defaultCurves();curves.rgb=[{x:0,y:.04},{x:.4,y:.56},{x:1,y:.97}];curves.hue=[{x:0,y:.7},{x:1,y:.7}];
  const result=await h.client.run(source,{type:'tone',curves},'wasm',()=>{}),expected=h.applyTone(source.data,curves);let max=0,alpha=0;expected.forEach((v,i)=>{if(i%4===3)alpha=Math.max(alpha,Math.abs(v-result.image.data[i]!));else max=Math.max(max,Math.abs(v-result.image.data[i]!));});return {max,alpha,backend:result.backend};
 });expect(diff.max).toBeLessThanOrEqual(1);expect(diff.alpha).toBe(0);expect(diff.backend).toBe('WebGL2');
});
test('cancel rejects old job and preserves the next job and input pixels',async({page})=>{
 const result=await page.evaluate(async({limits})=>{const h=window.harness,source=h.makeImage(),first=h.client.run(source,{type:'upscale',model:'realcugan',scale:4,tile:32,limits},'wasm',()=>{}).catch(e=>e.name);h.client.cancel();const second=await h.client.run(source,{type:'tone',curves:h.defaultCurves()},'wasm',()=>{});return {first:await first,length:source.data.length,second:second.image.width};},{limits});expect(result).toEqual({first:'AbortError',length:67*49*4,second:67});
});
test('corrupted model cache is checked and repaired',async({page})=>{
 const result=await page.evaluate(async()=>{
  const h=window.harness,r=await h.openSession('realesr-animevideov3.onnx','wasm');await r.session.release();
  const cache=await caches.open('pixel-workshop-models-v1'),key=(await cache.keys()).find(k=>k.url.includes('realesr-animevideov3'))!;
  await cache.put(key,new Response('corrupt'));const next=await h.openSession('realesr-animevideov3.onnx','wasm');await next.session.release();return (await (await cache.match(key))!.arrayBuffer()).byteLength;
 });expect(result).toBe(2498513);
});
test('download failure is actionable and does not produce a result',async({page,context})=>{
 await context.route('**/models/realesr-animevideov3.onnx',route=>route.fulfill({status:503,body:'temporarily unavailable'}));
 const message=await page.evaluate(async({limits})=>{try{await window.execute({type:'upscale',model:'realesr-anime',scale:2,tile:32,limits},'wasm');return '';}catch(e){return (e as Error).message;}},{limits});expect(message).toContain('HTTP 503');
});
for(const scale of [2,4])test(`RealCUGAN ${scale}x tile stitching matches full-frame PyTorch reference`,async({page})=>{
 const result=await page.evaluate(async({scale,limits})=>{
  const h=window.harness,source=h.makeImage();for(let i=3;i<source.data.length;i+=4)source.data[i]=255;
  const result=await h.client.run(source,{type:'upscale',model:'realcugan',scale,tile:32,limits},'wasm',()=>{});
  const reference=await createImageBitmap(await (await fetch(`/tests/fixtures/cugan${scale}-reference.png`)).blob()),canvas=new OffscreenCanvas(reference.width,reference.height),ctx=canvas.getContext('2d')!;ctx.drawImage(reference,0,0);const expected=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let max=0,sum=0,seam=0;for(let i=0;i<expected.length;i++){if(i%4===3)continue;const d=Math.abs(result.image.data[i]!-expected[i]!);max=Math.max(max,d);sum+=d;const x=Math.floor(i/4)%canvas.width;if(x%(32*scale)<2)seam=Math.max(seam,d);}
  return {max,mae:sum/(expected.length/4*3),seam};
 },{scale,limits});expect(result.max).toBeLessThanOrEqual(1);expect(result.seam).toBeLessThanOrEqual(1);expect(result.mae).toBeLessThan(.02);
});
