/**
 * 首屏里「PC 素材 + 屏幕」的几何：素材按 cover 铺满版面，屏幕上那块画面窗口的位置与大小
 * 按素材量出来 + 屏幕自己的比例算（下面这些常量都是从 public/pc_cutout.webp 里实测的）。
 *
 * hero-scene.tsx 拿它算「起手放大多少倍」，scene-canvas.tsx 拿它把窗口与素材摆进着色器：
 * 两处共用这一份，免得各算一套、越走越远。长度单位都是版面 px。
 *
 * 画面（视频）怎么铺进那块窗口有两套取景，见 {@link videoRect}：
 *   · 贴屏幕：视频 cover 铺进 4:3 的窗口（屏幕就是 4:3 的，16:9 的视频于是左右各裁掉一截）；
 *   · 铺满：视频 cover 铺进「画布真正露在视口里的那一块」（见 {@link visibleFrame}），
 *     只按屏幕比例裁最少的一点——16:9 的屏幕上几乎一点都不裁。
 * 两套都由这里算出「视频那块矩形在版面里的位置与大小」，着色器只做一次 uv 采样。
 */

/**
 * 玻璃（屏幕上那块洞）在素材里的占位。
 * 从 fly-pc_alpha.webm (1280×720) 实测：透明屏幕区域在 540, 232，宽 216、高 160。
 */
export const GLASS = { x: 540 / 1280, y: 232 / 720, w: 216 / 1280, h: 160 / 720 } as const;

/** 屏幕的比例：老显示器是 4:3 的，写死——不跟素材量出来的包围盒走（那个被斜角撑宽了）。 */
export const SCREEN_ASPECT = 4 / 3;

/** 素材固有宽高比（1280×720 = 16:9）。换图就跟着改——两处不一致时 scene-canvas 会告警。 */
export const ART_RATIO = 1280 / 720;

export type HeroGeometry = {
  /** 素材内容按 cover 铺满版面时，内容在版面里的位置与大小（px） */
  art: { x: number; y: number; w: number; h: number };
  /** 画面窗口（4:3）在版面坐标里的矩形（px），x/y 是中心点 */
  hole: { cx: number; cy: number; w: number; h: number };
  /**
   * 窗口比玻璃小出来的那一圈（px）：屏幕是 4:3、玻璃的包围盒更宽，差出来的这点落在
   * 玻璃边沿上。着色器靠它把画面往外多画一圈，不然那圈会透出台面底色。
   */
  pad: number;
  /** 起手放大倍数：放大到「整幅视频正好落在版面里」（上下留黑边） */
  grow: number;
};

/** 版面尺寸（= 画布尺寸 = 一屏 + 底下的撕口余量）→ 素材与窗口的几何 */
export function heroGeometry(boxW: number, boxH: number): HeroGeometry {
  // cover：版面比素材更宽时按宽铺满，否则按高铺满——和 object-fit: cover 一个算法
  const artH = boxW / boxH > ART_RATIO ? boxW / ART_RATIO : boxH;
  const artW = artH * ART_RATIO;
  const art = { x: (boxW - artW) / 2, y: (boxH - artH) / 2, w: artW, h: artH };

  // 画面窗口：先按玻璃的包围盒取，再收成 4:3——玻璃斜着放，包围盒比真屏幕宽，
  // 收的时候保住高（宽按 4:3 推），免得把屏幕上下裁掉一条。
  const glassW = GLASS.w * art.w;
  const glassH = GLASS.h * art.h;
  const holeW = Math.min(glassW, glassH * SCREEN_ASPECT);
  const holeH = holeW / SCREEN_ASPECT;
  const hole = {
    cx: art.x + (GLASS.x + GLASS.w / 2) * art.w,
    cy: art.y + (GLASS.y + GLASS.h / 2) * art.h,
    w: holeW,
    h: holeH,
  };
  // 窗口四边到玻璃包围盒的空档（取大的那边），着色器拿它当「画面往外多画一圈」的宽度
  const pad = Math.max((glassW - holeW) / 2, (glassH - holeH) / 2);

  // 起手倍数：放大到「窗口（含外扩那圈）盖住整块版面」——四个方向各量各的，取最远的那个边，
  // 这样首屏一点底色都不露（画面铺满整屏）。窗口心不在版面正中（屏幕偏右偏上），所以不能只看边长。
  const grow = Math.max(
    (2 * Math.max(hole.cx, boxW - hole.cx)) / (hole.w + 2 * pad),
    (2 * Math.max(hole.cy, boxH - hole.cy)) / (hole.h + 2 * pad),
  );
  return { art, hole, pad, grow };
}

/** 版面里的一块矩形（px）。视频那两套取景、可见取景框都用它。 */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * 取景框外扩的一圈（画布 px）：满屏取景是按「露在视口里的那一块」算的，
 * 但那一块是靠 getBoundingClientRect / offsetWidth 量出来的，与浏览器最后画上去的那几行像素
 * 之间有亚像素取整、滚动条那点缝，画面边缘贴得太死会抽到画面外（CLAMP 拉出一条边）。
 * 外扩这一圈兜住它，代价是比例上多裁不到 1%。
 */
