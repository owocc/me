"use client";

import * as React from "react";
import {
  BellRingIcon,
  ChevronsUpDownIcon,
  CircleCheckIcon,
  CloudDownloadIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const DEPLOYMENTS = [
  { id: "dpl_01H9", env: "Production", status: "成功", commit: "a3f9c21" },
  { id: "dpl_01H8", env: "Preview", status: "构建中", commit: "7d02b84" },
  { id: "dpl_01H7", env: "Preview", status: "失败", commit: "c188e40" },
];

export function ComponentShowcase() {
  const [notifications, setNotifications] = React.useState(true);
  const [analytics, setAnalytics] = React.useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>组件预览</CardTitle>
        <CardDescription>
          全部组件来自 shadcn/ui 的 <code className="text-foreground">base-nova</code> 预设，
          底层使用 Base UI 原语。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="actions">
          <TabsList>
            <TabsTrigger value="actions">操作</TabsTrigger>
            <TabsTrigger value="form">表单</TabsTrigger>
            <TabsTrigger value="data">数据</TabsTrigger>
          </TabsList>

          <TabsContent className="pt-4" value="actions">
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center gap-2">
                <Button>
                  <PlusIcon data-icon="inline-start" />
                  主要
                </Button>
                <Button variant="secondary">次要</Button>
                <Button variant="outline">描边</Button>
                <Button variant="ghost">幽灵</Button>
                <Button variant="destructive">
                  <TrashIcon data-icon="inline-start" />
                  危险
                </Button>
                <Button variant="link">链接</Button>
              </div>

              <Separator />

              <div className="flex flex-wrap items-center gap-3">
                <Dialog>
                  <DialogTrigger render={<Button variant="outline" />}>
                    打开对话框
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>确认部署</DialogTitle>
                      <DialogDescription>
                        该操作会把当前分支发布到 Production 环境，可在部署记录中回滚。
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter showCloseButton>
                      <Button>
                        <CloudDownloadIcon data-icon="inline-start" />
                        立即部署
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="outline" />}
                  >
                    更多操作
                    <ChevronsUpDownIcon data-icon="inline-end" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-48">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>部署</DropdownMenuLabel>
                      <DropdownMenuItem>
                        <CopyIcon />
                        复制部署 ID
                        <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <BellRingIcon />
                        订阅通知
                        <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive">
                      <TrashIcon />
                      删除部署
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" size="icon" />}>
                    <CircleCheckIcon />
                    <span className="sr-only">查看部署状态</span>
                  </TooltipTrigger>
                  <TooltipContent>最近 3 次部署均无异常</TooltipContent>
                </Tooltip>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge>默认</Badge>
                <Badge variant="secondary">次要</Badge>
                <Badge variant="outline">描边</Badge>
                <Badge variant="destructive">失败</Badge>
                <Badge variant="ghost">幽灵</Badge>
              </div>

              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage alt="@owocc" src="https://github.com/shadcn.png" />
                  <AvatarFallback>OC</AvatarFallback>
                </Avatar>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">owocc</span>
                  <span className="text-xs text-muted-foreground">运维</span>
                </div>
                <Skeleton className="ml-auto h-4 w-24" />
              </div>
            </div>
          </TabsContent>

          <TabsContent className="pt-4" value="form">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="project-name">项目名称</Label>
                <Input id="project-name" placeholder="my-awesome-app" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="project-domain">自定义域名</Label>
                <Input id="project-domain" placeholder="app.example.com" />
              </div>

              <div className="flex flex-col gap-4 md:col-span-2">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="notifications">部署通知</Label>
                    <span className="text-sm text-muted-foreground">
                      构建结束时发送邮件提醒。
                    </span>
                  </div>
                  <Switch
                    id="notifications"
                    checked={notifications}
                    onCheckedChange={setNotifications}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="analytics">接入分析</Label>
                    <span className="text-sm text-muted-foreground">
                      统计页面访问量与性能指标。
                    </span>
                  </div>
                  <Switch
                    id="analytics"
                    checked={analytics}
                    onCheckedChange={setAnalytics}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 md:col-span-2">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">本月免费额度</span>
                  <span className="text-sm text-muted-foreground tabular-nums">72%</span>
                </div>
                <Progress value={72} />
              </div>
            </div>
          </TabsContent>

          <TabsContent className="pt-4" value="data">
            <Table>
              <TableCaption>最近三次部署记录</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>部署 ID</TableHead>
                  <TableHead>环境</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">提交</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DEPLOYMENTS.map((deployment) => (
                  <TableRow key={deployment.id}>
                    <TableCell className="font-medium">{deployment.id}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {deployment.env}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          deployment.status === "失败" ? "destructive" : "secondary"
                        }
                      >
                        {deployment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {deployment.commit}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export function ThemeNote() {
  return (
    <Alert>
      <CircleCheckIcon />
      <AlertTitle>主题已接入</AlertTitle>
      <AlertDescription>
        点击右上角切换浅色 / 深色 / 跟随系统；选择会写入 localStorage，
        并在首屏渲染前应用，避免闪烁。键盘按 <kbd className="rounded border border-border px-1 text-xs">d</kbd> 也可快速切换。
      </AlertDescription>
    </Alert>
  );
}

