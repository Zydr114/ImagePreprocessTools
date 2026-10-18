import { applyTone, buildLuts, LUT_SIZE } from './curves';
import type { Curves } from './curves';
import type { PixelImage } from './image';

const vertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main(){uv=(position+1.)*.5;gl_Position=vec4(position,0.,1.);}`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform sampler2D curves;
in vec2 uv;
out vec4 color;
float curve(int row,float x){float p=clamp(x,0.,1.)*1023.;int i=int(floor(p));return mix(texelFetch(curves,ivec2(i,row),0).r,texelFetch(curves,ivec2(min(i+1,1023),row),0).r,fract(p));}
vec3 toHsl(vec3 c){float a=max(c.r,max(c.g,c.b)),b=min(c.r,min(c.g,c.b)),d=a-b,l=(a+b)*.5;if(d<.0000001)return vec3(0.,0.,l);float h=a==c.r?(c.g-c.b)/d+(c.g<c.b?6.:0.):a==c.g?(c.b-c.r)/d+2.:(c.r-c.g)/d+4.;return vec3(h/6.,d/(1.-abs(2.*l-1.)),l);}
vec3 toRgb(vec3 v){float h=fract(v.x)*6.,c=(1.-abs(2.*v.z-1.))*v.y,x=c*(1.-abs(mod(h,2.)-1.));vec3 rgb=h<1.?vec3(c,x,0.):h<2.?vec3(x,c,0.):h<3.?vec3(0.,c,x):h<4.?vec3(0.,x,c):h<5.?vec3(x,0.,c):vec3(c,0.,x);return rgb+v.z-c*.5;}
void main(){vec4 src=texture(image,vec2(uv.x,1.-uv.y));vec3 c=vec3(curve(0,curve(1,src.r)),curve(0,curve(2,src.g)),curve(0,curve(3,src.b)));vec3 hsl=toHsl(c);float h=hsl.x,w=smoothstep(0.,.1,hsl.y);hsl.x+=(curve(4,h)-.5)*w;hsl.y=clamp(hsl.y*curve(5,h)*2.,0.,1.);hsl.z=clamp(hsl.z+(curve(6,h)-.5)*w,0.,1.);color=vec4(toRgb(hsl),src.a);}`;

export class ToneRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private image: WebGLTexture;
  private lut: WebGLTexture;
  private buffer: WebGLBuffer;
  constructor(offscreen=false){
    this.canvas=offscreen?new OffscreenCanvas(1,1):document.createElement('canvas');
    const gl=this.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true,antialias:false}) as WebGL2RenderingContext | null;
    if(!gl)throw new Error('WebGL2 不可用');this.gl=gl;
    const shader=(type:number,text:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'着色器编译失败');return s;};
    const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);
    this.program=gl.createProgram()!;gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('调色着色器链接失败');
    gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(this.program);
    this.buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const attr=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
    this.image=gl.createTexture()!;this.lut=gl.createTexture()!;
    gl.uniform1i(gl.getUniformLocation(this.program,'image'),0);gl.uniform1i(gl.getUniformLocation(this.program,'curves'),1);
    gl.disable(gl.DITHER);
  }
  render(source: PixelImage,curves: Curves): void {
    const gl=this.gl;
    if(gl.isContextLost())throw new Error('调色 GPU 上下文已丢失');
    if(source.width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||source.height>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error('图片超过 GPU 纹理尺寸');
    this.canvas.width=source.width;this.canvas.height=source.height;gl.viewport(0,0,source.width,source.height);gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,source.width,source.height,0,gl.RGBA,gl.UNSIGNED_BYTE,source.data);
    const values=new Float32Array(LUT_SIZE*7*4);buildLuts(curves).forEach((lut,row)=>lut.forEach((value,x)=>{values[(row*LUT_SIZE+x)*4]=value;}));
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.lut);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,LUT_SIZE,7,0,gl.RGBA,gl.FLOAT,values);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    if(gl.getError()!==gl.NO_ERROR)throw new Error('GPU 调色失败');
  }
  pixels(): PixelImage {
    const {width,height}=this.canvas,raw=new Uint8Array(width*height*4);this.gl.readPixels(0,0,width,height,this.gl.RGBA,this.gl.UNSIGNED_BYTE,raw);
    const data=new Uint8ClampedArray(raw.length),stride=width*4;
    for(let y=0;y<height;y++)data.set(raw.subarray((height-1-y)*stride,(height-y)*stride),y*stride);
    return {width,height,data};
  }
  dispose(): void { const gl=this.gl;gl.deleteTexture(this.image);gl.deleteTexture(this.lut);gl.deleteProgram(this.program);gl.deleteBuffer(this.buffer);gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}

export function toneImage(source: PixelImage,curves: Curves,onProgress?: (fraction:number)=>void): {image: PixelImage;renderer:string} {
  let renderer: ToneRenderer;
  try{renderer=new ToneRenderer(true);}catch{return {image:{...source,data:applyTone(source.data,curves)},renderer:'CPU'};}
  const data=new Uint8ClampedArray(source.data.length),size=512;
  try{
    for(let y=0;y<source.height;y+=size){for(let x=0;x<source.width;x+=size){
      const w=Math.min(size,source.width-x),h=Math.min(size,source.height-y),tile=new Uint8ClampedArray(w*h*4);
      for(let row=0;row<h;row++)tile.set(source.data.subarray(((y+row)*source.width+x)*4,((y+row)*source.width+x+w)*4),row*w*4);
      renderer.render({width:w,height:h,data:tile},curves);const output=renderer.pixels().data;
      for(let row=0;row<h;row++)data.set(output.subarray(row*w*4,(row+1)*w*4),((y+row)*source.width+x)*4);
    }onProgress?.(Math.min(1,(y+size)/source.height));}
    return {image:{...source,data},renderer:'WebGL2'};
  }catch{return {image:{...source,data:applyTone(source.data,curves)},renderer:'CPU'};}
  finally{renderer.dispose();}
}
