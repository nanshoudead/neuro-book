/**
 * 语言贡献点的声明（docs/specs/workbench/editor.md 输出 43）与源码编辑器自带的语言表。登记进 Monaco、高亮与切换在真实
 * 浏览器里验收（`e2e/editor-types.e2e.ts`）。
 */

import {describe, expect, it} from "bun:test";
import {readFile} from "node:fs/promises";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";

import {MONACO_LANGUAGES_FILE, renderMonacoLanguages} from "../../../scripts/gen-monaco-languages";
import {validateLanguageContribution} from "./shared/contracts";
import {MONACO_LANGUAGES} from "./web/code/monaco-languages";

const contribution = (id: string, declaration: unknown, location = "browser"): ContributionDescriptor => ({capability: "editor.languages", id, plugin: "example.lang", entry: "browser", location, declaration});

describe("Spec workbench.editor 输出 43：语言登记", () => {
    it("自带的语言表与已装的 Monaco 一致（升级 Monaco 后要重新生成），每一条声明都被接受", async () => {
        expect(await readFile(MONACO_LANGUAGES_FILE, "utf8")).toBe(await renderMonacoLanguages());
        expect(MONACO_LANGUAGES.length).toBeGreaterThan(50);
        for (const {id, declaration} of MONACO_LANGUAGES) expect(validateLanguageContribution(contribution(id, declaration))).toBeNull();
    });

    it("纯文本与 JSON 由源码编辑器自带、不接受贡献；id、扩展名与首行正则的写法不对被拒；只接受浏览器入口", () => {
        const fine = {aliases: ["Vue"], extensions: ["vue"]};
        expect(validateLanguageContribution(contribution("vue", fine))).toBeNull();
        expect(validateLanguageContribution(contribution("json", fine))).not.toBeNull();
        expect(validateLanguageContribution(contribution("plaintext", fine))).not.toBeNull();
        expect(validateLanguageContribution(contribution("Vue", fine))).not.toBeNull();
        expect(validateLanguageContribution(contribution("vue", {aliases: ["Vue"], extensions: [".vue"]}))).not.toBeNull();
        expect(validateLanguageContribution(contribution("vue", {aliases: []}))).not.toBeNull();
        expect(validateLanguageContribution(contribution("vue", {aliases: ["Vue"], firstLine: "(<template"}))).not.toBeNull();
        expect(validateLanguageContribution(contribution("vue", fine, "server"))).not.toBeNull();
    });
});
