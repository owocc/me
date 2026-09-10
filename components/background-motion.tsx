"use client";

import { useEffect } from "react";

type Track = {
  /** 位移上限：背景是 px，光层是百分比 */
  rangeX: number;
  rangeY: number;
  /** 每帧追向目标的步长：越小越黏，越大越跟手 */
  ease: number;
  /** 1 = 跟着指针走，-1 = 与指针相反（越远的东西走得越反） */
  direction: number;
  targetX: number;
  targetY: number;
  currentX: number;
  currentY: number;
  write: (x: number, y: number) => void;
};

/**
 * 指针视差：鼠标一动，背景和每一层光各按自己的幅度与速度跟上去。
 * 背景离得最远——平移、方向与指针相反、幅度最小；光层越近越小越亮，
 * 幅度越大、跟得越快（参数逐层写在 globals.css 的 .bg-light-* 里，组件只负责读和插值）。
 *
 * 每帧只走剩余距离的一小部分，所以画面与指针之间天然有一段时间差，
 * 停下鼠标后各层还会按自己的速度各自收尾，分层感就出来了。
 *
 * 触屏（pointer: coarse）和「减少动态效果」下整体不启用，所有层保持静止。
 */
export function BackgroundMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const root = document.documentElement;
    const rootCss = getComputedStyle(root);
    const tracks: Track[] = [
      {
        rangeX: parseFloat(rootCss.getPropertyValue("--bg-shift-range-x")) || 18,
        rangeY: parseFloat(rootCss.getPropertyValue("--bg-shift-range-y")) || 12,
        ease: 0.07,
        direction: -1,
        targetX: 0,
        targetY: 0,
        currentX: 0,
        currentY: 0,
        write: (x, y) => {
          root.style.setProperty("--bg-shift-x", x.toFixed(2));
          root.style.setProperty("--bg-shift-y", y.toFixed(2));
        },
      },
      ...[...document.querySelectorAll<HTMLElement>("[data-bg-light]")].map((element): Track => {
        const css = getComputedStyle(element);
        return {
          rangeX: parseFloat(css.getPropertyValue("--lh-shift-range-x")) || 18,
          rangeY: parseFloat(css.getPropertyValue("--lh-shift-range-y")) || 14,
          ease: parseFloat(css.getPropertyValue("--lh-ease")) || 0.1,
          direction: parseFloat(css.getPropertyValue("--lh-direction")) || 1,
          targetX: 0,
          targetY: 0,
          currentX: 0,
          currentY: 0,
          write: (x, y) => {
            element.style.setProperty("--lh-shift-x", x.toFixed(2));
            element.style.setProperty("--lh-shift-y", y.toFixed(2));
          },
        };
      }),
    ];

    const SETTLED = 0.05;
    let frame = 0;

    function tick() {
      let moving = false;
      for (const track of tracks) {
        track.currentX += (track.targetX - track.currentX) * track.ease;
        track.currentY += (track.targetY - track.currentY) * track.ease;
        track.write(track.currentX, track.currentY);
        if (Math.abs(track.targetX - track.currentX) > SETTLED || Math.abs(track.targetY - track.currentY) > SETTLED) moving = true;
      }
      frame = moving ? requestAnimationFrame(tick) : 0;
    }

    function onPointerMove(event: PointerEvent) {
      const nx = (event.clientX / window.innerWidth - 0.5) * 2;
      const ny = (event.clientY / window.innerHeight - 0.5) * 2;
      for (const track of tracks) {
        track.targetX = nx * track.rangeX * track.direction;
        track.targetY = ny * track.rangeY * track.direction;
      }
      if (!frame) frame = requestAnimationFrame(tick);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--bg-shift-x");
      root.style.removeProperty("--bg-shift-y");
      for (const light of document.querySelectorAll<HTMLElement>("[data-bg-light]")) {
        light.style.removeProperty("--lh-shift-x");
        light.style.removeProperty("--lh-shift-y");
      }
    };
  }, []);

  return null;
}
