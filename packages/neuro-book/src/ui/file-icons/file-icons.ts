/**
 * 文件按名字选图标：扩展名（不区分大小写），认不出的与没有扩展名的用通用文件。资源管理器的行（文件夹另有规则，
 * docs/specs/workbench/files-explorer.md 的“行的样子”）与编辑器的标签（docs/specs/workbench/editor.md 输出 53）共用。
 * 图标本身在生成的 `catppuccin.ts` 里；这里用到的名字都要在生成脚本的清单里。
 */

import type {CatppuccinIcon} from "./catppuccin";

const BY_EXTENSION: Readonly<Record<string, CatppuccinIcon>> = {
    md: "markdown", markdown: "markdown", mdx: "markdown",
    txt: "text", text: "text",
    json: "json", jsonc: "json", json5: "json",
    yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", csv: "csv", tsv: "csv", pdf: "pdf",
    png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", avif: "image", ico: "image", svg: "svg",
    mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio", aac: "audio",
    mp4: "video", webm: "video", mov: "video", mkv: "video", avi: "video",
    ttf: "font", otf: "font", woff: "font", woff2: "font",
    zip: "zip", "7z": "zip", rar: "zip", tar: "zip", gz: "zip", tgz: "zip", bz2: "zip", xz: "zip",
    db: "database", sqlite: "database", sqlite3: "database",
    html: "html", htm: "html", css: "css", scss: "css", less: "css",
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript",
};

export function fileIconForName(name: string): CatppuccinIcon {
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return "file";
    return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? "file";
}
