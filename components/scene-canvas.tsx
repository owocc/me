"use client";

import { useEffect, useRef } from "react";

import { ART_RATIO, heroGeometry, hitsScreenHole, videoRect, visibleFrame, type Rect } from "@/lib/hero-screen";

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
 *   · 画面不加彩色光罩：亮处只揉一层无色的柔光（bloom），光晕只用来决定灰尘在哪亮；
 *   · 素材的放大/显形/虚焦由 hero-scene.tsx 的滚动动画写进 state，这里每帧读（普通对象，不走 React）；
 *   · 画面的取景有两套，由 state.framing 在两套之间插值：贴屏幕（按 4:3 的屏幕洞 cover）与
 *     铺满视口（按屏幕比例 cover，只裁比例差的那一点，见 framingUv）。两套都是「把视频按 cover
 *     铺进一块版面矩形」，矩形由 lib/hero-screen.ts 的 videoRect() 算好，着色器只做一次采样；
 *   · 画面按 cover 铺满屏幕（不裁不拉之外不留黑边——首屏整屏都是画面）；
 *   · 画布就是整个首屏版面（一屏 + 底下的 --hero-bleed）：素材按 cover 铺满，屏幕窗口的位置
 *     与大小照 lib/hero-screen.ts 里量好的比例算，两边共用同一份几何；
 *   · 视频只是纹理来源：元素铺在画布下面（保持可见→浏览器不会掐掉解码，被画布盖住→看不见）；
 *     **画面是一组视频**（videos 数组 + activeVideo 下标），当前这一段进纹理，别的只解码不上传；
 *   · 灰尘粒子在片段着色器里按素材的 alpha 与画面的范围掐两道：屏幕边壳、草地、以及留边都不落灰；
 *   · 画布拿不到 WebGL2 时它自己隐藏，底下那段视频就是兜底背景；
 *   · 容器整块滚出视野就停画（视频也一起暂停），看不见的场景不该一直烧 CPU。
 */

/**
 * 光晕。origin/size/range 都是版面（首屏那一屏）比例，和原来 CSS 里的写法一一对应。
 * 原先叠了三层（暖橙 / 红 / 粉），放大态下三块糊在一起，看着发晕，砍到只留最主的那一层暖光。
 * 数量由数组长度决定，着色器那边按它生成数组尺寸与循环次数，改数量不用再同步一处。
 */
const LIGHTS = [
  { color: "oklch(0.9 0.16 62 / 34%)", origin: [0.02, -0.1], size: [0.78, 0.7], range: [9, 7], ease: 0.055 },
] as const;
const LIGHT_COUNT = LIGHTS.length;

/** 照片层视差：与光反向、幅度最小（越远的东西走得越反），单位是像素。 */
const PHOTO_PARALLAX = { range: [18, 12], ease: 0.07, direction: -1 } as const;

/**
 * 缩进显示器里之后，画面跟指针走的幅度收到原来的几成。
 * 起手那屏画面铺满整块版面，18px 的位移摊在大画面上正合适；落进屏幕里以后画面只剩
 * 三百来像素宽，再照这个幅度晃就像画面在自己框里游，收一档才像贴在屏幕里。
 * 收多少按素材缩到多小的比例线性插值（见 render 里的 follow）。
 */
const SHRUNK_FOLLOW = 0.4;

/**
 * 满屏取景那一路的视差系数。视差是「屏幕 px 的位移」，而满屏那路是紧贴的 cover
 * （视频正好铺满可见的那一屏，四面全靠 VIEW_OVERSCAN 那点余量兜着），照原幅度推最多 12px，
 * 会把边上一条推出画面之外（CLAMP 拉出竖条）。压到 1/4（最多 3px）既留住了跟手，也还在余量以内。
 * 贴屏幕那一路不动它：画面缩在 4:3 的屏幕里，原幅度是调过的。
 */
