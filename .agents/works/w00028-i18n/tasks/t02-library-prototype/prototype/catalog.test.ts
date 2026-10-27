/**
 * w00028 t02 原型：i18next 的命名空间登记与注销、原生格式、分隔符与最小实现对照。
 * 运行：`bun test src/__i18n-spike__/catalog.test.ts`（在 packages/neuro-book 下）。
 */

import {describe, expect, test} from "bun:test";

import {createHostI18n, registerPlugin, unregisterPlugin} from "./host";
import {createMinimalT} from "./minimal-t";
import aEn from "./locales/plugin-a.en-US.json";
import aZh from "./locales/plugin-a.zh-CN.json";
import bEn from "./locales/plugin-b.en-US.json";
import bZh from "./locales/plugin-b.zh-CN.json";

const LANGS = ["zh-CN", "en-US"] as const;

describe("1. 命名空间登记与注销", () => {
    test("两个插件各自登记，同名键互不干扰", async () => {
        const i18n = await createHostI18n({language: "zh-CN"});
        registerPlugin(i18n, "plugin-a", {"zh-CN": aZh, "en-US": aEn});
        registerPlugin(i18n, "plugin-b", {"zh-CN": bZh, "en-US": bEn});
        expect(i18n.t("plugin-a:title")).toBe("插件甲");
        expect(i18n.t("plugin-b:title")).toBe("插件乙");
        expect(i18n.t("plugin-a:greeting", {name: "甲"})).toBe("你好，甲");
        expect(i18n.t("plugin-b:greeting", {name: "乙"})).toBe("乙问候 乙");
    });

    test("注销 A 后：A 的键回退成键本身，B 不受影响，资源与命名空间列表都不残留", async () => {
        const i18n = await createHostI18n({language: "zh-CN"});
        registerPlugin(i18n, "plugin-a", {"zh-CN": aZh, "en-US": aEn});
        registerPlugin(i18n, "plugin-b", {"zh-CN": bZh, "en-US": bEn});
        unregisterPlugin(i18n, "plugin-a", LANGS);
        // 缺键时返回的是不带命名空间前缀的键：`plugin-a:title` -> `title`。界面上会出现“title”而不是“plugin-a:title”
        expect(i18n.t("plugin-a:title")).toBe("title");
        expect(i18n.exists("plugin-a:title")).toBe(false);
        expect(i18n.hasResourceBundle("zh-CN", "plugin-a")).toBe(false);
        expect(i18n.hasResourceBundle("en-US", "plugin-a")).toBe(false);
        expect(Object.keys(i18n.store.data["zh-CN"] ?? {})).toEqual(["plugin-b"]);
        expect(i18n.t("plugin-b:title")).toBe("插件乙");
        // options.ns 在 addResourceBundle 时被追加，注销时不会删：这里记录实际值
        console.log("options.ns after unregister =", JSON.stringify(i18n.options.ns));
    });

    test("同一插件重复激活（热重载）：整体替换，旧键不残留", async () => {
        const i18n = await createHostI18n({language: "zh-CN"});
        registerPlugin(i18n, "plugin-a", {"zh-CN": {old: "旧"}});
        registerPlugin(i18n, "plugin-a", {"zh-CN": {fresh: "新"}});
        expect(i18n.t("plugin-a:old")).toBe("old");
        expect(i18n.t("plugin-a:fresh")).toBe("新");
    });

    test("回退语言：en-US 缺键时取 zh-CN；注销 zh-CN 后取键本身", async () => {
        const i18n = await createHostI18n({language: "en-US", fallback: ["zh-CN"]});
        registerPlugin(i18n, "plugin-a", {"zh-CN": aZh, "en-US": aEn});
        expect(i18n.t("plugin-a:only-zh")).toBe("只有中文");
        unregisterPlugin(i18n, "plugin-a", ["zh-CN"]);
        expect(i18n.t("plugin-a:only-zh")).toBe("only-zh");
        expect(i18n.t("plugin-a:title")).toBe("Plugin A");
    });

    test("事件：addResourceBundle / removeResourceBundle 触发 store 的 added / removed", async () => {
        const i18n = await createHostI18n({language: "zh-CN"});
        const events: string[] = [];
        i18n.store.on("added", (lng: string, ns: string) => events.push(`added ${lng} ${ns}`));
        i18n.store.on("removed", (lng: string, ns: string) => events.push(`removed ${lng} ${ns}`));
        registerPlugin(i18n, "plugin-b", {"zh-CN": bZh});
        unregisterPlugin(i18n, "plugin-b", ["zh-CN"]);
        // registerPlugin 内部先 remove 再 add，所以首次登记也会先收到一个 removed
        expect(events).toEqual(["removed zh-CN plugin-b", "added zh-CN plugin-b", "removed zh-CN plugin-b"]);
    });
});

