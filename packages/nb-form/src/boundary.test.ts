/**
 * 包的依赖边界（docs/specs/ui/forms.md“边界与兼容”）：核心只依赖 TypeBox，另外只许 `import type` 自
 * `@notnotype/nb-ui/text`（文字值的类型，docs/specs/ui/i18n.md），这样核心能在服务端、浏览器与以后的终端里用；Vue 渲染层
 * 只依赖 `vue`、`@notnotype/nb-ui` 与核心，以后才能打进生成式视图的沙箱。新增文件同样受约束。
 * 扫描的写法与它的取舍见 `@notnotype/neuro-book-test-support/import-boundary`。
 */

import {describe, expect, it} from "bun:test";
import {join} from "node:path";

import {offendingSpecifiers, scanImports, sourceFiles, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

const SOURCE_ROOT = import.meta.dir;
const VUE_ROOT = join(SOURCE_ROOT, "vue");

const CORE: ImportRule = {packages: [/^typebox(\/.*)?$/u], typeOnly: [/^@notnotype\/nb-ui\/text$/u], within: SOURCE_ROOT, excluding: VUE_ROOT};
const VUE: ImportRule = {packages: [/^vue$/u, /^@notnotype\/nb-ui(\/.*)?$/u], within: SOURCE_ROOT};

describe("包的导入", () => {
    it("核心只导入 typebox 与核心自己的文件，另外只许 import type 自 nb-ui 的文字值", () => {
        expect(scanImports(sourceFiles(SOURCE_ROOT, new Set(["vue"])), CORE)).toEqual([]);
    });

    it("Vue 渲染层只导入 vue、nb-ui 与本包的文件", () => {
        expect(scanImports(sourceFiles(VUE_ROOT), VUE)).toEqual([]);
    });

    it("核心从 nb-ui 的文字值取值（不只是类型）也算越界", () => {
        expect(offendingSpecifiers(join(SOURCE_ROOT, "text.ts"), "import {textRef} from \"@notnotype/nb-ui/text\";", CORE)).toEqual(["@notnotype/nb-ui/text"]);
        expect(offendingSpecifiers(join(SOURCE_ROOT, "text.ts"), "import type {Text} from \"@notnotype/nb-ui/text\";", CORE)).toEqual([]);
    });
});
