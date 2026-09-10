import { Newspaper } from "@/components/newspaper";

/** 报纸先收起来，等背景素材调定再打开。 */
const SHOW_NEWSPAPER = false;

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-3 lg:p-10">
      {SHOW_NEWSPAPER && <Newspaper />}
    </main>
  );
}
