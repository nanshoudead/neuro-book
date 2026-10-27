/**
 * 目录检查脚本（原型）：错误码穷举、语言之间键与占位符一致、复数后缀。
 * 用法：bun src/__i18n-spike__/check-catalog.ts <源语言目录.json> <其它语言目录.json> [--codes a,b,c --scope errors]
 * 返回非零表示有问题；每条问题一行。
 */

import {readFileSync} from "node:fs";

type Tree = {readonly [key: string]: string | Tree};

function flatten(tree: Tree, prefix = ""): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, value] of Object.entries(tree)) {
        if (typeof value === "string") out.set(`${prefix}${key}`, value);
        else for (const [inner, text] of flatten(value, `${prefix}${key}.`)) out.set(inner, text);
    }
    return out;
}

const placeholders = (text: string): string => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort().join(",");
const pluralBase = (key: string): string => key.replace(/_(zero|one|two|few|many|other)$/, "");

export function checkCatalogs(source: Tree, other: Tree, options: {readonly scope?: string; readonly codes?: readonly string[]} = {}): string[] {
    const problems: string[] = [];
    const sourceFlat = flatten(source);
    const otherFlat = flatten(other);
    const logical = (flat: Map<string, string>): Set<string> => new Set([...flat.keys()].map(pluralBase));
    for (const key of logical(sourceFlat)) if (!logical(otherFlat).has(key)) problems.push(`缺少译文：${key}`);
    for (const key of logical(otherFlat)) if (!logical(sourceFlat).has(key)) problems.push(`多余的键：${key}`);
    for (const [key, text] of otherFlat) {
        const reference = sourceFlat.get(key) ?? [...sourceFlat].find(([candidate]) => pluralBase(candidate) === pluralBase(key))?.[1];
        if (reference !== undefined && placeholders(reference) !== placeholders(text)) problems.push(`占位符不一致：${key}（{${placeholders(reference)}} 对 {${placeholders(text)}}）`);
    }
    if (options.codes && options.scope) {
        const present = new Set([...otherFlat.keys()].filter((key) => key.startsWith(`${options.scope}.`)).map((key) => key.slice(options.scope!.length + 1)));
        for (const code of options.codes) if (!present.has(code)) problems.push(`错误码缺文案：${options.scope}.${code}`);
        for (const code of present) if (!options.codes.includes(code)) problems.push(`目录里有联合类型之外的码：${options.scope}.${code}`);
    }
    return problems;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const flag = (name: string): string | undefined => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
    const files = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
    const [sourcePath, otherPath] = files;
    if (!sourcePath || !otherPath) { console.error("需要两个目录文件"); process.exit(2); }
    const problems = checkCatalogs(JSON.parse(readFileSync(sourcePath, "utf8")) as Tree, JSON.parse(readFileSync(otherPath, "utf8")) as Tree, {scope: flag("--scope"), codes: flag("--codes")?.split(",")});
    for (const problem of problems) console.log(problem);
    process.exit(problems.length === 0 ? 0 : 1);
}