describe("3. 原生格式", () => {
    async function build(language: string) {
        const i18n = await createHostI18n({language, fallback: ["zh-CN"]});
        registerPlugin(i18n, "plugin-a", {"zh-CN": aZh, "en-US": aEn});
        return i18n;
    }

    test("插值", async () => {
        expect((await build("en-US")).t("plugin-a:greeting", {name: "Ann"})).toBe("Hello, Ann");
        expect((await build("zh-CN")).t("plugin-a:greeting", {name: "安"})).toBe("你好，安");
    });

    test("不转义：Vue 自己转义，所以关 escapeValue；名字里的 < & 原样", async () => {
        expect((await build("en-US")).t("plugin-a:greeting", {name: "<b>&"})).toBe("Hello, <b>&");
    });

    test("英文 _one / _other", async () => {
        const en = await build("en-US");
        expect([0, 1, 2, 1.5].map((count) => en.t("plugin-a:files", {count}))).toEqual(["0 files", "1 file", "2 files", "1.5 files"]);
    });

    test("中文只写 _other，count 为 1 也取到", async () => {
        const zh = await build("zh-CN");
        expect([0, 1, 2].map((count) => zh.t("plugin-a:files", {count}))).toEqual(["0 个文件", "1 个文件", "2 个文件"]);
    });

    test("英文目录只写 _other、没写 _one：count 为 1 时 i18next 不会退到 _other，返回不带前缀的键（与最小实现不同）", async () => {
        const i18n = await createHostI18n({language: "en-US", fallback: []});
        registerPlugin(i18n, "x", {"en-US": {files_other: "{{count}} files"}});
        expect(i18n.t("x:files", {count: 1})).toBe("files");
        expect(i18n.t("x:files", {count: 2})).toBe("2 files");
        // 有 zh-CN 回退时：回退语言按“它自己的”复数类别查，中文只有 other，于是取到 zh 的 files_other
        const withFallback = await createHostI18n({language: "en-US", fallback: ["zh-CN"]});
        registerPlugin(withFallback, "x", {"en-US": {files_other: "{{count}} files"}, "zh-CN": {files_other: "{{count}} 个"}});
        expect(withFallback.t("x:files", {count: 1})).toBe("1 个");
    });

    test("数量参数传字符串 / undefined / null / NaN：实际输出", async () => {
        const en = await build("en-US");
        const zh = await build("zh-CN");
        const observed = Object.fromEntries(
            [["\"1,234\"", "1,234"], ["\"1\"", "1"], ["undefined", undefined], ["null", null], ["NaN", Number.NaN]].map(([label, count]) => [label as string, {en: en.t("plugin-a:files", {count: count as never}), zh: zh.t("plugin-a:files", {count: count as never})}]),
        );
        console.log("count 异常值输出 =", JSON.stringify(observed));
        // 非数字 count 不会选复数形式：找不到不带后缀的键 `files`，返回的是不带命名空间的键本身
        expect(observed["\"1,234\""]).toEqual({en: "files", zh: "files"});
        expect(observed["undefined"]).toEqual({en: "files", zh: "files"});
    });

    test("缺参数 / 参数为 undefined", async () => {
        const en = await build("en-US");
        expect(en.t("plugin-a:greeting")).toBe("Hello, {{name}}");
        expect(en.t("plugin-a:greeting", {name: undefined})).toBe("Hello, ");
    });
});

