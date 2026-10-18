import {ProcessingClient} from '../src/inference/client';
import {defaultCurves,applyTone} from '../src/core/curves';
import {ToneRenderer} from '../src/core/tone-gl';
import {resizeImage} from '../src/core/resize';
import {openSession,runTensor} from '../src/inference/runtime';
import type {Task} from '../src/inference/types';
import type {Backend} from '../src/inference/runtime';
const makeImage=(width=67,height=49)=>({width,height,data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>{
 const p=Math.floor(i/4),x=p%width,y=Math.floor(p/width);return i%4===3?Math.round(255*x/(width-1)):(x*3+y*2+(i%4)*40)%256;
})});
const client=new ProcessingClient();
const tools={client,makeImage,defaultCurves,applyTone,ToneRenderer,resizeImage,openSession,runTensor};
declare global{interface Window{harness:typeof tools;execute:(task:Task,backend:Backend)=>ReturnType<ProcessingClient['run']>}}
window.harness=tools;
window.execute=(task,backend)=>client.run(makeImage(),task,backend,()=>{});
