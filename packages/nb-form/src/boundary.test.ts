/**
 * 包的依赖边界（docs/specs/ui/forms.md“边界与兼容”）：核心只依赖 TypeBox，这样核心能在服务端、浏览器与以后的终端里
 * 用；Vue 渲染层只依赖 `vue`、`@notnotype/nb-ui` 与核心，以后才能打进生成式视图的沙箱。新增文件同样受约束。
 *
 * 扫描的是源码文字里的导入写法（`from "x"`、`import "x"`、`import("x")`），不解析语法树：注释里写了这样的字样也会
 * 被当成导入，宁可误报。相对路径解析到真实位置再判断，`../../neuro-book/...` 这样的跨包相对导入算越界。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";

const SOURCE_ROOT = import.meta.dir;
const VUE_ROOT = join(SOURCE_ROOT, "vue");

interface Rule {
    /** 允许的包名（不是相对路径的说明符）。 */
    readonly packages: ReadonlyArray<RegExp>;
    /** 相对导入解析后必须落在这个目录里。 */
    readonly within: string;
    /** 相对导入不许落进的子目录。 */
    readonly excluding?: string;
}

const CORE: Rule = {packages: [/^typebox(\/.*)?$/u], within: SOURCE_ROOT, excluding: VUE_ROOT};
const VUE: Rule = {packages: [/^vue$/u, /^@notnotype\/nb-ui(\/.*)?$/u], within: SOURCE_ROOT};

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/gu;

/** 一份源码里越界的导入说明符；`file` 用来解析相对路径。 */
function offendingSpecifiers(file: string, text: string, rule: Rule): string[] {
    const offending: string[] = [];
    for (const match of text.matchAll(SPECIFIER)) {
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

/** 目录下的源文件（不含测试）；`skip` 里的子目录不进。 */
function sources(directory: string, skip: ReadonlySet<string> = new Set()): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return skip.has(entry.name) ? [] : sources(path);
        return /\.(?:ts|vue)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

function scan(files: ReadonlyArray<string>, rule: Rule): string[] {
    return files.flatMap((file) => offendingSpecifiers(file, readFileSync(file, "utf8"), rule).map((specifier) => `${file}: ${specifier}`));
}

describe("包的导入", () => {
    it("核心只导入 typebox 与核心自己的文件", () => {
        expect(scan(sources(SOURCE_ROOT, new Set(["vue"])), CORE)).toEqual([]);
    });

    it("Vue 渲染层只导入 vue、nb-ui 与本包的文件", () => {
        expect(scan(sources(VUE_ROOT), VUE)).toEqual([]);
    });

    it("扫描认得各种导入写法，相对路径按真实位置判断", () => {
        const file = join(VUE_ROOT, "controls", "X.vue");
        const text = [
            "<script setup lang=\"ts\">",
            "import {a} from \"vue\";",
            "import \"node:fs\";",
            "const later = await import(\"nbook/shared/x\");",
            "export {b} from \"../scope\";",
            "import {c} from \"../../../../neuro-book/src/x\";",
            "</script>",
            "<script>import {d} from \"node:path\";</script>",
        ].join("\n");
        expect(offendingSpecifiers(file, text, VUE)).toEqual(["node:fs", "nbook/shared/x", "../../../../neuro-book/src/x", "node:path"]);
        // 核心不许经相对路径用到渲染层。
        expect(offendingSpecifiers(join(SOURCE_ROOT, "model.ts"), "import {x} from \"./vue/scope\";", CORE)).toEqual(["./vue/scope"]);
    });
});
