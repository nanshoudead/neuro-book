import {describe, expect, it} from "vitest";

import {parsePublishArguments, publishedState} from "#scripts/release/publish";

// 输出照 npm 10 的 `npm view <名>@<版本> version --json` 实际打印的形状（2026-10-24 对 registry.npmjs.org 取的）。
const NOT_FOUND = JSON.stringify({error: {code: "E404", summary: "Not Found - GET https://registry.npmjs.org/@notnotype%2fnb-ui - Not found"}});

describe("发布前查 registry", () => {
    it("版本在 registry 上算已发布；包或版本不存在（E404）算没发布", () => {
        expect(publishedState({code: 0, stdout: `[\n  "1.0.0"\n]\n`})).toBe("published");
        expect(publishedState({code: 0, stdout: `"1.0.0"\n`})).toBe("published");
        expect(publishedState({code: 1, stdout: NOT_FOUND})).toBe("unpublished");
    });

    it("其它失败不当成没发布：网络、权限、输出读不懂、成功却没有输出都抛出", () => {
        expect(() => publishedState({code: 1, stdout: JSON.stringify({error: {code: "ETIMEDOUT"}})})).toThrow("ETIMEDOUT");
        expect(() => publishedState({code: 1, stdout: JSON.stringify({error: {code: "E403"}})})).toThrow("E403");
        expect(() => publishedState({code: 1, stdout: "npm error something"})).toThrow("不是 JSON");
        expect(() => publishedState({code: 0, stdout: ""})).toThrow("分不清");
    });
});

describe("release:publish 的参数", () => {
    it("缺省只列出；--yes 才发布，--otp 与 --auth-type 原样转给 bun publish", () => {
        expect(parsePublishArguments([])).toEqual({yes: false, publishArgs: []});
        expect(parsePublishArguments(["--yes", "--auth-type", "web", "--otp", "123456"])).toEqual({yes: true, publishArgs: ["--auth-type=web", "--otp=123456"]});
    });

    it("不认识的参数、缺值、--auth-type 取值不对时拒绝", () => {
        expect(() => parsePublishArguments(["--dry"])).toThrow("--dry");
        expect(() => parsePublishArguments(["--otp"])).toThrow("--otp");
        expect(() => parsePublishArguments(["--auth-type", "sms"])).toThrow("web 或 legacy");
    });
});
