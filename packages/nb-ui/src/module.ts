import {readFileSync} from "node:fs";

import {addComponent, addImportsDir, createResolver, defineNuxtModule} from "@nuxt/kit";

export type NbUiModuleOptions = {
    /**
     * 自动注册组件时使用的前缀。默认不加前缀，便于模板项目直接使用 Dialog / IconButton。
     */
    componentPrefix?: string;
};

/*
 * 自动导入的范围与包入口相同：组件取 `components/index.ts` 里 `export {default as X} from "./….vue"` 的那些，
 * composable 取 `composables/index.ts` 里 `export * from "./…"` 的那些文件。按目录整个登记会把入口没导出的内部零件
 * （MenuNodes、PopupViewport、useMenuCascade 这类）也变成全局名，内部重构就成了破坏性变更。入口改成别的写法时，
 * 这里读不出名字，nuxt prepare 生成的组件声明会少掉对应的项。
 */
const COMPONENT_EXPORT = /^export \{default as (\w+)\} from "(\.\/[^"]+\.vue)";$/gm;
const COMPOSABLE_EXPORT = /^export \* from "(\.\/[^"]+)";$/gm;

/**
 * Nuxt 接入模块：注册入口导出的组件与 composable，并确保 linked 源码交给 Vite 转译。
 */
export default defineNuxtModule<NbUiModuleOptions>({
    meta: {
        name: "@notnotype/nb-ui",
        configKey: "nbUi",
    },
    defaults: {
        componentPrefix: "",
    },
    setup(options, nuxt) {
        const resolver = createResolver(import.meta.url);
        const packageRoot = resolver.resolve("..");

        nuxt.options.build.transpile.push("@notnotype/nb-ui");
        nuxt.options.vite ||= {};
        nuxt.options.vite.server ||= {};
        nuxt.options.vite.server.fs ||= {};
        const allow = nuxt.options.vite.server.fs.allow ||= [];
        if (!allow.includes(packageRoot)) {
            allow.push(packageRoot);
        }

        const componentsIndex = readFileSync(resolver.resolve("./components/index.ts"), "utf8");
        for (const [, name, path] of componentsIndex.matchAll(COMPONENT_EXPORT)) {
            addComponent({name: `${options.componentPrefix ?? ""}${name}`, filePath: resolver.resolve("./components", path!)});
        }
        // 每个文件当作一个目录项交给 imports.dirs（它接受 glob，不带通配符的路径只匹配这个文件本身）
        const composablesIndex = readFileSync(resolver.resolve("./composables/index.ts"), "utf8");
        for (const [, path] of composablesIndex.matchAll(COMPOSABLE_EXPORT)) {
            addImportsDir(resolver.resolve("./composables", `${path}.ts`));
        }
    },
});
