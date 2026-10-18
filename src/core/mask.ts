import { clamp } from './curves';
import type { PixelImage } from './image';
export interface Mask { width:number;height:number;data:Float32Array }
export interface MaskOptions { invert:boolean; shift:number; feather:number }
export const defaultMaskOptions = ():MaskOptions=>({invert:false,shift:0,feather:0});
export function normalizeMask(data:Float32Array):Float32Array {
  let min=Infinity,max=-Infinity;
  for(const v of data){if(!Number.isFinite(v))throw new Error('模型返回了无效遮罩');min=Math.min(min,v);max=Math.max(max,v);}
  const delta=max-min;
  return Float32Array.from(data,v=>clamp(delta>1e-6?(v-min)/delta:v));
}
function morphology(mask:Mask,radius:number,dilate:boolean):Float32Array {
  const {width,height,data}=mask,r=Math.ceil(radius),tmp=new Float32Array(data.length),out=new Float32Array(data.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let v=dilate?0:1;for(let k=-r;k<=r;k++){const s=data[y*width+clamp(x+k,0,width-1)]!;v=dilate?Math.max(v,s):Math.min(v,s);}tmp[y*width+x]=v;
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let v=dilate?0:1;for(let k=-r;k<=r;k++){const s=tmp[clamp(y+k,0,height-1)*width+x]!;v=dilate?Math.max(v,s):Math.min(v,s);}out[y*width+x]=data[y*width+x]!+(v-data[y*width+x]!)*Math.min(1,radius);
  }
  return out;
}
function blur(mask:Mask,sigma:number):Float32Array {
  const {width,height,data}=mask,r=Math.max(1,Math.ceil(sigma*3)),weights=Array.from({length:2*r+1},(_,i)=>Math.exp(-.5*((i-r)/Math.max(.15,sigma))**2));
  const sum=weights.reduce((a,b)=>a+b,0);const kernel=weights.map(v=>v/sum),tmp=new Float32Array(data.length),out=new Float32Array(data.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){let v=0;for(let k=-r;k<=r;k++)v+=data[y*width+clamp(x+k,0,width-1)]!*kernel[k+r]!;tmp[y*width+x]=v;}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){let v=0;for(let k=-r;k<=r;k++)v+=tmp[clamp(y+k,0,height-1)*width+x]!*kernel[k+r]!;out[y*width+x]=v;}
  return out;
}
export function prepareMask(mask:Mask,options:MaskOptions,imageWidth:number,imageHeight:number):Mask {
  const scale=Math.max(mask.width,mask.height)/Math.max(imageWidth,imageHeight);
  let data:Float32Array=new Float32Array(mask.data);
  if(options.shift)data=morphology({...mask,data},Math.abs(options.shift)*scale,options.shift>0);
  if(options.feather>0)data=blur({...mask,data},options.feather*scale);
  if(options.invert)data=Float32Array.from(data,v=>1-v);
  return {...mask,data};
}
export function sampleMask(mask:Mask,x:number,y:number,width:number,height:number):number {
  const sx=clamp((x+.5)*mask.width/width-.5,0,mask.width-1),sy=clamp((y+.5)*mask.height/height-.5,0,mask.height-1);
  const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,mask.width-1),y1=Math.min(y0+1,mask.height-1),dx=sx-x0,dy=sy-y0;
  return mask.data[y0*mask.width+x0]!*(1-dx)*(1-dy)+mask.data[y0*mask.width+x1]!*dx*(1-dy)+mask.data[y1*mask.width+x0]!*(1-dx)*dy+mask.data[y1*mask.width+x1]!*dx*dy;
}
export function applyMask(image:PixelImage,mask:Mask,view=false):PixelImage {
  const data=new Uint8ClampedArray(image.data.length);
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const p=(y*image.width+x)*4,a=sampleMask(mask,x,y,image.width,image.height);
    if(view){data[p]=data[p+1]=data[p+2]=Math.round(a*255);data[p+3]=255;}
    else{data[p]=image.data[p]!;data[p+1]=image.data[p+1]!;data[p+2]=image.data[p+2]!;data[p+3]=Math.round(image.data[p+3]!*a);}
  }
  return {...image,data};
}
