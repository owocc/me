"use client";

import { useEffect } from "react";

/**
 * 点击缩放：点画面 → 以点击处为定点把整个场景推近，再点一次复位。
 *
 * 定点缩放不用 transform-origin —— 改它会让支点瞬移，画面看上去就是「跳一下」。
 * 这里把支点钉死在左上角（CSS 里 transform-origin: 0 0），绕哪一点推近完全交给
 * translate + scale 这一对矩阵：两者都是 transform 的组成部分，浏览器会一起插值，
 * 所以动画起手的第一帧就是当前画面，没有跳变。
 *
 * 起算点是场景**当前**的计算矩阵，不是默认值——动画跑到一半再点，也从前眼前的位置接着走。
 * 复位动画结束后把内联 transform 交还给 CSS，免得内联的 px 在窗口尺寸变化后失效。
 */
export function SceneZoom() {
  useEffect(() => {
    const found = document.querySelector<HTMLElement>(".bg-scene");
    if (!found) return;
    const scene: HTMLElement = found;
    const rootStyle = getComputedStyle(document.documentElement);
    const duration = parseFloat(rootStyle.getPropertyValue("--zoom-duration")) || 900;
    const base = parseFloat(rootStyle.getPropertyValue("--scene-zoom")) || 1.08;
    const zoomIn = parseFloat(rootStyle.getPropertyValue("--scene-zoom-in")) || 1.7;
    // 照片外扩的保护边：可见窗口必须落在照片范围内，算出来的平移要夹在这个区间里
    const guardX = parseFloat(rootStyle.getPropertyValue("--scene-guard-x")) || 0;
    const guardY = parseFloat(rootStyle.getPropertyValue("--scene-guard-y")) || 0;
    let zoomed = false;
    let settleTimer = 0;

    function onClick(event: MouseEvent) {
      const target = event.target as Element | null;
      if (target?.closest("a, button, input, textarea, select, [contenteditable]")) return;
      clearTimeout(settleTimer);

      // 当前矩阵（动画途中读到的就是途中值）：v = translate + scale · e
      const matrix = new DOMMatrixReadOnly(getComputedStyle(scene).transform);
      const fromScale = matrix.a || 1;
      const scale = zoomed ? base : zoomIn;

      // 让点击处 P 缩放前后都停在原地：t₁ = P − (z₁/z₀)·(P − t₀)
      const ratio = scale / fromScale;
      const wantX = event.clientX - ratio * (event.clientX - matrix.e);
      const wantY = event.clientY - ratio * (event.clientY - matrix.f);

      // 夹住平移：超出这个区间，边缘就会露出 body 的纯色底。
      // 可见窗口 v ∈ [0, W] 映射到场景坐标 e = (v − t)/z，要求 e 落在
      // 照片的保底范围 [−8, W+8] 内（保护边已扣掉视差位移量）。
      const width = window.innerWidth;
      const height = window.innerHeight;
      const x = Math.min(guardX * scale, Math.max(width * (1 - scale) - guardX * scale, wantX));
      const y = Math.min(guardY * scale, Math.max(height * (1 - scale) - guardY * scale, wantY));

      scene.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale})`;
      zoomed = !zoomed;

      if (!zoomed) {
        settleTimer = window.setTimeout(() => {
          scene.style.removeProperty("transform");
        }, duration + 60);
      }
    }

    function onResize() {
      if (!zoomed) scene.style.removeProperty("transform");
    }

    window.addEventListener("click", onClick);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
      clearTimeout(settleTimer);
      scene.style.removeProperty("transform");
    };
  }, []);

  return null;
}