describe("6. 键分隔符", () => {
    test("默认配置（nsSeparator \":\"、keySeparator \".\"）：带点的码在嵌套对象里仍能取到（ignoreJSONStructure），带冒号的码被静默改写成点", async () => {
        const i18n = await createHostI18n({language: "en-US", fallback: []});
        registerPlugin(i18n, "own", {"en-US": {errors: {"a.b": "dot-code", "a:b": "colon-code", "plain": "ok"}}});
        expect(i18n.t("own:errors.plain")).toBe("ok");
        expect(i18n.t("own:errors.a.b")).toBe("dot-code");
        // 取键时 `own:errors.a:b` 先按 ":" 拆开，再用 keySeparator 重新拼接，等于查了 `errors.a.b`：码 "a:b" 拿到了码 "a.b" 的文字
        expect(i18n.t("own:errors.a:b")).toBe("dot-code");
        // 目录里只有 "a:b" 时，永远取不到它
        const only = await createHostI18n({language: "en-US", fallback: []});
        registerPlugin(only, "own", {"en-US": {errors: {"a:b": "colon-code"}}});
        expect(only.t("own:errors.a:b")).toBe("errors.a.b");
    });

    test("两个码只差 . 与 : 时互相撞车", async () => {
        const i18n = await createHostI18n({language: "en-US", fallback: []});
        registerPlugin(i18n, "own", {"en-US": {errors: {"x.y": "from-dot"}}});
        expect(i18n.t("own:errors.x:y")).toBe("from-dot");
    });

    test("nsSeparator \"::\" + keySeparator false：点与单冒号都是普通字符，目录要平铺", async () => {
        const i18n = await createHostI18n({language: "en-US", separators: false});
        registerPlugin(i18n, "own", {"en-US": {"errors.a.b": "dot-code", "errors.a:b": "colon-code", "errors.plain": "ok"}});
        expect(i18n.t("own::errors.plain")).toBe("ok");
        expect(i18n.t("own::errors.a.b")).toBe("dot-code");
        expect(i18n.t("own::errors.a:b")).toBe("colon-code");
        // 写成旧的单冒号形式查不到，返回整个字符串
        expect(i18n.t("own:errors.plain")).toBe("own:errors.plain");
    });

    test("命名空间名可以带点、@ 和 /（插件 id 常见形式）", async () => {
        const i18n = await createHostI18n({language: "en-US", fallback: []});
        registerPlugin(i18n, "my.plugin", {"en-US": {k: "v1"}});
        registerPlugin(i18n, "@acme/x", {"en-US": {k: "v2"}});
        expect([i18n.t("my.plugin:k"), i18n.t("@acme/x:k")]).toEqual(["v1", "v2"]);
    });

    test("键指向对象节点时，返回一句英文诊断而不是文案", async () => {
        const i18n = await createHostI18n({language: "en-US", fallback: []});
        registerPlugin(i18n, "own", {"en-US": {errors: {x: "X"}}});
        expect(i18n.t("own:errors")).toBe("key 'errors (en-US)' returned an object instead of string.");
    });
});

describe("7. 最小 t 与 i18next 对照", () => {
    const flat = (messages: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.entries(messages).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const catalog = {"zh-CN": flat(aZh), "en-US": flat(aEn)};
    const cases: Array<[string, Record<string, string | number | undefined> | undefined]> = [
        ["greeting", {name: "Ann"}],
        ["greeting", {name: "<b>&"}],
        ["greeting", undefined],
        ["greeting", {name: undefined}],
        ["greeting", {name: 5}],
        ["files", {count: 0}],
        ["files", {count: 1}],
        ["files", {count: 2}],
        ["files", {count: 1.5}],
        ["files", {count: "1,234"}],
        ["files", {count: "1"}],
        ["files", {count: undefined}],
        ["files", undefined],
        ["only-zh", undefined],
        ["missing", undefined],
        ["title", undefined],
    ];
    for (const language of LANGS) {
        test(`${language}：逐条与 i18next 比对`, async () => {
            const i18n = await createHostI18n({language, fallback: ["zh-CN"]});
            registerPlugin(i18n, "plugin-a", {"zh-CN": aZh, "en-US": aEn});
            const minimal = createMinimalT(catalog, language, ["zh-CN"]);
            const rows = cases.map(([key, params]) => ({key, params, i18next: i18n.t(`plugin-a:${key}`, params as never) as string, minimal: minimal(key, params)}));
            const diffs = rows.filter((row) => row.i18next !== row.minimal);
            console.log(`${language} diffs =`, JSON.stringify(diffs));
            expect(diffs).toEqual([]);
        });
    }

    test("行数与实现规模", async () => {
        const source = await Bun.file(new URL("./minimal-t.ts", import.meta.url)).text();
        const code = source.split("\n").filter((line) => line.trim() && !line.trim().startsWith("*") && !line.trim().startsWith("/*") && !line.trim().startsWith("//"));
        console.log("minimal-t.ts 非空非注释行数 =", code.length);
    });
});
