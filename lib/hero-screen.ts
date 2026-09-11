/**
 * 首屏里「PC 素材 + 屏幕洞」的几何：素材按 cover 铺满版面，屏幕那块洞的位置与大小按素材
 * 自带的比例算（下面两个常量都是从 public/pc_cutout.webp 里实测出来的）。
 *
 * hero-scene.tsx 拿它算「起手放大多少倍」，scene-canvas.tsx 拿它把洞与素材摆进着色器：
 * 两处共用这一份，免得各算一套、越走越远。长度单位都是版面 px。
 */

/**
 * 屏幕洞在素材里占自身宽高的比例。
 * 量法：把 webp 画进 canvas 扫 alpha，取「不是全不透明」那一片的紧包围盒——当前这张
 * 2200×1228 量得 927,397 起、371×269 大（50% 半透明的边线在 930,400 / 365×263）。
 * 取最外那一圈：显示器在素材里是斜着的（屏幕四角不在同一水平线上），方洞照着最大范围取，
 * 才盖得住整块玻璃；多出来的那点落在不透光的边壳上，被素材自己挡掉，看不见。
 * 换图必须重新量（比例与导出尺寸无关）。
 */
export const SCREEN = { x: 927 / 2200, y: 397 / 1228, w: 371 / 2200, h: 269 / 1228 } as const;

/** 素材固有宽高比（2200×1228 的导出）。换图就跟着改——两处不一致时 scene-canvas 会告警。 */
export const ART_RATIO = 2200 / 1228;

/** 起手放大到「洞盖满整个版面」之后再留的一点余量：首屏一点边壳都不露。 */
const GROW_FILL = 1.02;

export type HeroGeometry = {
  /** 素材内容按 cover 铺满版面时，内容在版面里的位置与大小（px） */
  art: { x: number; y: number; w: number; h: number };
  /** 屏幕洞在版面坐标里的矩形（px），x/y 是中心点 */
  hole: { cx: number; cy: number; w: number; h: number };
  /** 起手放大倍数：放大到洞把整个版面（含首屏下面那截留白）都盖住 */
  grow: number;
};

/** 版面尺寸（= 画布尺寸 = 一屏 + 底下的撕口余量）→ 素材与洞的几何 */
export function heroGeometry(boxW: number, boxH: number): HeroGeometry {
  // cover：版面比素材更宽时按宽铺满，否则按高铺满——和 object-fit: cover 一个算法
  const artH = boxW / boxH > ART_RATIO ? boxW / ART_RATIO : boxH;
  const artW = artH * ART_RATIO;
  const art = { x: (boxW - artW) / 2, y: (boxH - artH) / 2, w: artW, h: artH };
  const hole = {
    cx: art.x + (SCREEN.x + SCREEN.w / 2) * art.w,
    cy: art.y + (SCREEN.y + SCREEN.h / 2) * art.h,
    w: SCREEN.w * art.w,
    h: SCREEN.h * art.h,
  };
  // 洞心不在版面正中（屏幕偏上，离下沿最远），所以四个方向分开量、取最远的那个边：
  // 照它放大，洞就把整个版面都罩住了。
  const grow =
    Math.max(
      (2 * Math.max(hole.cx, boxW - hole.cx)) / hole.w,
      (2 * Math.max(hole.cy, boxH - hole.cy)) / hole.h,
    ) * GROW_FILL;
  return { art, hole, grow };
}
