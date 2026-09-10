import { Separator } from "@/components/ui/separator";
import { TornEdge } from "@/components/torn-edge";
import { cn } from "@/lib/utils";
import { profile } from "@/lib/profile";

/** 裁切标记的四个角，压在色块外侧，像印刷前的出血线。 */
const CROP_MARKS = [
  "-top-2 -left-2 border-t border-l",
  "-top-2 -right-2 border-t border-r",
  "-bottom-2 -left-2 border-b border-l",
  "-bottom-2 -right-2 border-b border-r",
] as const;

function CropMarks() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {CROP_MARKS.map((position) => (
        <span key={position} className={cn("absolute size-4 border-foreground/40", position)} />
      ))}
    </div>
  );
}

/** 色块的毛边参数：套印偏移那一层用同一组，两张剪影才对得上。 */
const PLATE_EDGE = { bite: 0.016, seed: 7311, waves: 10 } as const;

/**
 * 封面图占位：一整块套红，叠印刷网点和一层套印偏移。
 * 换成真实照片时，替换这块色块的内容即可。
 */
function CoverPlate() {
  return (
    <div className="relative">
      <TornEdge aria-hidden {...PLATE_EDGE} className="absolute inset-0 translate-x-2 translate-y-2 bg-foreground/15" />
      <TornEdge {...PLATE_EDGE} className="relative aspect-4/5 bg-spot">
        <div aria-hidden className="halftone absolute inset-0 text-foreground/25" />
      </TornEdge>
      <CropMarks />
    </div>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="flex flex-col gap-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,17rem)] lg:gap-10">
        <div className="flex flex-col gap-5">
          <p className="text-[0.6875rem] tracking-[0.3em] text-spot uppercase">头版 · 关于我</p>
          <h1
            id="hero-title"
            className="font-serif text-5xl leading-[1.05] font-bold tracking-tight text-balance lg:text-7xl"
          >
            你好，我是 {profile.name}
          </h1>
        </div>
        <Separator orientation="vertical" className="hidden lg:block" />
        <CoverPlate />
      </div>
      <div className="flex flex-col gap-4">
        <Separator />
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[0.6875rem] tracking-[0.25em] text-muted-foreground uppercase">
          <span>头版 · 完</span>
          <span>内页板块排印中</span>
        </div>
      </div>
    </section>
  );
}
