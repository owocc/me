/**
 * 首屏里「PC 素材 + 屏幕」的几何：素材按 cover 铺满版面，屏幕上那块画面窗口的位置与大小
 * 按素材量出来 + 屏幕自己的比例算（下面这些常量都是从 public/pc_cutout.webp 里实测的）。
 *
 * hero-scene.tsx 拿它算「起手放大多少倍」，scene-canvas.tsx 拿它把窗口与素材摆进着色器：
 * 两处共用这一份，免得各算一套、越走越远。长度单位都是版面 px。
 */

/**
 * 玻璃（屏幕上那块洞）在素材里的占位。
 * 量法：把 webp 画进 canvas 扫 alpha，取「不是全不透明」那一片的紧包围盒——当前这张
 * 2200×1228 量得 927,397 起、371×269 大（50% 半透明的边线在 930,400 / 365×263）。
 * 取的是最外那一圈：显示器在素材里是斜着的（屏幕四角不在同一水平线上），包围盒比真屏幕宽，
 * 所以下面还要按屏幕自己的比例收一次。换图必须重新量（占位与导出尺寸无关）。
 */
export const GLASS = { x: 927 / 2200, y: 397 / 1228, w: 371 / 2200, h: 269 / 1228 } as const;

/** 屏幕的比例：老显示器是 4:3 的，写死——不跟素材量出来的包围盒走（那个被斜角撑宽了）。 */
export const SCREEN_ASPECT = 4 / 3;

/** 素材固有宽高比（2200×1228 的导出）。换图就跟着改——两处不一致时 scene-canvas 会告警。 */
export const ART_RATIO = 2200 / 1228;

/** 起手放大到「窗口盖满整个版面」之后再留的一点余量：首屏一点边壳都不露。 */
const GROW_FILL = 1.02;

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
  /** 起手放大倍数：放大到窗口把整个版面（含首屏下面那截留白）都盖住 */
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

  // 窗口心不在版面正中（屏幕偏上，离下沿最远），所以四个方向分开量、取最远的那个边：
  // 照它放大，窗口就把整个版面都罩住了。
  const grow =
    Math.max(
      (2 * Math.max(hole.cx, boxW - hole.cx)) / hole.w,
      (2 * Math.max(hole.cy, boxH - hole.cy)) / hole.h,
    ) * GROW_FILL;
  return { art, hole, pad, grow };
}
