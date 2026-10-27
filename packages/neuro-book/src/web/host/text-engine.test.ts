/** docs/specs/ui/i18n.md 输出 3 到 7、9、10：宿主引擎的包装层。与 t02 原型的探索测试不同，这里断言的是合同。 */

import {describe, expect, it} from "bun:test";

import {textRef} from "@notnotype/nb-ui/text";
import type {Catalog, Text, TextProblem} from "@notnotype/nb-ui/text";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";

import {createTextEngine} from "./text-engine";

const own: Readonly<Record<string, Catalog>> = {
    "zh-CN": {files: {count_other: "{{count}} 个文件"}, path: "路径：{{path}}", nested: "$t(other:secret)"},
    "en-US": {files: {count_one: "{{count}} file", count_other: "{{count}} files"}, path: "Path: {{path}}", onlyEnglish: "English only"},
};
const other: Readonly<Record<string, Catalog>> = {"zh-CN": {secret: "机密"}};
const english: Readonly<Record<string, Catalog>> = {"en-US": {hello: "Hello"}};

function engine(problems: TextProblem[] = [], strict = false) {
    const text = createTextEngine({locale: "zh-CN", strict, report: (problem) => problems.push(problem)});
    text.register("own", own, "zh-CN");
    text.register("other", other, "zh-CN");
    text.register("en-source", english, "en-US");
    return text;
}

describe("宿主引擎", () => {
    it("输出 5：复数按当前语言选后缀；中文只写 _other 时 count 为 1 也取得到", () => {
        const text = engine();
        expect(text.port.t(textRef("files.count", {count: 1}, "own"))).toBe("1 个文件");
        text.setLocale("en-US");
        expect(text.port.t(textRef("files.count", {count: 1}, "own"))).toBe("1 file");
        expect(text.port.t(textRef("files.count", {count: 3}, "own"))).toBe("3 files");
    });

    it("输出 6：插值不做 HTML 转义", () => {
        expect(engine().port.t(textRef("path", {path: "a/b<c>"}, "own"))).toBe("路径：a/b<c>");
    });

    it("输出 4：回退链走命名空间的源语言，再 en-US，找不到显示键名并上报一次", () => {
        const problems: TextProblem[] = [];
        const text = engine(problems);
        expect(text.port.t(textRef("hello", undefined, "en-source"))).toBe("Hello");
        expect(text.port.t(textRef("onlyEnglish", undefined, "own"))).toBe("English only");
        expect(text.port.t(textRef("nope", undefined, "own"))).toBe("nope");
        text.port.t(textRef("nope", undefined, "own"));
        expect(problems).toEqual([{kind: "missing-key", ns: "own", key: "nope"}]);
    });

    it("输出 7：键里的冒号不切换命名空间，目录值里的 $t( 不展开", () => {
        const text = engine();
        expect(text.port.t(textRef("other:secret", undefined, "own"))).toBe("other:secret");
        expect(text.port.t(textRef("nested", undefined, "own"))).toBe("$t(other:secret)");
    });

    it("输出 3：参数整理，count 不是有限数字时不走复数并上报", () => {
        const problems: TextProblem[] = [];
        const text = engine(problems);
        expect(text.port.t(textRef("path", {path: "x".repeat(501)}, "own"))).toBe(`路径：${"x".repeat(500)}…`);
        expect(text.port.t(textRef("path", {path: "p", count: "1,234"} as never, "own"))).toBe("路径：p");
        expect(problems.map((problem) => `${problem.kind}:${problem.param ?? ""}`)).toEqual(["param-truncated:path", "param-dropped:count"]);
    });

    it("缺插值参数：原样保留并上报；严格模式抛错；缺键在严格模式也抛错", () => {
        const problems: TextProblem[] = [];
        expect(engine(problems).port.t(textRef("path", undefined, "own"))).toBe("路径：{{path}}");
        expect(problems.map((problem) => problem.kind)).toEqual(["missing-param"]);
        const strict = engine([], true);
        expect(() => strict.port.t(textRef("path", undefined, "own"))).toThrow(/Missing text param "path"/u);
        expect(() => strict.port.t(textRef("nope", undefined, "own"))).toThrow(/Missing text key "nope"/u);
    });

    it("再次登记同一命名空间时整个替换，旧键不残留", () => {
        const text = engine();
        text.register("own", {"zh-CN": {fresh: "新"}}, "zh-CN");
        expect(text.port.t(textRef("fresh", undefined, "own"))).toBe("新");
        expect(text.port.t(textRef("path", {path: "p"}, "own"))).toBe("path");
    });

    it("不在宿主语言集合里的语言被忽略", () => {
        const text = engine();
        text.setLocale("ja-JP");
        expect(text.port.locale.value).toBe("zh-CN");
    });

    it("输出 10：各语言的写法", () => {
        expect(engine().port.variants(textRef("path", undefined, "own"))).toEqual(["路径：{{path}}", "Path: {{path}}"]);
    });
});

describe("输出 9：最小实现与宿主引擎对同一组目录输出一致", () => {
    const catalogs = {own: {"zh-CN": own["zh-CN"] ?? {}, "en-US": own["en-US"] ?? {}}, "en-source": english};
    const minimal = createMinimalTranslator({catalogs, sources: {"en-source": "en-US"}});
    const cases: ReadonlyArray<readonly [string, Text]> = [
        ["zh-CN", textRef("files.count", {count: 1}, "own")],
        ["en-US", textRef("files.count", {count: 1}, "own")],
        ["en-US", textRef("files.count", {count: 0}, "own")],
        ["en-US", textRef("path", {path: "a/b<c>"}, "own")],
        ["zh-CN", textRef("onlyEnglish", undefined, "own")],
        ["zh-CN", textRef("hello", undefined, "en-source")],
        ["en-US", {"zh-CN": "中", "en-US": "En"}],
        ["zh-CN", "字面"],
    ];
    for (const [locale, text] of cases) {
        it(`${locale} ${JSON.stringify(text)}`, () => {
            const host = createTextEngine({locale});
            host.register("own", own, "zh-CN");
            host.register("en-source", english, "en-US");
            expect(host.port.t(text)).toBe(minimal.translate(text, locale));
        });
    }
});
