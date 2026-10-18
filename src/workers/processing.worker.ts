import { upscale } from '../inference/upscale';
import { cutout } from '../inference/cutout';
import { toneImage } from '../core/tone-gl';
import { applyMask,prepareMask } from '../core/mask';
import type { ProcessRequest,ProcessResult,WorkerResponse } from '../inference/types';
const send=(message:WorkerResponse,transfer:Transferable[]=[])=>self.postMessage(message,{transfer});
self.onmessage=async(event:MessageEvent<ProcessRequest>)=>{
  const {id,image,task,backend}=event.data,start=performance.now();
  const progress=(fraction:number,label:string)=>send({id,type:'progress',fraction,label});
  try{
    let result:Omit<ProcessResult,'ms'>;
    if(task.type==='tone'){
      const output=toneImage(image,task.curves,fraction=>progress(fraction,'正在渲染原尺寸图像'));
      result={image:output.image,backend:output.renderer};
    }else if(task.type==='mask'){
      const mask=prepareMask(task.mask,task.options,image.width,image.height);
      result={image:applyMask(image,mask),mask:task.mask,backend:'本地遮罩处理'};
    }else if(task.type==='upscale'){result=await upscale(image,task,backend,progress);}
    else {result=await cutout(image,task.options,backend,progress);}
    const complete={...result,ms:performance.now()-start};
    const transfer:Transferable[]=[complete.image.data.buffer as ArrayBuffer];
    if(complete.mask)transfer.push(complete.mask.data.buffer as ArrayBuffer);
    send({id,type:'done',result:complete},transfer);
  }catch(error){send({id,type:'error',message:error instanceof Error?error.message:String(error)});}
};
