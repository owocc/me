"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { SceneCanvas } from "@/components/scene-canvas";

gsap.registerPlugin(ScrollTrigger);

/**
 * 起手放大到「屏幕那块洞盖满整个版面」之后再留的一点余量。
 * 这样首屏看到的正好是整屏画面（素材整个在视口外，屏幕上只透出画面），
 * 滚动时素材一路缩回原大小，边壳、草地、蝴蝶才从画外收进来。
 */
const GROW = 1.02;

/**
 * 素材起手那层虚焦（px）。它先带糊压上来、再慢慢对焦，所以中段看得见「糊着的显示器」——
 * 要是一路清晰渐显（模糊比透明度先收完），那一层糊等于没有。
 */
const BLUR = 24;

/**
 * PC 素材里显示器屏幕那块透明洞的位置，占素材自身宽高的比例。
 * 量法：把 /pc_cutout.webp 画进 canvas，扫一遍 alpha，取全透明区的紧包围盒——
 * 当前这张 2200×1228 的 webp 量得 933,403 起、358×257 大（换图必须重新量，比例与导出尺寸无关）。
 * 只取 alpha == 0 的那一块，边上一圈半透明（抗锯齿）留给下面那个 SCREEN_FILL 去补。
 */
const SCREEN = { x: 933 / 2200, y: 403 / 1228, w: 358 / 2200, h: 257 / 1228 } as const;

/** 素材固有宽高比（2200×1228 的导出）。改了导出尺寸就跟着改。 */
const ART_RATIO = 2200 / 1228;

/**
 * 画面缩进洞里之后再放大这一丁点。洞沿有一圈半透明像素（alpha 的抗锯齿），
 * 画面正好卡着洞边，那圈像素就会透出底下的桌面色，成一道亮线；多出来的这圈被不透明的素材挡着，看不见。
 */
const SCREEN_FILL = 1.04;

/**
 * 首屏：一整屏（100vh × 满宽）的画面，作为页面的第一个板块，不铺到整页。
 *
 * 分四层：
 *   · 外面 `.hero-scene` 只是版面占位——高度钉死一屏（100vh），不跟着滚轮动，
 *     页面高度和纸张的起点因此永远是定的；vh 不随地址栏收放变化，滚全程量到的都是同一个数；
 *   · `.hero-canvas` 只是把「画面 + 素材」这一组框住，它自己不动；
 *   · `.hero-board` 是「画面 + 素材」这一组：起手推得很大（屏幕盖满整屏），滚动时整体缩回原大小；
 *   · `.hero-shot` 里就是屏幕那一块画面：宽高与位置由 GSAP 按素材里的屏幕洞摆好（定值，
 *     只跟版面走），画布也按这个框来画，所以场景是真配在屏幕上，不是从大画面里裁一块塞进洞。
 *     它压在 `.hero-pc`（PC 素材，屏幕处是透明洞）底下：素材放大/缩回多少，洞和画面就一起
 *     缩放多少，所以整段滚动里画面始终严丝合缝地贴在屏幕里。素材自己起手是藏着的（透明 +
 *     一层虚焦），随滚动压上来、显形、对焦（见下面那条时间轴）。
 *
 * 这一整段是「虚拟滚动」：首屏钉在原地（pin），滚轮只推着动画走、页面本身不往前走；
 * 一路推到画面缩进屏幕、素材显形完毕，钉住的那一屏才放开——后面的纸这时才开始上来盖场。
 * 里层比一屏高出 `--hero-bleed` 一截铺在纸的撕口底下（见 globals.css），
 * 所以纸从下面盖上来时，撕口里透出来的还是草地，不会露出网页底色。
 */
