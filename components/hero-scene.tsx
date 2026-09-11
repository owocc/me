"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

import { SceneCanvas, type HeroState } from "@/components/scene-canvas";
import { heroGeometry, hitsScreenHole } from "@/lib/hero-screen";
import { ACTIVE_HERO_VIDEO, HERO_PC_ASSET, HERO_VIDEOS } from "@/lib/hero-media";

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
 *   · 外面 `.hero-scene` 是版面占位——高度钉死一屏（100vh），页面高度和纸张的起点因此永远是定的；
 *     vh 不随地址栏收放变化，滚全程量到的都是同一个数；
 *   · 里面 `.hero-canvas`（一屏 + 底下的 --hero-bleed，多出来那截铺到纸张撕口底下）
 *     就是一整块画布：视频、光、粒子、镜头与 PC 素材都在着色器里一趟画完（见 scene-canvas.tsx）。
 *     素材里的屏幕洞、洞里的画面、素材自己的放大/显形/虚焦全是这一趟里的采样，
 *     没有 DOM 层参与，所以缩放时不会有谁露在谁外面、也没有直角边界可露。
 *
 * 动画只改一个普通对象（state）：GSAP 直接改它的字段，SceneCanvas 每帧读，
 * 不过 React state——省掉每帧一次重渲染。
 *
 * 双击画面放大到满屏期间，页面是**钉住**的（见 isPinned / handleScroll）：不管滚动来自滚轮、
 * 触屏、键盘还是拖动滚动条，都先把页面按回顶部、并触发收起动画，动画播完才放行。
 * 钉住不是靠 ScrollTrigger，就是这里手写的——页面真滚起来的话，满屏的画面会直接滚出屏幕，
 * 收起动画在看不见的地方播完，回来时状态还停在「已展开」，等于坏在半路。
 *
 * 展开时除了放大倍数，还写 state.framing：0 = 画面贴屏幕（按 4:3 的屏幕洞 cover，16:9 的视频
 * 左右各裁一截），1 = 铺满视口（按屏幕比例 cover，只裁屏幕与视频比例差的那一点）。
 * 于是放大到满屏之后看到的是整幅画面，不再被屏幕的 4:3 裁掉两边（见 scene-canvas 的 framingUv）。
 *
 * 手机那一档（{@link MOBILE}）另走一条路：不缩放、不起手放大，显示器与画面一起摆好
 * （state 直接落在终态），滚轮直接往下走。桌面端才做「双击放大」那一套。
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
  // 手机端略做 1.1 微调裁切防下边框黑线，桌面端为 1.0；
  // 取景固定在「贴屏幕」那一档（framing = 0），只有展开到满屏才切到「铺满视口」（见 expandToFullscreen）
  const defaultScale = mobile ? MOBILE_SCALE : 1.0;
  const state = useRef<HeroState>({ scale: defaultScale, opacity: 1, blur: 0, framing: 0 }).current;

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
    state.framing = 0;

    const getGrow = () => heroGeometry(box.offsetWidth, box.offsetHeight).grow;

    /**
     * 页面该不该被钉在顶部：放大动画期间、已展开、收起动画期间，都算。
     * 收起动画期间也得钉住——那时 isExpandedRef 还是 true，正好一起盖住。
     */
    const isPinned = () => isExpandedRef.current || isAnimatingRef.current;

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
          // 取景跟着一起走：倍数是「画面占多大」，取景是「画面按谁的比例铺」——
          // 到 100% 时按屏幕比例 cover，于是只裁掉屏幕与视频比例差的那一点（见 scene-canvas 的 framingUv）
          state.framing = p;
          // 到达 80% 进度后开始降低透明度，100% 时降为 0
          if (p >= 0.8) {
            state.opacity = Math.max(0, 1 - (p - 0.8) / 0.2);
          } else {
            state.opacity = 1;
          }
        },
        onComplete: () => {
          state.scale = targetScale;
          state.framing = 1;
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
          // 取景倒着走回「贴屏幕」那一档
          state.framing = 1 - p;
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
          state.framing = 0;
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

    /**
     * 真实滚动是唯一可靠的口径：不管滚动来自拖动滚动条、键盘、中键自动滚动还是别的什么，
     * 只要页面真的动了，这里都会收到——而 wheel / touchmove 只盖得住滚轮和手指。
     *
     * 以前只拦了 wheel 与 touchmove，于是拖动滚动条绕了过去：页面真的滚、满屏的画面跟着出屏，
     * 收起却始终没被触发，回来时状态还停在「已展开」。现在以真实滚动为准：
     * 页面一离开顶部就先按回顶部（钉住，让收起动画留在视野里），并照常触发收起；
     * 收起一结束 isPinned() 变 false，这个回调立刻不再插手，用户接着滚就正常往下走。
     */
    const handleScroll = () => {
      if (!isPinned()) return;
      if (window.scrollY === 0) return;
      window.scrollTo(0, 0);
      // 收起动画自己会钉住（isPinned 仍为 true），这里的重复触发由 collapseToNormal 挡掉
      if (isExpandedRef.current && !isAnimatingRef.current) collapseToNormal();
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
    // 钉住期间页面一律不动：滚动量只用来决定收不收，不真的滚。
    // 滚轮与触屏继续走「阻尼阈值」这一档（触控板惯性很大，一碰就收起会太敏感）；
    // 键盘与拖动滚动条那种明确的大动作不走阻尼，见 handleKeyDown / handleScroll。
    const VIRTUAL_THRESHOLD = 80; // 虚拟滚动触发收起的阻尼阈值

    const handleWheel = (e: WheelEvent) => {
      if (!isPinned()) return;
      e.preventDefault();
      // 放大动画期间只按住页面，不累加：那时还没展开，收起也无从收起
      if (!isExpandedRef.current || isAnimatingRef.current) return;

      if (e.deltaY > 0) {
        // 往下滚：累加虚拟滚动，够了就收起
        virtualScrollYRef.current += e.deltaY;
        if (virtualScrollYRef.current >= VIRTUAL_THRESHOLD) collapseToNormal();
      } else if (e.deltaY < 0) {
        // 往上滚：减小虚拟滚动累加
        virtualScrollYRef.current = Math.max(0, virtualScrollYRef.current + e.deltaY);
      }
    };

    // 移动端触屏滑动虚拟滚动拦截
    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };
    const handleTouchMove = (e: TouchEvent) => {
      // 两根手指多半是要捏合缩放，别拦
      if (!isPinned() || e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      const diff = touchStartY - currentY; // 正值表示向上滑动（页面想要往下滚）
      if (diff <= 0) return;
      e.preventDefault();
      touchStartY = currentY;
      if (!isExpandedRef.current || isAnimatingRef.current) return;
      virtualScrollYRef.current += diff;
      if (virtualScrollYRef.current >= VIRTUAL_THRESHOLD) collapseToNormal();
    };

    /**
     * 键盘滚动（空格 / PageDown / 方向键 / Home / End）既不经过 wheel 也不经过 touchmove，
     * 钉住期间得单独拦：不拦的话页面会先跳一屏，再被 handleScroll 按回来——白闪一下。
     * 这类按键是明确的大动作，不走阻尼阈值，按一下就收起。
     */
    const SCROLL_KEYS = new Set([" ", "Spacebar", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"]);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPinned() || !SCROLL_KEYS.has(e.key)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as Element | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      if (isExpandedRef.current && !isAnimatingRef.current) collapseToNormal();
    };

    // 窗口尺寸变化时，保持比例正确
    const handleResize = () => {
      if (isExpandedRef.current && !isAnimatingRef.current) {
        state.scale = getGrow();
        state.framing = 1;
      } else if (!isExpandedRef.current && !isAnimatingRef.current) {
        state.scale = mobile ? MOBILE_SCALE : 1.0;
        state.framing = 0;
      }
    };

    screen.addEventListener("dblclick", handleDblClick);
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      screen.removeEventListener("dblclick", handleDblClick);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("keydown", handleKeyDown);
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
