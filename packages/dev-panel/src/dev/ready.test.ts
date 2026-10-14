import {describe, expect, test} from "bun:test";
import {createReadyMatcher, createSampleTracker, LineSplitter, readyStatus, sampleUrl, stripAnsi} from "./ready.js";

/** t14 的就绪识别（L1）：去 ANSI、按 \r 与 \n 切行、两种内置就绪行与自定义规则、5xx 不算就绪（设计审查 S2）。 */
describe("就绪识别", () => {
    test("去掉 CSI 与 OSC（BEL 或 ESC \\ 结尾）", () => {
        expect(stripAnsi("  \u001b[32m➜\u001b[39m Local:    \u001b[36mhttp://127.0.0.1:3000/\u001b[39m")).toBe("  ➜ Local:    http://127.0.0.1:3000/");
        expect(stripAnsi("\u001b]8;;http://x\u0007链接\u001b]8;;\u001b\\ 完")).toBe("链接 完");
    });

    test("\\r 与 \\n 都算行尾，没写完的末行留到下次", () => {
        const splitter = new LineSplitter();
        expect(splitter.push("building 10%\rbuilding 90%\r\n  ➜ Lo")).toEqual(["building 10%", "building 90%"]);
        expect(splitter.push("cal: http://a/\n")).toEqual(["  ➜ Local: http://a/"]);
    });

    test("listhen 式认出地址即行级就绪；w00017 式要等 backend-ready；自定义规则取第一个捕获组", () => {
        const listhen = createReadyMatcher(null);
        expect(listhen.feed("building")).toEqual({url: null, ready: false});
        expect(listhen.feed("  ➜ Local:    http://127.0.0.1:3001/")).toEqual({url: "http://127.0.0.1:3001/", ready: true});

        const nbook = createReadyMatcher(null);
        expect(nbook.feed("[dev] page-ready http://127.0.0.1:4217/ 状态根 /tmp/x")).toEqual({url: "http://127.0.0.1:4217/", ready: false});
        expect(nbook.feed("  ➜ Local:    http://127.0.0.1:9999/")).toEqual({url: "http://127.0.0.1:4217/", ready: false});
        expect(nbook.feed("[dev] backend-ready pid=1 http://127.0.0.1:4219/")).toEqual({url: "http://127.0.0.1:4217/", ready: true});

        const custom = createReadyMatcher(/listening on (\S+)/u);
        expect(custom.feed("  ➜ Local:    http://127.0.0.1:3001/")).toEqual({url: null, ready: false});
        expect(custom.feed("server listening on http://127.0.0.1:5000")).toEqual({url: "http://127.0.0.1:5000", ready: true});
    });

    test("探测的状态：2xx、3xx、4xx 算就绪，5xx 不算", () => {
        expect([200, 302, 404, 500, 503].map(readyStatus)).toEqual([true, true, true, false, false]);
    });

    test("样例结果按代记：每行 backend-ready 开新的一代，本代只认第一行结果；还没有 backend-ready 时算第 0 代", () => {
        const tracker = createSampleTracker();
        tracker.feed("[dev] open-path /?project=early");
        expect(tracker.current()).toEqual({generation: 0, outcome: {kind: "open-path", path: "/?project=early"}});
        tracker.feed("[dev] backend-ready pid=1 http://127.0.0.1:4219/");
        expect(tracker.current()).toEqual({generation: 1, outcome: null});
        tracker.feed("[dev] sample-failed 超时（30 秒内没有放好样例）");
        tracker.feed("[dev] open-path /?project=late");
        expect(tracker.current()).toEqual({generation: 1, outcome: {kind: "failed", reason: "超时（30 秒内没有放好样例）"}});
        tracker.feed("[dev] backend-ready pid=2 http://127.0.0.1:4219/");
        tracker.feed("[dev] sample-failed");
        expect(tracker.current()).toEqual({generation: 2, outcome: {kind: "failed", reason: "（应用没有写原因）"}});
    });

    test("open-path 只收同源路径：绝对 URL、// 开头、含反斜杠、拼出来不同源的都不收", () => {
        expect(sampleUrl("/?project=sample", "http://127.0.0.1:4217/")).toBe("http://127.0.0.1:4217/?project=sample");
        for (const path of ["http://evil.example/", "HTTP://127.0.0.1:4217/", "javascript:alert(1)", "//evil.example/x", "/\\evil.example", "\\evil.example"]) {
            expect([path, sampleUrl(path, "http://127.0.0.1:4217/")]).toEqual([path, null]);
        }
    });
});
