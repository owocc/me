"use client";

import { useEffect } from "react";

type Point = { x: number; y: number };

/**
 * 点击缩放：点画面 → 以点击处为定点把整个场景推近，再点一次复位。
 *
 * 定点缩放不用 transform-origin —— 改它会让支点瞬移，画面看上去就是「跳一下」。
 * 这里把支点钉死在左上角（CSS 里 transform-origin: 0 0），绕哪一点推近完全交给
 * translate + scale 这一对矩阵：两者都是 transform 的组成部分，浏览器会一起插值，
 * 所以动画起手的第一帧就是当前画面，没有跳变。
 *
 * 起算点是场景**当前**的计算矩阵，不是默认值——动画跑到一半再点，也从前眼前的位置接着走。
 *
 * 两道限制：
 *   1. 平移夹进「可见窗口仍落在照片内」的区间，越界就会露出 body 的纯色底；
 *   2. 放大倍数封顶（--scene-zoom-max），再往上推照片已经糊得没有意义。
 * 窗口尺寸一变，照片与容器的尺寸全变了，内联的 px 会失效——所以 resize 时按记住的
 * 支点用新尺寸重算一次（缩小窗口时最容易露底，这一步是必须的）。
 */
export function SceneZoom() {
  useEffect(() => {
    const found = document.querySelector<HTMLElement>(".bg-scene");
    if (!found) return;
    const scene: HTMLElement = found;
    const rootStyle = getComputedStyle(document.documentElement);
    const duration = parseFloat(rootStyle.getPropertyValue("--zoom-duration")) || 900;
    const base = parseFloat(rootStyle.getPropertyValue("--scene-zoom")) || 1.08;
    const zoomIn = Math.min(parseFloat(rootStyle.getPropertyValue("--scene-zoom-in")) || 1.7, parseFloat(rootStyle.getPropertyValue("--scene-zoom-max")) || 2.2);
    // 照片外扩的保护边扣掉视差位移量之后，才是「无论视差跑到哪一端都还盖住」的余量。
    // 夹紧必须用这个净余量，否则视差把照片推走时，边界那几像素就会露出纯色底。
    const safeX = (parseFloat(rootStyle.getPropertyValue("--scene-guard-x")) || 0) - (parseFloat(rootStyle.getPropertyValue("--bg-shift-range-x")) || 0);
    const safeY = (parseFloat(rootStyle.getPropertyValue("--scene-guard-y")) || 0) - (parseFloat(rootStyle.getPropertyValue("--bg-shift-range-y")) || 0);
    const root = document.documentElement;
    let zoomed = false;
    let anchorX = 0;
    let anchorY = 0;
    let settleTimer = 0;

    /**
     * 以 (anchorX, anchorY) 为定点缩放到 scale：从场景**当前**的矩阵出发，
     * 解出让该点不动的平移，再夹进安全区间，最后写回内联 transform。
     */
    function applyZoom(scale: number, anchor: Point) {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(scene).transform);
      const fromScale = matrix.a || 1;
      const ratio = scale / fromScale;
      const wantX = anchor.x - ratio * (anchor.x - matrix.e);
      const wantY = anchor.y - ratio * (anchor.y - matrix.f);

      // 可见窗口 v ∈ [0, W] 映射到场景坐标 e = (v − t)/z，要求 e 落在照片的保底范围
      // [−safe, W+safe] 内（safe = 保护边 − 视差上限），否则视差一推就露出纯色底。
      const width = window.innerWidth;
      const height = window.innerHeight;
      const x = Math.min(safeX * scale, Math.max(width * (1 - scale) - safeX * scale, wantX));
      const y = Math.min(safeY * scale, Math.max(height * (1 - scale) - safeY * scale, wantY));
      scene.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale})`;
    }

    function onClick(event: MouseEvent) {
      const target = event.target as Element | null;
      if (target?.closest("a, button, input, textarea, select, [contenteditable]")) return;
      clearTimeout(settleTimer);

      anchorX = event.clientX;
      anchorY = event.clientY;
      zoomed = !zoomed;
      applyZoom(zoomed ? zoomIn : base, { x: anchorX, y: anchorY });
      // 放大态：畸变滤镜挂上并一直留着，四周失焦与折射高光淡入；
      // 复位：滤镜摘掉，另两层按 --lens-out 逐渐消失。
      root.classList.toggle("scene-zoomed", zoomed);

      if (!zoomed) {
        settleTimer = window.setTimeout(() => {
          scene.style.removeProperty("transform");
        }, duration + 60);
      }
    }

    function onResize() {
      if (!zoomed) {
        scene.style.removeProperty("transform");
        return;
      }
      // 尺寸变了：旧的内联 px 已经不对，必须按新尺寸重算并重新夹一次
      // （缩小窗口时最容易露底）。这里要**跳过过渡**：过渡会从旧值滑向新值，
      // 而旧值此刻已经越界，滑的过程就会把背景露出来。
      const current = new DOMMatrixReadOnly(getComputedStyle(scene).transform).a || zoomIn;
      scene.style.transition = "none";
      applyZoom(current, { x: Math.min(anchorX, window.innerWidth), y: Math.min(anchorY, window.innerHeight) });
      void scene.offsetHeight;
      scene.style.transition = "";
    }

    window.addEventListener("click", onClick);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
      clearTimeout(settleTimer);
      scene.style.removeProperty("transform");
      root.classList.remove("scene-zoomed");
    };
  }, []);

  return null;
}
