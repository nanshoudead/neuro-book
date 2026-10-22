import {join} from "node:path";

import {describe, expect, it} from "vitest";

import {offendingSpecifiers, type ImportRule} from "../src/import-boundary";

const ROOT = "/repo/packages/pkg/src";
const CORE: ImportRule = {packages: [/^typebox(\/.*)?$/u], typeOnly: [/^vue$/u], within: ROOT, excluding: join(ROOT, "vue")};
const VUE: ImportRule = {packages: [/^vue$/u, /^@notnotype\/nb-ui(\/.*)?$/u], within: ROOT};

describe("导入边界扫描", () => {
    it("认得各种导入写法，相对路径按真实位置判断", () => {
        const file = join(ROOT, "vue", "parts", "X.vue");
        const text = [
            "import {a} from \"vue\";",
            "import \"node:fs\";",
            "const later = await import(\"nbook/shared/x\");",
            "export {b} from \"../host\";",
            "import {c} from \"../../../../neuro-book/src/x\";",
            "<script>import {d} from \"node:path\";</script>",
        ].join("\n");
        expect(offendingSpecifiers(file, text, VUE)).toEqual(["node:fs", "nbook/shared/x", "../../../../neuro-book/src/x", "node:path"]);
        expect(offendingSpecifiers(join(ROOT, "model.ts"), "import {x} from \"./vue/scope\";", CORE)).toEqual(["./vue/scope"]);
    });

    it("夹在 import、from 与模块名之间的块注释不让导入漏过", () => {
        const text = "import/* 注释 */ \"node:fs\";\nconst m = await import/* 注释 */(\"nbook/x\");\nexport {y} from/* 注释 */ \"node:path\";";
        expect(offendingSpecifiers(join(ROOT, "vue", "X.vue"), text, VUE)).toEqual(["node:fs", "nbook/x", "node:path"]);
    });

    it("字符串里的 from 字样、注释里的导入都不算", () => {
        const text = "const action = {id: \"branch-from\", order: 40};\n// import \"node:fs\";\n/* import \"node:path\"; */";
        expect(offendingSpecifiers(join(ROOT, "vue", "X.vue"), text, VUE)).toEqual([]);
    });

    it("允许的包只许纯类型导入时，值导入照样越界", () => {
        const file = join(ROOT, "registry.ts");
        expect(offendingSpecifiers(file, "import type {Component} from \"vue\";\nexport type {Ref} from \"vue\";", CORE)).toEqual([]);
        expect(offendingSpecifiers(file, "import {ref} from \"vue\";", CORE)).toEqual(["vue"]);
    });
});
