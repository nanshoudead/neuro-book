/**
 * 插件文件夹里的消息目录（docs/specs/runtime/plugin-install.md 的 `catalog-invalid`）：清单 `l10n.locales` 列出的每种语言各读
 * 一份 `locales/<语言>.json`，按 nb-runtime 的目录规则检查。安装预览查安装源，安装查复制进准备目录的那一份：`files` 漏了目录
 * 时安装源里有、准备目录里没有，只有后一次能发现。启动盘点不调用它：装好之后目录坏了，插件照常登记，由窗口报告目录问题。
 */

import {lstat, readFile} from "node:fs/promises";
import {join} from "node:path";

import {catalogFile, parseCatalog} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";

import {errno} from "nbook/backend/locked-replace";

import {brief} from "./record";

/** 一份目录文件的大小上限；正常的目录是几十 KB。 */
export const CATALOG_LIMIT = 4 * 1024 * 1024;

/** 一种语言的目录文件读出来的问题；文件是普通文件、不超限、内容合规时为空。 */
async function catalogFileProblems(directory: string, tag: string): Promise<string[]> {
    const file = catalogFile(tag);
    const path = join(directory, file);
    let text: string;
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink()) return [`${file}：是符号链接`];
        if (!info.isFile()) return [`${file}：不是普通文件`];
        if (info.size > CATALOG_LIMIT) return [`${file}：超过 ${String(CATALOG_LIMIT)} 字节`];
        text = await readFile(path, "utf8");
    } catch (error) {
        // 不存在是作者的问题（漏写进 files，或忘了放文件）；别的读取错误照原样写出错误码。
        return [errno(error) === "ENOENT" ? `${file}：清单 l10n.locales 列出了这种语言，但没有这个文件` : `${file}：读取失败：${brief(error)}`];
    }
    const parsed = parseCatalog(text);
    return parsed.ok ? [] : parsed.problems.map((problem) => (problem.path === "" ? `${file}：${problem.message}` : `${file}：${problem.path}：${problem.message}`));
}

/** 清单列出的全部目录的问题，按 `l10n.locales` 的顺序；清单没有 `l10n` 时为空。 */
export async function catalogProblemsIn(directory: string, manifest: PluginManifest): Promise<string[]> {
    if (manifest.l10n === null) return [];
    const problems: string[] = [];
    for (const tag of manifest.l10n.locales) problems.push(...(await catalogFileProblems(directory, tag)));
    return problems;
}
