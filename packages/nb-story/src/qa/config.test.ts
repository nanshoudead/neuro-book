/**
 * 问答配置（docs/specs/story/qa.md 的“配置”与 F1）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {defaultConfigPath, loadQaConfig, qaLimits} from "./config";
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
