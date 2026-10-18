import { clamp } from './curves';
import type { PixelImage } from './image';
interface Weights { indices: number[]; values: number[]; first: number; last: number }
const sinc = (x: number) => Math.abs(x)<1e-8 ? 1 : Math.sin(Math.PI*x)/(Math.PI*x);
function coefficients(source: number, target: number): Weights[] {
  const scale = source/target, stretch = Math.max(1,scale), radius = 3*stretch;
  return Array.from({length:target},(_,i)=>{
    const center = (i+.5)*scale-.5, indices: number[] = [], values: number[] = [];
    let sum=0;
    for(let x=Math.ceil(center-radius);x<=Math.floor(center+radius);x++){
      const d=(x-center)/stretch, weight=sinc(d)*sinc(d/3);
      indices.push(clamp(x,0,source-1)); values.push(weight); sum+=weight;
    }
    return { indices, values:values.map(w=>w/sum),first:indices[0]!,last:indices.at(-1)! };
  });
}

/** Separable Lanczos-3 with premultiplied alpha and a bounded scanline ring. */
export class StreamingResize {
  readonly data: Uint8ClampedArray;
  private horizontal: Weights[];
  private vertical: Weights[];
  private rows = new Map<number, Float32Array>();
  private nextRow=0;
  private sourceRow=0;
  constructor(sourceWidth: number, sourceHeight: number, readonly width: number, readonly height: number){
    this.data = new Uint8ClampedArray(width*height*4);
    this.horizontal=coefficients(sourceWidth,width); this.vertical=coefficients(sourceHeight,height);
  }
  pushRow(row: Uint8ClampedArray): void {
    const filtered=new Float32Array(this.width*4);
    for(let x=0;x<this.width;x++){
      const weights=this.horizontal[x]!;
      for(let k=0;k<weights.indices.length;k++){
        const p=weights.indices[k]!*4, w=weights.values[k]!, a=row[p+3]!/255;
        filtered[x*4]!+=row[p]!*a*w; filtered[x*4+1]!+=row[p+1]!*a*w; filtered[x*4+2]!+=row[p+2]!*a*w; filtered[x*4+3]!+=a*w;
      }
    }
    const y=this.sourceRow++;
    this.rows.set(y,filtered);
    while(this.nextRow<this.height && this.vertical[this.nextRow]!.last<=y){
      const weights=this.vertical[this.nextRow]!, accum=new Float32Array(this.width*4);
      for(let k=0;k<weights.indices.length;k++){
        const src=this.rows.get(weights.indices[k]!)!; const w=weights.values[k]!;
        if(!src) throw new Error('重采样扫描行已丢失');
        for(let i=0;i<accum.length;i++) accum[i]!+=src[i]!*w;
      }
      const offset=this.nextRow*this.width*4;
      for(let x=0;x<this.width;x++){
        const p=x*4, a=clamp(accum[p+3]!);
        for(let c=0;c<3;c++) this.data[offset+p+c]=a>1e-6?Math.round(clamp(accum[p+c]!/a,0,255)):0;
        this.data[offset+p+3]=Math.round(a*255);
      }
      this.nextRow++;
    }
    const firstNeeded=this.nextRow<this.height?this.vertical[this.nextRow]!.first:y+1;
    for(const index of this.rows.keys()) if(index<firstNeeded)this.rows.delete(index);
  }
  finish(): PixelImage {
    if(this.nextRow!==this.height)throw new Error('重采样数据不完整');
    return {width:this.width,height:this.height,data:this.data};
  }
}
export function resizeImage(image: PixelImage,width: number,height: number): PixelImage {
  if(width===image.width&&height===image.height)return {width,height,data:new Uint8ClampedArray(image.data)};
  const resizer=new StreamingResize(image.width,image.height,width,height);
  for(let y=0;y<image.height;y++)resizer.pushRow(image.data.subarray(y*image.width*4,(y+1)*image.width*4));
  return resizer.finish();
}
