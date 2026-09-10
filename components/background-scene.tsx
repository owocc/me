import { BackgroundCanvas } from "@/components/background-canvas";

/**
 * 背景场景：一块固定铺满视口的画布，视差、缩放、镜头、粒子全在着色器里跑。
 * 元素层面只剩这一个容器 + 画布内部的视频兜底，DOM 不再参与逐帧合成。
 */
export function BackgroundScene() {
  return (
    <div aria-hidden className="bg-scene">
      <BackgroundCanvas src="/bg-loop.mp4" poster="/bg-v1.webp" />
    </div>
  );
}
