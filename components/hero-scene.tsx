"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { SceneCanvas } from "@/components/scene-canvas";

gsap.registerPlugin(ScrollTrigger);

/**
 * 首屏的视差：滚轮滚过一屏，画面自己只往下走这么多（占视口高的比例）。
 * 内页那张纸从下面追上来，正好把它盖住——数字越大画面退得越慢、被盖住的过程越长。
 */
const PARALLAX = 0.3;

/**
 * 首屏：一整屏（100vh × 满宽）的画面，作为页面的第一个板块，不铺到整页。
 *
 * 分两层：
 *   · 外面 `.hero-scene` 只是版面占位——高度钉死一屏（100vh），不跟着滚轮动，
 *     页面高度和纸张的起点因此永远是定的；vh 不随地址栏收放变化，滚全程量到的都是同一个数；
 *   · 里面 `.hero-canvas` 才是会动的那一层，整块画布（视频 + 视差 + 缩放 + 镜头 + 粒子）被推着往下走。
 * 里层比一屏高出 `--hero-bleed` 一截铺在纸的撕口底下（见 globals.css），
 * 所以画面被推下去多少，撕口里都还有画面，不会露出网页底色。
 */
export function HeroScene() {
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const screen = screenRef.current;
    const canvas = canvasRef.current;
    if (!screen || !canvas) return;
    // 减少动态效果时不跟滚轮较劲：画面待在原地，纸照常从下面上来盖住它
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // 幅度和滚动区间都取版面高度（占位层 = 100vh），不取 window.innerHeight：
    // 手机上滚起来地址栏会收，innerHeight 会跳一次，幅度跟着跳就露馅了。
    const span = () => screen.offsetHeight;

    const tween = gsap.to(canvas, {
      y: () => span() * PARALLAX,
      ease: "none",
      scrollTrigger: {
        start: 0,
        end: () => span(),
        scrub: true,
        invalidateOnRefresh: true,
      },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);

  return (
    <div ref={screenRef} aria-hidden className="hero-scene">
      <div ref={canvasRef} className="hero-canvas">
        <SceneCanvas src="/bg-loop.mp4" poster="/bg-v1.webp" />
      </div>
    </div>
  );
}
