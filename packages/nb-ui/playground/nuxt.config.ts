import nbUi from "../src/module";
import {defineNuxtConfig} from "nuxt/config";
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
    ssr: false,
    modules: [nbUi],
    // Tailwind v4 是 Vite 插件 + CSS-first 配置，没有 Nuxt module 形态。
    // 入口 CSS 的 @import "tailwindcss" 自带 preflight，不再单独引 reset。
    // nb-ui 的样式也在入口 CSS 里导入源码入口 src/tailwind.css，由这里的 Tailwind 编译，模块不注入任何样式。
    css: ["~/assets/css/main.css"],
    vite: {
        plugins: [tailwindcss()],
        optimizeDeps: {
            include: [
                "@vueuse/core",
                "errx",
                "reka-ui",
                "clsx",
                "tailwind-merge",
            ],
        },
    },
    compatibilityDate: "2026-07-03",
    devtools: {
        enabled: false,
    },
});
