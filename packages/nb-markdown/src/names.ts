/**
 * 一种语法占用的名字（docs/specs/workspace/markdown-syntaxes.md 输出 4）：标签、schema 里的节点与标记、写法、模块名（语言按
 * 模块名存写前准备）。两种语法占了同一个名字就撞名。组合扩展里的子扩展名要用编辑内核展开才看得出，见 `./language` 的
 * `syntaxNames`。
 *
 * 放在纯 TS 入口：neuro-book 的方言目录在插件入口里判撞名，不能引编辑内核。形状只取用到的字段，任何 `MarkdownSyntax` 都满足。
 */

export interface SyntaxNameSource {
    readonly name: string;
    readonly blockOpens?: Readonly<Record<string, unknown>>;
    readonly inlineTags?: ReadonlyArray<string>;
    readonly extensions: ReadonlyArray<{readonly name: string}>;
    readonly writeBlock?: Readonly<Record<string, unknown>>;
    readonly writeInline?: Readonly<Record<string, unknown>>;
    readonly writeMark?: Readonly<Record<string, unknown>>;
}

export function namesOf(syntax: SyntaxNameSource): ReadonlyArray<string> {
    return [
        `module:${syntax.name}`,
        ...[...Object.keys(syntax.blockOpens ?? {}), ...(syntax.inlineTags ?? [])].map((tag) => `tag:${tag}`),
        ...syntax.extensions.map((extension) => `type:${extension.name}`),
        ...Object.keys({...syntax.writeBlock, ...syntax.writeInline, ...syntax.writeMark}).map((type) => `writer:${type}`),
    ];
}
