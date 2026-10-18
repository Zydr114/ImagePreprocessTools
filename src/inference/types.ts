import type { PixelImage, ImageLimits } from '../core/image';
import type { Curves } from '../core/curves';
import type { Mask, MaskOptions } from '../core/mask';
import type { Backend } from './runtime';
export type UpscaleModel='realcugan'|'realesr-photo'|'realesr-anime';
export type Task=
  |{type:'tone';curves:Curves}
  |{type:'upscale';model:UpscaleModel;scale:number;tile:number;limits:ImageLimits}
  |{type:'cutout';options:MaskOptions}
  |{type:'mask';mask:Mask;options:MaskOptions};
export interface ProcessRequest {id:number;image:PixelImage;backend:Backend;task:Task}
export interface ProcessResult {image:PixelImage;backend:string;ms:number;mask?:Mask;nativeScale?:number;tile?:number}
export type WorkerResponse={id:number;type:'progress';fraction:number;label:string}|{id:number;type:'done';result:ProcessResult}|{id:number;type:'error';message:string};
