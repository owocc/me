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

/**
 * 手机起手多放大一点：素材本身下沿压着一片虚焦的暗前景，原大小铺上去会在底部留一条压暗的边；
 * 放大一点点把它推出画外，画面正好铺满。
 */
const MOBILE_SCALE = 1.1;

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

  // 初始状态：不管什么设备，固定一进入页面就完整显示电脑素材（清晰、不透明、原比例）
  // 手机端略做 1.1 微调裁切防下边框黑线，桌面端为 1.0
  const defaultScale = mobile ? MOBILE_SCALE : 1.0;
  const state = useRef<HeroState>({ scale: defaultScale, opacity: 1, blur: 0 }).current;

  // 运行状态引用
  const isExpandedRef = useRef(false);
  const isAnimatingRef = useRef(false);
  const virtualScrollYRef = useRef(0);

  useEffect(() => {
    const screen = screenRef.current;
    const box = boxRef.current;
    if (!screen || !box) return;

    const baseScale = mobile ? MOBILE_SCALE : 1.0;
    state.scale = baseScale;
    state.opacity = 1;
    state.blur = 0;

    const getGrow = () => heroGeometry(box.offsetWidth, box.offsetHeight).grow;

    // 点击放大到全屏：屏幕内播放的内容平滑放大至占满视口
    const expandToFullscreen = () => {
      if (isAnimatingRef.current || isExpandedRef.current) return;
      isAnimatingRef.current = true;
      virtualScrollYRef.current = 0;

      const targetScale = getGrow();
      gsap.to(state, {
        scale: targetScale,
        duration: 0.85,
        ease: "power2.out",
        onComplete: () => {
          isExpandedRef.current = true;
          isAnimatingRef.current = false;
        },
      });
    };

    // 收起回正常电脑素材状态
    const collapseToNormal = () => {
      if (isAnimatingRef.current || !isExpandedRef.current) return;
      isAnimatingRef.current = true;

      gsap.to(state, {
        scale: baseScale,
        duration: 0.75,
        ease: "power2.inOut",
        onComplete: () => {
          isExpandedRef.current = false;
          isAnimatingRef.current = false;
          virtualScrollYRef.current = 0;
        },
      });
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("a, button, input, textarea, select, [contenteditable]")) return;
      if (window.scrollY > 10) return;
      if (!isExpandedRef.current) {
        expandToFullscreen();
      } else {
        // 再次点击也可平滑收起
        collapseToNormal();
      }
    };
    // 虚拟滚动与手势拦截：
    // 当处于放大状态（全屏）时，滚轮或滑动手势不直接让页面跑，而是先做虚拟滚动收起；
    // 收起回到正常电脑后，再次滚动才放行页面正常下滚。
    const VIRTUAL_THRESHOLD = 80; // 虚拟滚动触发收起的阻尼阈值

    const handleWheel = (e: WheelEvent) => {
      if (!isExpandedRef.current) return;

      // 处于放大全屏态
      if (e.deltaY > 0) {
        // 往下滚：拦截页面真实滚动，累加虚拟滚动
        e.preventDefault();
        virtualScrollYRef.current += e.deltaY;
        if (virtualScrollYRef.current >= VIRTUAL_THRESHOLD && !isAnimatingRef.current) {
          collapseToNormal();
        }
      } else if (e.deltaY < 0) {
        // 往上滚：减小虚拟滚动累加
        e.preventDefault();
        virtualScrollYRef.current = Math.max(0, virtualScrollYRef.current + e.deltaY);
      }
    };

    // 移动端触屏滑动虚拟滚动拦截
    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!isExpandedRef.current) return;
      const currentY = e.touches[0].clientY;
      const diff = touchStartY - currentY; // 正值表示向上滑动（页面想要往下滚）
      if (diff > 0) {
        e.preventDefault();
        virtualScrollYRef.current += diff;
        touchStartY = currentY;
        if (virtualScrollYRef.current >= VIRTUAL_THRESHOLD && !isAnimatingRef.current) {
          collapseToNormal();
        }
      }
    };

    // 窗口尺寸变化时，保持比例正确
    const handleResize = () => {
      if (isExpandedRef.current && !isAnimatingRef.current) {
        state.scale = getGrow();
      } else if (!isExpandedRef.current && !isAnimatingRef.current) {
        state.scale = mobile ? MOBILE_SCALE : 1.0;
      }
    };

    screen.addEventListener("click", handleClick);
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("resize", handleResize);

    return () => {
      screen.removeEventListener("click", handleClick);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("resize", handleResize);
    };
  }, [state, mobile]);

  return (
    <div ref={screenRef} aria-hidden className="hero-scene cursor-pointer">
      <div ref={boxRef} className="hero-canvas">
        <SceneCanvas
          src="/bg-loop.mp4"
          poster="/bg-v1.webp"
          asset="/fly-pc_alpha.webm"
          zoomAnchor="screen"
          disableClickZoom
          state={state}
        />
      </div>
    </div>
  );
}
