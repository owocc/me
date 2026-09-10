import { Separator } from "@/components/ui/separator";
import { printDate, profile } from "@/lib/profile";

/**
 * 报纸刊头：信息条 —— 细线 —— 报名 —— 粗线，头版的标准三段式。
 */
export function Masthead() {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[0.6875rem] tracking-[0.25em] text-muted-foreground uppercase">
        <span>个人主页</span>
        <span className="tracking-[0.12em]">{printDate()}</span>
        <span>{profile.issue}</span>
      </div>
      <Separator />
      <div className="flex flex-col items-center gap-1 py-2 text-center">
        <p className="font-serif text-3xl font-bold tracking-[0.18em] lg:text-4xl">
          {profile.masthead}
        </p>
        <p className="text-[0.625rem] tracking-[0.35em] text-muted-foreground uppercase">
          {profile.mastheadLatin} · {profile.tagline}
        </p>
      </div>
      <Separator className="h-[3px]! bg-foreground" />
    </header>
  );
}
