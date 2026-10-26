/**
 * 编辑器里方言外观要的宿主信息：所在文件的地址（解析相对地址）、界面语言、图片地址服务与链接小块的分类。编辑器控件建实例时
 * 给出，地址与语言按函数取：换文档、换语言不重建扩展。
 */

import type {ChipEnv} from "../chip/chip";
import type {MarkdownLocale, MarkdownText} from "../locale";

/** 图片地址服务：宿主按所在文件解析地址，并告诉编辑器磁盘上的图片变了（重新取 URL）。 */
export interface MarkdownViewAssets {
    /** `base` 是图片所在文件的地址；返回可显示的 URL 与它对应的资源地址（外部图片为 null），不显示为 null。 */
    resolve(base: string | null, src: string): {readonly url: string; readonly address: string | null} | null;
    /** 资源地址的文件在磁盘上变了时调用；返回取消订阅。 */
    onChange(address: string, listener: () => void): () => void;
}

export interface MarkdownViewHost {
    base(): string | null;
    locale(): MarkdownLocale;
    /** 没有图片地址服务时（例如 Lab 的场景）图片一律不显示，只有说明。 */
    readonly assets: MarkdownViewAssets | null;
    /** 链接小块的目标分类与文件图标（与展示器、PromptEditor 同一份）。 */
    readonly chips: ChipEnv;
    /** 图片不显示时的说明。 */
    readonly imageMissing?: MarkdownText;
}
