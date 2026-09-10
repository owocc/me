/**
 * 背景场景：一张固定的照片 + 三层光，全部收在这个 fixed 容器里。
 * 点击缩放时整场景一起推近/拉远（缩放挂在 .bg-scene 上，见 globals.css），
 * 光斑的位置是容器内的百分比，所以会跟着一起放大，像镜头推近。
 * 照片层的视差平移、光层的光源漂移分别由 background-motion.tsx 写变量驱动。
 */
export function BackgroundScene() {
  return (
    <div aria-hidden className="bg-scene">
      <div data-bg-light className="bg-light bg-light-1" />
      <div data-bg-light className="bg-light bg-light-2" />
      <div data-bg-light className="bg-light bg-light-3" />
    </div>
  );
}
