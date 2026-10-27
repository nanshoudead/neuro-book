import {describe, expect, test} from "bun:test";

import {checkCatalogs} from "./check-catalog";
import {ERROR_CODES} from "./exhaustive/codes";
import extra from "./exhaustive/extra-code.json";
import missing from "./exhaustive/missing-code.json";
import aEn from "./locales/plugin-a.en-US.json";
import aZh from "./locales/plugin-a.zh-CN.json";

describe("5. 错误码穷举与目录一致性（脚本形式）", () => {
    const options = {scope: "errors", codes: ERROR_CODES};
    test("zh 只有 _other、en 有 _one/_other 不算不一致；只报 en 故意没写的 only-zh", () => {
        expect(checkCatalogs(aZh, aEn, options)).toEqual(["缺少译文：only-zh"]);
    });
    test("漏写一个码：报出码名", () => {
        expect(checkCatalogs(aZh, missing, options)).toContain("错误码缺文案：errors.unknown-outcome");
    });
    test("多写一个码：报出码名", () => {
        expect(checkCatalogs(aZh, extra, options)).toContain("目录里有联合类型之外的码：errors.legacy-code");
    });
    test("占位符不一致、语言之间缺键", () => {
        const problems = checkCatalogs({a: "你好 {{name}}", b: "x"}, {a: "Hello {{nam}}", c: "y"});
        expect(problems).toEqual(["缺少译文：b", "多余的键：c", "占位符不一致：a（{name} 对 {nam}）"]);
    });
});
