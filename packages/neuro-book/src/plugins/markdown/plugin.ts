import type {PluginDescriptor} from "nbook/manifest";

import {BUILTIN_DIALECTS, MARKDOWN_DIALECTS_POINT} from "./shared/dialects";

/**
 * Markdown（docs/specs/workspace/markdown-dialect.md、markdown-syntaxes.md）：作品 Markdown 的语言与编解码器、字数，以及
 * 用它们的组件。编辑器与以后的 Agent 界面经它的服务使用。内置方言的声明是顶层贡献：浏览器与项目两个位置都登记，字数按它们算。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.markdown",
    version: "0.1.0",
    locations: ["browser", "project"],
    contributions: Object.entries(BUILTIN_DIALECTS).map(([id, declaration]) => ({capability: MARKDOWN_DIALECTS_POINT, id, declaration})),
};
