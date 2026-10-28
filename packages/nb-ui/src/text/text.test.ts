/** docs/specs/ui/i18n.md 输出 1 到 7、10：纯数据层与最小实现。 */

import {describe, expect, it} from "vitest";

import {isLocaleMap, isText, isTextRef, resolveLocaleMap, sanitizeParams, textRef} from "./index";
import type {TextProblem} from "./index";
import {createMinimalTranslator} from "./minimal";

describe("输出 1：判别", () => {
    it("带 kind 的是引用，不会被当成语言映射", () => {
        const ref = textRef("title");
        expect(isTextRef(ref)).toBe(true);
        expect(isLocaleMap(ref)).toBe(false);
        expect(isLocaleMap(textRef("title", undefined, "nb-agent-ui"))).toBe(false);
    });

    // 判别按语言标签的语法：5 到 8 个字母（如 "title"）是合法的主标签，4 个字母（如 "kind"）与带下划线的不是。
    it("键都是语言标签的对象是语言映射，其它对象不是文字值", () => {
        expect(isLocaleMap({"zh-CN": "标题", "en-US": "Title"})).toBe(true);
        expect(isLocaleMap({"zh-CN": "标题", "kind": "x"})).toBe(false);
        expect(isLocaleMap({"zh-CN": "标题", "not_a_tag": "x"})).toBe(false);
        expect(isText({kind: "other", key: "x"})).toBe(false);
        expect(isText("字面")).toBe(true);
    });
});

describe("输出 2：语言映射的解析", () => {
    it("取当前语言，再取 en-US，再取第一项，空对象得空串", () => {
        expect(resolveLocaleMap({"zh-CN": "中", "en-US": "En"}, "zh-CN")).toBe("中");
        expect(resolveLocaleMap({"zh-CN": "中", "en-US": "En"}, "ja-JP")).toBe("En");
        expect(resolveLocaleMap({"zh-CN": "中", "fr-FR": "Fr"}, "ja-JP")).toBe("中");
        expect(resolveLocaleMap({}, "zh-CN")).toBe("");
    });
});

describe("输出 3：参数整理", () => {
    it("截断过长的字符串、不传非法值，并逐个上报", () => {
        const reported: string[] = [];
        const params = sanitizeParams({name: "a".repeat(501), n: 3, gone: undefined, bad: Number.NaN, obj: {}}, (param, kind) => reported.push(`${kind}:${param}`));
        expect(params).toEqual({name: `${"a".repeat(500)}…`, n: 3});
        expect(reported).toEqual(["param-truncated:name", "param-dropped:gone", "param-dropped:bad", "param-dropped:obj"]);
    });
});

const catalogs = {
    "own": {
        "zh-CN": {files: {count_other: "{{count}} 个文件"}, path: "路径：{{path}}"},
        "en-US": {files: {count_one: "{{count}} file", count_other: "{{count}} files"}, path: "Path: {{path}}", onlyEnglish: "English only"},
    },
    "en-source": {"en-US": {hello: "Hello"}},
};

describe("输出 4 到 7：最小实现翻译引用", () => {
    const problems: TextProblem[] = [];
    const translator = createMinimalTranslator({catalogs, sources: {"en-source": "en-US"}, report: (problem) => problems.push(problem)});

    it("复数回退逐个语言走完三级：中文只写裸键时不被回退链后面的英文 _other 抢走", () => {
        const bare = createMinimalTranslator({catalogs: {x: {"zh-CN": {n: "{{count}} 条"}, "en-US": {n_one: "{{count}} item", n_other: "{{count}} items"}}}});
        expect(bare.translate(textRef("n", {count: 2}, "x"), "zh-CN")).toBe("2 条");
        expect(bare.translate(textRef("n", {count: 1}, "x"), "en-US")).toBe("1 item");
    });

    it("复数按当前语言选后缀，中文只写 _other 时 count 为 1 也取得到", () => {
        expect(translator.translate(textRef("files.count", {count: 1}, "own"), "en-US")).toBe("1 file");
        expect(translator.translate(textRef("files.count", {count: 2}, "own"), "en-US")).toBe("2 files");
        expect(translator.translate(textRef("files.count", {count: 1}, "own"), "zh-CN")).toBe("1 个文件");
    });

    it("插值不做 HTML 转义", () => {
        expect(translator.translate(textRef("path", {path: "a/b<c>"}, "own"), "en-US")).toBe("Path: a/b<c>");
    });

    it("回退链：当前语言没有时取命名空间的源语言，再取 en-US", () => {
        expect(translator.translate(textRef("hello", undefined, "en-source"), "zh-CN")).toBe("Hello");
        expect(translator.translate(textRef("onlyEnglish", undefined, "own"), "zh-CN")).toBe("English only");
    });

    it("找不到键时显示键名并上报一次", () => {
        problems.length = 0;
        expect(translator.translate(textRef("nope", undefined, "own"), "zh-CN")).toBe("nope");
        translator.translate(textRef("nope", undefined, "own"), "zh-CN");
        expect(problems).toEqual([{kind: "missing-key", ns: "own", key: "nope"}]);
    });

    it("count 不是有限数字时不走复数并上报", () => {
        problems.length = 0;
        expect(translator.translate(textRef("path", {path: "x", count: "1,234"} as never, "own"), "zh-CN")).toBe("路径：x");
        expect(problems.map((problem) => problem.kind)).toEqual(["param-dropped"]);
    });

    it("键里的冒号不当命名空间分隔", () => {
        expect(translator.translate(textRef("en-source:hello", undefined, "own"), "en-US")).toBe("en-source:hello");
    });

    it("缺插值参数时原样保留并上报；严格模式下抛错", () => {
        problems.length = 0;
        expect(translator.translate(textRef("path", undefined, "own"), "en-US")).toBe("Path: {{path}}");
        expect(problems.map((problem) => problem.kind)).toEqual(["missing-param"]);
        const strict = createMinimalTranslator({catalogs, strict: true});
        expect(() => strict.translate(textRef("path", undefined, "own"), "en-US")).toThrow(/Missing text param "path"/u);
        expect(() => strict.translate(textRef("nope", undefined, "own"), "en-US")).toThrow(/Missing text key "nope"/u);
    });

    it("字面文字原样，语言映射按输出 2 解析", () => {
        expect(translator.translate("字面", "en-US")).toBe("字面");
        expect(translator.translate({"zh-CN": "中", "en-US": "En"}, "en-US")).toBe("En");
    });
});

describe("输出 10：各语言的写法", () => {
    const translator = createMinimalTranslator({catalogs});
    it("引用得各语言的文字，语言映射得全部值，字面得自己", () => {
        expect(translator.variants(textRef("path", undefined, "own"))).toEqual(["路径：{{path}}", "Path: {{path}}"]);
        expect(translator.variants({"zh-CN": "中", "en-US": "En"})).toEqual(["中", "En"]);
        expect(translator.variants("字面")).toEqual(["字面"]);
    });
});