const FULL_PARALLAX = 0.25;

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
uniform float uLens;         // 0..1
uniform float uBlurPx;
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
// 画面（视频）的取景：两路各是一块「把视频按 cover 铺进去」的版面矩形（x, y, w, h，px），
// 由 lib/hero-screen.ts 的 videoRect() 按 cover + 视差 + 定点缩放算好，着色器只做一次采样。
// uRectRest 的框是屏幕那块洞（视频就裁在屏幕里）；uRectFull 的框是画布露在视口里的那一块，
// 于是只按屏幕比例裁最少的一点（16:9 的屏幕上几乎不裁）。uFraming 在两路之间插值，见 framingUv。
uniform vec4 uRectRest;
uniform vec4 uRectFull;
uniform float uFraming;      // 0 = 贴屏幕，1 = 铺满视口

/** 素材固有宽度（px）：把 mip 层数换回版面 px 用，见 grow。 */
const float ASSET_W = 2200.0;
// 柔光：把画面里亮的地方揉开一点叠回去。不带颜色、只加在亮处，所以不会糊成一层色雾；
// 半径按「屏幕上多少像素」算（除以放大倍数），缩放时看上去一样柔，不会放大成一片糊。
const float BLOOM_PX = 14.0;      // 揉开的半径（屏幕 px）
const float BLOOM = 0.38;         // 叠回去的强度
const float BLOOM_FLOOR = 0.45;   // 低于这个亮度不发光

out vec4 outColor;

// 版面 px → 视频 uv。两路取景各是一块矩形（cover 摆放、视差、定点缩放都已经算进矩形里），
// 按 uFraming 线性混合：同一支点、同一个视频，混合相当于把取景框在中间插值——
// 两路的「点尺寸」长宽比本来就一样（都是这份视频的 vh/vw），所以混出来只是缩放变了、不会拉歪；
// 而可见的那几行像素在两路里都落在 0..1 内，混出来也就在 0..1 内，不会抽到画面外。
vec2 framingUv(vec2 board) {
  vec2 rest = (board - uRectRest.xy) / uRectRest.zw;
  vec2 full = (board - uRectFull.xy) / uRectFull.zw;
  return mix(rest, full, uFraming);
}

// 屏幕 uv 是 y 向下，纹理由 UNPACK_FLIP_Y_WEBGL 上传后图的顶边在 v=1，采样时翻回来
vec3 tex(vec2 uv) { return texture(uVideo, vec2(uv.x, 1.0 - uv.y)).rgb; }

