"use client";

import { useEffect, useRef } from "react";

import { ART_RATIO, heroGeometry } from "@/lib/hero-screen";

/**
 * 首屏场景（WebGL2 一块画布）：视频 + 三层光 + 点击定点缩放 + 镜头畸变/四周失焦 + 灰尘粒子，
 * 再按 PC 素材（显示器 + 草地…）合成上去——一块画布一趟画完。
 *
 * 为什么从 DOM 换成画布：原先畸变走 SVG feDisplacementMap、四周失焦走 backdrop-filter，
 * 画面里只要有 <video>，这两层滤镜就得逐帧把视频喂进滤镜管线——实测放大态 50ms/帧（约 20fps）。
 * 这些效果在着色器里只是几次纹理采样，一趟画完。本机（无 GPU、软件光栅化）实测：
 * 空闲与放大态均 33ms/帧，视频暂停（不重传纹理）时 16.7ms/帧。
 *
 * 素材也不再是盖在画面上的 <img>：屏幕上那块透明洞、洞里的画面、素材自己的放大/显形/虚焦
 * 全在这一个片段着色器里、按同一套版面坐标算。以前洞靠「一比一贴上去」对位，放大到 4–5 倍时
 * 素材的直角边界会甩出屏幕、露出画面；现在缩放只是改了采样，几样东西永远咬在一起。
 *
 * 分工：
 *   · 视差、缩放缓动、镜头淡入淡出、粒子漂移都在这里的 rAF 里算；
 *   · 素材的放大/显形/虚焦由 hero-scene.tsx 的滚动动画写进 state，这里每帧读（普通对象，不走 React）；
 *   · 画面按 cover 铺满屏幕（不裁不拉之外不留黑边——首屏整屏都是画面）；
 *   · 画布就是整个首屏版面（一屏 + 底下的 --hero-bleed）：素材按 cover 铺满，屏幕窗口的位置
 *     与大小照 lib/hero-screen.ts 里量好的比例算，两边共用同一份几何；
 *   · 视频只是纹理来源：元素铺在画布下面（保持可见→浏览器不会掐掉解码，被画布盖住→看不见）；
 *   · 灰尘粒子在片段着色器里按素材的 alpha 与画面的范围掐两道：屏幕边壳、草地、以及留边都不落灰；
 *   · 画布拿不到 WebGL2 时它自己隐藏，底下那段视频就是兜底背景；
 *   · 容器整块滚出视野就停画（视频也一起暂停），看不见的场景不该一直烧 CPU。
 */

/** 三层光。origin/size/range 都是版面（首屏那一屏）比例，和原来 CSS 里的写法一一对应。 */
const LIGHTS = [
  { color: "oklch(0.9 0.16 62 / 34%)", origin: [0.02, -0.1], size: [0.78, 0.7], range: [9, 7], ease: 0.055 },
  { color: "oklch(0.86 0.19 28 / 32%)", origin: [0.12, -0.04], size: [0.6, 0.56], range: [16, 12], ease: 0.09 },
  { color: "oklch(0.88 0.16 325 / 28%)", origin: [0.06, 0.06], size: [0.46, 0.42], range: [30, 22], ease: 0.16 },
] as const;

/** 照片层视差：与光反向、幅度最小（越远的东西走得越反），单位是像素。 */
const PHOTO_PARALLAX = { range: [18, 12], ease: 0.07, direction: -1 } as const;

/**
 * 缩进显示器里之后，画面跟指针走的幅度收到原来的几成。
 * 起手那屏画面铺满整块版面，18px 的位移摊在大画面上正合适；落进屏幕里以后画面只剩
 * 三百来像素宽，再照这个幅度晃就像画面在自己框里游，收一档才像贴在屏幕里。
 * 收多少按素材缩到多小的比例线性插值（见 render 里的 follow）。
 */
const SHRUNK_FOLLOW = 0.4;

const DUST_COUNT = 220;
/** 粒子整体亮度（0..1），想更明显就调大。 */
const DUST_AMOUNT = 1;

