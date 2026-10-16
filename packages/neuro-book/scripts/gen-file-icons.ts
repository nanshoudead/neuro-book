/**
 * 生成资源管理器的文件图标（docs/specs/workbench/files-explorer.md 的“行的样子”）：从 `@iconify-json/catppuccin`（MIT，
 * devDependency）挑出 `ICONS` 列出的图标，把 SVG 里 catppuccin Macchiato 的颜色换成 CSS 变量 `var(--file-icon-<色名>)`，
 * 写成 `src/ui/file-icons/catppuccin.ts`。亮暗两套颜色由 `FileIcon.vue` 按色名定义，换配色不用重新生成。
 * 只打包用到的几十个图标，不把整套 600 多个带进前端。
 *
 *   bun scripts/gen-file-icons.ts [--check]
 *
 * `--check`：只比较现有文件与将要生成的内容，不一致时以 1 退出（改了映射或升级了图标包却忘了重新生成）。
 */

import {readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";

/** 映射表（`src/ui/file-icons/file-icons.ts` 与 `src/plugins/explorer/web/icons/file-icons.ts`）用到的图标；加图标先加在这里再生成。 */
const ICONS = [
    "file", "text", "markdown", "json", "yaml", "toml", "xml", "csv", "pdf", "image", "svg", "audio", "video", "font", "zip", "database",
    "html", "css", "javascript", "typescript",
    "folder", "folder-open", "folder-content", "folder-content-open", "folder-docs", "folder-docs-open", "folder-images", "folder-images-open",
    "folder-audio", "folder-audio-open", "folder-video", "folder-video-open", "folder-fonts", "folder-fonts-open", "folder-config", "folder-config-open",
] as const;

/** catppuccin Macchiato 的色值到色名：Iconify 版只收了这一套配色，其余配色按色名一一对应。 */
const MACCHIATO: Readonly<Record<string, string>> = {
    "#cad3f5": "text", "#8aadf4": "blue", "#eed49f": "yellow", "#a6da95": "green", "#8087a2": "overlay1", "#f5a97f": "peach",
    "#ed8796": "red", "#c6a0f6": "mauve", "#91d7e3": "sky", "#7dc4e4": "sapphire", "#f5bde6": "pink", "#8bd5ca": "teal",
    "#ee99a0": "maroon", "#b7bdf8": "lavender", "#f4dbd6": "rosewater", "#f0c6c6": "flamingo",
};

interface IconSet {
    readonly width?: number;
    readonly height?: number;
    readonly icons: Readonly<Record<string, {readonly body: string; readonly width?: number; readonly height?: number}>>;
}

const packageRoot = join(import.meta.dir, "..");
const target = join(packageRoot, "src/ui/file-icons/catppuccin.ts");
const require = createRequire(join(packageRoot, "package.json"));
const setPath = require.resolve("@iconify-json/catppuccin/icons.json");
const set = JSON.parse(await readFile(setPath, "utf8")) as IconSet;
const version = (JSON.parse(await readFile(join(dirname(setPath), "package.json"), "utf8")) as {version: string}).version;

const lines: string[] = [];
for (const name of ICONS) {
    const icon = set.icons[name];
    if (icon === undefined) throw new Error(`图标包里没有 ${name}`);
    const width = icon.width ?? set.width ?? 16;
    const height = icon.height ?? set.height ?? 16;
    if (width !== 16 || height !== 16) throw new Error(`${name} 不是 16×16（${String(width)}×${String(height)}）`);
    const body = icon.body.replace(/#[0-9a-fA-F]{6}/gu, (hex) => {
        const color = MACCHIATO[hex.toLowerCase()];
        if (color === undefined) throw new Error(`${name} 用了配色表之外的颜色 ${hex}`);
        return `var(--file-icon-${color})`;
    });
    lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(body)},`);
}

const output = `/**
 * 由 \`scripts/gen-file-icons.ts\` 生成，不要手改。来源：@iconify-json/catppuccin ${version}，作者 Catppuccin，MIT 许可
 * （https://github.com/catppuccin/vscode-icons/blob/main/LICENSE）。颜色已换成 CSS 变量 \`var(--file-icon-<色名>)\`，取值见 \`FileIcon.vue\`。
 */

/** 16×16 视框里的 SVG 内容。 */
export const CATPPUCCIN_ICONS = {
${lines.join("\n")}
} as const;

export type CatppuccinIcon = keyof typeof CATPPUCCIN_ICONS;
`;

if (process.argv.includes("--check")) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== output) {
        console.error(`${target} 与生成结果不一致：运行 bun scripts/gen-file-icons.ts`);
        process.exit(1);
    }
} else {
    await writeFile(target, output);
    console.log(`写入 ${target}（${String(ICONS.length)} 个图标）`);
}
