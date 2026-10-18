export type CurveKey = 'rgb' | 'r' | 'g' | 'b' | 'hue' | 'saturation' | 'lightness';
export interface Point { x: number; y: number }
export type Curves = Record<CurveKey, Point[]>;
export const curveKeys: CurveKey[] = ['rgb', 'r', 'g', 'b', 'hue', 'saturation', 'lightness'];
export const curveLabels: Record<CurveKey, string> = { rgb: 'RGB', r: '红', g: '绿', b: '蓝', hue: '色相', saturation: '饱和度', lightness: '明度' };
export const LUT_SIZE = 1024;
export const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));

export function defaultPoints(key: CurveKey): Point[] {
  return key === 'hue' || key === 'saturation' || key === 'lightness'
    ? [{ x: 0, y: .5 }, { x: 1, y: .5 }] : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
}
export function defaultCurves(): Curves {
  return Object.fromEntries(curveKeys.map(key => [key, defaultPoints(key)])) as Curves;
}

/** Shape preserving cubic Hermite interpolation; no ringing past local extrema. */
export function curveLut(points: readonly Point[], periodic = false): Float32Array {
  const n = points.length, h: number[] = [], slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(points[i+1]!.x - points[i]!.x);
    slopes.push((points[i+1]!.y - points[i]!.y) / h[i]!);
  }
  const tangents = new Array<number>(n).fill(0);
  const join = (a: number, b: number, ha: number, hb: number) => {
    if (a * b <= 0) return 0;
    const w1 = 2*hb + ha, w2 = hb + 2*ha;
    return (w1+w2)/(w1/a+w2/b);
  };
  for (let i = 1; i < n-1; i++) tangents[i] = join(slopes[i-1]!, slopes[i]!, h[i-1]!, h[i]!);
  if (periodic) tangents[0] = tangents[n-1] = join(slopes[n-2]!, slopes[0]!, h[n-2]!, h[0]!);
  else {
    // Clamped end slopes retain straight neutral curves and avoid endpoint overshoot.
    tangents[0] = slopes[0]!; tangents[n-1] = slopes[n-2]!;
  }
  let segment = 0;
  const output = new Float32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = i/(LUT_SIZE-1);
    while (segment < n-2 && x > points[segment+1]!.x) segment++;
    const t = clamp((x-points[segment]!.x)/h[segment]!);
    const t2 = t*t, t3 = t2*t;
    output[i] = clamp((2*t3-3*t2+1)*points[segment]!.y + (t3-2*t2+t)*h[segment]!*tangents[segment]!
      + (-2*t3+3*t2)*points[segment+1]!.y + (t3-t2)*h[segment]!*tangents[segment+1]!);
  }
  return output;
}

export function buildLuts(curves: Curves): Float32Array[] {
  return curveKeys.map((key, i) => curveLut(curves[key], i >= 4));
}
export function sampleLut(lut: Float32Array, x: number): number {
  const at = clamp(x)*(LUT_SIZE-1), low = Math.floor(at), high = Math.min(low+1, LUT_SIZE-1);
  return lut[low]!*(1-at+low)+lut[high]!*(at-low);
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min, l = (max+min)/2;
  if (d < 1e-7) return [0,0,l];
  let h = max === r ? (g-b)/d+(g<b?6:0) : max === g ? (b-r)/d+2 : (r-g)/d+4;
  h /= 6;
  return [h,d/(1-Math.abs(2*l-1)),l];
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1-Math.abs(2*l-1))*s, h6 = ((h%1+1)%1)*6, x = c*(1-Math.abs(h6%2-1)), m = l-c/2;
  const rgb = h6<1 ? [c,x,0] : h6<2 ? [x,c,0] : h6<3 ? [0,c,x] : h6<4 ? [0,x,c] : h6<5 ? [x,0,c] : [c,0,x];
  return rgb.map(v=>v+m) as [number,number,number];
}
export function tonePixel(r: number, g: number, b: number, luts: readonly Float32Array[]): [number, number, number] {
  const sample = (i: number, x: number) => sampleLut(luts[i]!, x);
  r = sample(0, sample(1, r)); g = sample(0, sample(2, g)); b = sample(0, sample(3, b));
  let [h,s,l] = rgbToHsl(r,g,b);
  const originalHue = h, t = clamp(s/.1), chroma = t*t*(3-2*t);
  h += (sample(4,originalHue)-.5)*chroma;
  s = clamp(s*sample(5,originalHue)*2);
  l = clamp(l+(sample(6,originalHue)-.5)*chroma);
  return hslToRgb(h,s,l);
}

export function applyTone(data: Uint8ClampedArray, curves: Curves): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length), luts = buildLuts(curves);
  for (let i = 0; i < data.length; i+=4) {
    const rgb = tonePixel(data[i]!/255,data[i+1]!/255,data[i+2]!/255,luts);
    for (let c = 0; c<3; c++) result[i+c] = Math.round(rgb[c]!*255);
    result[i+3] = data[i+3]!;
  }
  return result;
}
