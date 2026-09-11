import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { kvDataAdapter } from "@vinext/cloudflare/cache/kv-data-adapter";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

export default defineConfig({
  server: {
    // 走隧道/反向代理访问时要带上外部域名（cf tunnel、ngrok 之类），
    // Vite 默认只放行 localhost 与 IP，其它 Host 一律 403。
    // true = 任意 Host 都放行；这是开发服务器的便利开关，别带公网部署跑。
    allowedHosts: true,
  },
  plugins: [
    vinext({
      cache: { data: kvDataAdapter({ binding: "OWOCC_ME_CACHE" }), cdn: cdnAdapter() },
      images: { optimizer: imagesOptimizer() },
      prerender: { routes: "*" },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
