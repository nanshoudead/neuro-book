/**
 * 行的图标（docs/specs/workbench/files-explorer.md 的“行的样子”）：文件按扩展名，目录按文件夹类型与少数常见名字。纯函数，
 * 只看名字与列出结果，不读内容。文件的规则与编辑器标签共用（`ui/file-icons`）；图标本身在生成的 `ui/file-icons/catppuccin.ts` 里，这里用到的名字都要在生成脚本的清单里。
 */

import type {FolderKind} from "nbook/plugins/files/shared/contracts";

import {fileIconForName} from "nbook/ui/file-icons/file-icons";
import type {CatppuccinIcon} from "nbook/ui/file-icons/catppuccin";

export interface IconSubject {
    /** 目录项的类型；符号链接、其它类型与缺失条目都按普通文件画。 */
    readonly kind: "file" | "directory" | "link" | "other" | "missing";
    readonly name: string;
    /** 目录的文件夹类型；文件为 `null`。 */
    readonly folder: FolderKind | null;
    readonly expanded: boolean;
    /** 内容文件夹里的目录：节点。 */
    readonly node: boolean;
    /** 节点有正文。 */
    readonly body: boolean;
}

type FolderIcon = "folder" | "folder-images" | "folder-docs" | "folder-audio" | "folder-video" | "folder-fonts" | "folder-config";

/** 普通文件夹按名字（不区分大小写）认出的几类；写作项目里常见的中文名也算。 */
const BY_FOLDER_NAME: Readonly<Record<string, FolderIcon>> = {
    images: "folder-images", image: "folder-images", img: "folder-images", pictures: "folder-images", 图片: "folder-images", 插图: "folder-images", 配图: "folder-images",
    docs: "folder-docs", doc: "folder-docs", 资料: "folder-docs", 文档: "folder-docs", 参考: "folder-docs",
    audio: "folder-audio", music: "folder-audio", 音频: "folder-audio", 音乐: "folder-audio",
    video: "folder-video", videos: "folder-video", 视频: "folder-video",
    fonts: "folder-fonts", 字体: "folder-fonts",
    config: "folder-config", 配置: "folder-config",
};

export function fileIconOf(subject: IconSubject): CatppuccinIcon {
    if (subject.kind === "directory") {
        if (subject.node) return subject.body ? "markdown" : subject.expanded ? "folder-content-open" : "folder-content";
        const base: FolderIcon | "folder-content" = subject.folder === "content" ? "folder-content" : subject.folder === "binder" ? "folder-docs" : BY_FOLDER_NAME[subject.name.toLowerCase()] ?? "folder";
        return subject.expanded ? `${base}-open` : base;
    }
    return fileIconForName(subject.name);
}
