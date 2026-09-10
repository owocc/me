import {
  BlocksIcon,
  CloudIcon,
  MoonStarIcon,
  PaletteIcon,
  SparklesIcon,
  TerminalIcon,
} from "lucide-react";

import { ComponentShowcase, ThemeNote } from "@/components/component-showcase";
import { ModeToggle } from "@/components/mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const revalidate = 300;

const highlights = [
  {
    icon: BlocksIcon,
    title: "shadcn/ui",
    description:
      "组件以源码形式落在 components/ui，直接改、直接用自己的设计系统覆盖。",
  },
  {
    icon: SparklesIcon,
    title: "Base UI 原语",
    description:
      "使用 base-nova 预设，底层是 @base-ui/react，用 render 组合替代 asChild。",
  },
  {
    icon: PaletteIcon,
    title: "明暗主题",
    description:
      "oklch 语义化色板 + CSS 变量，切换写入 localStorage，首屏不闪烁。",
  },
  {
    icon: CloudIcon,
    title: "Cloudflare Workers",
    description:
      "vinext 在 Vite 上实现 App Router 语义，构建产物直接跑在 Workers 边缘。",
  },
];

export default function Home() {
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <TerminalIcon className="size-5" />
          <span className="font-heading text-sm font-semibold">
            shadcn/ui · Base UI
          </span>
          <Badge className="ml-1" variant="secondary">
            base-nova
          </Badge>
          <ModeToggle className="ml-auto" />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
        <section className="flex flex-col gap-4">
          <Badge variant="outline">
            <SparklesIcon data-icon="inline-start" />
            shadcn/ui on Base UI primitives
          </Badge>
          <h1 className="max-w-2xl font-heading text-3xl leading-tight font-semibold text-balance sm:text-4xl">
            项目已就绪，接下来只需要写你自己的界面。
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            这套项目由 shadcn/ui CLI 初始化，使用 <code className="text-foreground">base-nova</code>{" "}
            预设（Base UI 原语 + neutral 主题），并接入了可持久化的浅色 / 深色 / 跟随系统主题切换。
          </p>
          <div className="flex flex-wrap gap-3">
            <Button render={<a href="#components" />}>
              <BlocksIcon data-icon="inline-start" />
              查看组件
            </Button>
            <Button variant="outline" render={<a href="/api/hello" />}>
              调用 API 路由
            </Button>
          </div>
        </section>

        <ThemeNote />

        <section className="grid gap-4 sm:grid-cols-2">
          {highlights.map(({ icon: Icon, title, description }) => (
            <Card key={title}>
              <CardHeader>
                <CardAction>
                  <Icon className="size-4 text-muted-foreground" />
                </CardAction>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </section>

        <section className="flex flex-col gap-4" id="components">
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-xl font-semibold">开始添加组件</h2>
            <p className="text-sm text-muted-foreground">
              用 CLI 继续拉取组件，或直接编辑 <code>components/ui/</code> 下的源码。
            </p>
          </div>
          <Card>
            <CardContent className="pt-6">
              <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                <code>{`pnpm dlx shadcn@latest add sidebar chart
pnpm dlx shadcn@latest docs button`}</code>
              </pre>
            </CardContent>
          </Card>
          <ComponentShowcase />
        </section>

        <Separator />

        <footer className="flex flex-wrap items-center gap-2 pb-4 text-sm text-muted-foreground">
          <span>左侧目录结构：</span>
          <code>app/</code>
          <code>components/ui/</code>
          <code>components/theme-provider.tsx</code>
          <code>lib/utils.ts</code>
          <code>components.json</code>
        </footer>
      </main>
    </div>
  );
}
