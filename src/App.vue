<script setup lang="ts">
import { ref,shallowRef,computed,watch,onMounted,onBeforeUnmount } from 'vue';
import { setColorScheme } from 'mdui/functions/setColorScheme.js';
import { setTheme } from 'mdui/functions/setTheme.js';
import AppIcon from './components/AppIcon.vue';
import logoUrl from '../assets/logo.png';
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
const sourceUrl=`https://github.com/Zydr114/ImagePreprocessTools/tree/${import.meta.env.VITE_SOURCE_REF||'main'}`;
function dragLeave(event:DragEvent){if(!(event.relatedTarget instanceof Node)||!(event.currentTarget as HTMLElement).contains(event.relatedTarget))dragging.value=false;}
type Tool='upscale'|'tone'|'cutout';
const tools=[{id:'upscale' as Tool,name:'图像超分',icon:'expand'},
  {id:'tone' as Tool,name:'曲线调色',icon:'curves'},
  {id:'cutout' as Tool,name:'智能抠图',icon:'cut'}];
const tool=ref<Tool>('upscale'),activeTool=computed(()=>tools.find(t=>t.id===tool.value)!);
const fileInput=ref<HTMLInputElement>(),filename=ref(''),current=shallowRef<PixelImage>(),original=shallowRef<PixelImage>();
const before=shallowRef<HTMLCanvasElement>(),thumbnail=shallowRef<PixelImage>(),processed=shallowRef<PixelImage>(),resultCanvas=shallowRef<HTMLCanvasElement>(),liveCanvas=shallowRef<HTMLCanvasElement>();
const rawMask=shallowRef<Mask>(),resultInfo=shallowRef<ProcessResult>();
const curves=ref<Curves>(defaultCurves()),curve=ref<CurveKey>('rgb'),maskOptions=ref<MaskOptions>(defaultMaskOptions());
const previewVersion=ref(0),toneBackend=ref('WebGL2'),showMask=ref(false),compare=ref(true),paramsOpen=ref(false),dragging=ref(false);
const model=ref<UpscaleModel>('realcugan'),scale=ref(2),tile=ref(128),backend=ref<Backend|'auto'>('auto');
const capabilities=ref({webgpu:false,webgl:false}),gpuName=ref('正在检测图形能力'),busy=ref(false),loadingImage=ref(false),progress=ref(0),progressLabel=ref(''),error=ref(''),notice=ref('');
const exportOpen=ref(false),infoOpen=ref(false),exportFormat=ref('image/png'),quality=ref(.92),background=ref('#ffffff'),exportName=ref(''),saving=ref(false);
const compactParams=ref(matchMedia('(max-width:1199px)').matches),compactNav=ref(matchMedia('(max-width:599px)').matches);
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
type ThemeMode='light'|'dark'|'auto';
const storedMode=localStorage.getItem('pixel-workshop-theme');
const themeMode=ref<ThemeMode>(storedMode==='light'||storedMode==='dark'?storedMode:'auto');
const storedSeed=localStorage.getItem('pixel-workshop-seed');
const themeSeed=ref(storedSeed&&/^#[0-9a-f]{6}$/i.test(storedSeed)?storedSeed:'#fb7916');
const seedDraft=ref(themeSeed.value),themeOpen=ref(false),seedError=ref(false);
const seedPresets=[{name:'紫色',value:'#6750a4'},{name:'蓝色',value:'#0061a4'},{name:'青色',value:'#006874'},{name:'绿色',value:'#386a20'},{name:'橙色',value:'#fb7916'},{name:'粉色',value:'#984061'}];
const validHex=(value:string)=>/^#[0-9a-f]{6}$/i.test(value);
function chooseScale(event:Event){
  const group=event.target as HTMLElement&{value:string},value=Number(group.value);
  if([1,2,3,4].includes(value))scale.value=value;
  else group.value=[1,2,3,4].includes(scale.value)?String(scale.value):'';
}
function chooseMode(event:Event){
  const group=event.target as HTMLElement&{value:string};
  if(['light','dark','auto'].includes(group.value))themeMode.value=group.value as ThemeMode;
  else group.value=themeMode.value;
}
function applySeed(value=seedDraft.value){
  const hex=value.trim().replace(/^#?/,'#');
  if(!validHex(hex)){seedError.value=true;return;}
  themeSeed.value=hex.toLowerCase();seedDraft.value=themeSeed.value;seedError.value=false;
  setColorScheme(themeSeed.value);localStorage.setItem('pixel-workshop-seed',themeSeed.value);
}
watch(themeMode,value=>{setTheme(value);localStorage.setItem('pixel-workshop-theme',value);});
watch(themeOpen,value=>{if(value){seedDraft.value=themeSeed.value;seedError.value=false;}});
async function cacheInfo(){const cache=await caches.open(CACHE_NAME);let total=0;for(const key of await cache.keys()){const response=await cache.match(key);if(response)total+=(await response.blob()).size;}cacheSize.value=(total/1e6).toFixed(1)+' MB';}
async function clearCache(){if(busy.value)return;await caches.delete(CACHE_NAME);await cacheInfo();flash('模型缓存已清理，下次运行时会重新下载');}
function paste(event:ClipboardEvent){const file=Array.from(event.clipboardData?.files||[]).find(f=>f.type.startsWith('image/'));if(file){event.preventDefault();void importFile(file);}}
function shortcut(event:KeyboardEvent){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='o'){event.preventDefault();fileInput.value?.click();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();openExport();}if(event.key==='Escape'){if(busy.value)cancel();paramsOpen.value=false;}}
const media=matchMedia('(max-width:700px)'),parameterMedia=matchMedia('(max-width:1199px)'),navMedia=matchMedia('(max-width:599px)');
const resizeDevice=()=>{mobile.value=media.matches;compactParams.value=parameterMedia.matches;compactNav.value=navMedia.matches;};
onMounted(async()=>{
  setColorScheme(themeSeed.value);setTheme(themeMode.value);
  document.addEventListener('paste',paste);document.addEventListener('keydown',shortcut);media.addEventListener('change',resizeDevice);parameterMedia.addEventListener('change',resizeDevice);navMedia.addEventListener('change',resizeDevice);
  try{const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');capabilities.value.webgl=!!gl;const info=gl?.getExtension('WEBGL_debug_renderer_info');gpuName.value=gl&&info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'CPU 兼容模式';gl?.getExtension('WEBGL_lose_context')?.loseContext();const adapter=await navigator.gpu?.requestAdapter();capabilities.value.webgpu=!!adapter;if(adapter)gpuName.value=adapter.info.description||`${adapter.info.vendor} ${adapter.info.architecture}`;}catch{gpuName.value='将按浏览器能力选择后端';}
});
watch(infoOpen,value=>{if(value)void cacheInfo();});
onBeforeUnmount(()=>{client.cancel();toneRenderer?.dispose();cancelAnimationFrame(previewFrame);clearTimeout(noticeTimer);document.removeEventListener('paste',paste);document.removeEventListener('keydown',shortcut);media.removeEventListener('change',resizeDevice);parameterMedia.removeEventListener('change',resizeDevice);navMedia.removeEventListener('change',resizeDevice);});
</script>

<template>
  <div class="application" @dragover.prevent="dragging=true" @dragleave="dragLeave" @drop.prevent="dragging=false;importFile($event.dataTransfer?.files[0])">
    <input ref="fileInput" class="visually-hidden" aria-label="选择图片文件" type="file" accept="image/png,image/jpeg,image/webp" @change="importFile(($event.target as HTMLInputElement).files?.[0])"/>
    <mdui-layout full-height>
      <mdui-top-app-bar :order="0">
        <img class="app-logo" :src="logoUrl" alt="" width="32" height="32"/><mdui-top-app-bar-title title="ImagePreprocessTools">ImagePreprocessTools</mdui-top-app-bar-title>
        <mdui-tooltip content="外观与主题色"><mdui-button-icon v-control-label aria-label="外观与主题色" @click="themeOpen=true"><AppIcon name="palette"/></mdui-button-icon></mdui-tooltip>
        <mdui-tooltip content="设备与模型缓存"><mdui-button-icon v-control-label aria-label="设备与模型缓存" @click="infoOpen=true"><AppIcon name="info"/></mdui-button-icon></mdui-tooltip>
      </mdui-top-app-bar>
      <mdui-navigation-rail v-if="!compactNav" :order="1" :value="tool" aria-label="图像处理工具">
        <mdui-navigation-rail-item v-for="item in tools" :key="item.id" :value="item.id" role="button" :aria-label="item.name" :aria-current="tool===item.id?'page':undefined" @click="tool=item.id;paramsOpen=false" @keydown.enter="tool=item.id" @keydown.space.prevent="tool=item.id">
          <AppIcon slot="icon" :name="item.icon"/><AppIcon slot="active-icon" :name="item.icon"/>{{item.name}}
        </mdui-navigation-rail-item>
      </mdui-navigation-rail>
      <mdui-navigation-bar v-else :order="1" :value="tool" aria-label="图像处理工具">
        <mdui-navigation-bar-item v-for="item in tools" :key="item.id" :value="item.id" role="button" :aria-label="item.name" :aria-current="tool===item.id?'page':undefined" @click="tool=item.id;paramsOpen=false" @keydown.enter="tool=item.id" @keydown.space.prevent="tool=item.id">
          <AppIcon slot="icon" :name="item.icon"/><AppIcon slot="active-icon" :name="item.icon"/>{{item.name}}
        </mdui-navigation-bar-item>
      </mdui-navigation-bar>
      <mdui-navigation-drawer class="parameters" placement="right" :order="2" :modal="compactParams" :open="!compactParams||paramsOpen" close-on-esc close-on-overlay-click @close.self="paramsOpen=false">
        <aside class="parameter-content" aria-label="处理参数">
          <div class="parameters-title"><h2>调整参数</h2><mdui-button-icon v-if="compactParams" v-control-label aria-label="关闭参数面板" @click="paramsOpen=false"><AppIcon name="close"/></mdui-button-icon></div>
          <div class="parameter-scroll">
            <div v-show="tool==='upscale'" class="tool-fields">
              <section class="parameter-section">
                <h3>超分模型</h3>
                <mdui-select v-control-label label="超分模型" :value="model" :disabled="busy" @change="model=($event.target as HTMLSelectElement).value as UpscaleModel"><mdui-menu-item v-for="(item,key) in modelMeta" :key="key" :value="key">{{item.name}}</mdui-menu-item></mdui-select>
                <span class="supporting-text">{{modelMeta[model].size}}</span>
              </section>
              <mdui-divider/>
              <section class="parameter-section">
                <h3>输出倍率</h3>
                <mdui-segmented-button-group class="scale-presets" selects="single" :value="String(scale)" full-width :disabled="busy" @change="chooseScale($event)">
                  <mdui-segmented-button v-for="n in [1,2,3,4]" :key="n" :value="String(n)">{{n}}×</mdui-segmented-button>
                </mdui-segmented-button-group>
                <mdui-text-field v-control-label label="自定义倍率" type="number" :min="1" :max="4" :step=".1" suffix="×" :value="String(scale)" :disabled="busy" data-testid="scale-input" @change="updateNumber('scale',$event)"/>
                <div class="output-dimensions"><span>输出尺寸</span><span>{{current?dimensions:'—'}}</span></div>
              </section>
              <mdui-divider/>
            </div>
            <div v-show="tool==='tone'" class="tool-fields">
              <section class="parameter-section curve-section">
                <div class="section-heading"><h3>色彩曲线</h3><mdui-tooltip content="重置当前曲线"><mdui-button-icon v-control-label aria-label="重置当前曲线" @click="curves={...curves,[curve]:defaultPoints(curve)}"><AppIcon name="reset"/></mdui-button-icon></mdui-tooltip></div>
                <mdui-select v-control-label label="颜色通道" :value="curve" @change="curve=($event.target as HTMLSelectElement).value as CurveKey"><mdui-menu-item v-for="key in curveKeys" :key="key" :value="key">{{curveLabels[key]}}</mdui-menu-item></mdui-select>
                <CurveEditor :key="curve" :points="curves[curve]" :kind="curve" :histogram="histogram" @change="changeCurve"/>
              </section>
              <mdui-divider/>
              <section class="parameter-section">
                <h3>预设</h3>
                <div class="tone-presets">
                  <mdui-chip @click="curves=defaultCurves()">原始色彩</mdui-chip>
                  <mdui-chip @click="curves={...defaultCurves(),rgb:[{x:0,y:0},{x:.25,y:.17},{x:.75,y:.84},{x:1,y:1}]}">柔和对比</mdui-chip>
                  <mdui-chip @click="curves={...defaultCurves(),r:[{x:0,y:.025},{x:.5,y:.54},{x:1,y:1}],b:[{x:0,y:0},{x:.5,y:.46},{x:1,y:.96}]}">暖意</mdui-chip>
                </div>
              </section>
            </div>
            <div v-show="tool==='cutout'" class="tool-fields">
              <section class="parameter-section"><h3>抠图模型</h3><div class="model-row"><AppIcon name="cut"/><span>U²-Net 轻量版</span><span class="supporting-text">4.57 MB</span></div></section>
              <mdui-divider/>
              <section class="parameter-section">
                <h3>优化边缘</h3>
                <div class="slider-field"><div class="slider-label"><span>边缘收缩 / 扩张</span><output>{{maskOptions.shift>0?'+':''}}{{maskOptions.shift}} px</output></div><mdui-slider v-control-label aria-label="边缘收缩或扩张" :min="-20" :max="20" :step="1" :value="maskOptions.shift" @input="updateNumber('shift',$event)"/></div>
                <div class="slider-field"><div class="slider-label"><span>边缘羽化</span><output>{{maskOptions.feather}} px</output></div><mdui-slider v-control-label aria-label="边缘羽化" :min="0" :max="20" :step="1" :value="maskOptions.feather" @input="updateNumber('feather',$event)"/></div>
                <label class="switch-label option-switch"><span>反选前景</span><mdui-switch v-control-label aria-label="反选前景" :checked="maskOptions.invert" @change="maskOptions={...maskOptions,invert:($event.target as HTMLInputElement).checked}"/></label>
                <label class="switch-label option-switch"><span>查看黑白遮罩</span><mdui-switch v-control-label aria-label="查看黑白遮罩" :checked="showMask" :disabled="!rawMask" @change="showMask=($event.target as HTMLInputElement).checked"/></label>
                <mdui-button variant="text" @click="maskOptions=defaultMaskOptions();showMask=false"><AppIcon slot="icon" name="reset"/>重置边缘参数</mdui-button>
              </section>
              <mdui-divider/>
            </div>
            <section v-show="tool!=='tone'" class="parameter-section backend-section">
              <h3>运行设置</h3>
              <mdui-select v-control-label label="计算后端" :value="backend" :disabled="busy" @change="backend=($event.target as HTMLSelectElement).value as Backend|'auto'"><mdui-menu-item value="auto">自动选择</mdui-menu-item><mdui-menu-item value="webgpu" :disabled="!capabilities.webgpu">WebGPU</mdui-menu-item><mdui-menu-item value="webgl" :disabled="!capabilities.webgl">WebGL</mdui-menu-item><mdui-menu-item value="wasm">WASM · CPU</mdui-menu-item></mdui-select>
              <mdui-select v-control-label v-show="tool==='upscale'" label="分块大小" :value="String(tile)" :disabled="busy" @change="updateNumber('tile',$event)"><mdui-menu-item value="128">128</mdui-menu-item><mdui-menu-item value="64">64</mdui-menu-item><mdui-menu-item value="32">32</mdui-menu-item></mdui-select>
            </section>
          </div>
          <div class="parameter-actions">
            <div v-if="busy" class="job-progress" role="status" aria-live="polite"><div><span>{{progressLabel}}</span><span>{{Math.round(progress*100)}}%</span></div><mdui-linear-progress :value="progress" :max="1"/></div>
            <mdui-button v-if="busy" full-width variant="outlined" @click="cancel"><AppIcon slot="icon" name="close"/>取消处理</mdui-button>
            <mdui-button v-else-if="tool!=='tone'" full-width :disabled="!current||loadingImage" @click="run"><AppIcon slot="icon" :name="tool==='upscale'?'expand':'cut'"/>{{tool==='upscale'?'开始超分':'开始抠图'}}</mdui-button>
            <mdui-button v-else full-width :disabled="!current||loadingImage" @click="applyResult"><AppIcon slot="icon" name="check"/>应用调整</mdui-button>
            <mdui-button full-width variant="outlined" :disabled="!canExport||busy||loadingImage" @click="openExport"><AppIcon slot="icon" name="download"/>导出图像</mdui-button>
          </div>
        </aside>
      </mdui-navigation-drawer>
      <mdui-layout-main>
        <main class="workspace">
          <div class="workspace-heading"><h1>{{activeTool.name}}</h1><div class="workspace-actions"><mdui-button v-if="current" variant="text" @click="fileInput?.click()"><AppIcon slot="icon" name="upload"/>导入图片</mdui-button><mdui-button v-if="compactParams" class="mobile-params" variant="tonal" @click="paramsOpen=true"><AppIcon slot="icon" name="settings"/>调整参数</mdui-button></div></div>
          <mdui-card v-if="error&&!exportOpen" variant="filled" class="error-banner" role="alert"><AppIcon name="info"/><span>{{error}}</span><mdui-button-icon v-control-label aria-label="关闭错误提示" @click="error=''"><AppIcon name="close"/></mdui-button-icon></mdui-card>
          <mdui-card v-if="!current" variant="filled" class="empty-workspace" aria-label="导入图像">
            <AppIcon name="image" :size="48"/>
            <h2>导入图片</h2>
            <p class="supporting-text">PNG · JPEG · WebP</p>
            <div class="import-actions"><mdui-button :loading="loadingImage" :disabled="loadingImage" @click="fileInput?.click()"><AppIcon slot="icon" name="upload"/>选择图片</mdui-button><mdui-button class="demo-button" variant="text" @click="demo">试用示例</mdui-button></div>
          </mdui-card>
          <template v-else>
            <div class="file-strip"><div class="file-info"><AppIcon name="image"/><span class="filename" :title="filename">{{filename}}</span><span class="supporting-text">{{current.width}} × {{current.height}}</span><mdui-chip v-if="steps" class="step-badge">已应用 {{steps}} 步</mdui-chip></div><mdui-button variant="text" @click="reset"><AppIcon slot="icon" name="reset"/>恢复原图</mdui-button></div>
            <ImageViewport v-if="before" :before="before" :after="after" :version="previewVersion" :width="displaySize[0]!" :height="displaySize[1]!" :compare="compare" :mask="tool==='cutout'&&showMask"/>
            <div class="result-toolbar"><label class="switch-label"><mdui-switch v-control-label aria-label="前后对比" :checked="compare" @change="compare=($event.target as HTMLInputElement).checked"/><span>前后对比</span></label><span v-if="tool==='tone'" class="result-detail">{{toneBackend}}</span><span v-else-if="resultInfo" class="result-detail">{{prettyBackend(resultInfo.backend)}} · {{(resultInfo.ms/1000).toFixed(2)}} s</span><span v-else class="result-detail">就绪</span><mdui-button v-if="canExport" variant="text" :disabled="busy" @click="applyResult">作为下一步输入<AppIcon slot="end-icon" name="arrow"/></mdui-button></div>
            <div v-if="busy&&compactParams&&!paramsOpen" class="compact-progress" role="status"><span>{{progressLabel}}</span><mdui-linear-progress :value="progress" :max="1"/><mdui-button variant="text" @click="cancel">取消处理</mdui-button></div>
          </template>
        </main>
      </mdui-layout-main>
    </mdui-layout>
    <div v-if="dragging" class="drop-overlay"><AppIcon name="upload" :size="48"/><h2>松开以导入图片</h2></div>
    <mdui-snackbar :open="!!notice" :auto-close-delay="4500" @closed.self="notice=''">{{notice}}</mdui-snackbar>
    <mdui-dialog :open="exportOpen" headline="导出图像" close-on-overlay-click close-on-esc @closed.self="exportOpen=false">
      <div class="dialog-fields export-fields">
        <mdui-text-field v-control-label label="文件名" :value="exportName" @input="exportName=($event.target as HTMLInputElement).value"/>
        <mdui-select v-control-label label="文件格式" :value="exportFormat" @change="exportFormat=($event.target as HTMLSelectElement).value"><mdui-menu-item value="image/png">PNG</mdui-menu-item><mdui-menu-item value="image/jpeg">JPEG</mdui-menu-item><mdui-menu-item value="image/webp">WebP</mdui-menu-item></mdui-select>
        <div v-show="exportFormat!=='image/png'" class="slider-field"><div class="slider-label"><span>图像质量</span><output>{{Math.round(quality*100)}}%</output></div><mdui-slider v-control-label aria-label="导出质量" :min=".1" :max="1" :step=".01" :value="quality" @input="updateNumber('quality',$event)"/></div>
        <mdui-text-field v-control-label v-show="exportFormat==='image/jpeg'" label="透明区域背景色" :value="background" pattern="#[0-9a-fA-F]{6}" helper="#RRGGBB" @input="background=($event.target as HTMLInputElement).value"/>
        <p v-if="error" class="export-error" role="alert">{{error}}</p>
      </div>
      <mdui-button slot="action" variant="text" :disabled="saving" @click="exportOpen=false">取消</mdui-button><mdui-button slot="action" :loading="saving" :disabled="saving||(exportFormat==='image/jpeg'&&!validHex(background))" @click="save">保存到设备</mdui-button>
    </mdui-dialog>
    <mdui-dialog :open="themeOpen" headline="外观与主题色" close-on-overlay-click close-on-esc @closed.self="themeOpen=false">
      <div class="dialog-fields theme-fields">
        <h3>外观</h3>
        <mdui-segmented-button-group selects="single" full-width :value="themeMode" @change="chooseMode($event)"><mdui-segmented-button value="auto"><AppIcon slot="icon" name="auto"/>系统</mdui-segmented-button><mdui-segmented-button value="light"><AppIcon slot="icon" name="sun"/>浅色</mdui-segmented-button><mdui-segmented-button value="dark"><AppIcon slot="icon" name="moon"/>深色</mdui-segmented-button></mdui-segmented-button-group>
        <h3>主题色</h3>
        <div class="seed-presets"><mdui-tooltip v-for="preset in seedPresets" :key="preset.value" :content="preset.name"><mdui-button-icon v-control-label :variant="themeSeed===preset.value?'tonal':'standard'" :aria-label="preset.name+'主题色'" :aria-pressed="themeSeed===preset.value" @click="applySeed(preset.value)"><AppIcon name="circle" :style="{color:preset.value}"/></mdui-button-icon></mdui-tooltip></div>
        <mdui-text-field v-control-label label="自定义主题色" :value="seedDraft" :helper="seedError?'请输入有效的十六进制颜色，如 #FB7916':'#RRGGBB'" pattern="#?[0-9a-fA-F]{6}" @input="seedDraft=($event.target as HTMLInputElement).value;seedError=false" @keydown.enter="applySeed()"/>
        <span v-if="seedError" class="export-error" role="alert">主题色格式无效</span>
      </div>
      <mdui-button slot="action" variant="text" @click="themeOpen=false">完成</mdui-button><mdui-button slot="action" @click="applySeed()">应用颜色</mdui-button>
    </mdui-dialog>
    <mdui-dialog :open="infoOpen" headline="设备与模型缓存" close-on-overlay-click close-on-esc @closed.self="infoOpen=false">
      <div class="dialog-fields"><h3>图形设备</h3><p class="device-info">{{gpuName}}</p><div class="cache-row"><div><h3>模型缓存</h3><span>{{cacheSize}}</span></div><mdui-button variant="outlined" :disabled="busy" @click="clearCache">清理缓存</mdui-button></div><div class="output-dimensions"><span>输出上限</span><span>{{limits.edge}} px / {{limits.pixels/1e6}} MP</span></div><mdui-divider/><h3>项目许可</h3><mdui-button variant="text" :href="sourceUrl" target="_blank" rel="noopener">AGPL-3.0 · 源代码</mdui-button><h3>模型许可</h3><div class="license-links"><mdui-button variant="text" :href="`${baseUrl}licenses/cugan.txt`" target="_blank" rel="noopener">RealCUGAN · MIT</mdui-button><mdui-button variant="text" :href="`${baseUrl}licenses/esrgan.txt`" target="_blank" rel="noopener">Real-ESRGAN · BSD</mdui-button><mdui-button variant="text" :href="`${baseUrl}licenses/u2net.txt`" target="_blank" rel="noopener">U²-Net · Apache 2.0</mdui-button></div></div><mdui-button slot="action" variant="text" @click="infoOpen=false">关闭</mdui-button>
    </mdui-dialog>
  </div>
</template>
