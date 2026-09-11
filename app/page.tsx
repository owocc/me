import { HeroScene } from "@/components/hero-scene";
import { LoadingVeil } from "@/components/loading-veil";
import { Newspaper } from "@/components/newspaper";

/** 报纸先收起来，等版面定稿再打开。 */
const SHOW_NEWSPAPER = false;

/**
 * 花那半截（纸边以上）的羽化：把同一张素材糊一版当 alpha 遮罩，压回图片自己的 alpha 上——
 * 只柔化轮廓的边，画面本身还是清晰的。纸边以下补一块实白，那一半压在纸上、素材自带边，不用再柔。
 * 遮罩里的图用根路径（data URI 里相对路径会解析到 data URI 自己身上，取不到）。
 */
const FEATHER_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1584" height="583">` +
    `<filter id="f" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="5"/></filter>` +
    `<image href="/flowers_cutout.webp" width="1584" height="583" filter="url(#f)"/>` +
    `<rect x="0" y="355" width="1584" height="228" fill="#ffffff"/>` +
    `</svg>`,
)}")`;

export default function Home() {
  return (
    <main>
      {/* 首屏：一整屏的场景。滚动时它跟在滚轮后面慢慢往下走，同时缩进 PC 素材的屏幕里（见 hero-scene.tsx） */}
      <HeroScene />
      {/*
        内页：一整屏的纸（#D2BA95）。
        · 带花的素材钉在纸的顶部（sticky），首屏从下面追上来，被这张纸一点点盖掉；
        · 素材上半是透明的（花就立在这一带）——那是还没被纸盖住的那块，透出来的正是首屏；
        · 纸身是接着素材下缘铺的一块纯色，颜色与素材实测同色（#D1B995，取 #D2BA95），接缝看不出来。
      */}
      <section className="-mt-(--paper-overhang) relative z-10 flex min-h-screen flex-col">
        <div className="sticky top-0 z-10">
          {/* 花上半截的影子：沿用 PaperSheet 那套——同一张素材当 alpha 遮罩、压上墨色，
              再往左下挪一点、blur 一道；只在纸边以上有效，往下渐隐（纸面那一半素材自带影子）。
              影子落在后面那屏画面上，花才像立在那儿，而不是浮着。 */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ maskImage: "linear-gradient(to bottom, #000 0 58%, transparent 62%)" }}
          >
            <div
              className="bg-paper-ink h-full w-full -translate-x-1 translate-y-1.5 opacity-50 blur-[12px]"
              style={{ maskImage: "url(/flowers_cutout.webp)", maskRepeat: "no-repeat", maskSize: "100% 100%" }}
            />
          </div>
          <img
            src="/flowers_cutout.webp"
            alt=""
            aria-hidden
            width={1584}
            height={583}
            className="relative block w-full"
            style={{ maskImage: FEATHER_MASK, maskRepeat: "no-repeat", maskSize: "100% 100%" }}
          />
        </div>
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