export const VIEW_OVERSCAN = 12;

/**
 * 满屏取景要贴的那块框：画布当前真正露在视口里的那一块（canvas，画布 px），绕缩放支点
 * 逆着版面放大倍数映回版面坐标——与着色器里 `board = uZoomAnchor + (px - uZoomAnchor) / uBoardScale` 同一套算法。
 *
 * 注意是「露在视口里的那一块」，不是整块画布：画布比一屏高（底下还有 --hero-bleed 给撕口留的余量），
 * 拿整块画布去 cover 的话长宽比接近 4:3，16:9 的视频照样要裁掉四分之一，等于白改。
 */
export function visibleFrame(
  out: Rect,
  scale: number,
  anchorX: number,
  anchorY: number,
  canvas: Rect,
): Rect {
  const k = Math.max(scale, 1e-3);
  const half = VIEW_OVERSCAN / 2;
  out.x = anchorX + (canvas.x - half - anchorX) / k;
  out.y = anchorY + (canvas.y - half - anchorY) / k;
  out.w = (canvas.w + VIEW_OVERSCAN) / k;
  out.h = (canvas.h + VIEW_OVERSCAN) / k;
  return out;
}

/**
 * 视频按 cover 铺进一块取景框之后，视频自己那块矩形在版面里的位置与大小（px）。
 * 着色器于是只要 `uv = (board - rect.xy) / rect.zw` 一次采样：视差、定点缩放都算进了这个矩形里。
 *
 * cover：框比视频「宽」就按宽铺满、上下裁，否则按高铺满、左右裁——和 object-fit: cover 一个算法，
 * 裁的是多出来的那一边。框就是 {@link visibleFrame} 那块时，裁掉的就只剩屏幕与视频比例差的那一点。
 *
 * 顺序与原来着色器里那段等价（先 cover 居中、再叠视差、最后绕支点放大）：
 * 视差只叠一次，不跟着 zoom 一起放大；缩放绕支点，于是支点那个点不动。
 * 用 out 数组写出（Float32Array(4) 直接喂 uniform4fv），热路径里不新建对象。
 */
export function videoRect(
  out: Float32Array,
  frame: Rect,
  videoW: number,
  videoH: number,
  pivotX: number,
  pivotY: number,
  zoom: number,
  parallaxX: number,
  parallaxY: number,
): Float32Array {
  const cover = Math.max(frame.w / videoW, frame.h / videoH);
  const displayedW = videoW * cover;
  const displayedH = videoH * cover;
  // 未缩放时视频在框里居中，再往指针反方向推一点（视差）
  const originX = frame.x + (frame.w - displayedW) * 0.5 - parallaxX;
  const originY = frame.y + (frame.h - displayedH) * 0.5 - parallaxY;
  out[0] = pivotX + (originX - pivotX) * zoom;
  out[1] = pivotY + (originY - pivotY) * zoom;
  out[2] = displayedW * zoom;
  out[3] = displayedH * zoom;
  return out;
}

/**
 * 点（版面 px）落没落在「画面（视频）窗口」里。
 *
 * 判据与 scene-canvas.tsx 着色器里那段 insideHole 同一套：先把点绕缩放支点反解回「还没放大」
 * 的版面坐标（scale 就是着色器里的 uBoardScale），再看它落不落在屏幕洞的矩形里——洞外那圈
 * pad 也算（着色器同样往外多画一圈，不然玻璃边沿会透出台面底色）。
 *
 * 点击放大只认画面这一块：版面里别的部分（显示器边壳、草地、留边）点下去不算点在视频上。
 * 放大到满屏那一档（scale = grow、素材已淡出）时，整块版面都落在窗口里，于是又能点哪儿都算。
 */
export function hitsScreenHole(
  point: { x: number; y: number },
  view: {
    /** 屏幕洞在版面里的矩形（px），x/y 是左上角 */
    hole: { x: number; y: number; w: number; h: number };
    /** 洞外仍算画面的那一圈（px），见 HeroGeometry.pad */
    pad: number;
    /** 版面当前的放大倍数（着色器里的 uBoardScale） */
    scale: number;
    /** 缩放支点（版面 px）：与着色器里的 uZoomAnchor 同一个——桌面是洞心，手机是画布中心 */
    anchor: { x: number; y: number };
  },
): boolean {
  const scale = Math.max(view.scale, 1e-3);
  const bx = view.anchor.x + (point.x - view.anchor.x) / scale;
  const by = view.anchor.y + (point.y - view.anchor.y) / scale;
  const { hole, pad } = view;
  return bx >= hole.x - pad && bx <= hole.x + hole.w + pad && by >= hole.y - pad && by <= hole.y + hole.h + pad;
}
