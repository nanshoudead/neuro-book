/**
 * e2e 测试外壳的构建：与产品前端同一份配置，入口换成 `src/web/testing/index.html`（多装一个测试插件），输出到
 * `dist/e2e/web`。产品的 `dist/web` 与 `check:dist` 不受影响。
 */

import {fileURLToPath} from "node:url";

import {mergeConfig} from "vite";

import base, {FULL_STYLE_ENTRY, STYLE_ENTRY} from "./vite.config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default mergeConfig(base, {
    root: `${packageRoot}src/web/testing`,
    // 测试外壳的插件界面在 `src/web/testing/`，生产入口排除了它，这里换回完整入口（别名合并时排在基础配置之前）。
    resolve: {alias: [{find: STYLE_ENTRY, replacement: FULL_STYLE_ENTRY}]},
    build: {outDir: `${packageRoot}dist/e2e/web`, emptyOutDir: true},
});
