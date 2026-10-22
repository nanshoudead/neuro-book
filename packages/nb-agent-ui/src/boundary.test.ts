/**
 * 包的依赖边界（packages/nb-agent-ui/AGENTS.md）：核心不依赖任何包，只许 `import type` 自 `vue`（注册表类型里有组件
 * 字段），这样服务端、nb-story 与以后的终端都能用分轮与适配器；Vue 渲染层只依赖 `vue`、`@notnotype/nb-ui` 与核心。
 * 两层都不许引用宿主的源码：`nbook/…` 这样的应用别名与 `../../neuro-book/…` 这样的跨包相对路径都算越界。
 *
 * 扫描的是源码文字里的导入写法（`from "x"`、`import "x"`、`import("x")`），不解析语法树：注释里写了这样的字样也会
 * 被当成导入，宁可误报。写法与 nb-form 的 `src/boundary.test.ts` 相同。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";

const SOURCE_ROOT = import.meta.dir;
const VUE_ROOT = join(SOURCE_ROOT, "vue");

interface Rule {
    /** 允许的包名（不是相对路径的说明符）。 */
    readonly packages: ReadonlyArray<RegExp>;
    /** 只许 `import type`、`export type` 的包名。 */
    readonly typeOnly?: ReadonlyArray<RegExp>;
    /** 相对导入解析后必须落在这个目录里。 */
    readonly within: string;
    /** 相对导入不许落进的子目录。 */
    readonly excluding?: string;
}

const CORE: Rule = {packages: [], typeOnly: [/^vue$/u], within: SOURCE_ROOT, excluding: VUE_ROOT};
const VUE: Rule = {packages: [/^vue$/u, /^@notnotype\/nb-ui(\/.*)?$/u], within: SOURCE_ROOT};

// `from` 前面不能是连字符或点：字符串里的 "branch-from" 不是导入。
const SPECIFIER = /(?:(?<![\w.-])from\s*|(?<![\w.-])import\s*\(\s*|(?<![\w.-])import\s+)["']([^"']+)["']/gu;
const TYPE_ONLY = /\b(?:import|export)\s+type\s[^;]*?\bfrom\s*["']([^"']+)["']/gu;

/** 一份源码里越界的导入说明符；`file` 用来解析相对路径。 */
function offendingSpecifiers(file: string, text: string, rule: Rule): string[] {
    // 允许的纯类型导入先从文字里拿掉，剩下的照普通导入判断。
    const scanned = text.replace(TYPE_ONLY, (statement, specifier: string) => (rule.typeOnly?.some((pattern) => pattern.test(specifier)) === true ? "" : statement));
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
    it("核心只导入核心自己的文件，另外只许 import type 自 vue", () => {
        expect(scan(sources(SOURCE_ROOT, new Set(["vue"])), CORE)).toEqual([]);
    });

    it("Vue 渲染层只导入 vue、nb-ui 与本包的文件", () => {
        expect(scan(sources(VUE_ROOT), VUE)).toEqual([]);
    });

    it("扫描认得各种导入写法，相对路径按真实位置判断", () => {
        const file = join(VUE_ROOT, "stream", "X.vue");
        const text = [
            "<script setup lang=\"ts\">",
            "import {a} from \"vue\";",
            "import \"node:fs\";",
            "const later = await import(\"nbook/shared/x\");",
            "export {b} from \"../host\";",
            "import {c} from \"../../../../neuro-book/src/x\";",
            "</script>",
            "<script>import {d} from \"node:path\";</script>",
        ].join("\n");
        expect(offendingSpecifiers(file, text, VUE)).toEqual(["node:fs", "nbook/shared/x", "../../../../neuro-book/src/x", "node:path"]);
        // 核心不许经相对路径用到渲染层，也不许引用应用别名（旧 agent-view.types.ts 就引用过应用里的粘贴策略类型）。
        expect(offendingSpecifiers(join(SOURCE_ROOT, "types.ts"), "import {x} from \"./vue/host\";", CORE)).toEqual(["./vue/host"]);
        // 字符串里出现 from 字样不算导入。
        expect(offendingSpecifiers(file, "const action = {id: \"branch-from\", order: 40, kinds: [\"user\"]};", VUE)).toEqual([]);
        expect(offendingSpecifiers(join(SOURCE_ROOT, "types.ts"), "import type {PromptEditorPastePolicy} from \"nbook/app/components/common/form/prompt-editor/prompt-editor.types\";", CORE)).toEqual(["nbook/app/components/common/form/prompt-editor/prompt-editor.types"]);
    });

    it("核心对 vue 只许纯类型导入", () => {
        const file = join(SOURCE_ROOT, "registry.ts");
        expect(offendingSpecifiers(file, "import type {Component} from \"vue\";\nexport type {Ref} from \"vue\";", CORE)).toEqual([]);
        expect(offendingSpecifiers(file, "import {ref} from \"vue\";", CORE)).toEqual(["vue"]);
    });
});
