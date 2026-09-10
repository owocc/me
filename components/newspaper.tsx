import { Hero } from "@/components/hero";
import { Masthead } from "@/components/masthead";
import { PaperSheet } from "@/components/paper-sheet";

/**
 * 一份完整的头版：纸 + 刊头 + 头版正文。
 * 版面本身自足，挂到哪页都能直接放；要不要显示由调用方决定（见 app/page.tsx 的开关）。
 */
export function Newspaper() {
  return (
    <PaperSheet>
      <Masthead />
      <Hero />
    </PaperSheet>
  );
}
