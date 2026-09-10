import type { Metadata } from "next";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "shadcn/ui · Base UI Starter",
  description:
    "shadcn/ui built on Base UI primitives with light/dark theming, running on vinext + Cloudflare Workers.",
};

/**
 * Applied before first paint so the initial render matches the stored theme and
 * the page never flashes the wrong color scheme.
 */
const themeInitScript = `(function(){try{var k="theme";var t=localStorage.getItem(k);var d=t==="dark"||((t===null||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.remove("light","dark");e.classList.add(d?"dark":"light");}catch(e){}})();`;

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
