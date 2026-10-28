import {execFile as execFileCallback} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {promisify} from "node:util";

import {afterAll, beforeAll, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {catalogFailures, messageCatalogFailures} from "#scripts/ci/message-catalogs";

const execFile = promisify(execFileCallback);
const REPOSITORY = resolve(import.meta.dirname, "../..");
let tmp = "";
let cases = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("scripts", "message-catalogs");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 一个合格的插件目录：中文是源语言，中文只写 `_other`，英文写 `_one` 与 `_other`。 */
const GOOD = {
    "zh-CN": {commands: {say: {title: "打招呼"}}, files_other: "{{count}} 个文件", errors: {gone: "没有了", busy: "{{name}} 正忙"}},
    "en-US": {commands: {say: {title: "Say hello"}}, files_one: "{{count}} file", files_other: "{{count}} files", errors: {gone: "Gone", busy: "{{name}} is busy"}},
};

/** 在临时目录里搭一个 git 仓库（不提交，检查读未跟踪文件），写入这些文件。 */
async function repositoryWith(files: Readonly<Record<string, unknown>>): Promise<string> {
    cases += 1;
    const root = join(tmp, `case-${String(cases)}`);
    for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), {recursive: true});
        await writeFile(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
    }
    await execFile("git", ["init", "-q"], {cwd: root});
    return root;
}

/** 一个带目录的插件：清单写 `l10n`，目录在 `locales/`。 */
function plugin(name: string, catalogs: Readonly<Record<string, unknown>>, source = "zh-CN"): Record<string, unknown> {
    const base = `packages/${name}`;
    return {
        [`${base}/package.json`]: {name, l10n: {source, locales: Object.keys(catalogs)}},
        ...Object.fromEntries(Object.entries(catalogs).map(([locale, catalog]) => [`${base}/locales/${locale}.json`, catalog])),
    };
}

async function runScript(repoRoot: string): Promise<{readonly status: number; readonly stderr: string}> {
    try {
        await execFile("bun", [join(REPOSITORY, "scripts/ci/message-catalogs.ts"), "--repo-root", repoRoot], {cwd: REPOSITORY, encoding: "utf8"});
        return {status: 0, stderr: ""};
    } catch (error) {
        const result = error as {code?: number | string; stderr?: string};
        return {status: typeof result.code === "number" ? result.code : -1, stderr: result.stderr ?? ""};
    }
}

/** 每种坏样本：改坏 GOOD 的一处，报告里要有的那句话。 */
const BAD: ReadonlyArray<{readonly name: string; readonly catalogs: Readonly<Record<string, unknown>>; readonly closedCodes?: ReadonlyArray<string>; readonly reported: string}> = [
    {name: "缺键", catalogs: {...GOOD, "en-US": {...GOOD["en-US"], commands: {}}}, reported: "en-US.json：缺键 commands.say.title"},
    {name: "多余的键", catalogs: {...GOOD, "en-US": {...GOOD["en-US"], extra: "Extra"}}, reported: "en-US.json：多余的键 extra"},
    {name: "占位符不一致", catalogs: {...GOOD, "en-US": {...GOOD["en-US"], errors: {gone: "Gone", busy: "{{who}} is busy"}}}, reported: "en-US.json：errors.busy 的占位符 {who} 与源语言的 {name} 不一致"},
    {name: "英文缺 _one", catalogs: {...GOOD, "en-US": {...GOOD["en-US"], files_one: undefined}}, reported: "en-US.json：复数键 files 缺 _one"},
    {name: "值含 $t(", catalogs: {...GOOD, "zh-CN": {...GOOD["zh-CN"], commands: {say: {title: "$t(other)"}}}}, reported: "zh-CN.json：commands.say.title：值不能含 $t("},
    {name: "闭合码缺文案", catalogs: GOOD, closedCodes: ["gone", "busy", "late"], reported: "zh-CN.json：闭合码 late 没有文案 errors.late"},
    {name: "闭合码多文案", catalogs: GOOD, closedCodes: ["gone"], reported: "zh-CN.json：errors.busy 不在码表里"},
];

describe("消息目录检查", () => {
    it("仓库里的目录通过", () => {
        expect(messageCatalogFailures(REPOSITORY)).toEqual([]);
    });

    it("合格的目录通过：中文只写 _other、英文写 _one 与 _other，闭合码恰好覆盖", () => {
        expect(catalogFailures({label: "x", source: "zh-CN", catalogs: GOOD, closedCodes: ["gone", "busy"]})).toEqual([]);
    });

    it("每种坏样本各报出一条", () => {
        // JSON 往返去掉写成 undefined 的键，与目录文件里没写这个键一样。
        const reported = BAD.map((sample) => ({name: sample.name, failures: catalogFailures({label: "x", source: "zh-CN", catalogs: JSON.parse(JSON.stringify(sample.catalogs)) as Record<string, unknown>, ...(sample.closedCodes === undefined ? {} : {closedCodes: sample.closedCodes})})}));
        expect(reported).toEqual(BAD.map((sample) => ({name: sample.name, failures: [expect.stringContaining(sample.reported)]})));
    });

    it("命令行：每种目录坏样本退出非零并写出问题；没有目录的插件、合格的目录退出 0", async () => {
        const samples = BAD.filter((sample) => sample.closedCodes === undefined);
        const results = await Promise.all(samples.map(async (sample) => {
            const root = await repositoryWith({"packages/plain/package.json": {name: "plain"}, ...plugin("notes", sample.catalogs)});
            const {status, stderr} = await runScript(root);
            return {name: sample.name, status, mentions: stderr.includes(sample.reported)};
        }));
        expect(results).toEqual(samples.map((sample) => ({name: sample.name, status: 1, mentions: true})));
        const good = await repositoryWith({"packages/plain/package.json": {name: "plain"}, ...plugin("notes", GOOD)});
        expect(await runScript(good)).toEqual({status: 0, stderr: ""});
    });

    it("清单列出的目录文件不存在、目录里有清单没列的语言、packages 下没登记的目录：逐条报出", async () => {
        const root = await repositoryWith({
            "packages/notes/package.json": {name: "notes", l10n: {source: "zh-CN", locales: ["zh-CN", "en-US"]}},
            "packages/notes/locales/zh-CN.json": GOOD["zh-CN"],
            "packages/notes/locales/ja-JP.json": {},
            "packages/stray/src/locales/zh-CN.json": {},
        });
        expect(messageCatalogFailures(root, [])).toEqual([
            "packages/notes/locales/en-US.json：目录文件不存在",
            "packages/notes/locales/ja-JP.json：清单的 l10n.locales 没有列出这种语言",
            "packages/stray/src/locales/zh-CN.json：目录没有登记（插件清单写 l10n，或登记进 scripts/ci/message-catalogs.ts 的 CATALOG_DIRECTORIES）",
        ]);
    });

    it("登记的不经清单的目录按登记的源语言查；登记了但仓库里没有的目录不查", async () => {
        const root = await repositoryWith({"packages/app/src/web/locales/zh-CN.json": GOOD["zh-CN"], "packages/app/src/web/locales/en-US.json": {...GOOD["en-US"], extra: "x"}});
        expect(messageCatalogFailures(root, [{path: "packages/app/src/web/locales", source: "zh-CN"}, {path: "packages/missing/locales", source: "zh-CN"}])).toEqual([
            "packages/app/src/web/locales/en-US.json：多余的键 extra（源语言 zh-CN 没有）",
        ]);
    });
});
