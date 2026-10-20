/**
 * 包的依赖边界（docs/specs/ui/forms.md“边界与兼容”）：核心只依赖 TypeBox。这样核心能在服务端、浏览器与以后的
 * 终端里用，Vue 渲染层也才能打进生成式视图的沙箱。新增文件同样受约束。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const ALLOWED = [/^typebox(\/.*)?$/u, /^\.\.?\//u];

function sources(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === "vue" ? [] : sources(path);
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

describe("核心的导入", () => {
    it("只导入 typebox 与包内文件", () => {
        const offending: string[] = [];
        for (const file of sources(import.meta.dir)) {
            for (const match of readFileSync(file, "utf8").matchAll(/(?:^|\n)\s*(?:import|export)[^"'\n]*?from\s+["']([^"']+)["']/gu)) {
                const specifier = match[1]!;
                if (!ALLOWED.some((pattern) => pattern.test(specifier))) offending.push(`${file}: ${specifier}`);
            }
        }
        expect(offending).toEqual([]);
    });
});
