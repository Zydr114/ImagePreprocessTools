import type { PixelImage } from '../core/image';
import type { Backend,Progress } from './runtime';
import type { ProcessResult,Task,WorkerResponse } from './types';
export class ProcessingClient {
  private worker?:Worker;
  private reject?: (error:unknown)=>void;
  private sequence=0;
  cancel(){this.sequence++;this.worker?.terminate();this.worker=undefined;this.reject?.(new DOMException('任务已取消','AbortError'));this.reject=undefined;}
  run(image:PixelImage,task:Task,backend:Backend,progress:Progress):Promise<ProcessResult>{
    this.cancel();const id=++this.sequence;
    const worker=this.worker=new Worker(new URL('../workers/processing.worker.ts',import.meta.url),{type:'module'});
    return new Promise((resolve,reject)=>{
      this.reject=reject;
      const finish=()=>{worker.terminate();if(this.worker===worker){this.worker=undefined;this.reject=undefined;}};
      worker.onmessage=(event:MessageEvent<WorkerResponse>)=>{
        const message=event.data;if(message.id!==id||id!==this.sequence)return;
        if(message.type==='progress')progress(message.fraction,message.label);
        else if(message.type==='error'){finish();reject(new Error(message.message));}
        else{finish();resolve(message.result);}
      };
      worker.onerror=event=>{finish();reject(new Error(event.message||'处理线程启动失败，请刷新重试。'));};
      const data=new Uint8ClampedArray(image.data);
      worker.postMessage({id,image:{...image,data},task,backend},[data.buffer]);
    });
  }
}
