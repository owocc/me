"use client";

import { useEffect, useRef } from "react";

/**
 * 背景场景（WebGL2 一块画布）：视频铺满 + 三层光 + 点击定点缩放 + 镜头畸变/四周失焦 + 灰尘粒子。
 *
 * 为什么从 DOM 换成画布：原先畸变走 SVG feDisplacementMap、四周失焦走 backdrop-filter，
 * 画面里只要有 <video>，这两层滤镜就得逐帧把视频喂进滤镜管线——实测放大态 50ms/帧（约 20fps）。
 * 这些效果在着色器里只是几次纹理采样，一趟画完。本机（无 GPU、软件光栅化）实测：
 * 空闲与放大态均 33ms/帧，视频暂停（不重传纹理）时 16.7ms/帧。
 *
 * 分工：
 *   · 视差、缩放缓动、镜头淡入淡出、粒子漂移都在这里的 rAF 里算；
 *   · 视频只是纹理来源：元素铺在画布下面（保持可见→浏览器不会掐掉解码，被画布盖住→看不见）；
 *   · 画布拿不到 WebGL2 时它自己隐藏，底下那段视频就是兜底背景。
 */

/** 三层光。origin/size/range 都是视口比例，和原来 CSS 里的写法一一对应。 */
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
uniform vec3 uLightColor[3];
uniform vec2 uLightPos[3];   // uv
uniform vec2 uLightSize[3];  // uv 半轴
uniform float uLightAmp[3];

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
  vec2 centered = (screenUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float radius = clamp(length(centered) / (0.5 * length(vec2(uRes.x / uRes.y, 1.0))), 0.0, 1.0);
  float edge = smoothstep(0.25, 1.0, radius);
  vec2 warpedUv = screenUv - (screenUv - 0.5) * (0.18 * uLens * edge);

  vec3 color = sampleVideo(videoUv(warpedUv), uBlurPx * uLens * edge);

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
uniform float uDust;
out float vBright;
void main() {
  float light = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 d = (aPos - uLightPos[i]) / uLightSize[i];
    light += clamp(1.0 - length(d) / 0.8, 0.0, 1.0) * uLightAmp[i];
  }
  // 光越足越亮；出了光就干脆不亮，不要整屏撒白点。
  // 单盏灯的中心光强只有 0.3 上下，所以阈值压得低，让一盏灯就够点亮附近的灰尘。
  vBright = smoothstep(0.05, 0.26, light) * uDust;
  // aPos 是 y 向下的屏幕 uv（和光的位置同一套坐标），GL 的 y 向上，这里翻一下
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
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
  console.warn("[bg-canvas] 着色器编译失败:", gl.getShaderInfoLog(shader));
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
  console.warn("[bg-canvas] 程序链接失败:", gl.getProgramInfoLog(program));
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

export function BackgroundCanvas({ src, poster }: { src: string; poster: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    const scene = gl ? link(gl, VERT, FRAG) : null;
    const dustProgram = gl ? link(gl, DUST_VERT, DUST_FRAG) : null;
    if (!gl || !scene || !dustProgram) {
      canvas.style.display = "none"; // 兜底：底下那段视频就是背景
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // —— 静态资源
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const quadPos = gl.getAttribLocation(scene, "aPos");

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
    const lightColor = gl.getUniformLocation(scene, "uLightColor");
    const lightPos = gl.getUniformLocation(scene, "uLightPos");
    const lightSize = gl.getUniformLocation(scene, "uLightSize");
    const lightAmp = gl.getUniformLocation(scene, "uLightAmp");
    const dustPosAttr = gl.getAttribLocation(dustProgram, "aPos");
    const dustSeedAttr = gl.getAttribLocation(dustProgram, "aSeed");
    const dustLightPos = gl.getUniformLocation(dustProgram, "uLightPos");
    const dustLightSize = gl.getUniformLocation(dustProgram, "uLightSize");
    const dustLightAmp = gl.getUniformLocation(dustProgram, "uLightAmp");

    const lightColors = new Float32Array(LIGHTS.flatMap((l) => toRgb(l.color)));
    const lightAmps = new Float32Array(LIGHTS.map((l) => Number(l.color.match(/\/\s*([\d.]+)%/)?.[1] ?? 30) / 100));
    const lightSizes = new Float32Array(LIGHTS.flatMap((l) => [...l.size]));
    const lightPosUv = new Float32Array(6);

    // —— CSS 令牌
    const blurPx = cssNumber("--lens-blur", 9);
    const durationMs = cssNumber("--zoom-duration", 900);
    const baseZoom = cssNumber("--scene-zoom", 1.08);
    const maxZoom = Math.min(cssNumber("--scene-zoom-in", 1.7), cssNumber("--scene-zoom-max", 2.2));
    const lensIn = cssNumber("--lens-in", 320) / 1000;
    const lensOut = cssNumber("--lens-out", 600) / 1000;
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
    let pivotX = 0;
    let pivotY = 0;
    let lens = 0;
    let lensTarget = 0;
    let uploadedTime = -1;
    const photoCurrent = [0, 0];
    const photoTarget = [0, 0];
    const lightCurrent = LIGHTS.map(() => [0, 0]);
    const lightTarget = LIGHTS.map(() => [0, 0]);

    const resize = () => {
      // 画布按 1:1 设备像素画：内容本身是 1280 宽的视频，放大到高 DPR 看不出差别，
      // 却要按面积多花几倍填充率（软件光栅化时尤其明显）。
      const dpr = 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (!pivotX && !pivotY) {
        pivotX = width / 2;
        pivotY = height / 2;
      }
    };

    /** 定点缩放时把支点夹进「可见画面仍落在视频内」的区间，保证不露底 */
    const clampPivot = (x: number, y: number, z: number) => {
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const cover = Math.max(width / vw, height / vh);
      const dw = vw * cover;
      const dh = vh * cover;
      const ox = (width - dw) / 2 - photoCurrent[0];
      const oy = (height - dh) / 2 - photoCurrent[1];
      const k = z / (z - 1);
      pivotX = Math.min((ox + dw - width / z) * k, Math.max(ox * k, x));
      pivotY = Math.min((oy + dh - height / z) * k, Math.max(oy * k, y));
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("a, button, input, textarea, select, [contenteditable]")) return;
      const goingIn = zoomTo <= baseZoom + 1e-3;
      zoomFrom = zoom;
      zoomTo = goingIn ? maxZoom : baseZoom;
      zoomStart = performance.now();
      clampPivot(event.clientX, event.clientY, Math.max(zoomFrom, zoomTo));
      lensTarget = goingIn ? 1 : 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (reduced) return;
      const nx = (event.clientX / width - 0.5) * 2;
      const ny = (event.clientY / height - 0.5) * 2;
      photoTarget[0] = nx * PHOTO_PARALLAX.range[0] * PHOTO_PARALLAX.direction;
      photoTarget[1] = ny * PHOTO_PARALLAX.range[1] * PHOTO_PARALLAX.direction;
      for (let i = 0; i < LIGHTS.length; i++) {
        lightTarget[i][0] = (nx * LIGHTS[i].range[0]) / 100;
        lightTarget[i][1] = (ny * LIGHTS[i].range[1]) / 100;
      }
    };

    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // 缩放缓动
      if (zoom !== zoomTo) {
        const t = Math.min(1, (now - zoomStart) / durationMs);
        zoom = zoomFrom + (zoomTo - zoomFrom) * ease(t);
        if (t >= 1) zoom = zoomTo;
      }
      // 镜头：进得快、退得稳
      if (lens < lensTarget) lens = Math.min(lensTarget, lens + dt / lensIn);
      else if (lens > lensTarget) lens = Math.max(lensTarget, lens - dt / lensOut);

      // 视差缓动
      for (let i = 0; i < 2; i++) photoCurrent[i] += (photoTarget[i] - photoCurrent[i]) * PHOTO_PARALLAX.ease;
      for (let i = 0; i < LIGHTS.length; i++) {
        lightCurrent[i][0] += (lightTarget[i][0] - lightCurrent[i][0]) * LIGHTS[i].ease;
        lightCurrent[i][1] += (lightTarget[i][1] - lightCurrent[i][1]) * LIGHTS[i].ease;
        lightPosUv[i * 2] = LIGHTS[i].origin[0] + lightCurrent[i][0];
        lightPosUv[i * 2 + 1] = LIGHTS[i].origin[1] + lightCurrent[i][1];
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
      gl.uniform1i(gl.getUniformLocation(scene, "uVideo"), 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform2f(gl.getUniformLocation(scene, "uRes"), width, height);
      gl.uniform2f(gl.getUniformLocation(scene, "uBuffer"), canvas.width, canvas.height);
      gl.uniform2f(gl.getUniformLocation(scene, "uVideoSize"), video.videoWidth || 16, video.videoHeight || 9);
      gl.uniform2f(gl.getUniformLocation(scene, "uPhotoOffset"), photoCurrent[0], photoCurrent[1]);
      gl.uniform1f(gl.getUniformLocation(scene, "uZoom"), zoom);
      gl.uniform2f(gl.getUniformLocation(scene, "uPivot"), pivotX, pivotY);
      gl.uniform1f(gl.getUniformLocation(scene, "uLens"), lens);
      gl.uniform1f(gl.getUniformLocation(scene, "uBlurPx"), blurPx);
      gl.uniform3fv(lightColor, lightColors);
      gl.uniform2fv(lightPos, lightPosUv);
      gl.uniform2fv(lightSize, lightSizes);
      gl.uniform1fv(lightAmp, lightAmps);
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
        gl.uniform2fv(dustLightPos, lightPosUv);
        gl.uniform2fv(dustLightSize, lightSizes);
        gl.uniform1fv(dustLightAmp, lightAmps);
        gl.uniform1f(gl.getUniformLocation(dustProgram, "uDust"), DUST_AMOUNT * (0.7 + 0.3 * lens));
        gl.drawArrays(gl.POINTS, 0, DUST_COUNT);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("click", onClick);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("click", onClick);
      window.removeEventListener("pointermove", onPointerMove);
      gl.deleteTexture(texture);
      gl.deleteBuffer(quad);
      gl.deleteBuffer(dustPosBuffer);
      gl.deleteBuffer(dustSeedBuffer);
      gl.deleteProgram(scene);
      gl.deleteProgram(dustProgram);
    };
  }, [src]);

  return (
    <div className="absolute inset-0">
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
