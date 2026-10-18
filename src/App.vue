<script setup lang="ts">
import { ref,shallowRef,computed,watch,onMounted,onBeforeUnmount } from 'vue';
import { setColorScheme } from 'mdui/functions/setColorScheme.js';
import { setTheme } from 'mdui/functions/setTheme.js';
import AppIcon from './components/AppIcon.vue';
import CurveEditor from './components/CurveEditor.vue';
import ImageViewport from './components/ImageViewport.vue';
import { defaultCurves,defaultPoints,curveKeys,curveLabels,applyTone,rgbToHsl } from './core/curves';
import type { Curves,CurveKey,Point } from './core/curves';
import { decodeImage,demoImage,imageCanvas,desktopLimits,mobileLimits,outputSize } from './core/image';
import type { PixelImage } from './core/image';
import { ToneRenderer } from './core/tone-gl';
import { applyMask,prepareMask,defaultMaskOptions } from './core/mask';
import type { Mask,MaskOptions } from './core/mask';
import { ProcessingClient } from './inference/client';
import type { Backend } from './inference/runtime';
import { CACHE_NAME } from './inference/runtime';
import type { ProcessResult,Task,UpscaleModel } from './inference/types';

const baseUrl=import.meta.env.BASE_URL;
function dragLeave(event:DragEvent){if(!(event.relatedTarget instanceof Node)||!(event.currentTarget as HTMLElement).contains(event.relatedTarget))dragging.value=false;}
type Tool='upscale'|'tone'|'cutout';
const tools=[{id:'upscale' as Tool,name:'图像超分',en:'Super resolution',icon:'expand',number:'01',title:'让清晰，更进一步。',description:'用轻量 AI 模型，找回照片的细节与插画的线条。'},
  {id:'tone' as Tool,name:'曲线调色',en:'Color & curves',icon:'curves',number:'02',title:'把色彩，调成你的样子。',description:'从明暗到色相，让每一条曲线都成为表达。'},
  {id:'cutout' as Tool,name:'智能抠图',en:'Remove background',icon:'cut',number:'03',title:'留下主角，释放想象。',description:'一键提取主要前景，为下一次创作留出空间。'}];
