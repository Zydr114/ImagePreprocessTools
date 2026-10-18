import {describe,it,expect} from 'vitest';
import {applyTone,defaultCurves,curveLut,hslToRgb,tonePixel,buildLuts} from '../../src/core/curves';
import {StreamingResize,resizeImage} from '../../src/core/resize';
import {normalizeMask,applyMask,prepareMask} from '../../src/core/mask';
import {outputSize,validateSize,encodedSize} from '../../src/core/image';
const image=(w:number,h:number,rgba:number[])=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>rgba[i%4]!)});
describe('curves',()=>{
 it('neutral curves preserve every channel and alpha',()=>{const src=Uint8ClampedArray.from({length:256*4},(_,i)=>i%4===3?i%255:(i*73)%256);expect(applyTone(src,defaultCurves())).toEqual(src);});
 it('interpolation preserves extrema without overshoot',()=>{const lut=curveLut([{x:0,y:.1},{x:.3,y:.8},{x:.6,y:.2},{x:1,y:.9}]);expect(Math.min(...lut)).toBeGreaterThanOrEqual(.0999);expect(Math.max(...lut)).toBeLessThanOrEqual(.9001);expect([...lut].every(Number.isFinite)).toBe(true);});
 it('periodic hue wraps continuously at red',()=>{const curves=defaultCurves();curves.hue=[{x:0,y:.65},{x:.4,y:.25},{x:1,y:.65}];const lut=buildLuts(curves);const a=tonePixel(...hslToRgb(.000001,.8,.5),lut),b=tonePixel(...hslToRgb(.999999,.8,.5),lut);expect(Math.max(...a.map((v,i)=>Math.abs(v-b[i]!)))).toBeLessThan(.0001);});
 it('hue adjustments protect neutral gray',()=>{const curves=defaultCurves();curves.hue=[{x:0,y:1},{x:1,y:1}];curves.lightness=[{x:0,y:1},{x:1,y:1}];expect(applyTone(Uint8ClampedArray.from([120,120,120,90]),curves)).toEqual(Uint8ClampedArray.from([120,120,120,90]));});
});
describe('streaming Lanczos',()=>{
 it('preserves a constant color at odd noninteger dimensions',()=>{const output=resizeImage(image(17,11,[80,123,210,143]),29,19);expect(output.data).toEqual(image(29,19,[80,123,210,143]).data);});
 it('premultiplied filtering prevents hidden transparent red fringes',()=>{const source={width:2,height:1,data:Uint8ClampedArray.from([255,0,0,0,0,0,255,255])};const out=resizeImage(source,9,1);for(let i=0;i<out.data.length;i+=4)if(out.data[i+3]!>0){expect(out.data[i]).toBe(0);expect(out.data[i+2]).toBe(255);}});
 it('stream and batch outputs agree and reject incomplete streams',()=>{const source=image(19,13,[73,82,94,255]),stream=new StreamingResize(19,13,7,5);expect(()=>stream.finish()).toThrow();for(let y=0;y<13;y++)stream.pushRow(source.data.subarray(y*76,(y+1)*76));expect(stream.finish()).toEqual(resizeImage(source,7,5));});
});
describe('foreground mask',()=>{
 it('constant output is finite without division by zero',()=>{expect([...normalizeMask(Float32Array.from([0,0,0]))]).toEqual([0,0,0]);expect([...normalizeMask(Float32Array.from([1,1]))]).toEqual([1,1]);expect(()=>normalizeMask(Float32Array.from([NaN]))).toThrow();});
 it('multiplies existing alpha and inversion complements the mask',()=>{const source=image(4,3,[10,20,30,100]),mask={width:1,height:1,data:Float32Array.of(.25)};expect(applyMask(source,mask).data[3]).toBe(25);const inverted=prepareMask(mask,{invert:true,shift:0,feather:0},4,3);expect(applyMask(source,inverted).data[3]).toBe(75);});
 it('dilation and erosion affect the edge in the right direction',()=>{const mask={width:3,height:3,data:Float32Array.from([0,0,0,0,1,0,0,0,0])};const options={invert:false,feather:0,shift:1};expect([...prepareMask(mask,options,3,3).data]).toEqual(new Array(9).fill(1));expect([...prepareMask(mask,{...options,shift:-1},3,3).data]).toEqual(new Array(9).fill(0));});
});
describe('image boundaries',()=>{
 it('rounds each requested output dimension and validates pixel limits',()=>{expect(outputSize(35,27,1.7)).toEqual([60,46]);expect(()=>outputSize(8192,8192,4)).toThrow();expect(()=>outputSize(10,10,NaN)).toThrow();expect(()=>validateSize(0,2)).toThrow();});
 it('reads PNG header dimensions before decode',()=>{const bytes=new Uint8Array(24);const view=new DataView(bytes.buffer);view.setUint32(16,33000);view.setUint32(20,120);expect(encodedSize(bytes,'image/png')).toEqual([33000,120]);});
});
