<script setup lang="ts">
import { computed, ref } from 'vue';
import { curveLut, clamp } from '../core/curves';
import type { Point, CurveKey } from '../core/curves';
import AppIcon from './AppIcon.vue';
const props=defineProps<{points: Point[];kind: CurveKey;histogram?: number[]}>();
const emit=defineEmits<{change:[points:Point[]]}>();
const selected=ref(0),dragging=ref(false),svg=ref<SVGSVGElement>();
const periodic=computed(()=>['hue','saturation','lightness'].includes(props.kind));
const current=computed(()=>props.points[Math.min(selected.value,props.points.length-1)]!);
const line=computed(()=>{const lut=curveLut(props.points,periodic.value);return Array.from({length:257},(_,i)=>`${i?'L':'M'}${32+i/256*256},${264-lut[Math.round(i/256*1023)]!*240}`).join(' ');});
const histPath=computed(()=>props.histogram?.map((v,i)=>`${i?'L':'M'}${32+i/(props.histogram!.length-1)*256},${264-v*170}`).join(' ')+' L288,264 L32,264Z');
const color=computed(()=>({r:'#ba5c57',g:'#548269',b:'#587ab0'}[props.kind as 'r'|'g'|'b']||'rgb(var(--mdui-color-primary))'));
function update(index:number,x:number,y:number){
  const points=props.points.map(p=>({...p}));
  x=index===0?0:index===points.length-1?1:clamp(x,points[index-1]!.x+.005,points[index+1]!.x-.005);
  points[index]={x,y:clamp(y)};
  if(periodic.value&&(index===0||index===points.length-1))points[index===0?points.length-1:0]!.y=clamp(y);
  emit('change',points);
}
function coordinates(event:PointerEvent){const rect=svg.value!.getBoundingClientRect();return {x:clamp(((event.clientX-rect.left)/rect.width*320-32)/256),y:clamp((264-(event.clientY-rect.top)/rect.height*296)/240)};}
function start(event:PointerEvent,index?:number){
  if(event.button!==0)return;
  const p=coordinates(event);
  if(index===undefined){
    const nearest=props.points.findIndex(point=>Math.abs(point.x-p.x)<.025&&Math.abs(point.y-p.y)<.045);
    if(nearest>=0)index=nearest;
    else{const points=props.points.map(point=>({...point}));index=points.findIndex(point=>point.x>p.x);if(index<1||p.x-points[index-1]!.x<.005||points[index]!.x-p.x<.005)return;points.splice(index,0,p);emit('change',points);}
  }
  selected.value=index;dragging.value=true;svg.value!.setPointerCapture(event.pointerId);event.preventDefault();
}
function move(event:PointerEvent){if(!dragging.value)return;const p=coordinates(event);update(selected.value,p.x,p.y);}
function remove(){if(selected.value===0||selected.value>=props.points.length-1)return;emit('change',props.points.filter((_,i)=>i!==selected.value));selected.value=Math.max(0,selected.value-1);}
function key(event:KeyboardEvent,index:number){selected.value=index;const p=props.points[index]!,step=event.shiftKey?.05:.01;if(event.key==='Delete'||event.key==='Backspace')remove();else if(event.key.startsWith('Arrow')){event.preventDefault();update(index,p.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),p.y+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0));}}
const xValue=computed(()=>Math.round(current.value.x*(periodic.value?360:255)));
const yValue=computed(()=>props.kind==='hue'?Math.round((current.value.y-.5)*360):props.kind==='saturation'?Number((current.value.y*2).toFixed(2)):props.kind==='lightness'?Math.round((current.value.y-.5)*100):Math.round(current.value.y*255));
function numeric(axis:'x'|'y',event:Event){const value=Number((event.target as HTMLInputElement).value);if(!Number.isFinite(value))return;let x=current.value.x,y=current.value.y;if(axis==='x')x=value/(periodic.value?360:255);else y=props.kind==='hue'?value/360+.5:props.kind==='saturation'?value/2:props.kind==='lightness'?value/100+.5:value/255;update(selected.value,x,y);}
</script>
<template>
  <div class="curve-editor">
    <svg ref="svg" class="curve-graph" viewBox="0 0 320 296" @pointerdown="start($event)" @pointermove="move" @pointerup="dragging=false" @pointercancel="dragging=false" role="group" :aria-label="`${kind} 曲线编辑器，点击添加控制点，方向键移动，Delete 删除`">
      <defs><linearGradient id="hue-axis"><stop offset="0" stop-color="#e66f6a"/><stop offset=".17" stop-color="#d5bd65"/><stop offset=".33" stop-color="#81b77b"/><stop offset=".5" stop-color="#69b7bb"/><stop offset=".67" stop-color="#7b8bd2"/><stop offset=".83" stop-color="#bf7fb5"/><stop offset="1" stop-color="#e66f6a"/></linearGradient></defs>
      <rect x="32" y="24" width="256" height="240" rx="2" fill="rgb(var(--mdui-color-surface-container))"/>
      <path v-if="histogram?.length" :d="histPath" fill="rgb(var(--mdui-color-primary))" opacity=".11"/>
      <g stroke="rgb(var(--mdui-color-outline-variant))" stroke-width="1"><path v-for="i in [0,1,2,3,4]" :key="i" :d="`M${32+i*64} 24V264 M32 ${24+i*60}H288`"/></g>
      <path :d="periodic?'M32 144H288':'M32 264L288 24'" stroke="rgb(var(--mdui-color-on-surface-variant))" stroke-dasharray="3 5" opacity=".4"/>
      <path :d="line" :stroke="color" fill="none" stroke-width="2.4" pointer-events="none"/>
      <circle v-for="(p,index) in points" :key="index" :cx="32+p.x*256" :cy="264-p.y*240" :r="index===selected?6:4.5" :fill="index===selected?color:'rgb(var(--mdui-color-surface))'" :stroke="color" stroke-width="2" tabindex="0" role="slider" :aria-label="`控制点 ${index+1}`" :aria-valuenow="Math.round(p.y*255)" :aria-valuemin="0" :aria-valuemax="255" @pointerdown.stop="start($event,index)" @keydown="key($event,index)" @focus="selected=index" @dblclick.stop="selected=index;remove()"/>
      <rect x="32" y="275" width="256" height="5" rx="2" :fill="periodic?'url(#hue-axis)':'rgb(var(--mdui-color-outline-variant))'"/>
      <text x="23" y="268" text-anchor="end" class="graph-text">0</text><text x="23" y="29" text-anchor="end" class="graph-text">1</text>
    </svg>
    <div class="point-values">
      <mdui-text-field v-control-label aria-label="控制点输入值" :label="periodic?'色相':'输入'" type="number" :min="0" :max="periodic?360:255" :step="1" :value="String(xValue)" :disabled="selected===0||selected===points.length-1" @change="numeric('x',$event)"/>
      <mdui-text-field v-control-label aria-label="控制点输出值" :label="kind==='hue'?'偏移 °':kind==='saturation'?'增益 ×':kind==='lightness'?'偏移 %':'输出'" type="number" :min="kind==='hue'?-180:kind==='lightness'?-50:0" :max="kind==='hue'?180:kind==='saturation'?2:kind==='lightness'?50:255" :step="kind==='saturation'?.01:1" :value="String(yValue)" @change="numeric('y',$event)"/>
      <mdui-tooltip content="删除控制点"><mdui-button-icon v-control-label aria-label="删除控制点" :disabled="selected===0||selected>=points.length-1" @click="remove"><AppIcon name="trash"/></mdui-button-icon></mdui-tooltip>
    </div>
  </div>
</template>