const VERT = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform sampler2D uVideo;
uniform sampler2D uAsset;    // PC 素材（显示器 + 草地…），屏幕那块洞是全透明的
uniform vec2 uRes;        // 版面（画布）CSS 像素
uniform vec2 uBuffer;     // 绘制缓冲像素（gl_FragCoord 的量纲，含 DPR）
uniform vec2 uVideoSize;
uniform vec2 uPhotoOffset;   // px（屏幕内视差）
uniform float uZoom;         // 点击定点缩放的倍数
uniform vec2 uPivot;         // px（屏幕内坐标）
uniform float uLens;         // 0..1
uniform float uBlurPx;
uniform vec3 uLightColor[3];
uniform vec2 uLightPos[3];   // uv（屏幕内）
uniform vec2 uLightSize[3];  // uv 半轴
uniform float uLightAmp[3];
// 素材与屏幕洞：都是版面 px 的矩形（x, y, w, h），见 lib/hero-screen.ts。
// 素材整块在这里摆：uBoardScale 是它当前放大多少倍（支点 = 洞心），洞与洞里的画面跟着一起放。
// 三样共用一套坐标，缩放于是只是改了采样——没有 DOM 边界可露。
uniform vec4 uArt;
uniform vec4 uHole;
uniform float uBoardScale;
uniform float uAssetAlpha;   // 素材整体不透明度（0..1），滚过开头那段就一直是 1
uniform float uAssetLod;     // 素材显形那层虚焦：mip 层数（0 = 原图，越大越糊）
uniform float uHolePad;      // 窗口比玻璃小出来的那一圈（px，见 lib/hero-screen.ts 的 pad）
uniform vec2 uZoomAnchor;    // 缩放支点（版面 px）：绕它放大/缩小整个版面

/** 素材固有宽度（px）：把 mip 层数换回版面 px 用，见 grow。 */
const float ASSET_W = 2200.0;

out vec4 outColor;

// 屏幕 uv（y 向下）→ 视频 uv（含 cover 摆放、视差、定点缩放）。框就是屏幕那块洞：
// 画面按 cover 铺满它，不裁不拉之外的黑边一概不留（首屏整屏都是画面）。
vec2 videoUv(vec2 frameUv) {
  vec2 frameRes = uHole.zw;
  vec2 px = frameUv * frameRes;
  vec2 zoomed = uPivot + (px - uPivot) / uZoom;
  float cover = max(frameRes.x / uVideoSize.x, frameRes.y / uVideoSize.y);
  vec2 displayed = uVideoSize * cover;
  vec2 origin = (frameRes - displayed) * 0.5 - uPhotoOffset;
  return (zoomed - origin) / displayed;
}

// 屏幕 uv 是 y 向下，纹理由 UNPACK_FLIP_Y_WEBGL 上传后图的顶边在 v=1，采样时翻回来
vec3 tex(vec2 uv) { return texture(uVideo, vec2(uv.x, 1.0 - uv.y)).rgb; }

vec3 sampleVideo(vec2 uv, float blurPx) {
  if (blurPx < 0.01) return tex(uv);
  vec3 sum = tex(uv);
  for (int i = 0; i < 7; i++) {
    float a = float(i) * 2.399963;                       // 黄金角：7 个方向不重复
    float r = blurPx * (0.35 + 0.65 * float(i) / 6.0);
    // 半径按屏幕（洞）归一，别按整块画布：画布比屏幕大，按它归一采样步就偏小
    sum += tex(uv + vec2(cos(a), sin(a)) * r / uHole.zw);
  }
  return sum / 8.0;
}

