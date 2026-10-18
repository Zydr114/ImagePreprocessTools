<script setup lang="ts">
import '@mdui/icons/auto-fix-high.js';
import '@mdui/icons/show-chart.js';
import '@mdui/icons/content-cut.js';
import '@mdui/icons/file-upload.js';
import '@mdui/icons/image.js';
import '@mdui/icons/file-download.js';
import '@mdui/icons/arrow-forward.js';
import '@mdui/icons/check.js';
import '@mdui/icons/palette.js';
import '@mdui/icons/info--outlined.js';
import '@mdui/icons/restart-alt.js';
import '@mdui/icons/add.js';
import '@mdui/icons/remove.js';
import '@mdui/icons/fit-screen.js';
import '@mdui/icons/close.js';
import '@mdui/icons/tune.js';
import '@mdui/icons/delete-outline.js';
import '@mdui/icons/compare-arrows.js';
import '@mdui/icons/light-mode.js';
import '@mdui/icons/dark-mode.js';
import '@mdui/icons/brightness-auto.js';
import '@mdui/icons/circle.js';
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 24 });
const icons: Record<string,string> = {
  expand:'auto-fix-high',curves:'show-chart',cut:'content-cut',upload:'file-upload',image:'image',
  download:'file-download',arrow:'arrow-forward',check:'check',palette:'palette',info:'info--outlined',
  reset:'restart-alt',plus:'add',minus:'remove',fit:'fit-screen',close:'close',settings:'tune',trash:'delete-outline',
  compare:'compare-arrows',sun:'light-mode',moon:'dark-mode',auto:'brightness-auto',circle:'circle',
};
</script>
<template><component :is="`mdui-icon-${icons[name] || 'image'}`" :style="{fontSize:`${size}px`}" aria-hidden="true"/></template>
