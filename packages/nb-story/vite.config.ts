import {resolve} from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import {defineConfig} from "vite";

/** 查看器前端：根是 src/web，产物进 dist/web（不入库，`nbstory serve` 发现没有产物时先构建）。设置照 dev-panel 的 vite.config.ts。 */
export default defineConfig({
    root: resolve(import.meta.dirname, "src/web"),
    base: "/",
    plugins: [vue(), tailwindcss()],
    build: {
        outDir: resolve(import.meta.dirname, "dist/web"),
        emptyOutDir: true,
        // 只在本机开，产物大小不是问题；图的依赖（sigma、graphology）占大头。
        chunkSizeWarningLimit: 3_000,
        // Lightning CSS 会把 backdrop-filter 与它的 -webkit- 前缀当成同一属性只留一条（见 dev-panel 的 vite.config.ts），换回 esbuild。
        cssMinify: "esbuild",
        rolldownOptions: {checks: {pluginTimings: false}},
    },
});
