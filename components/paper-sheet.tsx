import { cn } from "@/lib/utils";

/**
 * 桌面上那张报纸。
 *
 * 纸面 = public 里的报纸素材（窄屏竖版切片、lg 起横版整页，见 globals.css 的
 * --paper-art / --paper-ratio），四边的羽化就是纸的边，不再自己画毛边；
 * TornEdge 留给内部板块用。
 *
 * 正文一律排进 paper-well 这层容器里，四边的余量按两张素材各自实测的留白配：
 *   · 竖版 506×1281：羽化 10–19px、右侧压边约 40px、底部阴影带约 65px；
 *   · 横版 1035×782：羽化 24–32px、底部阴影带从约 88% 高处开始。
 * 颗粒与影子都拿同一张素材当 alpha 遮罩，跟着纸的形状走；正文那层不挂 filter。
 */
export function PaperSheet({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("paper-tilt relative mx-auto w-[22.875rem] max-w-full lg:w-[64rem]", className)}>
      <div aria-hidden className="paper-shape-mask absolute inset-0 translate-y-1.5">
        <div className="paper-noise-mask bg-paper-ink h-full w-full opacity-45" />
      </div>
      <div className="paper-surface relative w-full">
        <div className="paper-well">{children}</div>
        <div aria-hidden className="paper-noise paper-shape-mask pointer-events-none absolute inset-0" />
      </div>
    </div>
  );
}
