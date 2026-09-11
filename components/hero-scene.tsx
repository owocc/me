"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { SceneCanvas, type HeroState } from "@/components/scene-canvas";
import { heroGeometry, hitsScreenHole } from "@/lib/hero-screen";
import { ACTIVE_HERO_VIDEO, HERO_PC_ASSET, HERO_VIDEOS } from "@/lib/hero-media";

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
 *
 * 屏幕里的画面现在是**数组**：段与顺序都在 lib/hero-media.ts 里，往里加项、改
 * ACTIVE_HERO_VIDEO（或把 activeVideo 接成状态）就能多段切换，着色器、几何、
 * 双击全屏这套都不用动。
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

    // 双击放大到全屏：屏幕内播放的内容平滑放大至占满视口
    // 动画过程中，到达 80% 进度后开始平滑降低素材透明度（fade out），最后完全隐藏
    const expandToFullscreen = () => {
      if (isAnimatingRef.current || isExpandedRef.current) return;
      isAnimatingRef.current = true;
      virtualScrollYRef.current = 0;

      const targetScale = getGrow();
      const animObj = { progress: 0 };

      gsap.to(animObj, {
        progress: 1,
        duration: 0.85,
        ease: "power2.out",
        onUpdate: () => {
          const p = animObj.progress;
          state.scale = baseScale + (targetScale - baseScale) * p;
          // 到达 80% 进度后开始降低透明度，100% 时降为 0
          if (p >= 0.8) {
            state.opacity = Math.max(0, 1 - (p - 0.8) / 0.2);
          } else {
            state.opacity = 1;
          }
        },
        onComplete: () => {
          state.scale = targetScale;
          state.opacity = 0;
          isExpandedRef.current = true;
          isAnimatingRef.current = false;
        },
      });
    };

    // 双击或虚拟滚动收起回正常电脑素材状态
    const collapseToNormal = () => {
      if (isAnimatingRef.current || !isExpandedRef.current) return;
      isAnimatingRef.current = true;

      const startScale = state.scale;
      const animObj = { progress: 0 };

      gsap.to(animObj, {
        progress: 1,
        duration: 0.75,
        ease: "power2.inOut",
        onUpdate: () => {
          const p = animObj.progress;
          state.scale = startScale + (baseScale - startScale) * p;
          // 从全屏收起：倒推回来，p < 0.2 时透明度从 0 升到 1（即还原到 80% 缩放位置时素材已完全不透明）
          if (p <= 0.2) {
            state.opacity = Math.min(1, p / 0.2);
          } else {
            state.opacity = 1;
          }
        },
        onComplete: () => {
          state.scale = baseScale;
          state.opacity = 1;
          isExpandedRef.current = false;
          isAnimatingRef.current = false;
          virtualScrollYRef.current = 0;
        },
      });
    };

    /**
     * 这一下点没点在画面（屏幕）里：与 SceneCanvas 里单击推近用的是同一条判据
     * （lib/hero-screen.ts 的 hitsScreenHole），几何也当场按同一份量。
     *
     * 监听仍然挂在整块首屏上（滚出视野就收不到事件），但「算不算点到视频」由它决定：
     * 显示器边壳、草地、留边上双击不该把画面顶到满屏。放大到满屏那一档（scale = grow、
     * 素材已淡出）时整块版面都在窗口里，于是画面上任意位置双击都能收回来。
     */
    const overScreen = (clientX: number, clientY: number) => {
      const rect = box.getBoundingClientRect();
      const geom = heroGeometry(box.offsetWidth, box.offsetHeight);
      return hitsScreenHole(
        { x: clientX - rect.left, y: clientY - rect.top },
        {
          hole: {
            x: geom.hole.cx - geom.hole.w / 2,
            y: geom.hole.cy - geom.hole.h / 2,
            w: geom.hole.w,
            h: geom.hole.h,
          },
          pad: geom.pad,
          scale: Math.max(state.scale, 1e-3),
          anchor: { x: geom.hole.cx, y: geom.hole.cy },
        },
      );
    };

    // 双击处理：改为 dblclick 事件触发全屏放大/收起
    // 单击则保留由 SceneCanvas 内部处理视频画面微观推近
    const handleDblClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("a, button, input, textarea, select, [contenteditable]")) return;
      if (window.scrollY > 10) return;
      if (!overScreen(e.clientX, e.clientY)) return;
      if (!isExpandedRef.current) {
        expandToFullscreen();
      } else {
        collapseToNormal();
      }
    };

    // 移动端模拟双击（两次快速点击 tap）
    let lastTapTime = 0;
    const handleTouchEnd = (e: TouchEvent) => {
      if (window.scrollY > 10) return;
      const touch = e.changedTouches[0];
      if (touch && !overScreen(touch.clientX, touch.clientY)) return;
      const now = performance.now();
      if (now - lastTapTime < 300) {
        // 触发双击
        if (!isExpandedRef.current) {
          expandToFullscreen();
        } else {
          collapseToNormal();
        }
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    };
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

    screen.addEventListener("dblclick", handleDblClick);
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      screen.removeEventListener("dblclick", handleDblClick);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("resize", handleResize);
    };
  }, [state, mobile]);

  return (
    <div ref={screenRef} aria-hidden className="hero-scene cursor-pointer select-none">
      <div ref={boxRef} className="hero-canvas">
        <SceneCanvas
          videos={HERO_VIDEOS}
          asset={HERO_PC_ASSET}
          zoomAnchor="screen"
          activeVideo={ACTIVE_HERO_VIDEO}
          state={state}
        />
      </div>
    </div>
  );
}
