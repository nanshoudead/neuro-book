/**
 * 问答配置（docs/specs/story/qa.md 的“配置”与 F1）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {ABSENT_CONFIG, currentConfigDigest, defaultConfigPath, loadQaConfig, parseQaConfig, qaLimits, readQaConfigFile, saveQaConfig} from "./config";
import {CONFIG_FIELDS, ConfigEditError, setConfigField, unsetConfigField} from "./config-edit";
import {QaError} from "./errors";

let root = "";

beforeAll(async () => {
    root = await createTestTmpRoot("nb-story", "qa-config");
});

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const model = {baseUrl: "http://127.0.0.1:1/v1", id: "m", apiKeyEnv: "SOME_ENV"};

async function codeFor(content: string | null): Promise<string> {
    const path = join(root, `${Math.random()}.json`);
    if (content !== null) await writeFile(path, content);
    try {
        await loadQaConfig(path);
    } catch (error) {
        if (error instanceof QaError) return error.code;
        throw error;
    }
    return "ok";
}

describe("问答配置", () => {
    test("默认位置跟 XDG_CONFIG_HOME 走", () => {
        expect(defaultConfigPath({XDG_CONFIG_HOME: "/x"})).toBe("/x/nbstory/config.json");
    });

    test("写全必填字段即可用；上限有缺省值", async () => {
        const path = join(root, "ok.json");
        await writeFile(path, JSON.stringify({model}));
        expect(qaLimits(await loadQaConfig(path))).toEqual({maxChapters: 20, fullReadMaxChars: 300000});
    });

    test("文件不在、不是 JSON、缺字段、类型不对、maxChapters 越界：qa_unconfigured（F1）", async () => {
        expect(await codeFor(null)).toBe("qa_unconfigured");
        expect(await codeFor("{")).toBe("qa_unconfigured");
        expect(await codeFor(JSON.stringify({model: {baseUrl: "x", id: "m"}}))).toBe("qa_unconfigured");
        expect(await codeFor(JSON.stringify({model: {...model, maxTokens: "多"}}))).toBe("qa_unconfigured");
        for (const maxChapters of [0, 21, 2.5]) expect(await codeFor(JSON.stringify({model, qa: {maxChapters}}))).toBe("qa_unconfigured");
        expect(await codeFor(JSON.stringify({model, qa: {maxChapters: 20, fullReadMaxChars: 1}}))).toBe("ok");
    });
});

describe("写配置（config 命令）", () => {
    const base = parseQaConfig({model}, "");

    test("写出的文件能原样读回；目录不存在时建出来，目录里不留临时文件", async () => {
        const dir = join(root, "nested", "dir");
        const path = join(dir, "config.json");
        await saveQaConfig(path, {model, qa: {maxChapters: 5}});
        expect(await loadQaConfig(path)).toEqual({model, qa: {maxChapters: 5}});
        // 只剩配置本身与常驻的锁文件，没有临时文件。
        expect((await readdir(dir)).sort()).toEqual([".config.json.lock", "config.json"]);
    });

    test("校验不过：qa_unconfigured，已有的文件一个字不动，也不留临时文件", async () => {
        const dir = join(root, "keep");
        const path = join(dir, "config.json");
        await saveQaConfig(path, {model});
        const before = await readFile(path, "utf8");
        const failure = await saveQaConfig(path, {model: {...model, id: ""}}).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(QaError);
        expect((failure as QaError).code).toBe("qa_unconfigured");
        expect(await readFile(path, "utf8")).toBe(before);
        // 只剩配置本身与常驻的锁文件，没有临时文件。
        expect((await readdir(dir)).sort()).toEqual([".config.json.lock", "config.json"]);
    });

    test("写不进去（父路径是个文件）：qa_config_write_failed", async () => {
        const file = join(root, "plain-file");
        await writeFile(file, "x");
        const failure = await saveQaConfig(join(file, "config.json"), {model}).catch((error: unknown) => error);
        expect((failure as QaError).code).toBe("qa_config_write_failed");
    });

    test("每个可改字段都能 set，改完整份仍过 schema；原配置对象不变", () => {
        const values: Record<string, string> = {
            "model.baseUrl": "http://x/v1",
            "model.id": "other",
            "model.apiKeyEnv": "OTHER_ENV",
            "model.contextWindow": "128000",
            "model.maxTokens": "64000",
            "model.thinking": "xhigh",
            "model.price": '{"input":1,"output":4,"currency":"USD"}',
            // 整组先写入，之后才能逐项改。
            "ingest.model": '{"baseUrl":"http://y/v1","id":"x","apiKeyEnv":"X_ENV"}',
            "ingest.model.baseUrl": "http://z/v1",
            "ingest.model.id": "ingest",
            "ingest.model.apiKeyEnv": "INGEST_ENV",
            "ingest.model.contextWindow": "64000",
            "ingest.model.maxTokens": "16000",
            "ingest.model.price": '{"input":2,"output":8,"currency":"CNY"}',
            // 挑相关说法的开关不用先整组写入；挑选的模型和抽取的一样要先整组写入。
            "ingest.recall.enabled": "true",
            "ingest.recall.model": '{"baseUrl":"http://r/v1","id":"r","apiKeyEnv":"R_ENV"}',
            "ingest.recall.model.baseUrl": "http://s/v1",
            "ingest.recall.model.id": "recall",
            "ingest.recall.model.apiKeyEnv": "RECALL_ENV",
            "ingest.recall.model.contextWindow": "32000",
            "ingest.recall.model.maxTokens": "4000",
            "ingest.recall.model.price": '{"input":0.5,"output":1,"currency":"USD"}',
            "qa.maxChapters": "10",
            "qa.fullReadMaxChars": "100000",
        };
        expect(Object.keys(values).sort()).toEqual(Object.keys(CONFIG_FIELDS).sort());
        let config = base;
        for (const [name, text] of Object.entries(values)) config = setConfigField(config, name, text, "");
        expect(config).toEqual({
            model: {baseUrl: "http://x/v1", id: "other", apiKeyEnv: "OTHER_ENV", contextWindow: 128000, maxTokens: 64000, thinking: "xhigh", price: {input: 1, output: 4, currency: "USD"}},
            ingest: {
                model: {baseUrl: "http://z/v1", id: "ingest", apiKeyEnv: "INGEST_ENV", contextWindow: 64000, maxTokens: 16000, price: {input: 2, output: 8, currency: "CNY"}},
                recall: {enabled: true, model: {baseUrl: "http://s/v1", id: "recall", apiKeyEnv: "RECALL_ENV", contextWindow: 32000, maxTokens: 4000, price: {input: 0.5, output: 1, currency: "USD"}}},
            },
            qa: {maxChapters: 10, fullReadMaxChars: 100000},
        });
        expect(base).toEqual({model});
    });

    test("字段不认识、值写不对：ConfigEditError；值合法但越界：qa_unconfigured", () => {
        expect(() => setConfigField(base, "model.nope", "1", "")).toThrow(ConfigEditError);
        expect(() => setConfigField(base, "qa.maxChapters", "多", "")).toThrow(ConfigEditError);
        expect(() => setConfigField(base, "model.thinking", "max", "")).toThrow(ConfigEditError);
        expect(() => setConfigField(base, "model.price", "{", "")).toThrow(ConfigEditError);
        for (const [name, text] of [["qa.maxChapters", "21"], ["model.price", '{"input":1}']] as const) {
            const failure = (() => {
                try {
                    return setConfigField(base, name, text, "");
                } catch (error) {
                    return error;
                }
            })();
            expect((failure as QaError).code).toBe("qa_unconfigured");
        }
    });

    test("unset 去掉可选字段，qa 里没有字段了整段去掉；必填字段不能去掉", () => {
        const full = setConfigField(setConfigField(base, "model.thinking", "high", ""), "qa.maxChapters", "5", "");
        expect(unsetConfigField(full, "model.thinking", "")).toEqual({model, qa: {maxChapters: 5}});
        expect(unsetConfigField(full, "qa.maxChapters", "")).toEqual({model: {...model, thinking: "high"}});
        expect(unsetConfigField(base, "qa.maxChapters", "")).toEqual({model});
        expect(() => unsetConfigField(base, "model.id", "")).toThrow(ConfigEditError);
    });
});

describe("整份写入（网页设置页与命令行共用，t13）", () => {
    const pasted = "sk-review-fake-pasted-value-0042";

    test("三处密钥环境变量名都只收变量名，误贴密钥被拒且报错里没有原文；不认识的字段不收", () => {
        const configs = [
            {model: {...model, apiKeyEnv: pasted}},
            {model, ingest: {model: {...model, apiKeyEnv: pasted}}},
            {model, ingest: {recall: {enabled: true, model: {...model, apiKeyEnv: pasted}}}},
        ];
        for (const config of configs) {
            const error = (() => {
                try {
                    parseQaConfig(config, " 测试 ");
                } catch (thrown) {
                    return thrown as QaError;
                }
                return null;
            })();
            expect(error?.code).toBe("qa_unconfigured");
            expect(error?.message).not.toContain(pasted);
        }
        expect(() => parseQaConfig({model: {...model, apiKey: pasted}}, " 测试 ")).toThrow(QaError);
        expect(() => parseQaConfig({model, extra: 1}, " 测试 ")).toThrow(QaError);
    });

    test("带 expect 的写入：同时两个只有一个成功，另一个 config_conflict；成功返回的摘要就是磁盘上的", async () => {
        const path = join(root, `cas-${Math.random()}`, "config.json");
        const first = await saveQaConfig(path, {model});
        for (let round = 0; round < 5; round += 1) {
            const current = (await saveQaConfig(path, {model, qa: {maxChapters: 1 + round}})).digest;
            const results = await Promise.allSettled([saveQaConfig(path, {model, qa: {maxChapters: 10}}, {expect: current}), saveQaConfig(path, {model, qa: {maxChapters: 11}}, {expect: current})]);
            const done = results.filter(result => result.status === "fulfilled");
            const conflicts = results.filter(result => result.status === "rejected" && (result.reason as QaError).code === "config_conflict");
            expect([done.length, conflicts.length]).toEqual([1, 1]);
            const written = (done[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof saveQaConfig>>>).value;
            expect(await loadQaConfig(path)).toEqual(written.config);
            expect((await readQaConfigFile(path)).digest).toBe(written.digest);
        }
        expect(first.digest).not.toBe(ABSENT_CONFIG);
    });

    test("不带 expect 的并发写入互不踩：每个都成功，磁盘上是其中一份，摘要对得上；不留临时文件", async () => {
        const dir = join(root, `parallel-${Math.random()}`);
        const path = join(dir, "config.json");
        const results = await Promise.all(Array.from({length: 10}, (_, index) => saveQaConfig(path, {model, qa: {maxChapters: index + 1}})));
        const {config, digest} = await readQaConfigFile(path);
        expect(results.some(result => result.digest === digest && JSON.stringify(result.config) === JSON.stringify(config))).toBe(true);
        expect((await readdir(dir)).filter(name => name.endsWith(".tmp"))).toEqual([]);
    });

    test("读取之后被别处改过（命令行先写了）：再按读到的摘要写报 config_conflict，文件不动", async () => {
        const path = join(root, `stale-${Math.random()}`, "config.json");
        await saveQaConfig(path, {model});
        const seen = await readQaConfigFile(path);
        await saveQaConfig(path, {model: {...model, id: "命令行改的"}}, {expect: seen.digest});
        const before = await readFile(path, "utf8");
        const stale = await saveQaConfig(path, {model: {...model, id: "网页改的"}}, {expect: seen.digest}).catch((error: unknown) => error as QaError);
        expect((stale as QaError).code).toBe("config_conflict");
        expect(await readFile(path, "utf8")).toBe(before);
        // 文件还不存在时，按“不存在”的摘要写成功；之后别人建了文件，同样的期望就冲突。
        const fresh = join(root, `fresh-${Math.random()}`, "config.json");
        expect((await currentConfigDigest(fresh))).toBe(ABSENT_CONFIG);
        await saveQaConfig(fresh, {model}, {expect: ABSENT_CONFIG});
        expect(((await saveQaConfig(fresh, {model}, {expect: ABSENT_CONFIG}).catch((error: unknown) => error)) as QaError).code).toBe("config_conflict");
    });
});
