/** 测试用的导入读取：机检的结论靠它，写法变了也要读得到。 */

import {describe, expect, it} from "bun:test";

import {sourceImports} from "./source-imports";

describe("源码的导入", () => {
    it("同一行的第二条语句、跨行的导入、模板字符串的动态导入都读到；注释里的不算；类型导入分开", () => {
        const text = [
            `export const local = 1; export {target} from "./target";`,
            `import {`,
            `    a,`,
            `} from "./multi";`,
            `import type {T} from "./types";`,
            `export type {U} from "./more-types";`,
            `import {type V, w} from "./mixed";`,
            `const lazy = () => import(\`./lazy\`);`,
            `const skipped = (name: string) => import(\`./\${name}\`);`,
            `// import {x} from "./commented";`,
            `/** 例如 import("./documented") */`,
        ].join("\n");
        expect(sourceImports("a.ts", text)).toEqual([
            {specifier: "./target", typeOnly: false, dynamic: false},
            {specifier: "./multi", typeOnly: false, dynamic: false},
            {specifier: "./types", typeOnly: true, dynamic: false},
            {specifier: "./more-types", typeOnly: true, dynamic: false},
            {specifier: "./mixed", typeOnly: false, dynamic: false},
            {specifier: "./lazy", typeOnly: false, dynamic: true},
        ]);
    });

    it(".vue 文件只读脚本块", () => {
        const text = `<script setup lang="ts">\nimport X from "./X.vue";\n</script>\n<template><div>import("./not-code")</div></template>\n`;
        expect(sourceImports("A.vue", text)).toEqual([{specifier: "./X.vue", typeOnly: false, dynamic: false}]);
    });
});
