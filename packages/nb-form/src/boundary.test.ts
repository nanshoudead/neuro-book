/**
 * 包的依赖边界（docs/specs/ui/forms.md“边界与兼容”）：核心只依赖 TypeBox，这样核心能在服务端、浏览器与以后的终端里
 * 用；Vue 渲染层只依赖 `vue`、`@notnotype/nb-ui` 与核心，以后才能打进生成式视图的沙箱。新增文件同样受约束。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const RELATIVE = /^\.\.?\//u;
const CORE_ALLOWED = [/^typebox(\/.*)?$/u, RELATIVE];
const VUE_ALLOWED = [/^vue$/u, /^@notnotype\/nb-ui(\/.*)?$/u, RELATIVE];

/** 目录下的源文件（不含测试）；`skip` 里的子目录不进。 */
function sources(directory: string, skip: ReadonlySet<string> = new Set()): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return skip.has(entry.name) ? [] : sources(path);
        return /\.(?:ts|vue)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

function offendingImports(files: ReadonlyArray<string>, allowed: ReadonlyArray<RegExp>): string[] {
    const offending: string[] = [];
    for (const file of files) {
        for (const match of readFileSync(file, "utf8").matchAll(/(?:^|\n)\s*(?:import|export)[^"'\n]*?from\s+["']([^"']+)["']/gu)) {
            const specifier = match[1]!;
            if (!allowed.some((pattern) => pattern.test(specifier))) offending.push(`${file}: ${specifier}`);
        }
    }
    return offending;
}

describe("包的导入", () => {
    it("核心只导入 typebox 与包内文件", () => {
        expect(offendingImports(sources(import.meta.dir, new Set(["vue"])), CORE_ALLOWED)).toEqual([]);
    });

    it("Vue 渲染层只导入 vue、nb-ui 与包内文件", () => {
        expect(offendingImports(sources(join(import.meta.dir, "vue")), VUE_ALLOWED)).toEqual([]);
    });
});
