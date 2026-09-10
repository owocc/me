import type { CSSProperties } from "react";

type Point = [number, number];

type TornEdgeOptions = {
  /** 沿每条边啃进去的深度，占元素宽/高的比例。 */
  bite: number;
  /** 换一个数字就是另一条毛边。 */
  seed: number;
  /** 每条边上的波数。 */
  waves: number;
  /** 每条边的分段数：够密才不像折线，够疏才不至于把属性撑得太大。 */
  steps: number;
};

type TornEdgeProps = Omit<React.ComponentProps<"div">, "style"> &
  Partial<TornEdgeOptions> & {
    style?: CSSProperties;
  };

/** 确定性伪随机（mulberry32），让毛边看着随机、实则每次都一样。 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 沿矩形四边来回摆动的闭合多边形。每条边的底稿线先内缩半个深度，波形再在
 * ±半个深度之间晃，于是缺口全落在元素之内——元素外的部分根本画不出来，
 * 只有朝里啃的这一侧能看见。波幅在两端收到 0，四边共用角点，接缝才严丝合缝。
 */
function buildTornEdge({ bite, seed, waves, steps }: TornEdgeOptions): string {
  const rand = mulberry32(seed);
  const corners: Point[] = (
    [
      [bite / 2, bite / 2],
      [1 - bite / 2, bite / 2],
      [1 - bite / 2, 1 - bite / 2],
      [bite / 2, 1 - bite / 2],
    ] as Point[]
  ).map(([x, y]) => [x + (rand() * 2 - 1) * (bite / 4), y + (rand() * 2 - 1) * (bite / 4)]);

  const sides: { normal: Point }[] = [
    { normal: [0, 1] },
    { normal: [-1, 0] },
    { normal: [0, -1] },
    { normal: [1, 0] },
  ];

  const points: string[] = [];
  for (const [index, { normal }] of sides.entries()) {
    const from = corners[index];
    const to = corners[(index + 1) % corners.length];
    const phaseA = rand() * Math.PI * 2;
    const phaseB = rand() * Math.PI * 2;
    const sideWaves = waves + Math.floor(rand() * 3);

    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const wobble =
        Math.sin(phaseA + 2 * Math.PI * sideWaves * t) * 0.55 +
        Math.sin(phaseB + 2 * Math.PI * (sideWaves / 2.5) * t) * 0.45;
      const swing = Math.max(-1, Math.min(1, wobble * 0.8 + (rand() * 2 - 1) * 0.2));
      const offset = (bite / 2) * Math.sin(Math.PI * t) * swing;
      const x = (from[0] + (to[0] - from[0]) * t + normal[0] * offset) * 100;
      const y = (from[1] + (to[1] - from[1]) * t + normal[1] * offset) * 100;
      points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
    }
  }

  return `polygon(${points.join(", ")})`;
}

/**
 * 通用毛边容器：把方块的四边裁成不规则的波浪，缺口里透出底下的东西。
 * 任何需要「纸」的质感的地方都用它，别再画直边 border。
 * 想给毛边投阴影，把 filter 挂到外面那层，影子才会跟着波浪走。
 */
export function TornEdge({
  bite = 0.009,
  seed = 20260910,
  waves = 12,
  steps = 40,
  style,
  children,
  ...props
}: TornEdgeProps) {
  return (
    <div style={{ ...style, clipPath: buildTornEdge({ bite, seed, waves, steps }) }} {...props}>
      {children}
    </div>
  );
}
