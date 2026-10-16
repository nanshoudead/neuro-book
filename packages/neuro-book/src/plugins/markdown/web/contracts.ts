/**
 * 贡献方言实现的插件按类型引用的合同（docs/specs/workspace/markdown-syntaxes.md）：`markdown.syntaxes` 的实现与语法模块的形状。
 * 只放类型；运行时的贡献点 id 与声明校验在 `../shared/contracts.ts`。
 */

import type {MarkdownSyntax} from "./syntax/types";

export type {MarkdownSyntax} from "./syntax/types";

/** `markdown.syntaxes` 的实现：交付后由 `nbook.markdown` 调用一次 `load()`。 */
export interface MarkdownSyntaxImplementation {
    load(): Promise<MarkdownSyntax>;
}
