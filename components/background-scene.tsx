import { BackgroundVideo } from "@/components/background-video";
/**
 * 背景场景：一张固定的照片 + 放大时才浮现的镜头效果。
 *
 * 照片只有一层：放大时把畸变滤镜直接加在它身上，不再复制一份图像去交叉淡化
 *   · .bg-photo  照片/视频层：静音循环的视频铺满它，视差平移与畸变滤镜都挂在这一层；
 *   · .bg-lens-blur 只对背后做 backdrop-filter 的四周失焦（径向遮罩裁到外圈）；
 *   · .bg-refraction 最外圈一道折射高光，screen 叠上去，像镜片边缘吃光。
 *
 * 三层光**不在**这个容器里——它们单独一层（.bg-lights），不跟着缩放，
 * 相当于打在场景上的固定灯光，画面推近时灯的位置与尺度保持不变。
 *
 * 畸变用 feDisplacementMap + 一张预生成的径向位移图 public/lens-map.webp：
 * 图中心是 128/128（不位移），越靠边 R/G 越偏，采样点被推得越远——
 * scale 取负，采样落在图像内部，于是四周被向外拉伸铺满画面（放大镜的放大感），
 * 同时任何时候都不会采样到图像外的透明像素。想更猛就调大 |scale|。
 * 四周失焦用 public/lens-falloff.webp（中心 alpha=0、外圈 alpha=255）当 CSS 遮罩，
 * 想调糊的力度改 --lens-blur，想调糊的范围改那张遮罩的渐变区间。
 */
export function BackgroundScene() {
  return (
    <>
      <div aria-hidden className="bg-scene">
        <svg className="pointer-events-none absolute size-0" focusable="false">
          <defs>
            <filter id="lens-warp" x="-12%" y="-12%" width="124%" height="124%" colorInterpolationFilters="sRGB">
              <feImage href="/lens-map.webp" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale="-40"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>
        <div className="bg-photo">
          <BackgroundVideo src="/bg-loop.mp4" poster="/bg-v1.webp" />
        </div>
        <div className="bg-lens-blur" />
        <div className="bg-refraction" />
      </div>
      <div aria-hidden className="bg-lights">
        <div data-bg-light className="bg-light bg-light-1" />
        <div data-bg-light className="bg-light bg-light-2" />
        <div data-bg-light className="bg-light bg-light-3" />
      </div>
    </>
  );
}