const tool=ref<Tool>('upscale'),activeTool=computed(()=>tools.find(t=>t.id===tool.value)!);
const fileInput=ref<HTMLInputElement>(),filename=ref(''),current=shallowRef<PixelImage>(),original=shallowRef<PixelImage>();
const before=shallowRef<HTMLCanvasElement>(),thumbnail=shallowRef<PixelImage>(),processed=shallowRef<PixelImage>(),resultCanvas=shallowRef<HTMLCanvasElement>(),liveCanvas=shallowRef<HTMLCanvasElement>();
const rawMask=shallowRef<Mask>(),resultInfo=shallowRef<ProcessResult>();
const curves=ref<Curves>(defaultCurves()),curve=ref<CurveKey>('rgb'),maskOptions=ref<MaskOptions>(defaultMaskOptions());
const previewVersion=ref(0),toneBackend=ref('WebGL2'),showMask=ref(false),compare=ref(true),paramsOpen=ref(false),dragging=ref(false);
const model=ref<UpscaleModel>('realcugan'),scale=ref(2),tile=ref(128),backend=ref<Backend|'auto'>('auto');
const capabilities=ref({webgpu:false,webgl:false}),gpuName=ref('正在检测图形能力'),busy=ref(false),loadingImage=ref(false),progress=ref(0),progressLabel=ref(''),error=ref(''),notice=ref('');
const exportOpen=ref(false),infoOpen=ref(false),exportFormat=ref('image/png'),quality=ref(.92),background=ref('#ffffff'),exportName=ref(''),saving=ref(false),dark=ref(false);
const mobile=ref(matchMedia('(max-width: 700px)').matches),steps=ref(0),cacheSize=ref('尚未检测');
const client=new ProcessingClient();let operation=0,importSequence=0,toneRenderer:ToneRenderer|undefined,previewFrame=0,noticeTimer:ReturnType<typeof setTimeout>|undefined;
const limits=computed(()=>mobile.value?mobileLimits:desktopLimits);
const selectedBackend=computed<Backend>(()=>backend.value==='auto'?(capabilities.value.webgpu?'webgpu':capabilities.value.webgl?'webgl':'wasm'):backend.value);
const modelMeta:Record<UpscaleModel,{name:string;description:string;size:string}>={
  realcugan:{name:'RealCUGAN · 动漫',description:'保守修复，注重线条和画风保留',size:'原生 2× / 4× · 分阶段模型'},
  'realesr-photo':{name:'Real-ESRGAN · 照片',description:'为自然照片与真实场景优化',size:'原生 4× · 4.88 MB'},
  'realesr-anime':{name:'Real-ESRGAN · 动漫轻量',description:'适合动漫画面、插画与快速处理',size:'原生 4× · 2.50 MB'},
};
const dimensions=computed(()=>{if(!current.value)return '';try{return outputSize(current.value.width,current.value.height,scale.value,limits.value).join(' × ');}catch{return '超出尺寸限制';}});
const after=computed(()=>tool.value==='tone'?liveCanvas.value:tool.value==='cutout'&&rawMask.value?liveCanvas.value:resultCanvas.value);
const displaySize=computed(()=>tool.value==='upscale'&&processed.value?[processed.value.width,processed.value.height]:[current.value?.width||1,current.value?.height||1]);
const canExport=computed(()=>!!current.value&&(tool.value==='tone'||!!processed.value));
const histogram=computed(()=>{
  const image=thumbnail.value;if(!image)return [];
  const bins=new Array<number>(64).fill(0),step=Math.max(4,Math.ceil(image.data.length/(50000*4))*4);
  for(let i=0;i<image.data.length;i+=step){if(image.data[i+3]!<10)continue;let v:number;if(['hue','saturation','lightness'].includes(curve.value))v=rgbToHsl(image.data[i]!/255,image.data[i+1]!/255,image.data[i+2]!/255)[0];else if(curve.value==='rgb')v=(image.data[i]!*.2126+image.data[i+1]!*.7152+image.data[i+2]!*.0722)/255;else v=image.data[i+(['r','g','b'].indexOf(curve.value))]!/255;bins[Math.min(63,Math.floor(v*64))]!++;}
  const max=Math.max(...bins,1);return bins.map(v=>Math.sqrt(v/max));
});
const prettyBackend=(name:string)=>({webgpu:'WebGPU',webgl:'WebGL',wasm:'WASM · CPU'}[name]||name);
function flash(text:string){notice.value=text;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.value='',4500);}
function cancel(){operation++;client.cancel();busy.value=false;progress.value=0;progressLabel.value='';}
function clearResult(){processed.value=undefined;resultCanvas.value=undefined;resultInfo.value=undefined;rawMask.value=undefined;liveCanvas.value=undefined;}
function selectImage(image:PixelImage,name:string,initial=true){
  cancel();clearResult();current.value=image;filename.value=name;before.value=imageCanvas(image);
  const ratio=Math.min(1,1400/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(before.value,0,0,canvas.width,canvas.height);thumbnail.value={width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
  if(initial){original.value=image;steps.value=0;}
  curves.value=defaultCurves();maskOptions.value=defaultMaskOptions();error.value='';renderPreview();
}
async function importFile(file?:File){if(!file)return;const id=++importSequence;cancel();loadingImage.value=true;error.value='';try{const image=await decodeImage(file,limits.value);if(id===importSequence)selectImage(image,file.name);}catch(e){if(id===importSequence)error.value=e instanceof Error?e.message:String(e);}finally{if(id===importSequence)loadingImage.value=false;if(fileInput.value)fileInput.value.value='';}}
function demo(){importSequence++;loadingImage.value=false;selectImage(demoImage(),'山间来信.png');}
function renderPreview(){
  cancelAnimationFrame(previewFrame);previewFrame=requestAnimationFrame(()=>{
    if(!thumbnail.value)return;
    if(tool.value==='tone'){
      try{toneRenderer??=new ToneRenderer();toneRenderer.render(thumbnail.value,curves.value);liveCanvas.value=toneRenderer.canvas as HTMLCanvasElement;toneBackend.value='WebGL2';}
      catch{toneRenderer?.dispose();toneRenderer=undefined;liveCanvas.value=imageCanvas({...thumbnail.value,data:applyTone(thumbnail.value.data,curves.value)});toneBackend.value='CPU';}
    }else if(tool.value==='cutout'&&rawMask.value&&current.value){const mask=prepareMask(rawMask.value,maskOptions.value,current.value.width,current.value.height);liveCanvas.value=imageCanvas(applyMask(thumbnail.value,mask,showMask.value));}
    previewVersion.value++;
  });
}
function changeCurve(points:Point[]){curves.value={...curves.value,[curve.value]:points};}
watch(curves,renderPreview,{deep:true});watch([maskOptions,showMask],renderPreview,{deep:true});
watch(tool,()=>{cancel();clearResult();error.value='';renderPreview();});
watch([model,scale],()=>{if(tool.value==='upscale'){cancel();clearResult();}});
async function runTask(task:Task):Promise<PixelImage|undefined>{
  if(!current.value||busy.value||loadingImage.value)return;
  const id=++operation;busy.value=true;error.value='';progress.value=0;progressLabel.value='正在准备图像';
  try{
    const result=await client.run(current.value,task,selectedBackend.value,(fraction,label)=>{if(id===operation){progress.value=fraction;progressLabel.value=label;}});
    if(id!==operation)return;
    processed.value=result.image;resultCanvas.value=imageCanvas(result.image);resultInfo.value=result;
    if(result.mask)rawMask.value=result.mask;
    renderPreview();return result.image;
  }catch(e){if(id===operation&&!(e instanceof DOMException&&e.name==='AbortError'))error.value=e instanceof Error?e.message:String(e);}
  finally{if(id===operation){busy.value=false;progressLabel.value='';}}
}
function taskForTool():Task{
  if(tool.value==='tone')return {type:'tone',curves:JSON.parse(JSON.stringify(curves.value))};
  if(tool.value==='cutout')return rawMask.value?{type:'mask',mask:rawMask.value,options:{...maskOptions.value}}:{type:'cutout',options:{...maskOptions.value}};
  return {type:'upscale',model:model.value,scale:scale.value,tile:tile.value,limits:{...limits.value}};
}
async function run(){try{if(tool.value==='upscale'&&current.value)outputSize(current.value.width,current.value.height,scale.value,limits.value);await runTask(taskForTool());}catch(e){error.value=e instanceof Error?e.message:String(e);}}
async function applyResult(){let image=processed.value;if(tool.value==='tone'||tool.value==='cutout'&&rawMask.value)image=await runTask(taskForTool());if(image){selectImage(image,filename.value,false);steps.value++;flash('结果已作为下一步输入');}}
function reset(){if(original.value){selectImage(original.value,filename.value,false);steps.value=0;flash('已恢复导入的原图');}}
function openExport(){if(!canExport.value)return;exportName.value=filename.value.replace(/\.[^.]+$/,'')+(tool.value==='upscale'?`_${scale.value}x`:tool.value==='tone'?'_调色':'_去背景');exportOpen.value=true;}
async function save(){
  if(saving.value)return;saving.value=true;error.value='';
  try{
    let image=processed.value;
    if(tool.value==='tone'||tool.value==='cutout'&&rawMask.value)image=await runTask(taskForTool());
    if(!image)return;
    const canvas=imageCanvas(image),ctx=canvas.getContext('2d')!;
    if(exportFormat.value==='image/jpeg'){ctx.globalCompositeOperation='destination-over';ctx.fillStyle=background.value;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='source-over';}
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('导出失败，图像可能超过浏览器编码限制。')),exportFormat.value,quality.value));
    const ext=exportFormat.value==='image/png'?'png':exportFormat.value==='image/jpeg'?'jpg':'webp';
    if(blob.type!==exportFormat.value)throw new Error('当前浏览器不支持该导出格式，请选择 PNG。');
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(exportName.value.trim()||'图像')+'.'+ext;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    exportOpen.value=false;flash('图像已导出');
  }catch(e){error.value=e instanceof Error?e.message:String(e);}
  finally{saving.value=false;}
}
function updateNumber(target:'scale'|'tile'|'quality'|'shift'|'feather',event:Event){const value=Number((event.target as HTMLInputElement).value);if(!Number.isFinite(value))return;if(target==='scale')scale.value=Math.max(1,Math.min(4,value));else if(target==='tile')tile.value=value;else if(target==='quality')quality.value=Math.max(.1,Math.min(1,value));else maskOptions.value={...maskOptions.value,[target]:Math.max(target==='shift'?-20:0,Math.min(20,value))};}
function theme(){dark.value=!dark.value;setTheme(dark.value?'dark':'light');localStorage.setItem('pixel-workshop-theme',dark.value?'dark':'light');}
async function cacheInfo(){const cache=await caches.open(CACHE_NAME);let total=0;for(const key of await cache.keys()){const response=await cache.match(key);if(response)total+=(await response.blob()).size;}cacheSize.value=(total/1e6).toFixed(1)+' MB';}
async function clearCache(){if(busy.value)return;await caches.delete(CACHE_NAME);await cacheInfo();flash('模型缓存已清理，下次运行时会重新下载');}
function paste(event:ClipboardEvent){const file=Array.from(event.clipboardData?.files||[]).find(f=>f.type.startsWith('image/'));if(file){event.preventDefault();void importFile(file);}}
function shortcut(event:KeyboardEvent){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='o'){event.preventDefault();fileInput.value?.click();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();openExport();}if(event.key==='Escape'){if(busy.value)cancel();paramsOpen.value=false;}}
const media=matchMedia('(max-width:700px)');const resizeDevice=()=>mobile.value=media.matches;
onMounted(async()=>{
  setColorScheme('#4b6757');dark.value=(localStorage.getItem('pixel-workshop-theme')|| (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'))==='dark';setTheme(dark.value?'dark':'light');
  document.addEventListener('paste',paste);document.addEventListener('keydown',shortcut);media.addEventListener('change',resizeDevice);
  try{const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');capabilities.value.webgl=!!gl;const info=gl?.getExtension('WEBGL_debug_renderer_info');gpuName.value=gl&&info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'CPU 兼容模式';gl?.getExtension('WEBGL_lose_context')?.loseContext();const adapter=await navigator.gpu?.requestAdapter();capabilities.value.webgpu=!!adapter;if(adapter)gpuName.value=adapter.info.description||`${adapter.info.vendor} ${adapter.info.architecture}`;}catch{gpuName.value='将按浏览器能力选择后端';}
});
watch(infoOpen,value=>{if(value)void cacheInfo();});
onBeforeUnmount(()=>{client.cancel();toneRenderer?.dispose();cancelAnimationFrame(previewFrame);clearTimeout(noticeTimer);document.removeEventListener('paste',paste);document.removeEventListener('keydown',shortcut);media.removeEventListener('change',resizeDevice);});
</script>

<template>
  <div class="application" @dragover.prevent="dragging=true" @dragleave="dragLeave" @drop.prevent="dragging=false;importFile($event.dataTransfer?.files[0])">
    <input ref="fileInput" class="visually-hidden" aria-label="选择图片文件" type="file" accept="image/png,image/jpeg,image/webp" @change="importFile(($event.target as HTMLInputElement).files?.[0])"/>
    <header class="app-header"><a class="brand" href="./" aria-label="像素工坊首页"><span class="brand-mark"><i/><i/><i/><i/></span><span>像素工坊<small>PIXEL WORKSHOP</small></span></a><div class="header-right"><span class="privacy-pill"><AppIcon name="shield" :size="15"/>本地处理 · 隐私优先</span><span class="header-divider"/><mdui-button-icon v-control-label :aria-label="dark?'切换浅色主题':'切换深色主题'" @click="theme"><AppIcon :name="dark?'sun':'moon'"/></mdui-button-icon><mdui-button-icon v-control-label aria-label="关于与模型缓存" @click="infoOpen=true"><AppIcon name="info"/></mdui-button-icon></div></header>
    <div class="app-layout">
      <aside class="navigation"><div class="nav-caption">创作工具 <span>03</span></div><nav aria-label="图像处理工具"><button v-for="item in tools" :key="item.id" class="nav-item" :class="{active:tool===item.id}" :aria-current="tool===item.id?'page':undefined" @click="tool=item.id;paramsOpen=false"><AppIcon :name="item.icon" :size="22"/><span>{{item.name}}<small>{{item.en}}</small></span><span class="nav-number">{{item.number}}</span></button></nav><div class="nav-note"><span class="little-stars">✳</span><p>好工具，让创作<br/>多一点自由。</p><span>在你的浏览器里，完成。</span></div><button class="nav-about" @click="infoOpen=true">关于工坊 <span>v0.1</span></button></aside>
      <main class="workspace">
        <div class="workspace-heading"><div><div class="eyebrow"><span>{{activeTool.number}}</span> / {{activeTool.en.toUpperCase()}}</div><h1>{{activeTool.name}}</h1><p>{{activeTool.description}}</p></div><mdui-button v-if="current" variant="outlined" class="replace-button" @click="fileInput?.click()"><AppIcon slot="icon" name="upload" :size="17"/>导入图片</mdui-button><mdui-button class="mobile-params" variant="tonal" @click="paramsOpen=true"><AppIcon slot="icon" name="settings" :size="17"/>调整参数</mdui-button></div>
        <div v-if="error" class="error-banner" role="alert"><AppIcon name="info" :size="19"/><span>{{error}}</span><button aria-label="关闭错误提示" @click="error=''"><AppIcon name="close" :size="17"/></button></div>
        <section v-if="!current" class="empty-workspace" aria-label="导入图像">
          <div class="empty-topline"><span class="micro-label">A LITTLE MORE POSSIBILITY</span><span class="tiny-cross">+</span></div>
          <div class="empty-illustration" aria-hidden="true"><div class="image-sheet sheet-back"><span/></div><div class="image-sheet sheet-front"><svg viewBox="0 0 280 200" fill="none"><rect width="280" height="200" fill="#d7e2d9"/><circle cx="205" cy="51" r="23" fill="#f2ddb7"/><path d="M0 156 73 57l83 104 49-62 75 84v17H0Z" fill="#91ac9a"/><path d="m0 197 105-92 84 95H0Z" fill="#557b64"/><path d="m124 200 93-70 63 40v30Z" fill="#355f49"/></svg><span class="sheet-caption"><i/>MAKE ROOM FOR DETAIL</span></div><span class="illustration-spark">✳</span><span class="illustration-corner">↗</span></div>
          <h2>{{activeTool.title}}</h2><p class="empty-description">一张图像，无限可能。把它交给工坊，<br class="desktop-break"/>从这里开始下一次创作。</p>
          <button class="upload-zone" @click="fileInput?.click()" :disabled="loadingImage"><span class="upload-symbol"><AppIcon name="upload" :size="24"/></span><strong>{{loadingImage?'正在读取图片…':'点击上传，或将图片拖到这里'}}</strong><span>PNG、JPEG、WebP <i>·</i> 也可直接粘贴图片</span></button>
          <button class="demo-button" @click="demo">暂时没有图片？<span>试试示例 <AppIcon name="arrow" :size="15"/></span></button>
          <div class="empty-footer"><AppIcon name="shield" :size="15"/><span>图片不上传服务器，所有处理在本地完成</span></div>
        </section>
        <template v-else>
          <div class="file-strip"><div><AppIcon name="image" :size="17"/><strong :title="filename">{{filename}}</strong><span>{{current.width}} × {{current.height}}</span><span v-if="steps" class="step-badge">已应用 {{steps}} 步</span></div><button class="text-action" @click="reset"><AppIcon name="reset" :size="15"/>恢复原图</button></div>
          <ImageViewport v-if="before" :before="before" :after="after" :version="previewVersion" :width="displaySize[0]!" :height="displaySize[1]!" :compare="compare" :mask="tool==='cutout'&&showMask" @replace="fileInput?.click()"/>
          <div class="result-toolbar"><label class="switch-label"><mdui-switch v-control-label aria-label="前后对比" :checked="compare" @change="compare=($event.target as HTMLInputElement).checked"/>前后对比</label><span v-if="tool==='tone'" class="result-detail"><span class="status-dot"/>{{toneBackend}} 实时预览 · 原尺寸导出</span><span v-else-if="resultInfo" class="result-detail">{{prettyBackend(resultInfo.backend)}} · {{(resultInfo.ms/1000).toFixed(2)}} s</span><span v-else class="result-detail">参数就绪后，点击右侧开始处理</span><mdui-button v-if="canExport" variant="text" :disabled="busy" @click="applyResult">作为下一步输入<AppIcon slot="end-icon" name="arrow" :size="16"/></mdui-button></div>
        </template>
        <div class="workspace-footer"><span><i class="status-dot"/>{{prettyBackend(selectedBackend)}} 就绪</span><span>小而专注，处理好每一张图。</span></div>
      </main>
      <div v-if="paramsOpen" class="params-backdrop" @click="paramsOpen=false"/>
      <aside class="parameters" :class="{'mobile-open':paramsOpen}" aria-label="处理参数"><div class="parameters-title"><span>调整参数</span><mdui-button-icon v-control-label class="close-params" aria-label="关闭参数面板" @click="paramsOpen=false"><AppIcon name="close"/></mdui-button-icon><span class="parameter-symbol">↗</span></div>
        <div class="parameter-scroll">
          <div v-show="tool==='upscale'">
            <section class="parameter-section"><h2><span>01</span>选择模型</h2><mdui-select label="超分模型" :value="model" :disabled="busy" @change="model=($event.target as HTMLSelectElement).value as UpscaleModel"><mdui-menu-item v-for="(item,key) in modelMeta" :key="key" :value="key">{{item.name}}</mdui-menu-item></mdui-select><p class="model-description">{{modelMeta[model].description}}</p><span class="model-size">{{modelMeta[model].size}}</span></section>
            <section class="parameter-section"><h2><span>02</span>输出倍率</h2><div class="scale-presets"><button v-for="n in [1,2,3,4]" :key="n" :class="{selected:scale===n}" :disabled="busy" @click="scale=n">{{n}}<span>×</span></button></div><div class="scale-value-row"><label for="scale-input">自定义倍率</label><input id="scale-input" data-testid="scale-input" type="number" min="1" max="4" step=".1" :value="scale" :disabled="busy" @change="updateNumber('scale',$event)"/><span>倍</span></div><div class="output-dimensions"><span>输出尺寸</span><strong>{{current?dimensions:'— × —'}}</strong></div><p class="field-help">支持 1～4 倍。非原生倍率会在超分后进行高质量重采样。</p></section>
          </div>
          <div v-show="tool==='tone'">
            <section class="parameter-section curve-section"><h2><span>01</span>色彩曲线<button class="text-action" @click="curves={...curves,[curve]:defaultPoints(curve)}"><AppIcon name="reset" :size="14"/>重置</button></h2><div class="curve-channels"><button v-for="key in curveKeys.slice(0,4)" :key="key" :class="['channel-'+key,{selected:curve===key}]" @click="curve=key">{{curveLabels[key]}}</button></div><div class="hue-channels"><button v-for="key in curveKeys.slice(4)" :key="key" :class="{selected:curve===key}" @click="curve=key">{{curveLabels[key]}}</button></div><CurveEditor :key="curve" :points="curves[curve]" :kind="curve" :histogram="histogram" @change="changeCurve"/><p class="curve-description">{{['hue','saturation','lightness'].includes(curve)?'横轴选择颜色范围，纵轴调整该范围的'+curveLabels[curve]+'。中线为原始值。':'左侧是暗部，右侧是亮部。向上提亮，向下压暗。'}}</p></section>
            <section class="parameter-section"><h2><span>02</span>快速开始</h2><div class="tone-presets"><button @click="curves=defaultCurves()">原始色彩</button><button @click="curves={...defaultCurves(),rgb:[{x:0,y:0},{x:.25,y:.17},{x:.75,y:.84},{x:1,y:1}]}">柔和对比</button><button @click="curves={...defaultCurves(),r:[{x:0,y:.025},{x:.5,y:.54},{x:1,y:1}],b:[{x:0,y:0},{x:.5,y:.46},{x:1,y:.96}]}">暖意</button></div><p class="field-help">调节即时生效。导出时按原始尺寸渲染。</p></section>
          </div>
          <div v-show="tool==='cutout'">
            <section class="parameter-section"><h2><span>01</span>自动识别</h2><div class="cutout-model"><span class="model-icon"><AppIcon name="cut" :size="23"/></span><div><strong>U²-Net · 轻量版</strong><span>4.57 MB · 主要前景提取</span></div><span class="small-badge">本地</span></div><p class="field-help">适合人像、商品和主体明确的图片。复杂发丝、透明物体与相近背景可能需要进一步修整。</p></section>
            <section class="parameter-section"><h2><span>02</span>优化边缘</h2><div class="slider-label"><label>边缘收缩 / 扩张</label><span>{{maskOptions.shift>0?'+':''}}{{maskOptions.shift}} px</span></div><mdui-slider v-control-label aria-label="边缘收缩或扩张" :min="-20" :max="20" :step="1" :value="maskOptions.shift" @input="updateNumber('shift',$event)"/><div class="slider-label"><label>边缘羽化</label><span>{{maskOptions.feather}} px</span></div><mdui-slider v-control-label aria-label="边缘羽化" :min="0" :max="20" :step="1" :value="maskOptions.feather" @input="updateNumber('feather',$event)"/><label class="switch-label option-switch"><span>反选前景</span><mdui-switch v-control-label aria-label="反选前景" :checked="maskOptions.invert" @change="maskOptions={...maskOptions,invert:($event.target as HTMLInputElement).checked}"/></label><label class="switch-label option-switch"><span>查看黑白遮罩</span><mdui-switch v-control-label aria-label="查看黑白遮罩" :checked="showMask" :disabled="!rawMask" @change="showMask=($event.target as HTMLInputElement).checked"/></label><button class="text-action reset-mask" @click="maskOptions=defaultMaskOptions();showMask=false"><AppIcon name="reset" :size="14"/>重置边缘参数</button></section>
          </div>
          <section v-show="tool!=='tone'" class="parameter-section backend-section"><h2><span>03</span>运行设置</h2><mdui-select label="计算后端" :value="backend" :disabled="busy" @change="backend=($event.target as HTMLSelectElement).value as Backend|'auto'"><mdui-menu-item value="auto">自动选择 · 优先 WebGPU</mdui-menu-item><mdui-menu-item value="webgpu" :disabled="!capabilities.webgpu">WebGPU</mdui-menu-item><mdui-menu-item value="webgl" :disabled="!capabilities.webgl">WebGL · 兼容模式</mdui-menu-item><mdui-menu-item value="wasm">WASM · CPU</mdui-menu-item></mdui-select><div v-if="tool==='upscale'" class="tile-setting"><label>分块大小</label><select aria-label="分块大小" :value="tile" :disabled="busy" @change="updateNumber('tile',$event)"><option :value="128">自动 · 128</option><option :value="64">64 · 更省内存</option><option :value="32">32 · 最低内存</option></select></div><p class="field-help">模型按需下载并缓存在本地。首次运行包含下载与编译时间。</p></section>
          <div class="local-note"><AppIcon name="shield" :size="18"/><div><strong>图像留在本地</strong><p>无需注册，也无需上传图片。</p></div></div>
        </div>
        <div class="parameter-actions"><div v-if="busy" class="job-progress" role="status" aria-live="polite"><div><span>{{progressLabel}}</span><strong>{{Math.round(progress*100)}}%</strong></div><mdui-linear-progress :value="progress" :max="1"/></div><mdui-button v-if="busy" full-width variant="outlined" @click="cancel"><AppIcon slot="icon" name="close" :size="17"/>取消处理</mdui-button><mdui-button v-else-if="tool!=='tone'" full-width :disabled="!current||loadingImage" @click="run"><AppIcon slot="icon" :name="tool==='upscale'?'expand':'cut'" :size="18"/>{{tool==='upscale'?'开始超分':'开始抠图'}}<AppIcon slot="end-icon" name="arrow" :size="18"/></mdui-button><mdui-button v-else full-width variant="tonal" :disabled="!current||loadingImage" @click="applyResult"><AppIcon slot="icon" name="check" :size="18"/>应用调整</mdui-button><mdui-button full-width variant="outlined" :disabled="!canExport||busy||loadingImage" @click="openExport"><AppIcon slot="icon" name="download" :size="18"/>导出图像</mdui-button><span class="action-caption">{{current?'创作由你掌控，细节交给工坊。':'先导入一张图片，开始创作。'}}</span></div>
      </aside>
    </div>
    <div v-if="dragging" class="drop-overlay"><AppIcon name="upload" :size="46"/><strong>松开，导入这张图片</strong><span>PNG / JPEG / WebP</span></div>
    <div v-if="notice" class="notice-toast" role="status"><AppIcon name="check" :size="17"/>{{notice}}</div>
    <mdui-dialog :open="exportOpen" headline="导出图像" close-on-overlay-click @closed="exportOpen=false"><div class="export-fields"><mdui-text-field label="文件名" :value="exportName" @input="exportName=($event.target as HTMLInputElement).value"/><mdui-select label="文件格式" :value="exportFormat" @change="exportFormat=($event.target as HTMLSelectElement).value"><mdui-menu-item value="image/png">PNG · 无损，保留透明</mdui-menu-item><mdui-menu-item value="image/jpeg">JPEG · 适合照片</mdui-menu-item><mdui-menu-item value="image/webp">WebP · 保留透明</mdui-menu-item></mdui-select><template v-if="exportFormat!=='image/png'"><div class="slider-label"><label>图像质量</label><span>{{Math.round(quality*100)}}%</span></div><mdui-slider v-control-label aria-label="导出质量" :min=".1" :max="1" :step=".01" :value="quality" @input="updateNumber('quality',$event)"/></template><label v-if="exportFormat==='image/jpeg'" class="background-color">透明区域背景色<input type="color" v-model="background"/></label><p class="field-help">{{tool==='tone'?'按原始尺寸渲染，保留所有调色细节。':'导出当前处理结果。透明效果请选择 PNG 或 WebP。'}}</p><p v-if="error" class="export-error" role="alert">{{error}}</p></div><mdui-button slot="action" variant="text" :disabled="saving" @click="exportOpen=false">取消</mdui-button><mdui-button slot="action" :loading="saving" :disabled="saving" @click="save">保存到设备</mdui-button></mdui-dialog>
    <mdui-dialog :open="infoOpen" headline="关于像素工坊" close-on-overlay-click @closed="infoOpen=false"><div class="about-content"><p>一组小而专注的本地图像工具。使用 mdui 2 构建，推理由你的设备完成。</p><div class="about-device"><span>图形设备</span><strong>{{gpuName}}</strong></div><div class="cache-row"><span>模型本地缓存<strong>{{cacheSize}}</strong></span><mdui-button variant="outlined" :disabled="busy" @click="clearCache">清理缓存</mdui-button></div><p class="field-help">WebGL 为兼容后端。性能受浏览器、驱动、图片尺寸和模型影响。支持的输出上限：{{limits.edge}} 像素单边 / {{limits.pixels/1e6}} 百万像素。</p><div class="license-links"><a :href="`${baseUrl}licenses/cugan.txt`" target="_blank" rel="noopener">RealCUGAN · MIT ↗</a><a :href="`${baseUrl}licenses/esrgan.txt`" target="_blank" rel="noopener">Real-ESRGAN · BSD ↗</a><a :href="`${baseUrl}licenses/u2net.txt`" target="_blank" rel="noopener">U²-Net · Apache 2.0 ↗</a></div></div><mdui-button slot="action" @click="infoOpen=false">知道了</mdui-button></mdui-dialog>
  </div>
</template>
