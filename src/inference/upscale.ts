import type { Tensor } from 'onnxruntime-web';
import { outputSize } from '../core/image';
import type { PixelImage } from '../core/image';
import { StreamingResize } from '../core/resize';
import { openSession, runTensor } from './runtime';
import type { Backend, Progress } from './runtime';
import type { Task } from './types';

export function reflect(index:number,length:number):number {
  if(length===1)return 0;
  const period=2*(length-1),n=((index%period)+period)%period;
  return n<length?n:period-n;
}
function inputPatch(image:PixelImage,x:number,y:number,w:number,h:number,reflection:boolean):Float32Array {
  const data=new Float32Array(3*w*h),area=w*h;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const sx=reflection?reflect(x+i,image.width):x+i,sy=reflection?reflect(y+j,image.height):y+j,p=(sy*image.width+sx)*4,q=j*w+i;
    for(let c=0;c<3;c++)data[c*area+q]=image.data[p+c]!/255;
  }
  return data;
}
function alpha(image:PixelImage,x:number,y:number,scale:number):number {
  const sx=Math.max(0,Math.min(image.width-1,(x+.5)/scale-.5)),sy=Math.max(0,Math.min(image.height-1,(y+.5)/scale-.5));
  const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,image.width-1),y1=Math.min(y0+1,image.height-1),dx=sx-x0,dy=sy-y0;
  const a=(x:number,y:number)=>image.data[(y*image.width+x)*4+3]!;
  return a(x0,y0)*(1-dx)*(1-dy)+a(x1,y0)*dx*(1-dy)+a(x0,y1)*(1-dx)*dy+a(x1,y1)*dx*dy;
}
async function attempt(image:PixelImage,task:Extract<Task,{type:'upscale'}>,backend:Backend,tile:number,progress:Progress){
  const [width,height]=outputSize(image.width,image.height,task.scale,task.limits),cugan=task.model==='realcugan',nativeScale=cugan&&task.scale<=2?2:4;
  const cols=Math.ceil(image.width/tile),rows=Math.ceil(image.height/tile),count=cols*rows,means:Float32Array[]=[];
  const resize=new StreamingResize(image.width*nativeScale,image.height*nativeScale,width,height);
  const halo=nativeScale===2?18:19,channels=[64,128,128,64];
  // Every RealCUGAN tile has the same reflected shape, including the padded last
  // core. A complete image pass computes each shared SE statistic before the next.
  const passes=cugan?5:1;
  for(let stage=0;stage<passes;stage++){
    const file=cugan?`cugan${nativeScale}-stage${stage}.onnx`:task.model==='realesr-photo'?'realesr-general-x4v3.onnx':'realesr-animevideov3.onnx';
    const {ort,session}=await openSession(file,backend,(v,label)=>progress((stage+v*.1)/passes,label));
    const sums=stage<4&&cugan?new Float64Array(channels[stage]!):undefined;
    const shared=means.map((m,i)=>new ort.Tensor('float32',m,[1,channels[i]!,1,1]));
    try{
      for(let row=0;row<rows;row++){
        const y=row*tile,coreH=Math.min(tile,image.height-y),band=cugan&&stage<4?undefined:new Uint8ClampedArray(image.width*nativeScale*coreH*nativeScale*4);
        for(let col=0;col<cols;col++){
          const x=col*tile,coreW=Math.min(tile,image.width-x);
          // SRVGG: anchor a fixed context rectangle inside the image. This keeps
          // the original zero-padding at image edges and avoids WebGL shape rebinding.
          const pw=cugan?tile+halo*2:Math.min(image.width,tile+80),ph=cugan?tile+halo*2:Math.min(image.height,tile+80);
          const px=cugan?x-halo:Math.max(0,Math.min(x-40,image.width-pw)),py=cugan?y-halo:Math.max(0,Math.min(y-40,image.height-ph));
          const input=new ort.Tensor('float32',inputPatch(image,px,py,pw,ph,cugan),[1,3,ph,pw]);
          const feeds:Record<string,Tensor>={input};shared.forEach((v,i)=>feeds[`mean${i}`]=v);
          let output;try{output=await runTensor(session,feeds);}finally{input.dispose();}
          if(sums){for(let i=0;i<sums.length;i++)sums[i]!+=output.data[i]!/count;}
          else{
            const ow=output.dims[3]!,oh=output.dims[2]!,area=ow*oh,ox=cugan?0:(x-px)*nativeScale,oy=cugan?0:(y-py)*nativeScale;
            if(ox+coreW*nativeScale>ow||oy+coreH*nativeScale>oh)throw new Error('模型输出尺寸异常');
            for(let j=0;j<coreH*nativeScale;j++)for(let i=0;i<coreW*nativeScale;i++){
              const q=(j+oy)*ow+i+ox,p=(j*image.width*nativeScale+x*nativeScale+i)*4;
              for(let c=0;c<3;c++)band![p+c]=Math.round(Math.max(0,Math.min(1,output.data[c*area+q]!))*255);
              band![p+3]=Math.round(alpha(image,x*nativeScale+i,y*nativeScale+j,nativeScale));
            }
          }
          const done=(row*cols+col+1)/count;progress((stage+.1+.9*done)/passes,cugan&&stage<4?`分析全图特征 ${stage+1}/4 · ${row*cols+col+1}/${count}`:`生成超分图像 · ${row*cols+col+1}/${count}`);
        }
        if(band){const stride=image.width*nativeScale*4;for(let j=0;j<coreH*nativeScale;j++)resize.pushRow(band.subarray(j*stride,(j+1)*stride));}
      }
      if(sums)means.push(Float32Array.from(sums));
    }finally{shared.forEach(v=>v.dispose());await session.release();}
  }
  return {image:resize.finish(),backend,nativeScale,tile};
}
export async function upscale(image:PixelImage,task:Extract<Task,{type:'upscale'}>,backend:Backend,progress:Progress){
  outputSize(image.width,image.height,task.scale,task.limits);
  let tile=[32,64,128].includes(task.tile)?task.tile:128;
  while(true){
    try{return await attempt(image,task,backend,tile,progress);}
    catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(tile>32&&/memory|alloc|out of bounds|resource exhausted|buffer.*size/i.test(message)){tile/=2;progress(0,`内存不足，改用 ${tile} 像素分块重试`);continue;}
      throw new Error(`${backend.toUpperCase()} 超分失败：${message}。可减小分块，或手动切换计算后端。`);
    }
  }
}
