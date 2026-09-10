import type { Metadata } from 'next';
import './globals.css';

import { BackgroundScene } from '@/components/background-scene';
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
        <BackgroundScene />
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
