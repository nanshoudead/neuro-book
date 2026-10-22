/// <reference types="node" />
/**
 * 渲染层样式只消费 nb-ui 的 token，规则取自 nb-ui 的 `src/components/token-consumption.test.ts`（那份只扫 nb-ui 自己）：
 * 不写字面颜色、控件圆角不写常量档、不写 transition-all、动效时长与缓动只用 token（减少动效时写的 0s 不算）、字号只用排版
 * token（可以在 token 上加减，例如角标字 `calc(var(--text-2xs) - 1px)`）、用到的 CSS 变量都有声明。
 * 没有声明的变量在计算值阶段无效，整条声明退回初始值，不报任何错。
 *
 * 放在渲染层、由 Vitest 运行：要读 nb-ui 的配色契约，它带 DOM 类型，核心的 tsconfig 没有 DOM。
 */

import {describe, expect, it} from "vitest";
import {readdirSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join, relative} from "node:path";

import {nbColorwayVarKeys} from "@notnotype/nb-ui/colorway";

const VUE_ROOT = import.meta.dirname;

function vueFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return vueFiles(path);
        return entry.name.endsWith(".vue") ? [path] : [];
    });
}

/** 剥掉 HTML 注释、块注释和整行 // 注释，扫的是代码不是散文。 */
function stripComments(source: string): string {
    const blank = (text: string) => text.replace(/[^\n]/gu, " ");
    return source.replace(/<!--[\s\S]*?-->/gu, blank).replace(/\/\*[\s\S]*?\*\//gu, blank).replace(/^[ \t]*\/\/.*$/gmu, blank);
}

const files = vueFiles(VUE_ROOT).map((path) => ({rel: relative(VUE_ROOT, path), text: stripComments(readFileSync(path, "utf8"))}));

type Rule = {name: string; pattern: RegExp; allow?: ReadonlyMap<string, string>};

const RULES: ReadonlyArray<Rule> = [
    {name: "字面颜色", pattern: /#[0-9a-fA-F]{3,8}\b(?![-\w])|\brgba?\(/u},
    {name: "常量圆角档", pattern: /\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/u},
    {name: "transition-all", pattern: /\btransition-all\b|transition:\s*all\b/u},
    {name: "写死的缓动", pattern: /cubic-bezier\(/u},
    {
        name: "写死的时长",
        pattern: /\bduration-\[?\d|\b(?!0m?s\b)\d+(?:\.\d+)?m?s\b(?![-\w])/u,
        // 每一条都要写理由。
        allow: new Map([["fallback/PlainMarkdown.vue", "流式光标一秒闪一次，是固定节拍，不是随主题快慢的界面动效"]]),
    },
    {name: "字面字号", pattern: /\bfont-size\s*:\s*(?:\d*\.)?\d*[1-9]\d*(?:\.\d+)?(?:px|rem)/u},
];

describe("渲染层的样式 token", () => {
    for (const rule of RULES) {
        it(`不写${rule.name}`, () => {
            const hits = files.filter(({rel}) => rule.allow?.has(rel) !== true)
                .flatMap(({rel, text}) => text.split("\n").flatMap((line, index) => (rule.pattern.test(line) ? [`${rel}:${String(index + 1)} ${line.trim()}`] : [])));
            expect(hits).toEqual([]);
        });
    }

    it("用到的 CSS 变量都有声明", () => {
        const require = createRequire(import.meta.url);
        const nbUiSource = dirname(require.resolve("@notnotype/nb-ui/colorway").replace(/colorway[/\\]index\.ts$/u, "index.ts"));
        const stylesheets = ["theme.css", "tokens.css", "styles.css"].map((name) => stripComments(readFileSync(join(nbUiSource, name), "utf8")));
        const declared = new Set<string>(nbColorwayVarKeys);
        for (const text of [...stylesheets, ...files.map((file) => file.text)]) {
            for (const match of text.matchAll(/["']?(--[a-z0-9-]+)["']?\s*:/gu)) declared.add(match[1]!);
        }
        const undeclared = files.flatMap(({rel, text}) => [...text.matchAll(/var\(\s*(--[a-z0-9-]+)/gu)]
            .map((match) => match[1]!)
            .filter((name) => !declared.has(name) && !name.startsWith("--tw-"))
            .map((name) => `${rel} 用了没有声明的 ${name}`));
        expect(undeclared).toEqual([]);
    });
});
