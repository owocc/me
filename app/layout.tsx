import type { Metadata } from 'next';

// 字体必须交给 Vite 的 CSS 管线直接处理：Fontsource 的 CSS 内是相对 url(./files/*.woff2)，
// 一旦被 Tailwind 的 @import 内联进 globals.css，URL 重写就会失效，woff 文件不会被产出（线上 404）。
// 因此在这里以独立 CSS 模块导入，不要写回 globals.css 的 @import。
import '@fontsource-variable/inter';
import '@fontsource/bonheur-royale/latin.css';

import './globals.css';

import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { profile } from '@/lib/profile';

export const metadata: Metadata = {
  title: `${profile.masthead} · 个人主页`,
  description: `${profile.name} 的个人主页：像一份报纸那样排版，每个板块讲一件事。`,
};

/**
 * Applied before first paint so the initial render matches the stored theme and
 * the page never flashes the wrong color scheme.
 */
const themeInitScript = `(function(){try{var k='theme';var t=localStorage.getItem(k);var d=t==='dark'||((t===null||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(d?'dark':'light');}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
