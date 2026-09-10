/**
 * 站点内容源：个人信息只在这里改一次，版面各处引用它。
 */
export const profile = {
  /** 报头中文名 */
  masthead: "RIVO 日报",
  /** 报头拉丁名 */
  mastheadLatin: "THE RIVO DAILY",
  /** 报头副题 */
  tagline: "一个人的头版",
  /** 期号 */
  issue: "第 001 期",
  /** 署名 */
  name: "Rivo",
} as const;

/**
 * 印刷日期。时区写死为北京时间：云端渲染跑在 UTC，若跟随本机时区，
 * 服务端与浏览器会算出不同的日期，触发水合不一致。
 */
export function printDate(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}
