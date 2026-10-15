/**
 * 生成源码编辑器自带的语言表（docs/specs/workbench/editor.md 输出 43）：读已装 monaco-editor 的
 * `esm/vs/basic-languages/<名字>/<名字>.contribution.js`，取每个 `registerLanguage({...})` 调用的声明与 `loader`，写成
 * `src/plugins/editor/web/code/monaco-languages.ts`，由 `nbook.editor` 投给自己的贡献点 `editor.languages`。
 *
 *   bun scripts/gen-monaco-languages.ts [--check]
 *
 * `--check`：只比较现有文件与将要生成的内容，不一致时以 1 退出（升级 Monaco 后忘了重新生成）。
 *
 * 为什么执行而不是用正则读：一个文件可以登记几门语言（freemarker2 登记 6 门），`loader` 的写法也不统一（有的取模块的
 * 某个导出）。这里把文件去掉 import 后执行，用自己的 `registerLanguage` 收下每次调用，`loader` 按源码原样保留，只把
 * 相对路径换成包内路径。
 */

import {readdir, readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";

const packageRoot = join(import.meta.dir, "..");
export const MONACO_LANGUAGES_FILE = join(packageRoot, "src/plugins/editor/web/code/monaco-languages.ts");

interface MonacoLanguageCall {
    readonly id: string;
    readonly aliases?: ReadonlyArray<string>;
    readonly extensions?: ReadonlyArray<string>;
    readonly filenames?: ReadonlyArray<string>;
    readonly firstLine?: string;
    readonly mimetypes?: ReadonlyArray<string>;
    readonly loader: () => unknown;
}

const IMPORT_LINE = /^import \{ registerLanguage \} from '\.\.\/_\.contribution\.js';\n/u;

/** 扩展名去掉点、改成小写：与 `editor.editors` 的写法一致；Monaco 按文件名匹配时本来就不分大小写。 */
const extensionOf = (value: string): string => {
    if (!value.startsWith(".")) throw new Error(`扩展名不以点开头：${value}`);
    return value.slice(1).toLowerCase();
};

/** 生成的文件内容。 */
export async function renderMonacoLanguages(): Promise<string> {
    const require = createRequire(join(packageRoot, "package.json"));
    const monacoRoot = dirname(require.resolve("monaco-editor/package.json"));
    const version = (JSON.parse(await readFile(join(monacoRoot, "package.json"), "utf8")) as {version: string}).version;
    const languagesRoot = join(monacoRoot, "esm/vs/basic-languages");
    const folders = (await readdir(languagesRoot, {withFileTypes: true})).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const lines: string[] = [];
    for (const folder of folders) {
        const source = await readFile(join(languagesRoot, folder, `${folder}.contribution.js`), "utf8");
        if (!IMPORT_LINE.test(source)) throw new Error(`${folder}.contribution.js 的 import 不是预期的写法`);
        const calls: MonacoLanguageCall[] = [];
        // 执行的是已装依赖里的 Monaco 源码：只登记声明，不引入别的模块。
        new Function("registerLanguage", source.replace(IMPORT_LINE, ""))((call: MonacoLanguageCall) => calls.push(call));
        if (calls.length === 0) throw new Error(`${folder}.contribution.js 没有登记语言`);
        for (const call of calls) {
            const declaration = {
                aliases: call.aliases === undefined || call.aliases.length === 0 ? [call.id] : call.aliases,
                ...(call.extensions === undefined || call.extensions.length === 0 ? {} : {extensions: [...new Set(call.extensions.map(extensionOf))]}),
                ...(call.filenames === undefined || call.filenames.length === 0 ? {} : {filenames: call.filenames}),
                ...(call.firstLine === undefined ? {} : {firstLine: call.firstLine}),
                ...(call.mimetypes === undefined || call.mimetypes.length === 0 ? {} : {mimetypes: call.mimetypes}),
            };
            const loader = call.loader.toString().replace(/import\('\.\/([^']+)'\)/gu, (_, file: string) => `import("monaco-editor/esm/vs/basic-languages/${folder}/${file}")`);
            if (loader.includes("'./") || !loader.includes("import(\"monaco-editor/")) throw new Error(`${call.id} 的 loader 不是预期的写法：${loader}`);
            lines.push(`    {id: ${JSON.stringify(call.id)}, declaration: ${JSON.stringify(declaration)}, load: ${loader.replace(/\n\s*/gu, " ")}},`);
        }
    }
    return `/**
 * 由 \`scripts/gen-monaco-languages.ts\` 生成，不要手改。来源：monaco-editor ${version} 的 basic-languages（MIT 许可）。
 * 声明的扩展名已去掉点、改成小写；\`load\` 是 Monaco 原来的 loader，只把相对路径换成包内路径。
 */

/// <reference path="./monaco-modules.d.ts" />

import type {MonacoLanguageEntry} from "./languages";

export const MONACO_LANGUAGES: ReadonlyArray<MonacoLanguageEntry> = [
${lines.join("\n")}
];
`;
}

if (import.meta.main) {
    const output = await renderMonacoLanguages();
    if (process.argv.includes("--check")) {
        const current = await readFile(MONACO_LANGUAGES_FILE, "utf8").catch(() => "");
        if (current !== output) {
            console.error(`${MONACO_LANGUAGES_FILE} 与生成结果不一致：运行 bun scripts/gen-monaco-languages.ts`);
            process.exit(1);
        }
    } else {
        await writeFile(MONACO_LANGUAGES_FILE, output);
        console.log(`写入 ${MONACO_LANGUAGES_FILE}（${String(output.split("\n    {id:").length - 1)} 门语言）`);
    }
}
