/**
 * 预览页的 `srcdoc`（docs/specs/workbench/html-preview.md 输出 3、5）：插入位置、目录地址与 CSP。纯函数；沙箱与 CSP 在
 * 浏览器里的效果由 `e2e/editor-types.e2e.ts` 验收。
 */

import {describe, expect, it} from "bun:test";

import {previewContentSecurityPolicy as contentSecurityPolicy} from "nbook/plugins/files/shared/contracts";

import {composePreview, directoryUrl} from "./web/compose";

const BASE = "http://127.0.0.1:3100/api/nbook.files/preview/abc/";

describe("Spec workbench.html-preview 输出 3、5：拼出预览页", () => {
    it("插在开头的 doctype 之后（前面可以有空白与注释），没有 doctype 时在最前面；不放到 doctype 前面", () => {
        const options = {base: BASE, path: "site/index.html", network: false};
        expect(composePreview("<!doctype html><html lang=\"zh\"><head><title>t</title></head><body>x</body></html>", options)).toMatch(/^<!doctype html><meta http-equiv="Content-Security-Policy".*<html lang="zh"><head><title>/u);
        expect(composePreview("\n<!-- 说明 -->\n<!DOCTYPE html><html><body>x</body></html>", options)).toMatch(/^\n<!-- 说明 -->\n<!DOCTYPE html><meta http-equiv/u);
        expect(composePreview("<p>x</p>", options)).toMatch(/^<meta http-equiv=.*<p>x<\/p>$/u);
    });

    it("注释、脚本里出现的 <head> 或 doctype 字样不影响位置：保护总在页面内容之前", () => {
        const options = {base: BASE, path: "site/index.html", network: false};
        for (const html of [
            "<!doctype html><!-- <head> --><html><head></head><body>x</body></html>",
            "<html><head><script>var s = \"<head>\";</script></head></html>",
            "<p>x</p><!-- <!doctype html> -->",
        ]) {
            const composed = composePreview(html, options);
            const meta = composed.indexOf("<meta http-equiv");
            const prefix = composed.slice(0, meta);
            expect(prefix === "" || /^<!doctype html>$/iu.test(prefix)).toBe(true);
        }
    });

    it("base 指向文件所在目录在令牌下的地址，各段按 URL 编码", () => {
        expect(directoryUrl(BASE, "index.html")).toBe(BASE);
        expect(directoryUrl(BASE, "第 1 卷/site/a.html")).toBe(`${BASE}${encodeURIComponent("第 1 卷")}/site/`);
        expect(composePreview("<p>x</p>", {base: BASE, path: "site/a.html", network: false})).toContain(`<base href="${BASE}site/">`);
    });

    it("默认 CSP 只放行令牌地址、data: 与 blob:；打开联网后去掉网络限制；都不许提交表单与嵌套框架", () => {
        const closed = contentSecurityPolicy(BASE, false);
        expect(closed).toContain("default-src 'none'");
        expect(closed).toContain(`connect-src ${BASE} data: blob:`);
        expect(closed).toContain(`script-src ${BASE} data: blob: 'unsafe-inline' 'unsafe-eval'`);
        expect(closed).not.toContain("*");
        const open = contentSecurityPolicy(BASE, true);
        expect(open).toContain("default-src *");
        for (const policy of [closed, open]) {
            expect(policy).toContain("form-action 'none'");
            expect(policy).toContain("frame-src 'none'");
        }
    });
});