// invScale 是「一个版面 px 等于多少 uv」：半径按版面 px 给，采样步就得按当前那路取景换算
// （两路取景框大小不同，uv 步长跟着不同，混一下才对得上）。
vec3 sampleVideo(vec2 uv, float blurPx, vec2 invScale) {
  if (blurPx < 0.01) return tex(uv);
  vec3 sum = tex(uv);
  for (int i = 0; i < 7; i++) {
    float a = float(i) * 2.399963;                       // 黄金角：7 个方向不重复
    float r = blurPx * (0.35 + 0.65 * float(i) / 6.0);
    sum += tex(uv + vec2(cos(a), sin(a)) * r * invScale);
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
    // 畸变就是绕屏幕中心均匀缩一下。原来写在屏幕 uv 上，现在在版面坐标里做同一件事——
    // 因为取景框已经不一定是屏幕洞了（满屏时是视口），这一步不能再挂在屏幕 uv 上。
    vec2 holeCenter = uHole.xy + uHole.zw * 0.5;
    vec2 warped = holeCenter + (board - holeCenter) * (1.0 - 0.18 * uLens * edge);

    // 失焦与柔光的半径都按屏幕 px 算：除以放大倍数，缩到哪一档看上去都一样柔。
    // （放大态下不除，边缘那圈 blur 会跟着放大成一片糊，正是之前「边缘糊在一起」的来源。）
    vec2 invScale = mix(1.0 / uRectRest.zw, 1.0 / uRectFull.zw, uFraming);
    vec2 vuv = framingUv(warped);
    vec3 base = sampleVideo(vuv, (uBlurPx * uLens * edge) / uBoardScale, invScale);
    vec3 soft = sampleVideo(vuv, BLOOM_PX / uBoardScale, invScale);
    color = base + max(soft - BLOOM_FLOOR, 0.0) * BLOOM;
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
uniform vec2 uLightPos[${LIGHT_COUNT}];
uniform vec2 uLightSize[${LIGHT_COUNT}];
uniform float uLightAmp[${LIGHT_COUNT}];
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
  for (int i = 0; i < ${LIGHT_COUNT}; i++) {
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
  /**
   * 取景：0 = 画面贴屏幕（按 4:3 的屏幕 cover，16:9 的视频于是左右各裁一截），
   * 1 = 铺满视口（按屏幕比例 cover，只裁比例差的那一点）。
   * 中间值由着色器在两套取景之间插值，见 scene-canvas 的 framingUv。
   * 由 hero-scene 的展开/收起动画写，静止时是 0。
   */
  framing: number;
};

/**
 * 一段画面。数组里放几段，屏幕上就换几段——只有 activeVideo 那一段会被采进纹理，
 * 其余的先解码备着（换段时不至于从零开始缓冲）。
 */
export type VideoSource = {
  /** 视频本体 */
  src: string;
  /** 这一段的视频首帧，解码前先顶上（也参与无 WebGL 时的兜底背景） */
  poster: string;
};

export function SceneCanvas({
  videos,
  asset,
  zoomAnchor: anchorMode,
  activeVideo = 0,
  state,
}: {
  /**
   * 画面（视频）列表：结构就是数组，一段也照样放进数组里。
   * 以后加「多视频切换」只要往这里加项、改 activeVideo，着色器与几何都不用动。
   */
  videos: readonly VideoSource[];
  /** PC 素材（显示器 + 草地），屏幕那块洞是全透明的 */
  asset: string;
  /**
   * 缩放支点：`screen` = 绕屏幕（素材里那块玻璃）中心，`canvas` = 绕画布中心。
   */
  zoomAnchor: "screen" | "canvas";
  /**
   * 当前在屏幕上播放的是 videos 里的第几段（硬切：换下标即换画面，不做交叉淡入）。
   * 越界会被夹回数组内；由外部 state/ref 驱动就不会触发 React 重渲染。
   */
  activeVideo?: number;
  /** 滚动/缩放状态，每帧读 */
  state: HeroState;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 屏幕上的每一段视频各一个元素，下标与 videos 一一对应 */
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  /** 当前在播第几段：渲染循环每帧读它，所以不走 React state */
  const activeRef = useRef(activeVideo);
  /** 容器露没露在视口里：render 里写，播放同步逻辑读（两边都不新建对象） */
  const awakeRef = useRef(true);

  /**
   * 数组里只有「当前那段」在播，别的先解码备着但不占纹理、也不出声：
   * 切换 = 换 activeRef.current，画面下一帧就换过来（纹理上传看它选元素）。
   * 整个场景滚出视野时 awake 关掉，这里也是唯一一处按住所有视频的地方。
   * 换段 effect 与渲染循环共用它，播放/暂停只有这一套判据。
   */
  const syncVideos = () => {
    const current = videoRefs.current[activeRef.current];
    videoRefs.current.forEach((element) => {
      if (!element) return;
      const wanted = awakeRef.current && element === current;
      if (wanted) void element.play().catch(() => {});
      else if (!element.paused) element.pause();
    });
  };

  // —— 换段：activeVideo 变了才走一次这个 effect；渲染循环那边因此不用每帧比对「谁在播」——
  // 数组里的段数只在「加段」时变，此时元素刚挂上，这里正好把起手该播的那段点起来。
  useEffect(() => {
    // 越界（数组变短、外部传了个错的）就夹回最后一格：宁可停在某一段上，也别让画面空掉
    const last = Math.max(0, videos.length - 1);
    activeRef.current = Math.min(Math.max(activeVideo, 0), last);
    syncVideos();
    // syncVideos 只读 ref，不需要进依赖；这里要的就是「换段了」与「段数变了」两个时机
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVideo, videos]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    /** 当前这一段（还没解码好就返回 null，画面先留上一帧的内容） */
    const pickActive = () => {
      const element = videoRefs.current[activeRef.current];
      return element && element.readyState >= 2 ? element : null;
    };

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

    // 素材：支持静态图片或带 alpha 通道的动态视频（如 .webm）。
    // 屏幕那块洞是全透明的，洞里由着色器自己画画面（见 FRAG）。
    const assetTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, assetTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    let assetUp = false;
    let assetUploadedTime = -1;
    const isVideoAsset = /\.(webm|mp4|mov|ogg)(\?.*)?$/i.test(asset);
    let assetVideo: HTMLVideoElement | null = null;
    let assetImage: HTMLImageElement | null = null;

    if (isVideoAsset) {
      assetVideo = document.createElement("video");
      assetVideo.src = asset;
      assetVideo.muted = true;
      assetVideo.loop = true;
      assetVideo.playsInline = true;
      assetVideo.autoplay = true;
      assetVideo.preload = "auto";
      assetVideo.onloadedmetadata = () => {
        const ratio = assetVideo!.videoWidth / assetVideo!.videoHeight;
        if (Math.abs(ratio - ART_RATIO) > 0.01) {
          console.warn(
            `[scene-canvas] ${asset} 的宽高比 ${ratio.toFixed(4)} 与 ART_RATIO ${ART_RATIO.toFixed(4)} 不一致，几何要重新对一遍（lib/hero-screen.ts）`,
          );
        }
      };
      assetVideo.oncanplay = () => {
        assetUp = true;
      };
      assetVideo.play().catch(() => {});
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      assetImage = new Image();
      assetImage.decoding = "async";
      assetImage.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, assetTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, assetImage!);
        gl.generateMipmap(gl.TEXTURE_2D);
        const ratio = assetImage!.naturalWidth / assetImage!.naturalHeight;
        if (Math.abs(ratio - ART_RATIO) > 0.01) {
          console.warn(
            `[scene-canvas] ${asset} 的宽高比 ${ratio.toFixed(4)} 与 ART_RATIO ${ART_RATIO.toFixed(4)} 不一致，几何要重新对一遍（lib/hero-screen.ts）`,
          );
        }
        assetUp = true;
      };
      assetImage.src = asset;
    }
    // —— 着色器里的固定表
    // 位置只查一次：每帧再 getUniformLocation/getAttribLocation 都是同步 GL 调用，白花时间
    const sceneLoc = {
      video: gl.getUniformLocation(scene, "uVideo"),
      res: gl.getUniformLocation(scene, "uRes"),
      buffer: gl.getUniformLocation(scene, "uBuffer"),
      lens: gl.getUniformLocation(scene, "uLens"),
      blurPx: gl.getUniformLocation(scene, "uBlurPx"),
      asset: gl.getUniformLocation(scene, "uAsset"),
      art: gl.getUniformLocation(scene, "uArt"),
      hole: gl.getUniformLocation(scene, "uHole"),
      boardScale: gl.getUniformLocation(scene, "uBoardScale"),
      assetAlpha: gl.getUniformLocation(scene, "uAssetAlpha"),
      assetLod: gl.getUniformLocation(scene, "uAssetLod"),
      holePad: gl.getUniformLocation(scene, "uHolePad"),
      zoomAnchor: gl.getUniformLocation(scene, "uZoomAnchor"),
      rectRest: gl.getUniformLocation(scene, "uRectRest"),
      rectFull: gl.getUniformLocation(scene, "uRectFull"),
      framing: gl.getUniformLocation(scene, "uFraming"),
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
    const lightPosUv = new Float32Array(LIGHT_COUNT * 2);
    /** 素材与屏幕洞在版面里的矩形（px）：版面一变就重新量，见 lib/hero-screen.ts */
    const artRect = new Float32Array(4);
    const holeRect = new Float32Array(4);
    // 画面两路取景的框与「视频那块矩形」（都是版面 px）：
    //   frameRest / rectRest —— 贴屏幕：框就是屏幕洞，视频 cover 在 4:3 的屏幕里；
    //   frameFull / rectFull —— 铺满：框是画布露在视口里的那一块，只按屏幕比例裁最少的一点。
    // 每帧只改后者的框与前者的矩形（鼠标视差、定点缩放），不新建对象。
    const frameRest: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const frameFull: Rect = { x: 0, y: 0, w: 0, h: 0 };
    /** 画布露在视口里的那一块（画布 px）：每帧从容器框量，再喂给 visibleFrame */
    const viewRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const rectRest = new Float32Array(4);
    const rectFull = new Float32Array(4);

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
    let singleClickTimer: ReturnType<typeof setTimeout> | null = null;
    /** 点击定点缩放的支点：**版面 px**（着色器里那套 board 坐标），两路取景共用同一个支点 */
    let pivotX = 0;
    let pivotY = 0;
    let pivotFromX = 0;              // 本次动画的支点起点/终点
    let pivotFromY = 0;
    let pivotToX = 0;
    let pivotToY = 0;
    let lens = 0;
    let lensTarget = 0;
    let uploadedTime = -1;
    /** 上一次传进纹理的是哪个 video 元素：换段时它变了，同一帧的 currentTime 也得重传一次 */
    let uploadedVideo: HTMLVideoElement | null = null;
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
      // 「贴屏幕」那一路的框 = 屏幕洞，整块版面不动它
      frameRest.x = holeRect[0];
      frameRest.y = holeRect[1];
      frameRest.w = holeRect[2];
      frameRest.h = holeRect[3];
      // 桌面绕屏幕中心（= 洞心，缩放不动的那个点），手机绕画布中心
      zoomAnchor[0] = anchorMode === "canvas" ? width / 2 : geom.hole.cx;
      zoomAnchor[1] = anchorMode === "canvas" ? height / 2 : geom.hole.cy;
      // 点击定点缩放的起手支点 = 屏幕中心（版面 px）。以后每帧算的「视频那块矩形」绕它缩放，
      // 所以支点必须与 holeRect / zoomAnchor 同一套坐标，不能再是屏幕内的局部 px。
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

    /**
     * 这一下点没点在画面（屏幕）里。
     *
     * 监听还挂在容器上（滚出去就收不到事件），但「算不算点到视频」由这个判据决定：
     * 容器比画面大得多，版面里除了屏幕那块，还有显示器边壳、草地和留边——那些地方点一下
     * 不该把画面推近。用的是着色器同一套坐标：holeRect / zoomAnchor / holePad 都是 resize()
     * 量好后喂给着色器的那几个数，state.scale 每帧被 GSAP 改，所以缩到哪一档都对得上。
     */
    const overScreen = (clientX: number, clientY: number) => {
      const rect = host.getBoundingClientRect();
      return hitsScreenHole(
        { x: clientX - rect.left, y: clientY - rect.top },
        {
          hole: { x: holeRect[0], y: holeRect[1], w: holeRect[2], h: holeRect[3] },
          pad: holePad,
          scale: Math.max(state.scale, 1e-3),
          anchor: { x: zoomAnchor[0], y: zoomAnchor[1] },
        },
      );
    };

    const doClickZoom = (clientX: number, clientY: number) => {
      const goingIn = zoomTo <= baseZoom + 1e-3;
      zoomFrom = zoom;
      zoomTo = goingIn ? maxZoom : baseZoom;
      zoomStart = performance.now();
      pivotFromX = pivotX;
      pivotFromY = pivotY;
      if (goingIn) {
        const rect = host.getBoundingClientRect();
        const k = Math.max(state.scale, 1e-3);
        // 点到的那个屏幕像素在版面里落在哪：与着色器里 board = anchor + (px - anchor)/k 同一套算法
        pivotToX = zoomAnchor[0] + (clientX - rect.left - zoomAnchor[0]) / k;
        pivotToY = zoomAnchor[1] + (clientY - rect.top - zoomAnchor[1]) / k;
      } else {
        // 收回来时支点回到屏幕中心（= 起手那个支点）
        pivotToX = holeRect[0] + holeRect[2] / 2;
        pivotToY = holeRect[1] + holeRect[3] / 2;
      }
      lensTarget = goingIn ? 1 : 0;
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("a, button, input, textarea, select, [contenteditable]")) return;
      // detail >= 2 表示是双击的一部分，取消单击延时
      if (event.detail >= 2) {
        if (singleClickTimer) {
          clearTimeout(singleClickTimer);
          singleClickTimer = null;
        }
        return;
      }
      // 点在画面外（显示器边壳、草地、留边）就当没点过：不排这个单击，也就不会推近。
      // 推近是在画面窗口「里面」改采样，窗口本身不动，所以放大态下这一片还是同一个判据——
      // 点画面推进去、再点画面收回来，都不会因为点了画面外而误触发。
      if (!overScreen(event.clientX, event.clientY)) return;
      if (singleClickTimer) clearTimeout(singleClickTimer);
      const cx = event.clientX;
      const cy = event.clientY;
      singleClickTimer = setTimeout(() => {
        singleClickTimer = null;
        doClickZoom(cx, cy);
      }, 250);
    };

    const onDblClick = () => {
      if (singleClickTimer) {
        clearTimeout(singleClickTimer);
        singleClickTimer = null;
      }
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
        awakeRef.current = awake;
        syncVideos();
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

      // 滚动动画写的几个数（普通对象，GSAP 每帧改）。素材还没解码完就先当它没显形：
      // 不全的黑图会糊住底下那块画面，等图到了再交给它。
      const boardScale = Math.max(state.scale, 1e-3);
      const assetAlpha = assetUp ? state.opacity : 0;
      const assetLod = Math.log2(1 + Math.max(0, state.blur));
      // 画面跟指针走的幅度：缩进屏幕里之后收一档（见 SHRUNK_FOLLOW），灯光的漂移不受影响
      const photoScale = follow();
      // 视差按当前放大倍数退回版面坐标：photoCurrent 记的是「屏幕上该走多少像素」，
      // 不除以 boardScale 的话，起手那种放大了五倍的状态下画面会被推得满屏乱跑。
      const parallaxX = (photoCurrent[0] * photoScale) / boardScale;
      const parallaxY = (photoCurrent[1] * photoScale) / boardScale;

      // 24fps 的视频配 60fps 的循环：同一帧不必反复上传（每帧一次 3.7MB 拷贝）
      const active = pickActive();
      if (active && (active !== uploadedVideo || active.currentTime !== uploadedTime)) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, active);
        uploadedVideo = active;
        uploadedTime = active.currentTime;
      }

      // —— 两路取景（都是版面 px），交给着色器按 state.framing 插值：
      // 一路是屏幕洞（贴屏幕），一路是「画布露在视口里的那一块」（铺满，只按屏幕比例裁最少的一点）。
      // 后者每帧都要量：画布露出来的那一段随滚动变，放大倍数也在动，两者都影响它在版面里的位置与大小。
      viewRect.x = 0;
      viewRect.y = Math.max(0, -rect.top);
      viewRect.w = width;
      viewRect.h = Math.max(1, Math.min(height, rect.top + window.innerHeight) - viewRect.y);
      visibleFrame(frameFull, boardScale, zoomAnchor[0], zoomAnchor[1], viewRect);
      // 视频解码前 videoWidth 还是 0，先用 16:9 顶着（与原来喂给 uVideoSize 的兜底一致）
      const videoW = active?.videoWidth || 16;
      const videoH = active?.videoHeight || 9;
      videoRect(rectRest, frameRest, videoW, videoH, pivotX, pivotY, zoom, parallaxX, parallaxY);
      // 「铺满」那一路把默认放大倍数归一掉：--scene-zoom（1.08）是给「画面缩在显示器里」垫的
      // （免得贴着屏幕边壳露馅），满屏之后没边壳可露，再留着它就只是白裁掉 8%。
      // 归一之后两路的点击推近倍数相对量一致（都是 zoom / baseZoom 倍），点一下看到的是同一个推近幅度。
      // 视差按 FULL_PARALLAX 压低：这一路是紧贴的 cover，没有余量可推。
      videoRect(
        rectFull,
        frameFull,
        videoW,
        videoH,
        pivotX,
        pivotY,
        zoom / baseZoom,
        parallaxX * FULL_PARALLAX,
        parallaxY * FULL_PARALLAX,
      );

      // 若素材是动态视频（如 WebM），也按帧更新纹理
      if (isVideoAsset && assetVideo && assetVideo.readyState >= 2 && assetVideo.currentTime !== assetUploadedTime) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, assetTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, assetVideo);
        assetUploadedTime = assetVideo.currentTime;
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
      gl.uniform1f(sceneLoc.lens, lens);
      gl.uniform1f(sceneLoc.blurPx, blurPx);
      gl.uniform4fv(sceneLoc.art, artRect);
      gl.uniform4fv(sceneLoc.hole, holeRect);
      gl.uniform1f(sceneLoc.boardScale, boardScale);
      gl.uniform1f(sceneLoc.assetAlpha, assetAlpha);
      gl.uniform1f(sceneLoc.assetLod, assetLod);
      gl.uniform1f(sceneLoc.holePad, holePad);
      gl.uniform2fv(sceneLoc.zoomAnchor, zoomAnchor);
      gl.uniform4fv(sceneLoc.rectRest, rectRest);
      gl.uniform4fv(sceneLoc.rectFull, rectFull);
      // 取景在「贴屏幕」与「铺满视口」之间插值：0/1 两端各是一套完整取景（含视差与定点缩放），
      // 中间是取景框在插值，见着色器的 framingUv。夹一下，防 GSAP 那边写进来个超出范围的数。
      gl.uniform1f(sceneLoc.framing, Math.min(1, Math.max(0, state.framing)));
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
      host.removeEventListener("dblclick", onDblClick);
      if (singleClickTimer) clearTimeout(singleClickTimer);
      host.removeEventListener("pointermove", onPointerMove);
      // 数组里每一段都停在原地，元素本身随 React 卸载
      for (const element of videoRefs.current) {
        if (!element) continue;
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      if (assetVideo) {
        assetVideo.pause();
        assetVideo.src = "";
        assetVideo.load();
      }
      gl.deleteTexture(texture);
      gl.deleteTexture(assetTexture);
      gl.deleteBuffer(quad);
      gl.deleteBuffer(dustPosBuffer);
      gl.deleteBuffer(dustSeedBuffer);
      gl.deleteProgram(scene);
    };
  }, [videos, asset, anchorMode, state]);

  return (
    <div ref={hostRef} className="absolute inset-0">
      {/* 视频段铺在画布下面：保持可见→浏览器不掐解码，被画布盖住→看不见；也当无 WebGL 时的兜底。
          数组里有几段就摆几个元素，只有当前这段不透明（.hero-video[data-active] 在 globals.css 里），
          换段于是是硬切；preload 分两档——非当前段只拉到能解码，换段时不至于从零开始缓冲。 */}
      {videos.map((video, index) => (
        <video
          key={video.src}
          ref={(element) => {
            videoRefs.current[index] = element;
          }}
          className="hero-video absolute inset-0 size-full object-cover"
          data-active={index === activeVideo}
          src={video.src}
          poster={video.poster}
          autoPlay={index === activeVideo}
          muted
          loop
          playsInline
          preload={index === activeVideo ? "auto" : "metadata"}
          aria-hidden
        />
      ))}
      <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
    </div>
  );
}
