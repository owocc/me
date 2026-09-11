"use client";

import { useEffect, useRef } from "react";

/**
 * 首屏场景（WebGL2 一块画布）：视频铺满 + 三层光 + 点击定点缩放 + 镜头畸变/四周失焦 + 灰尘粒子。
 *
 * 为什么从 DOM 换成画布：原先畸变走 SVG feDisplacementMap、四周失焦走 backdrop-filter，
 * 画面里只要有 <video>，这两层滤镜就得逐帧把视频喂进滤镜管线——实测放大态 50ms/帧（约 20fps）。
 * 这些效果在着色器里只是几次纹理采样，一趟画完。本机（无 GPU、软件光栅化）实测：
 * 空闲与放大态均 33ms/帧，视频暂停（不重传纹理）时 16.7ms/帧。
 *
 * 分工：
 *   · 视差、缩放缓动、镜头淡入淡出、粒子漂移都在这里的 rAF 里算；
 *   · 滚动模糊（画面从屏幕底部往上糊、随滚动加深）在片段着色器里算，见 FRAG 里的 uSweep；
 *   · 尺寸只认自己那个容器的框（首屏里那层会动的画面，见 hero-scene.tsx）：容器是一块 16:9
 *     （宽度按「盖住版面」算，满屏时比视口大，缩进显示器时正好盖住屏幕那块洞），不铺到整页；
 *     光/粒子/镜头这些按版面调的参数在 resize() 里换算进画布坐标，露在视口里的那部分才不走样；
 *     指针/点击也只认容器内的坐标，滚到下面的板块上时画面不再跟着动；
 *   · 视频只是纹理来源：元素铺在画布下面（保持可见→浏览器不会掐掉解码，被画布盖住→看不见）；
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
uniform vec2 uRes;        // CSS 像素（cover / 支点都用它）
uniform vec2 uBuffer;     // 绘制缓冲像素（gl_FragCoord 的量纲，含 DPR）
uniform vec2 uVideoSize;
uniform vec2 uPhotoOffset;   // px
uniform float uZoom;
uniform vec2 uPivot;         // px
uniform float uLens;         // 0..1
uniform float uBlurPx;
uniform float uSweep;        // 0..1：往下滚了多少（一屏 = 1）
uniform float uSweepBlur;    // 滚到底那一档的最大模糊半径（px）
uniform float uEdgePx;       // 纸的上沿在屏幕上的 y（px，0 = 屏幕顶）
uniform float uViewTop;      // 画面层顶边在视口里的 y（px）
uniform float uViewH;        // 视口高（px）
uniform vec3 uLightColor[3];
uniform vec2 uLightPos[3];   // uv（画布）
uniform vec2 uLightSize[3];  // uv 半轴
uniform float uLightAmp[3];
uniform vec2 uBoxScale;      // 版面（首屏那一屏）占画布的比例：画布是整块 16:9，比版面宽出来的部分不在视口里

// 滚动模糊：一条贴着纸上沿往上铺的模糊带——越靠近纸越糊，往上渐清晰，整条随滚动加深。
// 之所以贴着纸的上沿而不是屏幕底：纸盖上来以后屏幕底下那半截早被纸挡住了，
// 把最糊的一段放在那儿等于白糊；纸的上沿才是「画面还露着的最下边」。
const float SWEEP_BAND = 0.4;   // 模糊带高度（占视口高的比例）

out vec4 outColor;

// 屏幕 uv（y 向下）→ 视频 uv（含 cover 裁切、视差、定点缩放）
vec2 videoUv(vec2 screenUv) {
  vec2 px = screenUv * uRes;
  vec2 zoomed = uPivot + (px - uPivot) / uZoom;
  float cover = max(uRes.x / uVideoSize.x, uRes.y / uVideoSize.y);
  vec2 displayed = uVideoSize * cover;
  vec2 origin = (uRes - displayed) * 0.5 - uPhotoOffset;
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
    sum += tex(uv + vec2(cos(a), sin(a)) * r / uRes);
  }
  return sum / 8.0;
}

void main() {
  // gl_FragCoord 是绘制缓冲像素（含 DPR），先归一到 0..1；y 翻转成左上为原点
  vec2 screenUv = vec2(gl_FragCoord.x / uBuffer.x, 1.0 - gl_FragCoord.y / uBuffer.y);

  // 镜头：越靠边越往画面中心取采样（等于把四周向外拉伸），并叠加失焦
  // 半径按「版面」归一（uBoxScale 把画布坐标换回版面坐标）：画布比版面宽出来的那截不算数。
  // 否则露在视口里的那块版面永远落在画布的中央，四周的畸变与失焦就没了——竖屏手机上尤其明显。
  vec2 boxUv = 0.5 + (screenUv - 0.5) / uBoxScale;
  vec2 boxRes = uRes * uBoxScale;
  vec2 centered = (boxUv - 0.5) * vec2(boxRes.x / boxRes.y, 1.0);
  float radius = clamp(length(centered) / (0.5 * length(vec2(boxRes.x / boxRes.y, 1.0))), 0.0, 1.0);
  float edge = smoothstep(0.25, 1.0, radius);
  vec2 warpedUv = screenUv - (screenUv - 0.5) * (0.18 * uLens * edge);

  // 滚动模糊：vy 是像素在屏幕上的位置（0 = 屏幕顶，1 = 屏幕底）。
  // uViewTop 是画布顶边在视口里的 y，加它才是屏幕坐标（减号会把整幅画面推到屏幕底下去）。
  float vy = (screenUv.y * uRes.y + uViewTop) / max(uViewH, 1.0);
  float edgeVy = uEdgePx / max(uViewH, 1.0);
  float sweepT = clamp(1.0 - (edgeVy - vy) / SWEEP_BAND, 0.0, 1.0);
  float sweepPx = uSweep * uSweepBlur * sweepT;

  vec3 color = sampleVideo(videoUv(warpedUv), uBlurPx * uLens * edge + sweepPx);

  // 三层光：screen 叠加，位置各自跟着指针漂移
  for (int i = 0; i < 3; i++) {
    vec2 d = (screenUv - uLightPos[i]) / uLightSize[i];
    float alpha = clamp(1.0 - length(d) / 0.72, 0.0, 1.0);
    color = 1.0 - (1.0 - color) * (1.0 - uLightColor[i] * alpha * uLightAmp[i]);
  }

  outColor = vec4(color, 1.0);
}`;

const DUST_VERT = `#version 300 es
in vec2 aPos;
in float aSeed;
uniform vec2 uLightPos[3];
uniform vec2 uLightSize[3];
uniform float uLightAmp[3];
uniform vec2 uBoxScale;
uniform float uDust;
out float vBright;
void main() {
  // aPos 是版面 uv（和光的位置同一套坐标），换算成画布 uv 再画：只画在视口里那块版面上
  vec2 p = 0.5 + (aPos - 0.5) * uBoxScale;
  float light = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 d = (p - uLightPos[i]) / uLightSize[i];
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
in float vBright;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * vBright;
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

/** oklch 字符串 → 0..1 的 rgb：借 canvas 让浏览器自己换算。 */
function toRgb(color: string): [number, number, number] {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [1, 1, 1];
  ctx.fillStyle = color;
  const hex = ctx.fillStyle.startsWith("#") ? ctx.fillStyle.slice(1) : "ffffff";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
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

export function SceneCanvas({ src, poster }: { src: string; poster: string }) {
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
      sweep: gl.getUniformLocation(scene, "uSweep"),
      sweepBlur: gl.getUniformLocation(scene, "uSweepBlur"),
      edgePx: gl.getUniformLocation(scene, "uEdgePx"),
      viewTop: gl.getUniformLocation(scene, "uViewTop"),
      viewH: gl.getUniformLocation(scene, "uViewH"),
      lightColor: gl.getUniformLocation(scene, "uLightColor"),
      lightPos: gl.getUniformLocation(scene, "uLightPos"),
      lightSize: gl.getUniformLocation(scene, "uLightSize"),
      lightAmp: gl.getUniformLocation(scene, "uLightAmp"),
      boxScale: gl.getUniformLocation(scene, "uBoxScale"),
    };
    const dustPosAttr = gl.getAttribLocation(dustProgram, "aPos");
    const dustSeedAttr = gl.getAttribLocation(dustProgram, "aSeed");
    const dustLoc = {
      lightPos: gl.getUniformLocation(dustProgram, "uLightPos"),
      lightSize: gl.getUniformLocation(dustProgram, "uLightSize"),
      lightAmp: gl.getUniformLocation(dustProgram, "uLightAmp"),
      boxScale: gl.getUniformLocation(dustProgram, "uBoxScale"),
      dust: gl.getUniformLocation(dustProgram, "uDust"),
    };

    const lightColors = new Float32Array(LIGHTS.flatMap((l) => toRgb(l.color)));
    const lightAmps = new Float32Array(LIGHTS.map((l) => Number(l.color.match(/\/\s*([\d.]+)%/)?.[1] ?? 30) / 100));
    // 光的尺寸（uv 半轴）在 resize() 里按版面占画布的比例换算到画布坐标，所以这份是运行时值
    const lightSizesUv = new Float32Array(LIGHTS.flatMap((l) => [...l.size]));
    const lightPosUv = new Float32Array(6);
    /** 画布与「版面」的换算比：现在画布就是屏幕那块，恒等 */
    const boxScale = new Float32Array([1, 1]);

    // —— CSS 令牌
    const blurPx = cssNumber("--lens-blur", 9);
    const sweepBlurPx = cssNumber("--sweep-blur", 12);
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
    /** 版面上的「一屏」高度（px），在 resize() 里量 */
    let screenH = 0;
    const photoCurrent = [0, 0];
    const photoTarget = [0, 0];
    const lightCurrent = LIGHTS.map(() => [0, 0]);
    const lightTarget = LIGHTS.map(() => [0, 0]);

    const resize = () => {
      // 画布按 1:1 设备像素画：内容本身是 1280 宽的视频，放大到高 DPR 看不出差别，
      // 却要按面积多花几倍填充率（软件光栅化时尤其明显）。
      // 尺寸取自容器而不是视口：容器就是屏幕那一块画面（hero-scene.tsx 按素材里的屏幕洞量出来），
      // 场景才跟着屏幕走。
      // 用 offsetWidth/Height（排版尺寸）而不是 getBoundingClientRect()：外层把它缩进屏幕里时，
      // 变换后的 rect 是缩过的，画布连同着色器里的 res 都会被量小，画面糊掉。
      // 排版尺寸不受祖先 transform 影响，画布始终按「放到最大那一档」在画（见 landing().w），
      // 缩下去只是被显示得小。
      const dpr = 1;
      width = host.offsetWidth;
      height = host.offsetHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      // 画布就是屏幕那一块（见 hero-scene.tsx）：光的位置/尺寸、粒子位置、镜头半径原本都按
      // 「版面」（首屏那一屏）调过，现在整块画布都在屏幕里，一比一换算即可——它们于是就配在
      // 屏幕这个框里，画面是真的适配屏幕，而不是从一块大画面里裁一块塞进去。
      boxScale[0] = 1;
      boxScale[1] = 1;
      for (let i = 0; i < LIGHTS.length; i++) {
        lightSizesUv[i * 2] = LIGHTS[i].size[0] * boxScale[0];
        lightSizesUv[i * 2 + 1] = LIGHTS[i].size[1] * boxScale[1];
      }
      // 版面上的「一屏」高度（占位层是 100vh）：滚动模糊的进度按它算，不按 window.innerHeight——
      // 手机上滚起来地址栏会收，innerHeight 会跳一次，模糊就不该跟着跳。它只在版面变的时候才变，
      // 所以搭在这里量一次就够。
      screenH = host.closest(".hero-scene")?.clientHeight ?? window.innerHeight;
      if (!pivotX && !pivotY) {
        pivotX = pivotFromX = pivotToX = width / 2;
        pivotY = pivotFromY = pivotToY = height / 2;
      }
    };

    /**
     * 把支点夹进「放大后可见画面仍落在视频内」的区间，保证任何放大倍数都不露底。
     * 两端都夹好之后再让支点在两者之间线性走也不会越界：上界随 z 单调递减、
     * 下界随 z 单调递增，缩放往回走时可行区间只会变宽。
     * 另外留出视差幅度当余量，免得动画途中鼠标一动就把采样推出画面外。
     */
    const clampPivot = (x: number, y: number, z: number) => {
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const cover = Math.max(width / vw, height / vh);
      const dw = vw * cover;
      const dh = vh * cover;
      const ox = (width - dw) / 2 - photoCurrent[0];
      const oy = (height - dh) / 2 - photoCurrent[1];
      const mx = PHOTO_PARALLAX.range[0];
      const my = PHOTO_PARALLAX.range[1];
      const k = z / (z - 1);
      return {
        x: Math.min((ox + dw - width / z - mx) * k, Math.max((ox + mx) * k, x)),
        y: Math.min((oy + dh - height / z - my) * k, Math.max((oy + my) * k, y)),
      };
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
      pivotFromX = pivotX;
      pivotFromY = pivotY;
      if (goingIn) {
        // 点击坐标是视口的，画布的支点是容器内的：减去容器左上角，往下滚过也不会错位
        const rect = host.getBoundingClientRect();
        const spot = clampPivot(event.clientX - rect.left, event.clientY - rect.top, maxZoom);
        pivotToX = spot.x;
        pivotToY = spot.y;
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

      // 滚动模糊（着色器里算）：一条贴着纸的上沿往上铺的模糊带，随滚动加深。
      // · 进度按版面高度（100vh）算，不按 window.innerHeight —— 地址栏收放不会让它跳；
      // · 纸的上沿 = 版面高 - 已经滚掉的距离（纸的起点就在首屏底下）；
      // · 屏幕底的位置另用 rect.top + window.innerHeight 换算：画布比屏幕高、还跟着视差在动。
      const viewH = window.innerHeight;
      const sweep = Math.min(1, Math.max(0, window.scrollY / Math.max(screenH, 1)));

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
        // origin 与漂移都是版面比例，换算到画布坐标再传（画布比版面宽出来的部分不参与）
        lightPosUv[i * 2] = 0.5 + (LIGHTS[i].origin[0] + lightCurrent[i][0] - 0.5) * boxScale[0];
        lightPosUv[i * 2 + 1] = 0.5 + (LIGHTS[i].origin[1] + lightCurrent[i][1] - 0.5) * boxScale[1];
      }

      // 24fps 的视频配 60fps 的循环：同一帧不必反复上传（每帧一次 3.7MB 拷贝）
      if (video.readyState >= 2 && video.currentTime !== uploadedTime) {
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform2f(sceneLoc.res, width, height);
      gl.uniform2f(sceneLoc.buffer, canvas.width, canvas.height);
      gl.uniform2f(sceneLoc.videoSize, video.videoWidth || 16, video.videoHeight || 9);
      gl.uniform2f(sceneLoc.photoOffset, photoCurrent[0], photoCurrent[1]);
      gl.uniform1f(sceneLoc.zoom, zoom);
      gl.uniform2f(sceneLoc.pivot, pivotX, pivotY);
      gl.uniform1f(sceneLoc.lens, lens);
      gl.uniform1f(sceneLoc.blurPx, blurPx);
      gl.uniform1f(sceneLoc.sweep, sweep);
      gl.uniform1f(sceneLoc.sweepBlur, sweepBlurPx);
      // 滚动模糊在着色器里按「屏幕坐标」算，而这块画布比视口大（还整体缩着）：先把视口换回画布像素。
      // scale 是画面当前被缩到几分之一（含素材推近），rect 是变换后的框——减掉半高就是没缩过的顶边。
      const fit = rect.width / width;
      const canvasTop = rect.top + rect.height / 2 - (height * fit) / 2;
      gl.uniform1f(sceneLoc.edgePx, (screenH - window.scrollY) / fit);
      gl.uniform1f(sceneLoc.viewTop, canvasTop / fit);
      gl.uniform1f(sceneLoc.viewH, viewH / fit);
      gl.uniform2fv(sceneLoc.boxScale, boxScale);
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
        gl.uniform2fv(dustLoc.boxScale, boxScale);
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
      gl.deleteBuffer(quad);
      gl.deleteBuffer(dustPosBuffer);
      gl.deleteBuffer(dustSeedBuffer);
      gl.deleteProgram(scene);
      gl.deleteProgram(dustProgram);
    };
  }, [src]);

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
