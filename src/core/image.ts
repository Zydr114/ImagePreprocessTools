export interface PixelImage { width: number; height: number; data: Uint8ClampedArray }
export interface ImageLimits { pixels: number; edge: number }
export const desktopLimits: ImageLimits = { pixels: 64_000_000, edge: 8192 };
export const mobileLimits: ImageLimits = { pixels: 16_000_000, edge: 4096 };
export function validateSize(width: number, height: number, limits = desktopLimits): void {
  if (![width,height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('图片尺寸无效。');
  if (width > limits.edge || height > limits.edge || width*height > limits.pixels) {
    throw new Error(`图片尺寸超出当前设备限制：单边 ${limits.edge} 像素，总计 ${(limits.pixels/1e6).toFixed(0)} 百万像素。请缩小图片或降低倍率。`);
  }
}
export function outputSize(width: number, height: number, scale: number, limits = desktopLimits): [number, number] {
  if (!Number.isFinite(scale) || scale < 1 || scale > 4) throw new Error('输出倍率应在 1～4 之间。');
  const w = Math.round(width*scale), h = Math.round(height*scale);
  validateSize(w,h,limits);
  return [w,h];
}

export function imageCanvas(image: PixelImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data),image.width,image.height),0,0);
  return canvas;
}
export async function decodeImage(file: File, limits: ImageLimits): Promise<PixelImage> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 静态图片。');
  if (file.size > 100_000_000) throw new Error('图片文件需小于 100 MB。');
  // Read dimensions before decoding large files; browser decode enforces EXIF orientation.
  const header = new Uint8Array(await file.slice(0,256*1024).arrayBuffer());
  const dimensions = encodedSize(header, file.type);
  if (dimensions) validateSize(...dimensions,limits);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'default' }); }
  catch { throw new Error('无法解码这张图片，请检查文件是否完整。'); }
  try {
    validateSize(bitmap.width,bitmap.height,limits);
    const canvas = new OffscreenCanvas(bitmap.width,bitmap.height), ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap,0,0);
    return { width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0,0,bitmap.width,bitmap.height).data };
  } finally { bitmap.close(); }
}

export function encodedSize(bytes: Uint8Array, mime: string): [number,number] | null {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (mime === 'image/png' && bytes.length >= 24) return [view.getUint32(16),view.getUint32(20)];
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i+9 < bytes.length) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i+1]!;
      if (marker === 0xd8 || marker === 0x01) { i+=2; continue; }
      if (marker === 0xda || marker === 0xd9) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return [view.getUint16(i+7),view.getUint16(i+5)];
      const size = view.getUint16(i+2);
      if (size < 2) break;
      i += 2+size;
    }
  }
  if (mime === 'image/webp' && bytes.length >= 30) {
    const kind = String.fromCharCode(...bytes.slice(12,16));
    if (kind === 'VP8X') return [1+(bytes[24]!|bytes[25]!<<8|bytes[26]!<<16),1+(bytes[27]!|bytes[28]!<<8|bytes[29]!<<16)];
    if (kind === 'VP8 ') return [view.getUint16(26,true)&0x3fff,view.getUint16(28,true)&0x3fff];
    if (kind === 'VP8L') { const bits = view.getUint32(21,true); return [(bits&0x3fff)+1,((bits>>>14)&0x3fff)+1]; }
  }
  return null;
}

export function demoImage(): PixelImage {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 360;
  const c = canvas.getContext('2d')!;
  const sky = c.createLinearGradient(0,0,0,360); sky.addColorStop(0,'#d6e2dc'); sky.addColorStop(1,'#f2e3c9');
  c.fillStyle = sky; c.fillRect(0,0,480,360);
  c.fillStyle = '#eee3c8'; c.beginPath(); c.arc(330,100,42,0,Math.PI*2); c.fill();
  const hill = (points: number[][],color: string) => { c.fillStyle = color; c.beginPath(); points.forEach(([x,y],i)=>i?c.lineTo(x!,y!):c.moveTo(x!,y!)); c.lineTo(480,360); c.lineTo(0,360); c.closePath(); c.fill(); };
  hill([[0,240],[95,114],[180,206],[260,139],[385,260],[480,180]],'#8ca69a');
  hill([[0,286],[150,195],[265,278],[380,219],[480,285]],'#526f60');
  hill([[0,340],[115,265],[245,324],[370,274],[480,332]],'#324e40');
  c.strokeStyle = '#f2e3c9'; c.lineWidth = 2;
  for(let i=0;i<9;i++){c.beginPath();c.moveTo(60+i*38,331);c.lineTo(62+i*38,315-i%3*6);c.stroke();}
  return { width:480,height:360,data:c.getImageData(0,0,480,360).data };
}
