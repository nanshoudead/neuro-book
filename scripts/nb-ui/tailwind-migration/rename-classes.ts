#!/usr/bin/env bun
/**
 * w00030 t02 的临时工具，Task 完成后删除。
 *
 * 把 UnoCSS（Tailwind v3 刻度）的类名换成 Tailwind v4 里同样观感的名字。只换类名出现的位置：前面是引号、反引号、空白、
 * 变体冒号或 `!`，后面是引号、反引号、空白或 `!`。`var(--radius-sm)`、`.rounded-sm {` 这类 CSS 里的写法前后不满足，不会碰。
 *
 *   bun scripts/nb-ui/tailwind-migration/rename-classes.ts [--write] <目录或文件>...
 *
 * 不带 `--write` 时只列出每一处（文件:行、原行），核对后再带 `--write` 写入。
 */
import {readFile, stat, writeFile} from "node:fs/promises";
import {relative, resolve} from "node:path";

/** Tailwind v4 改了刻度名：v3 的 `shadow-sm`、`rounded-sm` 在 v4 叫 `shadow-xs`、`rounded-xs`；`outline-none` 在 v4 是 `outline-style: none`，v3 的“透明轮廓”叫 `outline-hidden`。 */
const RENAMES: ReadonlyMap<string, string> = new Map([
    ["shadow-sm", "shadow-xs"],
    ["rounded-sm", "rounded-xs"],
    ["outline-none", "outline-hidden"],
]);

const pattern = new RegExp(`(?<=^|["'\`\\s:!])(${[...RENAMES.keys()].join("|")})(?=$|["'\`\\s!])`, "gmu");

async function files(target: string): Promise<string[]> {
    if ((await stat(target)).isFile()) return [target];
    const found: string[] = [];
    for await (const path of new Bun.Glob("**/*.{vue,ts,tsx}").scan({cwd: target, absolute: true})) found.push(path);
    return found.sort();
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const targets = args.filter((arg) => arg !== "--write").map((arg) => resolve(arg));
if (targets.length === 0) {
    console.error("用法：rename-classes.ts [--write] <目录或文件>...");
    process.exit(1);
}

const counts = new Map<string, number>();
let changedFiles = 0;
for (const target of targets) {
    for (const file of await files(target)) {
        const before = await readFile(file, "utf8");
        const lines = before.split("\n");
        let hit = false;
        lines.forEach((line, index) => {
            const matches = [...line.matchAll(pattern)];
            if (matches.length === 0) return;
            hit = true;
            for (const match of matches) counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1);
            console.log(`${relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`);
        });
        if (!hit) continue;
        changedFiles += 1;
        if (write) await writeFile(file, before.replace(pattern, (name) => RENAMES.get(name)!));
    }
}
console.log(`\n${write ? "已替换" : "将替换（dry run）"}：${[...RENAMES.keys()].map((name) => `${name} → ${RENAMES.get(name)} ${counts.get(name) ?? 0} 处`).join("，")}；${changedFiles} 个文件`);
