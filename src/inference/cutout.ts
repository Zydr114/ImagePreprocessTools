import type { PixelImage } from '../core/image';
import { resizeImage } from '../core/resize';
import { applyMask,normalizeMask,prepareMask } from '../core/mask';
import type { MaskOptions } from '../core/mask';
import { openSession,runTensor } from './runtime';
import type { Backend,Progress } from './runtime';
export async function cutout(image:PixelImage,options:MaskOptions,backend:Backend,progress:Progress){
  const {ort,session}=await openSession('u2netp.onnx',backend,(v,label)=>progress(v*.25,label));
  try{
    const small=resizeImage(image,320,320),area=320*320,data=new Float32Array(3*area),means=[.485,.456,.406],std=[.229,.224,.225];
    let max=0;for(let p=0;p<small.data.length;p+=4)for(let c=0;c<3;c++)max=Math.max(max,small.data[p+c]!);
    for(let i=0;i<area;i++)for(let c=0;c<3;c++)data[c*area+i]=(small.data[i*4+c]!/Math.max(1,max)-means[c]!)/std[c]!;
    progress(.35,'正在识别主要前景');
    const tensor=new ort.Tensor('float32',data,[1,3,320,320]);
    let output;try{output=await runTensor(session,{[session.inputNames[0]!]:tensor});}finally{tensor.dispose();}
    const mask={width:320,height:320,data:normalizeMask(output.data)};
    progress(.85,'正在优化边缘并恢复原始尺寸');
    return {image:applyMask(image,prepareMask(mask,options,image.width,image.height)),mask,backend};
  }finally{await session.release();}
}
