<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });
const paths: Record<string,string> = {
  expand:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8l-5-5m13 5 5-5M8 16l-5 5m13-5 5 5',
  curves:'M4 3v17h17M5 17C14 17 8 6 20 5',
  cut:'m4 4 7 7m3 3 6 6M4 20l16-16M4.5 9A3.5 3.5 0 1 0 4.5 2a3.5 3.5 0 0 0 0 7Zm0 13a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  upload:'M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  image:'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 14 6-6 4 4 3-3 5 5M16 7h.01',
  download:'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
  arrow:'M4 12h16m-6-6 6 6-6 6',
  check:'m5 12 4 4L19 6',
  shield:'m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5l8-3Zm-4 10 3 3 5-6',
  sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19',
  moon:'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10Z',
  info:'M12 8h.01M12 11v6M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
  reset:'M3 10a9 9 0 1 1 1 7M3 4v6h6',
  plus:'M12 5v14M5 12h14',
  minus:'M5 12h14',
  fit:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8Z',
  close:'m6 6 12 12M6 18 18 6',
  play:'m8 4 13 8-13 8V4Z',
  chevron:'m9 5 7 7-7 7',
  settings:'M4 7h16M4 17h16M8 4v6m8 4v6',
  trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
};
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.image" /></svg></template>
