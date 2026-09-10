import { LoadingVeil } from "@/components/loading-veil";
import { Newspaper } from "@/components/newspaper";

/** 报纸先收起来，等版面定稿再打开。 */
const SHOW_NEWSPAPER = false;

export default function Home() {
  return (
    <main className="min-h-screen">
      {SHOW_NEWSPAPER && <Newspaper />}
      {/* 进场：字从中间放大到溢出整屏，洞里透出画面，随后底色淡出 */}
      <LoadingVeil preload={["/bg-v1.webp"]} />
    </main>
  );
}
