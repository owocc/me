"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { SceneCanvas, type HeroState } from "@/components/scene-canvas";
import { heroGeometry } from "@/lib/hero-screen";

gsap.registerPlugin(ScrollTrigger);

/**
 * 素材起手那层虚焦（px）。它先带糊压上来、再慢慢对焦，所以中段看得见「糊着的显示器」——
 * 要是一路清晰渐显（模糊比透明度先收完），那一层糊等于没有。
 */
const BLUR = 24;

/** 透明度只撑开头这么远（px）：滚过它素材就已经是 100% 不透明 */
const REVEAL_PX = 50;

/** 手机那一档（与 Tailwind 的 md 同界）：这一档不做「缩进屏幕」那套。 */
const MOBILE = "(max-width: 767px)";

/** 手机：起手就显示器和画面一起在，不缩放、不钉住，滚轮直接往下走。 */
function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}

/**
 * 首屏：一整屏（100vh × 满宽）的场景，作为页面的第一个板块，不铺到整页。
 *
 * 只有两层：
 *   · 外面 `.hero-scene` 是版面占位——高度钉死一屏（100vh），也不跟着滚轮动，
 *     页面高度和纸张的起点因此永远是定的；vh 不随地址栏收放变化，滚全程量到的都是同一个数。
 *     这块同时是 ScrollTrigger 钉住（pin）的那一块：整段动画期间它定在视口里，
 *     滚轮只推着动画走，动画走完才放开、页面继续往下滚，后面的纸这时才开始上来盖场；
 *   · 里面 `.hero-canvas`（一屏 + 底下的 --hero-bleed，多出来那截铺到纸张撕口底下）
 *     就是一整块画布：视频、光、粒子、镜头与 PC 素材都在着色器里一趟画完（见 scene-canvas.tsx）。
 *     素材里的屏幕洞、洞里的画面、素材自己的放大/显形/虚焦全是这一趟里的采样，
 *     没有 DOM 层参与，所以缩放时不会有谁露在谁外面、也没有直角边界可露。
 *
 * 动画只改一个普通对象（state）：GSAP 直接改它的字段，SceneCanvas 每帧读，
 * 不过 React state——省掉每帧一次重渲染。
 *
 * 手机那一档（{@link MOBILE}）另走一条路：不缩放、不钉住，起手就把显示器与画面一起摆好
 * （state 直接落在终态），滚轮直接往下走。桌面端才做「显示器从画外化出来」那一套。
 */
export function HeroScene() {
  const screenRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();
  // 初值 = 首帧：素材放到最大（洞盖满整屏）、还藏着、还糊着
  const state = useRef<HeroState>({ scale: 1, opacity: 0, blur: BLUR }).current;

  useEffect(() => {
    const screen = screenRef.current;
    const box = boxRef.current;
    if (!screen || !box) return;

    // 幅度和滚动区间都取版面高度（占位层 = 100vh），不取 window.innerHeight：
    // 手机上滚起来地址栏会收，innerHeight 会跳一次，幅度跟着跳就露馅了。
    const span = () => screen.offsetHeight;
    const grow = () => heroGeometry(box.offsetWidth, box.offsetHeight, !mobile).grow;

    // 手机：显示器与画面一起显示，不缩放也不钉住页面——首屏就是终态，滚轮直接往下走。
    // 只在 mount 时写一次（state 是普通对象，不触发重渲染），之后没有东西再改它。
    if (mobile) {
      state.scale = 1;
      state.opacity = 1;
      state.blur = 0;
      return;
    }

    // 减少动态效果时不跟滚轮较劲：直接落在终态（素材原大小、不透明、清晰），也不钉住页面。
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const settle = () => {
        state.scale = 1;
        state.opacity = 1;
        state.blur = 0;
      };
      settle();
      // 版面变了（转屏、滚动条）落点就变了，得重新量一次，不然画面会漂出屏幕
      window.addEventListener("resize", settle);
      return () => window.removeEventListener("resize", settle);
    }

    state.scale = grow();
    state.opacity = 0;
    state.blur = BLUR;

    const tween = gsap
      .timeline({
        scrollTrigger: {
          // 钉住的正是这一屏；起止都写绝对滚动位置（数字），不用 "top top"/"+=…" 那套相对的：
          // 数字是量得最准的一档，首屏又是文档第一块，0 就是要的那个起点。
          trigger: screen,
          start: 0,
          // 虚拟滚动：这一屏钉在原地，滚轮只推着下面几条动画走，页面本身不往前走。
          // 钉住的距离正好一屏——动画走完才放开。
          end: () => span(),
          scrub: true,
          pin: true,
          // 起手放大倍数与模糊都按函数值现取，refresh 之后重算才是确定的，
          // 不会拿「上一次动画停在半路的值」当起点。
          invalidateOnRefresh: true,
        },
      })
      // 素材缩回原大小：起手那一屏（屏幕盖满整屏、只剩画面）一路收成显示器里的一块，
      // 边壳、草地、蝴蝶从画外收进来。duration 给满 1：这条就是整段钉住行程的时长，
      // 放开页面那一下正好收完——「内容缩小完毕才让页面继续滚」就是它撑住的。
      .fromTo(state, { scale: () => grow() }, { scale: 1, ease: "none", duration: 1 }, 0)
      // 素材对焦：先带糊压上来、慢慢收清楚。留一截尾巴（0.9 收完）——放开页面之前它已经实了。
      .fromTo(state, { blur: BLUR }, { blur: 0, ease: "power1.inOut", duration: 0.9 }, 0);

    // 素材的透明度：滚过 50px 就已经是 100%，往后这条不再动。
    // 于是整段动画只剩「模糊递减」和「缩回原大小」两样在走——亮度和形变分开，看着才像显影。
    // 单独挂触发器（不并进上面那条时间轴）：50px 是个绝对值，和首屏一屏的长度无关。
    const reveal = gsap.fromTo(
      state,
      { opacity: 0 },
      {
        opacity: 1,
        ease: "none",
        scrollTrigger: {
          trigger: screen,
          start: 0,
          end: REVEAL_PX,
          scrub: true,
          invalidateOnRefresh: true,
        },
      },
    );

    return () => {
      reveal.scrollTrigger?.kill();
      reveal.kill();
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [state, mobile]);

  return (
    <div ref={screenRef} aria-hidden className="hero-scene">
      <div ref={boxRef} className="hero-canvas">
        <SceneCanvas
          src="/bg-loop.mp4"
          poster="/bg-v1.webp"
          asset="/pc_cutout.webp"
          contain={!mobile}
          state={state}
        />
      </div>
    </div>
  );
}
