<script setup lang="ts">
import { ref,watch,onMounted,onBeforeUnmount,nextTick } from 'vue';
import AppIcon from './AppIcon.vue';
const props=withDefaults(defineProps<{before:HTMLCanvasElement;after?:HTMLCanvasElement;version?:number;width:number;height:number;compare?:boolean;mask?:boolean}>(),{version:0,compare:true,mask:false});
const container=ref<HTMLElement>(),canvas=ref<HTMLCanvasElement>(),zoom=ref(1),split=ref(50),pan={x:0,y:0};
let width=1,height=1,fit=1,frame=0,observer:ResizeObserver|undefined,pointer:{x:number;y:number;mode:'pan'|'split'}|undefined;
const percent=ref(100);
function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);}
function draw(){
  if(!canvas.value)return;const el=canvas.value,dpr=Math.min(devicePixelRatio||1,2);el.width=Math.round(width*dpr);el.height=Math.round(height*dpr);
  const ctx=el.getContext('2d')!;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  fit=Math.min((width-48)/props.width,(height-48)/props.height,1);fit=Math.max(fit,.001);
  const s=fit*zoom.value,w=props.width*s,h=props.height*s,x=(width-w)/2+pan.x,y=(height-h)/2+pan.y;percent.value=Math.round(s*100);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  const draw=(image:HTMLCanvasElement)=>ctx.drawImage(image,x,y,w,h);
  if(props.after){draw(props.after);if(props.compare){ctx.save();ctx.beginPath();ctx.rect(0,0,width*split.value/100,height);ctx.clip();ctx.clearRect(0,0,width*split.value/100,height);draw(props.before);ctx.restore();}}
  else draw(props.before);
}
function reset(){zoom.value=1;pan.x=pan.y=0;schedule();}
function scale(factor:number){zoom.value=Math.max(.05,Math.min(32,zoom.value*factor));schedule();}
function wheel(event:WheelEvent){event.preventDefault();scale(Math.exp(-event.deltaY*.0015));}
function start(event:PointerEvent,mode:'pan'|'split'){if(event.button!==0)return;pointer={x:event.clientX,y:event.clientY,mode};(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);if(mode==='split')updateSplit(event);}
function updateSplit(event:PointerEvent){const rect=container.value!.getBoundingClientRect();split.value=Math.max(0,Math.min(100,(event.clientX-rect.left)/width*100));schedule();}
function move(event:PointerEvent){if(!pointer)return;if(pointer.mode==='split')updateSplit(event);else{pan.x+=event.clientX-pointer.x;pan.y+=event.clientY-pointer.y;pointer.x=event.clientX;pointer.y=event.clientY;schedule();}}
function splitKey(event:KeyboardEvent){if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();split.value=Math.max(0,Math.min(100,split.value+(event.key==='ArrowRight'?2:-2)));schedule();}}
watch(()=>[props.after,props.version,props.width,props.height,props.compare,props.mask],schedule);
watch(()=>props.before,()=>nextTick(reset));
onMounted(()=>{observer=new ResizeObserver(entries=>{width=entries[0]!.contentRect.width;height=entries[0]!.contentRect.height;schedule();});observer.observe(container.value!);});
onBeforeUnmount(()=>{observer?.disconnect();cancelAnimationFrame(frame);});
</script>
<template>
  <mdui-card variant="outlined" class="viewport-shell">
    <div class="viewport-toolbar">
      <span class="preview-title">{{after?(mask?'遮罩预览':'图像预览'):'原始图像'}}</span>
      <div class="zoom-tools">
        <mdui-tooltip content="缩小"><mdui-button-icon v-control-label aria-label="缩小" @click="scale(1/1.25)"><AppIcon name="minus"/></mdui-button-icon></mdui-tooltip>
        <mdui-button class="zoom-value" variant="text" v-control-label aria-label="以原始像素显示" @click="zoom=1/fit;schedule()">{{percent}}%</mdui-button>
        <mdui-tooltip content="放大"><mdui-button-icon v-control-label aria-label="放大" @click="scale(1.25)"><AppIcon name="plus"/></mdui-button-icon></mdui-tooltip>
        <mdui-tooltip content="适应画布"><mdui-button-icon v-control-label aria-label="适应画布" @click="reset"><AppIcon name="fit"/></mdui-button-icon></mdui-tooltip>
      </div>
    </div>
    <mdui-divider/>
    <div ref="container" class="image-viewport" :class="{'has-comparison':after&&compare}">
      <canvas ref="canvas" aria-label="图像预览画布，可滚轮缩放、拖动平移" @wheel="wheel" @pointerdown="start($event,'pan')" @pointermove="move" @pointerup="pointer=undefined" @pointercancel="pointer=undefined" @dblclick="reset"/>
      <template v-if="after&&compare">
        <span class="compare-label before-label">原图</span><span class="compare-label after-label">{{mask?'遮罩':'处理后'}}</span>
        <div class="split-line" :style="{left:`${split}%`}" @pointerdown.stop="start($event,'split')" @pointermove="move" @pointerup="pointer=undefined" @pointercancel="pointer=undefined">
          <mdui-button-icon v-control-label variant="filled" data-control-role="slider" aria-label="原图与处理后对比分割线" :aria-valuenow="Math.round(split)" :aria-valuemin="0" :aria-valuemax="100" @keydown="splitKey"><AppIcon name="compare"/></mdui-button-icon>
        </div>
      </template>
      <div class="canvas-meta">{{props.width}} × {{props.height}}</div>
    </div>
  </mdui-card>
</template>
