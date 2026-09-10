"use client";

import { useEffect, useId, useRef, useState } from "react";
import gsap from "gsap";

type Props = {
  /** 遮罩上抠出来的字，字号/字体由调用方用 className 决定（要和页面里那个字对齐） */
  text?: string;
  /** 字放大到溢出整屏的时长（秒） */
  duration?: number;
  /** 遮罩底色：默认跟着桌面色走 */
  veil?: string;
  /** 字的字号类；默认和设计稿一致，换尺寸就传这个 */
  textClassName?: string;
  /** 开始动画前先等这些图解码完（否则洞里透出的是还没画出来的空底） */
  preload?: string[];
};

/**
 * 通用加载特效：一层底色盖住页面，字是这层底色上**抠出来的洞**——
 * 洞里透出的就是页面本身。加载时字放大到溢出整屏，随后底色淡出，页面完整露出来。
 *
 * 用法：放到被加载内容的最上层即可（自带 fixed 与高 z-index，动画结束自行卸载）。
 * 让洞和页面里那个字对齐，就把同一套字体/字号类传给 textClassName。
 * 换文案/时长传 text / duration；换底色传 veil；要等图就先传 preload。
 * 「减少动态效果」下不播动画，直接收场。
 */
export function LoadingVeil({
  text = "Rivo",
  duration = 0.5,
  veil = "var(--desk)",
  textClassName = "text-[6rem] lg:text-[11rem]",
  preload = [],
}: Props) {
  const maskId = useId().replace(/:/g, "");
  const textRef = useRef<SVGTextElement>(null);
  const veilRef = useRef<SVGRectElement>(null);
  const inkRef = useRef<SVGTextElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const glyphs = textRef.current;
    const sheet = veilRef.current;
    const ink = inkRef.current;
    if (!glyphs || !sheet || !ink) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDone(true);
      return;
    }

    let timeline: gsap.core.Timeline | undefined;
    let cancelled = false;

    // 字体必须等（否则量到的是回退字体的宽度）；图只等一小会儿——
    // 网慢也不该把进场拖住，大不了洞里先透出底色。
    const { promise: deadline, resolve: ready } = Promise.withResolvers<void>();
    const timer = window.setTimeout(ready, 400);
    Promise.all([
      document.fonts.ready,
      ...preload.map((src) => {
        const { promise, resolve } = Promise.withResolvers<void>();
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = src;
        return promise;
      }),
    ]).then(ready);
    Promise.race([document.fonts.ready, deadline]).then(() => {
      if (cancelled) return;
      const box = glyphs.getBBox();
      const reach = Math.hypot(window.innerWidth, window.innerHeight);
      // 字要长得比整屏对角线还大；字形本身有镂空，收尾时再让底色淡出补干净
      const grow = (reach / Math.max(box.width, box.height)) * 1.3;

      // 时间线（总时长 = duration）：
      //   1) 那行白字先停留一小会儿，让人看清它是白的；
      //   2) 再线性淡成透明——淡出的过程里，底下同一个字的洞就把画面一点点放出来；
      //   3) 字同时放大到溢出整屏，收尾把底色淡掉，剩下完整画面。
      timeline = gsap
        .timeline({ onComplete: () => setDone(true) })
        // svgOrigin 是 GSAP 给 SVG 用的支点（用户坐标）：以字形自己的中心放大，
        // 否则会绕坐标系原点缩放，字一放大就飘到左上角去
        .set([glyphs, ink], { svgOrigin: `${box.x + box.width / 2} ${box.y + box.height / 2}` })
        .to(glyphs, { scale: grow, duration, ease: "power3.in" }, 0)
        .to(ink, { opacity: 0, duration: duration * 0.74, ease: "none" }, duration * 0.16)
        .to(sheet, { opacity: 0, duration: duration * 0.34, ease: "power1.out" }, duration * 0.66);
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      timeline?.kill();
    };
  }, [duration, preload]);

  if (done) return null;

  return (
    <svg aria-hidden className="fixed inset-0 z-50 size-full">
      <defs>
        {/* 用户坐标 = CSS 像素（不设 viewBox）：遮罩与底色都只铺满视口即可，
            放大后的字会被这一层裁掉，没必要铺几千像素白费栅格化 */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          {/* 黑色 = 挖掉，于是字的形状在遮罩上是透明的洞 */}
          <text
            ref={textRef}
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="central"
            fill="black"
            className={`font-script leading-none ${textClassName}`}
          >
            {text}
          </text>
        </mask>
      </defs>
      <rect ref={veilRef} x="0" y="0" width="100%" height="100%" fill={veil} mask={`url(#${maskId})`} />
      {/* 与洞里那个字形严丝合缝的白字：它淡成透明的同时，画面就从字里透出来 */}
      <text
        ref={inkRef}
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className={`fill-loader-ink font-script leading-none ${textClassName}`}
      >
        {text}
      </text>
    </svg>
  );
}
