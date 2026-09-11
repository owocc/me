import { HeroScene } from "@/components/hero-scene";
import { LoadingVeil } from "@/components/loading-veil";
import { Newspaper } from "@/components/newspaper";

/** 报纸先收起来，等版面定稿再打开。 */
const SHOW_NEWSPAPER = false;

export default function Home() {
  return (
    <main>
      {/* 首屏：一整屏的场景。滚动时它跟在滚轮后面慢慢往下走，同时缩进 PC 素材的屏幕里（见 hero-scene.tsx） */}
      <HeroScene />
      {/*
        内页：一整屏的墙（#D4B792）。
        · 墙面素材钉在顶部（sticky），首屏从下面追上来，被这面墙一点点盖掉；
        · 素材最上方约 70px（占素材高 9.7%）是透明的，就是墙沿那条缝，透出来的正是还没被盖住的首屏；
        · 墙身是接着素材下缘铺的一块纯色，颜色与素材实测同色（#D4B792），接缝看不出来。
      */}
      <section className="-mt-(--paper-overhang) relative z-10 flex min-h-screen flex-col">
        <img
          src="/wall_cutout.webp"
          alt=""
          aria-hidden
          width={3168}
          height={723}
          className="sticky top-0 z-10 block w-full"
        />
        {/* 纸身：接着素材下缘铺。往上压 2px 塞到素材底下——两条盒子的公共边落在小数像素上时，
            中间会漏出一丝丝桌面底色，成了一道 1px 的暗线，压进去就被素材自己的像素盖住了。 */}
        <div className="-mt-0.5 flex flex-1 items-center justify-center bg-paper-2 text-paper-2-ink">
          <p className="text-[0.6875rem] tracking-[0.3em] uppercase">第二屏 · 占位</p>
        </div>
      </section>
      {SHOW_NEWSPAPER && <Newspaper />}
      {/* 进场：字从中间放大到溢出整屏，洞里透出画面，随后底色淡出 */}
      <LoadingVeil preload={["/bg-v1.webp", "/pc_cutout.webp"]} />
    </main>
  );
}
