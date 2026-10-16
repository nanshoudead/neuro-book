import type {PluginDescriptor} from "nbook/manifest";

/**
 * Markdown（docs/specs/workspace/markdown-dialect.md、markdown-syntaxes.md）：作品 Markdown 的语言与编解码器、字数，以及
 * 用它们的展示器与写给 Agent 的编辑组件。编辑器与以后的 Agent 界面经它的服务使用。
 */
export const descriptor: PluginDescriptor = {id: "nbook.markdown", version: "0.1.0", locations: ["browser"]};