void main() {
  // gl_FragCoord 是绘制缓冲像素（含 DPR），先归一到 0..1；y 翻转成左上为原点
  vec2 screenUv = vec2(gl_FragCoord.x / uBuffer.x, 1.0 - gl_FragCoord.y / uBuffer.y);
  vec2 px = screenUv * uRes;

  // 反解素材那一路缩放：这个像素在「还没缩」的版面坐标里落在哪。
  // 支点由 uZoomAnchor 给（画布中心或屏幕中心），整幅版面绕它缩放——素材、屏幕窗口、
  // 窗口里的画面都摆在这套坐标里，于是放大到几倍都对得上，构图也不会因为屏幕不在正中而跑偏。
  vec2 board = uZoomAnchor + (px - uZoomAnchor) / uBoardScale;

  // 素材：cover 之后按 uArt 归一。用 textureGrad 而不是 textureLod：导数乘上 2^lod 等于
  // 「再糊 lod 层 mip」，同时保留硬件自己那档缩小选层——移动端素材从 2200 缩到 1600 上下，
  // 全按 lod 0 采会闪（本来该走 mip 的那点缩小被跳过，草丛和蝴蝶边缘会跳）。
  vec2 assetUv = (board - uArt.xy) / uArt.zw;
  float assetBias = exp2(uAssetLod);
  vec2 assetDx = dFdx(assetUv) * assetBias;
  vec2 assetDy = dFdy(assetUv) * assetBias;
  vec4 asset = textureGrad(uAsset, vec2(assetUv.x, 1.0 - assetUv.y), vec2(assetDx.x, -assetDx.y), vec2(assetDy.x, -assetDy.y));

  // 洞里才画场景。洞往外放一圈：画面窗口是 4:3、玻璃包围盒更宽，这一圈得接着画画面，
  // 否则那圈会透出台面底色；素材自己的虚焦与洞里外那圈抗锯齿也会漫出来，一并算进去。
  float grow = max(uHolePad, exp2(uAssetLod) * (uArt.z / ASSET_W) * 2.0);
  vec2 holePx = board - uHole.xy;
  bool insideHole = holePx.x > -grow && holePx.y > -grow && holePx.x < uHole.z + grow && holePx.y < uHole.w + grow;

  // 窗口外是黑的：它是兜底不是设计——起手倍数保证窗口盖住整个版面，素材显形后又全被素材盖住，
  // 所以正常情况看不见它；真露出来说明几何出了问题，黑一下好过透出网页底色。
  vec3 color = vec3(0.0);
  if (insideHole) {
    vec2 frameUv = holePx / uHole.zw;

    // 镜头：越靠边越往屏幕中心取采样（等于把四周向外拉伸），并叠加失焦。
    // 半径按屏幕（洞）归一：屏幕上那圈畸变与失焦才是照着屏幕边来的。
    float aspect = uHole.z / uHole.w;
    vec2 centered = (frameUv - 0.5) * vec2(aspect, 1.0);
    float radius = clamp(length(centered) / (0.5 * length(vec2(aspect, 1.0))), 0.0, 1.0);
    float edge = smoothstep(0.25, 1.0, radius);
    vec2 warpedUv = frameUv - (frameUv - 0.5) * (0.18 * uLens * edge);

    color = sampleVideo(videoUv(warpedUv), uBlurPx * uLens * edge);

    // 三层光：screen 叠加，位置各自跟着指针漂移
    for (int i = 0; i < 3; i++) {
      vec2 d = (frameUv - uLightPos[i]) / uLightSize[i];
      float alpha = clamp(1.0 - length(d) / 0.72, 0.0, 1.0);
      color = 1.0 - (1.0 - color) * (1.0 - uLightColor[i] * alpha * uLightAmp[i]);
    }
  }

  // 素材按自己的 alpha 压上去：屏幕洞里 alpha = 0，于是洞里就是刚画好的画面——
  // 素材再怎么透明也挡不住它。uAssetAlpha 只管「显不显形」，两者各管各的。
  outColor = vec4(mix(color, asset.rgb, asset.a * uAssetAlpha), 1.0);
}`;

const DUST_VERT = `#version 300 es
in vec2 aPos;
in float aSeed;
uniform vec2 uRes;           // 版面（画布）CSS 像素
uniform vec4 uHole;          // 屏幕洞在版面里的矩形
uniform float uBoardScale;   // 版面放大倍数：粒子和屏幕一起放，于是始终待在屏幕里
uniform vec2 uZoomAnchor;    // 缩放支点（版面 px）：与 FRAG 用同一个
uniform vec2 uLightPos[3];
uniform vec2 uLightSize[3];
uniform float uLightAmp[3];
uniform float uDust;
out float vBright;
out vec2 vBoard;             // 粒子在版面坐标里的位置（px）：碎片着色器拿它查素材的 alpha
void main() {
  // aPos 是屏幕洞内的 uv（和光的位置同一套坐标）：先摆回版面，再按素材那一路放大，最后归到画布 uv。
  // 起手放大到 5 倍多时，粒子跟着铺满整屏——它们本来就该在屏幕里，而不是钉在屏幕上不动。
  vec2 boardPx = uHole.xy + aPos * uHole.zw;
  vec2 p = (uZoomAnchor + (boardPx - uZoomAnchor) * uBoardScale) / uRes;
  vBoard = boardPx;
  float light = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 d = (aPos - uLightPos[i]) / uLightSize[i];
    light += clamp(1.0 - length(d) / 0.8, 0.0, 1.0) * uLightAmp[i];
  }
  // 光越足越亮；出了光就干脆不亮，不要整屏撒白点。
  // 单盏灯的中心光强只有 0.3 上下，所以阈值压得低，让一盏灯就够点亮附近的灰尘。
  vBright = smoothstep(0.05, 0.26, light) * uDust;
  // aPos 是 y 向下的屏幕 uv（和光的位置同一套坐标），GL 的 y 向上，这里翻一下
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  // 点大小跟着光走：光里稍大稍亮一点，暗处收到 1px
  gl_PointSize = 1.0 + 3.0 * aSeed * (0.5 + vBright);
}`;

const DUST_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uAsset;    // PC 素材
uniform vec4 uArt;           // 素材在版面里的矩形（px）
uniform float uAssetAlpha;   // 素材整体不透明度：显形之前它没画上去，粒子也就不该被掐
in float vBright;
in vec2 vBoard;              // 版面坐标（px）
out vec4 outColor;
void main() {
  // 只在画面里落灰：素材不透明的地方是屏幕边壳与草地，按素材的 alpha 把粒子掐掉。
  // 画面按 cover 铺满屏幕，屏幕范围内处处是画面，所以只掐这一道就够。
  vec2 assetUv = (vBoard - uArt.xy) / uArt.zw;
  float opaque = textureLod(uAsset, vec2(assetUv.x, 1.0 - assetUv.y), 0.0).a * uAssetAlpha;
  float keep = 1.0 - smoothstep(0.45, 0.9, opaque);
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * vBright * keep;
  outColor = vec4(vec3(1.0), a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn("[scene-canvas] 着色器编译失败:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.warn("[scene-canvas] 程序链接失败:", gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

/**
 * oklch 字符串 → 0..1 的 rgb：借 canvas 让浏览器自己换算。
 * 画一个像素再读回来——别去解析 ctx.fillStyle：Chrome 对 oklch 会原样返回字符串，
 * 早先按 #hex 解析，于是所有 oklch 颜色（三层光的暖色、台面底色）都落成了白色。
 */
function toRgb(color: string): [number, number, number] {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return [1, 1, 1];
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const pixel = ctx.getImageData(0, 0, 1, 1).data;
  return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
}

function cssNumber(name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/** cubic-bezier 求值（与 CSS 的 --zoom-ease 对齐） */
function bezier(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-4) break;
      const slope = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(slope) < 1e-5) break;
      t -= error / slope;
    }
    return sampleY(Math.min(1, Math.max(0, t)));
  };
}

/**
 * 首屏动画只改这个对象：GSAP 写、SceneCanvas 每帧读（普通对象，不走 React state，
 * 省掉每帧一次重渲染）。三个字段各管一件事，见 hero-scene.tsx。
 */
export type HeroState = {
  /** 素材放大倍数（支点 = 屏幕洞心）：起手放到洞盖满整屏，滚完回到 1 */
  scale: number;
  /** 素材整体不透明度（0..1）：滚过开头那一小段就一直是 1 */
  opacity: number;
  /** 素材虚焦（px）：从 BLUR 收到 0，素材是「先带糊压上来、再对焦」的 */
  blur: number;
};

export function SceneCanvas({
  src,
  poster,
  asset,
  zoomAnchor: anchorMode,
  state,
}: {
  /** 视频（画面本体） */
  src: string;
  /** 视频首帧，解码前先顶上 */
  poster: string;
  /** PC 素材（显示器 + 草地），屏幕那块洞是全透明的 */
  asset: string;
  /**
   * 缩放支点：`screen` = 绕屏幕（素材里那块玻璃）中心，`canvas` = 绕画布中心。
   * 桌面的「缩进屏幕」要绕屏幕——绕画布的话屏幕偏在素材右上方，缩到能盖住整版时得放大十倍；
   * 手机没有那段动画，绕画布中心放大一点点即可，构图不会跟着屏幕跑偏。
   */
  zoomAnchor: "screen" | "canvas";
  /** 滚动动画写的状态，每帧读 */
  state: HeroState;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!host || !canvas || !video) return;

    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    const scene = gl ? link(gl, VERT, FRAG) : null;
    const dustProgram = gl ? link(gl, DUST_VERT, DUST_FRAG) : null;
    if (!gl || !scene || !dustProgram) {
      canvas.style.display = "none"; // 兜底：底下那段视频就是画面
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // —— 静态资源
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const quadPos = gl.getAttribLocation(scene, "aPos");   // 只查一次

    const dustPosBuffer = gl.createBuffer();
    const dustSeedBuffer = gl.createBuffer();
    const dustPos = new Float32Array(DUST_COUNT * 2);
    const dustSeed = new Float32Array(DUST_COUNT);
    const dustSpeed = new Float32Array(DUST_COUNT);
    const dustPhase = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) {
      dustPos[i * 2] = Math.random();
      dustPos[i * 2 + 1] = Math.random();
      dustSeed[i] = Math.random();
      dustSpeed[i] = 0.004 + Math.random() * 0.011; // 上升速度
      dustPhase[i] = Math.random() * Math.PI * 2;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, dustPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, dustPos.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, dustSeedBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, dustSeed, gl.STATIC_DRAW);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    // 素材：屏幕那块洞是全透明的，洞里由着色器自己画画面（见 FRAG）。带 mipmap 是因为
    // 「显形虚焦」直接挑一层 mip 就够——比每帧多做几趟模糊采样便宜得多，糊得也干净。
    const assetTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, assetTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    let assetUp = false;
    const assetImage = new Image();
    assetImage.decoding = "async";
    assetImage.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, assetTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, assetImage);
      gl.generateMipmap(gl.TEXTURE_2D);
      // 换素材（重新导出）时比例会对不上：几何是照 ART_RATIO 算的，对不上整套就错位。
      // 不拦着，只报一声——要改的是 lib/hero-screen.ts 里的常量与尺寸量法。
      const ratio = assetImage.naturalWidth / assetImage.naturalHeight;
      if (Math.abs(ratio - ART_RATIO) > 0.01) {
        console.warn(
          `[scene-canvas] ${asset} 的宽高比 ${ratio.toFixed(4)} 与 ART_RATIO ${ART_RATIO.toFixed(4)} 不一致，几何要重新对一遍（lib/hero-screen.ts）`,
        );
      }
      assetUp = true;
    };
    assetImage.src = asset;

    // —— 着色器里的固定表
    // 位置只查一次：每帧再 getUniformLocation/getAttribLocation 都是同步 GL 调用，白花时间
    const sceneLoc = {
      video: gl.getUniformLocation(scene, "uVideo"),
      res: gl.getUniformLocation(scene, "uRes"),
      buffer: gl.getUniformLocation(scene, "uBuffer"),
      videoSize: gl.getUniformLocation(scene, "uVideoSize"),
      photoOffset: gl.getUniformLocation(scene, "uPhotoOffset"),
      zoom: gl.getUniformLocation(scene, "uZoom"),
      pivot: gl.getUniformLocation(scene, "uPivot"),
      lens: gl.getUniformLocation(scene, "uLens"),
      blurPx: gl.getUniformLocation(scene, "uBlurPx"),
      lightColor: gl.getUniformLocation(scene, "uLightColor"),
      lightPos: gl.getUniformLocation(scene, "uLightPos"),
      lightSize: gl.getUniformLocation(scene, "uLightSize"),
      lightAmp: gl.getUniformLocation(scene, "uLightAmp"),
      asset: gl.getUniformLocation(scene, "uAsset"),
      art: gl.getUniformLocation(scene, "uArt"),
      hole: gl.getUniformLocation(scene, "uHole"),
      boardScale: gl.getUniformLocation(scene, "uBoardScale"),
      assetAlpha: gl.getUniformLocation(scene, "uAssetAlpha"),
      assetLod: gl.getUniformLocation(scene, "uAssetLod"),
      holePad: gl.getUniformLocation(scene, "uHolePad"),
      zoomAnchor: gl.getUniformLocation(scene, "uZoomAnchor"),
    };
    const dustPosAttr = gl.getAttribLocation(dustProgram, "aPos");
    const dustSeedAttr = gl.getAttribLocation(dustProgram, "aSeed");
    const dustLoc = {
      res: gl.getUniformLocation(dustProgram, "uRes"),
      hole: gl.getUniformLocation(dustProgram, "uHole"),
      boardScale: gl.getUniformLocation(dustProgram, "uBoardScale"),
      zoomAnchor: gl.getUniformLocation(dustProgram, "uZoomAnchor"),
      asset: gl.getUniformLocation(dustProgram, "uAsset"),
      art: gl.getUniformLocation(dustProgram, "uArt"),
      assetAlpha: gl.getUniformLocation(dustProgram, "uAssetAlpha"),
      lightPos: gl.getUniformLocation(dustProgram, "uLightPos"),
      lightSize: gl.getUniformLocation(dustProgram, "uLightSize"),
      lightAmp: gl.getUniformLocation(dustProgram, "uLightAmp"),
      dust: gl.getUniformLocation(dustProgram, "uDust"),
    };

    const lightColors = new Float32Array(LIGHTS.flatMap((l) => toRgb(l.color)));
    const lightAmps = new Float32Array(LIGHTS.map((l) => Number(l.color.match(/\/\s*([\d.]+)%/)?.[1] ?? 30) / 100));
    // 光的位置/尺寸、粒子位置原本都按「版面」（首屏那一屏）调过，现在这块画布就是版面，
    // 谁也不换算——它们于是实打实配在屏幕上，画面是真适配屏幕，而不是从大画面里裁一块塞进去
    const lightSizesUv = new Float32Array(LIGHTS.flatMap((l) => [...l.size]));
    const lightPosUv = new Float32Array(6);
    /** 素材与屏幕洞在版面里的矩形（px）：版面一变就重新量，见 lib/hero-screen.ts */
    const artRect = new Float32Array(4);
    const holeRect = new Float32Array(4);

    // —— CSS 令牌
    const blurPx = cssNumber("--lens-blur", 9);
    const durationMs = cssNumber("--zoom-duration", 900);
    const baseZoom = cssNumber("--scene-zoom", 1.08);
    const maxZoom = Math.min(cssNumber("--scene-zoom-in", 1.7), cssNumber("--scene-zoom-max", 2.2));
    const lensIn = cssNumber("--lens-in", 320) / 1000;
    const lensOut = cssNumber("--lens-out", 900) / 1000;
    const ease = bezier(0.22, 1, 0.36, 1);

    // —— 运行时状态（都预分配，热路径里不新建对象）
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = performance.now();
    let zoom = baseZoom;
    let zoomFrom = baseZoom;
    let zoomTo = baseZoom;
    let zoomStart = 0;
    let pivotX = 0;                  // 当前生效的支点
    let pivotY = 0;
    let pivotFromX = 0;              // 本次动画的支点起点/终点
    let pivotFromY = 0;
    let pivotToX = 0;
    let pivotToY = 0;
    let lens = 0;
    let lensTarget = 0;
    let uploadedTime = -1;
    /** 画面当前该不该是活的（容器有没有露在视口里）；autoplay 已经让视频跑起来了，所以初值是 true */
    let awake = true;
    /** 素材起手放大到多少倍（在 resize() 里按版面量）：视差收幅度按「缩到多小」线性插 */
    let growRef = 1;
    /** 4:3 的窗口比玻璃小出来的那一圈（px）：着色器拿它把画面往外多画一圈 */
    let holePad = 0;
    /** 缩放支点（版面 px）：桌面绕屏幕中心（起手要盖满整版），手机绕画布中心（构图不跟着屏幕跑） */
    const zoomAnchor = new Float32Array(2);
    const photoCurrent = [0, 0];
    const photoTarget = [0, 0];
    const lightCurrent = LIGHTS.map(() => [0, 0]);
    const lightTarget = LIGHTS.map(() => [0, 0]);

    const resize = () => {
      // 画布按 1:1 设备像素画：内容本身是 1280 宽的视频，放大到高 DPR 看不出差别，
      // 却要按面积多花几倍填充率（软件光栅化时尤其明显）。
      // 用 offsetWidth/Height（排版尺寸）而不是 getBoundingClientRect()：这一层在别处
      // 可能被祖先的 transform 缩过，变换后的 rect 是缩过的，画布连同着色器里的 res
      // 都会被量小、画面糊掉；排版尺寸不受祖先 transform 影响。
      const dpr = 1;
      width = host.offsetWidth;
      height = host.offsetHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      // 素材按 cover 铺满整块画布，屏幕洞的位置与大小跟着素材走。着色器里的逆映射、
      // GSAP 那边的起手倍数都取自同一份几何（lib/hero-screen.ts），不会各算一套。
      const geom = heroGeometry(width, height);
      artRect.set([geom.art.x, geom.art.y, geom.art.w, geom.art.h]);
      holeRect.set([
        geom.hole.cx - geom.hole.w / 2,
        geom.hole.cy - geom.hole.h / 2,
        geom.hole.w,
        geom.hole.h,
      ]);
      // 起手放大倍数：视差收幅度、以及几何那套的参考值（见 follow()）。版面变了就跟着变。
      growRef = geom.grow;
      holePad = geom.pad;
      // 桌面绕屏幕中心（= 洞心，缩放不动的那个点），手机绕画布中心
      zoomAnchor[0] = anchorMode === "canvas" ? width / 2 : geom.hole.cx;
      zoomAnchor[1] = anchorMode === "canvas" ? height / 2 : geom.hole.cy;
      // 点击定点缩放的起手支点 = 屏幕洞心：第一次量到几何时落在那儿，之后只跟着动画走
      if (!pivotX && !pivotY) {
        pivotX = pivotFromX = pivotToX = geom.hole.cx;
        pivotY = pivotFromY = pivotToY = geom.hole.cy;
      }
    };

    /**
     * 画面跟指针走的幅度系数：1 = 起手那一档（画面铺满整块版面），缩进屏幕里收到 SHRUNK_FOLLOW。
     * 按素材缩到多小的比例线性插，于是整个缩回过程是平顺的，落定时正好收干。
     * 手机那条路没有缩放（grow 恒为 1）、一直落在终态，直接用收过的那一档。
     */
    const follow = () => {
      const room = growRef - 1;
      const shrunk = room < 1e-3 ? 1 : Math.min(1, Math.max(0, (growRef - state.scale) / room));
      return 1 - (1 - SHRUNK_FOLLOW) * shrunk;
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("a, button, input, textarea, select, [contenteditable]")) return;
      const goingIn = zoomTo <= baseZoom + 1e-3;
      zoomFrom = zoom;
      zoomTo = goingIn ? maxZoom : baseZoom;
      zoomStart = performance.now();
      // 支点不瞬间改：从当前生效的支点滑过去，否则第一帧画面就跳一下（这正是之前的卡顿）。
      // 推进时落到点击处（那里就是放大镜中心），退回时滑回画面中心——正好回到原始构图。
      // 不再夹支点：画面按 cover 铺满屏幕，放大时推到哪里都不会「露底」。
      pivotFromX = pivotX;
      pivotFromY = pivotY;
      if (goingIn) {
        // 点击坐标是视口的，画布的支点是容器内的：减去容器左上角，往下滚过也不会错位
        const rect = host.getBoundingClientRect();
        pivotToX = event.clientX - rect.left;
        pivotToY = event.clientY - rect.top;
      } else {
        pivotToX = width / 2;
        pivotToY = height / 2;
      }
      lensTarget = goingIn ? 1 : 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (reduced) return;
      const rect = host.getBoundingClientRect();
      const nx = ((event.clientX - rect.left) / width - 0.5) * 2;
      const ny = ((event.clientY - rect.top) / height - 0.5) * 2;
      photoTarget[0] = nx * PHOTO_PARALLAX.range[0] * PHOTO_PARALLAX.direction;
      photoTarget[1] = ny * PHOTO_PARALLAX.range[1] * PHOTO_PARALLAX.direction;
      for (let i = 0; i < LIGHTS.length; i++) {
        lightTarget[i][0] = (nx * LIGHTS[i].range[0]) / 100;
        lightTarget[i][1] = (ny * LIGHTS[i].range[1]) / 100;
      }
    };

    const render = (now: number) => {
      frame = requestAnimationFrame(render);

      // 容器整块离开视口（含正好贴着上/下边缘）就不画：这块场景在软件光栅化下也要 30fps，
      // 下面还有别的板块时，没必要烧在看不见的地方；视频也一起停，别白解码。
      // 判据是容器自己的框，一帧一次 getBoundingClientRect——这块页面自己不动 DOM，布局是干净的，
      // 而且不用 IntersectionObserver：贴边那种零面积相交浏览器算作「还相交」，回调不一定来，
      // 正好停在交界上就白跑了。
      const rect = host.getBoundingClientRect();
      const onScreen = rect.bottom > 0 && rect.top < window.innerHeight;
      if (onScreen !== awake) {
        awake = onScreen;
        if (awake) void video.play().catch(() => {});
        else video.pause();
      }
      if (!awake) {
        last = now; // 回来时 dt 不跳
        return;
      }

      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // 缩放缓动
      if (zoom !== zoomTo) {
        const t = Math.min(1, (now - zoomStart) / durationMs);
        const k = ease(t);
        zoom = zoomFrom + (zoomTo - zoomFrom) * k;
        pivotX = pivotFromX + (pivotToX - pivotFromX) * k;
        pivotY = pivotFromY + (pivotToY - pivotFromY) * k;
        if (t >= 1) {
          zoom = zoomTo;
          pivotX = pivotFromX = pivotToX;
          pivotY = pivotFromY = pivotToY;
        }
      }
      // 镜头：进得快、退得稳
      if (lens < lensTarget) lens = Math.min(lensTarget, lens + dt / lensIn);
      else if (lens > lensTarget) lens = Math.max(lensTarget, lens - dt / lensOut);

      // 视差缓动
      for (let i = 0; i < 2; i++) photoCurrent[i] += (photoTarget[i] - photoCurrent[i]) * PHOTO_PARALLAX.ease;
      for (let i = 0; i < LIGHTS.length; i++) {
        lightCurrent[i][0] += (lightTarget[i][0] - lightCurrent[i][0]) * LIGHTS[i].ease;
        lightCurrent[i][1] += (lightTarget[i][1] - lightCurrent[i][1]) * LIGHTS[i].ease;
        // origin 与漂移都是屏幕（洞）内的比例，光就配在屏幕上
        lightPosUv[i * 2] = LIGHTS[i].origin[0] + lightCurrent[i][0];
        lightPosUv[i * 2 + 1] = LIGHTS[i].origin[1] + lightCurrent[i][1];
      }

      // 滚动动画写的三个数（普通对象，GSAP 每帧改）。素材还没解码完就先当它没显形：
      // 不全的黑图会糊住底下那块画面，等图到了再交给它。
      const boardScale = Math.max(state.scale, 1e-3);
      const assetAlpha = assetUp ? state.opacity : 0;
      const assetLod = Math.log2(1 + Math.max(0, state.blur));
      // 画面跟指针走的幅度：缩进屏幕里之后收一档（见 SHRUNK_FOLLOW），灯光的漂移不受影响
      const photoScale = follow();

      // 24fps 的视频配 60fps 的循环：同一帧不必反复上传（每帧一次 3.7MB 拷贝）
      if (video.readyState >= 2 && video.currentTime !== uploadedTime) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        uploadedTime = video.currentTime;
      }

      // —— 场景
      gl.useProgram(scene);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(quadPos);
      gl.vertexAttribPointer(quadPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(sceneLoc.video, 0);
      gl.uniform1i(sceneLoc.asset, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, assetTexture);
      gl.uniform2f(sceneLoc.res, width, height);
      gl.uniform2f(sceneLoc.buffer, canvas.width, canvas.height);
      gl.uniform2f(sceneLoc.videoSize, video.videoWidth || 16, video.videoHeight || 9);
      gl.uniform2f(sceneLoc.photoOffset, photoCurrent[0] * photoScale, photoCurrent[1] * photoScale);
      gl.uniform1f(sceneLoc.zoom, zoom);
      gl.uniform2f(sceneLoc.pivot, pivotX, pivotY);
      gl.uniform1f(sceneLoc.lens, lens);
      gl.uniform1f(sceneLoc.blurPx, blurPx);
      gl.uniform4fv(sceneLoc.art, artRect);
      gl.uniform4fv(sceneLoc.hole, holeRect);
      gl.uniform1f(sceneLoc.boardScale, boardScale);
      gl.uniform1f(sceneLoc.assetAlpha, assetAlpha);
      gl.uniform1f(sceneLoc.assetLod, assetLod);
      gl.uniform1f(sceneLoc.holePad, holePad);
      gl.uniform2fv(sceneLoc.zoomAnchor, zoomAnchor);
      gl.uniform3fv(sceneLoc.lightColor, lightColors);
      gl.uniform2fv(sceneLoc.lightPos, lightPosUv);
      gl.uniform2fv(sceneLoc.lightSize, lightSizesUv);
      gl.uniform1fv(sceneLoc.lightAmp, lightAmps);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // —— 灰尘粒子：只在光里亮，加法混合叠上去
      if (!reduced) {
        for (let i = 0; i < DUST_COUNT; i++) {
          dustPos[i * 2 + 1] -= dustSpeed[i] * dt;
          dustPos[i * 2] += Math.sin(now / 2600 + dustPhase[i]) * 0.006 * dt;
          if (dustPos[i * 2 + 1] < -0.02) dustPos[i * 2 + 1] = 1.02;
          if (dustPos[i * 2] < -0.02) dustPos[i * 2] = 1.02;
          if (dustPos[i * 2] > 1.02) dustPos[i * 2] = -0.02;
        }
        gl.useProgram(dustProgram);
        gl.enable(gl.BLEND);
        // 加法叠加，但要按 alpha 加权：否则 alpha=0 的粒子也会把纯白加满整屏
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.bindBuffer(gl.ARRAY_BUFFER, dustPosBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, dustPos);
        // 位置可能是 -1（编译器判定没用就丢掉），必须先挡：vertexAttribPointer(-1) 会报
        // INVALID_VALUE，而且一旦启用了非法索引，整个点绘制就废了
        if (dustPosAttr >= 0) {
          gl.enableVertexAttribArray(dustPosAttr);
          gl.vertexAttribPointer(dustPosAttr, 2, gl.FLOAT, false, 0, 0);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, dustSeedBuffer);
        if (dustSeedAttr >= 0) {
          gl.enableVertexAttribArray(dustSeedAttr);
          gl.vertexAttribPointer(dustSeedAttr, 1, gl.FLOAT, false, 0, 0);
        }
        gl.uniform2fv(dustLoc.lightPos, lightPosUv);
        gl.uniform2fv(dustLoc.lightSize, lightSizesUv);
        gl.uniform1fv(dustLoc.lightAmp, lightAmps);
        gl.uniform2f(dustLoc.res, width, height);
        gl.uniform4fv(dustLoc.hole, holeRect);
        gl.uniform1f(dustLoc.boardScale, boardScale);
        gl.uniform2fv(dustLoc.zoomAnchor, zoomAnchor);
        // 粒子只在视频里亮：素材的 alpha 由碎片着色器查，采样器指向 1 号单元（上面绑的就是素材）
        gl.uniform1i(dustLoc.asset, 1);
        gl.uniform4fv(dustLoc.art, artRect);
        gl.uniform1f(dustLoc.assetAlpha, assetAlpha);
        gl.uniform1f(dustLoc.dust, DUST_AMOUNT * (0.7 + 0.3 * lens));
        gl.drawArrays(gl.POINTS, 0, DUST_COUNT);
      }
    };

    resize();
    // 尺寸跟着容器走：转屏、滚动条出现/消失、版面上别的板块把首屏挤窄，容器都会重新量一次，
    // 画布始终和首屏区块严丝合缝。
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    // 监听挂在容器上（不是 window）：首屏滚上去之后，指针和点击都落不到这块场景上。
    host.addEventListener("click", onClick);
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      host.removeEventListener("click", onClick);
      host.removeEventListener("pointermove", onPointerMove);
      gl.deleteTexture(texture);
      gl.deleteTexture(assetTexture);
      gl.deleteBuffer(quad);
      gl.deleteBuffer(dustPosBuffer);
      gl.deleteBuffer(dustSeedBuffer);
      gl.deleteProgram(scene);
      gl.deleteProgram(dustProgram);
    };
  }, [src, asset, anchorMode, state]);

  return (
    <div ref={hostRef} className="absolute inset-0">
      {/* 视频铺在画布下面：保持可见→浏览器不掐解码，被画布盖住→看不见；也当无 WebGL 时的兜底 */}
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        src={src}
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden
      />
      <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
    </div>
  );
}
