/**
 * 首屏的画面资源源：屏幕里播的视频段（数组）、PC 素材、以及进场遮罩要等的图。
 *
 * 集中放这里是为了「加一段视频只改一处」：hero-scene 把 {@link HERO_VIDEOS} 与
 * {@link ACTIVE_HERO_VIDEO} 喂给画布（components/scene-canvas.tsx），app/page.tsx 的进场
 * 遮罩也从这里取要等的资源。段数、顺序、当前第几段都对着这一份，不会各改各的。
 */

/**
 * 屏幕里的一段画面：src 是视频本体，poster 是解码前先顶上的首帧。
 * 形状与 SceneCanvas 的 VideoSource 一致（组件那边不依赖这个文件，是可复用的）。
 */
export type HeroVideo = {
  src: string;
  poster: string;
};

/**
 * 屏幕里的画面段（数组）。现在只有一段，但结构已经是数组：以后加段、做切换
 * 只要往这里加项、改 {@link ACTIVE_HERO_VIDEO}，着色器与几何都不用动。
 */
export const HERO_VIDEOS: readonly HeroVideo[] = [{ src: "/bg-loop.mp4", poster: "/bg-v1.webp" }];

/**
 * 当前在屏幕上播的是 HERO_VIDEOS 的下标（喂给 SceneCanvas 的 activeVideo）。
 * 硬切：换下标下一帧就换画面，不做交叉淡入。多段切换接上以后这里改由状态驱动。
 */
export const ACTIVE_HERO_VIDEO = 0;

/** PC 素材（显示器 + 草地），屏幕那块洞是全透明的；也当无 WebGL 时的兜底背景 */
export const HERO_PC_ASSET = "/fly-pc_alpha.webm";

/**
 * 进场遮罩（LoadingVeil）开动画前等的东西：每一段的 poster、PC 素材。
 * 漏了某一段的 poster 不至于出错，只是那一段解码前会先透出空底；网慢时 loading-veil
 * 自己只等一小会儿就放行，不会把进场拖住。
 */
export const HERO_PRELOAD: readonly string[] = [...HERO_VIDEOS.map((video) => video.poster), HERO_PC_ASSET];