export function HeroScene() {
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const shotRef = useRef<HTMLDivElement>(null);
  const pictureRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const screen = screenRef.current;
    const canvas = canvasRef.current;
    const board = boardRef.current;
    const shot = shotRef.current;
    const picture = pictureRef.current;
    const pc = pcRef.current;
    if (!screen || !canvas || !board || !shot || !picture || !pc) return;

    // 幅度和滚动区间都取版面高度（占位层 = 100vh），不取 window.innerHeight：
    // 手机上滚起来地址栏会收，innerHeight 会跳一次，幅度跟着跳就露馅了。
    const span = () => screen.offsetHeight;

    /**
     * 画面与屏幕的相对关系。三件事：
     *   · 洞口在哪：素材是 cover 铺满版面的，先按 cover 反推素材内容在版面里的大小与偏移，
     *     再按洞口在素材里的比例定位；
     *   · 画面就是屏幕那一块：不再是块 16:9 的大画面压在洞底下——画布按屏幕的框来画，
     *     场景里的光、镜头、颗粒也都按这个框配（见 scene-canvas.tsx 的 boxScale），
     *     于是画面是真的「适配屏幕」，而不是从一块大画面里裁出一块塞进洞。
     *     尺寸给到「最大那一档」（放大的起手倍数）上：显示尺寸一路是 hole × K，
     *     K = grow 那一下正好 1:1 不糊，缩回去之后是超采样（多花填充率，换首屏清楚）。
     *   · 起手放大多少：放大到「洞把整个版面（含首屏下面那截留白）都盖住」——
     *     洞心不在版面正中（屏幕偏上，离下沿最远），所以四个方向分开量、取最远的那个边。
     * 位移是相对版面中心的（transform-origin 就在中心），量的是排版尺寸，
     * 滚动途中重算（refresh）也不会漂。缩放的支点取洞心：屏幕原地放大/缩回，画面不用追。
     */
    const landing = () => {
      const bw = pc.offsetWidth;
      const bh = pc.offsetHeight;
      // cover：版面比素材更宽时按宽铺满，否则按高铺满——和 object-fit: cover 一个算法
      const artH = bw / bh > ART_RATIO ? bw / ART_RATIO : bh;
      const artW = artH * ART_RATIO;
      const artX = (bw - artW) / 2;
      const artY = (bh - artH) / 2;
      const holeW = SCREEN.w * artW;
      const holeH = SCREEN.h * artH;
      const holeX = artX + (SCREEN.x + SCREEN.w / 2) * artW;
      const holeY = artY + (SCREEN.y + SCREEN.h / 2) * artH;
      const grow =
        Math.max(
          (2 * Math.max(holeX, bw - holeX)) / holeW,
          (2 * Math.max(holeY, bh - holeY)) / holeH,
        ) * GROW;
      return {
        grow,
        w: holeW * grow * SCREEN_FILL,
        h: holeH * grow * SCREEN_FILL,
        // 画面缩到 hole / 素材倍数：素材放大多少，它就跟着缩多少，两边正好抵消成 1:1
        scale: SCREEN_FILL / grow,
        // 位移相对版面中心：外层满版那层和它里面居中的画面同心，平移多少画面就走多少
        x: holeX - bw / 2,
        y: holeY - bh / 2,
        origin: `${(holeX / bw) * 100}% ${(holeY / bh) * 100}%`,
      };
    };

    /** 画面摆位是个定值（只跟版面走，不跟滚动走）：版面一变重新摆一次就行 */
    const place = () => {
      const land = landing();
      gsap.set(picture, { width: land.w, height: land.h });
      gsap.set(shot, { scale: land.scale, x: land.x, y: land.y });
    };

    // 减少动态效果时不跟滚轮较劲：素材摆成落定的样子（缩回原大小、显形、清晰），
    // 画面待在屏幕里，整屏一动不动，也不钉住页面。
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const settle = () => {
        place();
        gsap.set(board, { scale: 1, transformOrigin: landing().origin });
      };
      settle();
      gsap.set(pc, { opacity: 1, filter: "blur(0px)" });
      // 版面变了（转屏、滚动条）落点就变了，得重新摆一次，不然画面会漂出屏幕
      window.addEventListener("resize", settle);
      return () => window.removeEventListener("resize", settle);
    }

    place();

    const tween = gsap
      .timeline({
        scrollTrigger: {
          // 钉住的正是这一屏；起止都写绝对滚动位置（数字），不用 "top top"/"+=…" 那套相对的：
          // 数字是量得最准的一档，首屏又是文档第一块，0 就是要的那个起点。
          trigger: screen,
          start: 0,
          // 虚拟滚动：这一屏钉在原地，滚轮只推着下面几条动画走，页面本身不往前走。
          // 钉住的距离正好一屏——动画走完才放开，后面的纸这时才开始从下面上来盖场。
          end: () => span(),
          scrub: true,
          pin: true,
          invalidateOnRefresh: true,
          // 画面是定值，刷新时重摆一次；下面那几条自己会按函数值重算
          onRefresh: place,
        },
      })
      // 素材缩回原大小：起手那一屏（屏幕盖满整屏、只剩画面）一路收成显示器里的一块，
      // 边壳、草地、蝴蝶从画外收进来。duration 给满 1：这条就是整段钉住行程的时长，
      // 放开页面那一下正好收完——「内容缩小完毕才让页面继续滚」就是它撑住的。
      // 用 fromTo：两头都写死（都是从函数现取的），refresh 之后重算才是确定的，
      // 不会拿「上一次动画停在半路的值」当起点。
      // 支点也两头都写——只写一头的话，GSAP 会把支点从默认的 50% 慢慢徙到洞心，缩的途中画面会横移。
      .fromTo(
        board,
        { scale: () => landing().grow, transformOrigin: () => landing().origin },
        { scale: 1, transformOrigin: () => landing().origin, ease: "none", duration: 1 },
        0,
      )
      // 素材对焦：先带糊压上来、慢慢收清楚。留一截尾巴（0.9 收完）——放开页面之前它已经实了。
      .fromTo(
        pc,
        { filter: `blur(${BLUR}px)` },
        { filter: "blur(0px)", ease: "power1.inOut", duration: 0.9 },
        0,
      );

    // 屏幕图的透明度：滚过 50px 就已经是 100%，往后这条不再动。
    // 于是整段动画只剩「模糊递减」和「缩回原大小」两样在走——亮度和形变分开，看着才像显影。
    // 单独挂触发器（不并进上面那条时间轴）：50px 是个绝对值，和首屏一屏的长度无关。
    const reveal = gsap.fromTo(
      pc,
      { opacity: 0 },
      {
        opacity: 1,
        ease: "none",
        scrollTrigger: { trigger: screen, start: 0, end: 50, scrub: true, invalidateOnRefresh: true },
      },
    );

    return () => {
      reveal.scrollTrigger?.kill();
      reveal.kill();
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);

  return (
    <div ref={screenRef} aria-hidden className="hero-scene">
      <div ref={canvasRef} className="hero-canvas">
        <div ref={boardRef} className="hero-board">
          <div ref={shotRef} className="hero-shot">
            <div ref={pictureRef} className="hero-shot-picture">
              <SceneCanvas src="/bg-loop.mp4" poster="/bg-v1.webp" />
            </div>
          </div>
          {/* 尺寸写素材固有的：布局是 absolute inset-0，这两个数只当解码前的占位提示 */}
          <img
            ref={pcRef}
            className="hero-pc"
            src="/pc_cutout.webp"
            alt=""
            width={2200}
            height={1228}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
