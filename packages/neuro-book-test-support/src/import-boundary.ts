/**
 * 包的导入边界检查：读源码文字里的导入写法（`from "x"`、`import "x"`、`import("x")`），找出越界的说明符。nb-form、
 * nb-agent-ui 的 `src/boundary.test.ts` 共用它，各自只写规则。
 *
 * 不解析语法树，按文字扫描，宁可误报。扫描前去掉块注释与整行注释：语法允许在 `import` 与模块名之间夹一段块注释，
 * 不去掉就会漏过；行尾注释不去，字符串里的 `//`（例如网址）会被误伤。`from` 前面是连字符或点时不算导入，
 * 字符串里的 "branch-from" 不是导入。相对路径解析到真实位置再判断，`../../neuro-book/...` 这样的跨包相对导入算越界。
 */

import {readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";

export interface ImportRule {
    /** 允许的包名（不是相对路径的说明符）。 */
    readonly packages: ReadonlyArray<RegExp>;
    /** 只许 `import type`、`export type` 的包名。 */
    readonly typeOnly?: ReadonlyArray<RegExp>;
    /** 相对导入解析后必须落在这个目录里。 */
    readonly within: string;
    /** 相对导入不许落进的子目录。 */
    readonly excluding?: string;
}

const SPECIFIER = /(?:(?<![\w.-])from\s*|(?<![\w.-])import\s*\(\s*|(?<![\w.-])import\s+)["']([^"']+)["']/gu;
const TYPE_ONLY = /\b(?:import|export)\s+type\s[^;]*?\bfrom\s*["']([^"']+)["']/gu;

function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/^[ \t]*\/\/.*$/gmu, "");
}

/** 一份源码里越界的导入说明符；`file` 用来解析相对路径。 */
export function offendingSpecifiers(file: string, text: string, rule: ImportRule): string[] {
    // 允许的纯类型导入先从文字里拿掉，剩下的照普通导入判断。
    const scanned = stripComments(text).replace(TYPE_ONLY, (statement, specifier: string) => (rule.typeOnly?.some((pattern) => pattern.test(specifier)) === true ? "" : statement));
    const offending: string[] = [];
    for (const match of scanned.matchAll(SPECIFIER)) {
        const specifier = match[1]!;
        if (specifier.startsWith(".")) {
            const target = resolve(dirname(file), specifier);
            const inside = !relative(rule.within, target).startsWith("..");
            const excluded = rule.excluding !== undefined && !relative(rule.excluding, target).startsWith("..");
            if (!inside || excluded) offending.push(specifier);
        } else if (!rule.packages.some((pattern) => pattern.test(specifier))) {
            offending.push(specifier);
        }
    }
    return offending;
}

/** 目录下的源文件（`.ts`、`.vue`，不含测试）；`skip` 里的子目录不进。 */
export function sourceFiles(directory: string, skip: ReadonlySet<string> = new Set()): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return skip.has(entry.name) ? [] : sourceFiles(path);
        return /\.(?:ts|vue)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

/** 一组文件里越界的导入，写成 `文件: 说明符`。 */
export function scanImports(files: ReadonlyArray<string>, rule: ImportRule): string[] {
    return files.flatMap((file) => offendingSpecifiers(file, readFileSync(file, "utf8"), rule).map((specifier) => `${file}: ${specifier}`));
}
