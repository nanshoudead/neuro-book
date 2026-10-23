/**
 * 编辑器里方言外观要的宿主信息：所在文件的地址（解析相对地址）、界面语言与图片地址服务。Markdown 控件建实例时给出，地址与
 * 语言按函数取：换文档、换语言不重建扩展。
 */

import type {MarkdownText} from "@notnotype/nb-markdown";
import type {ChipEnv} from "@notnotype/nb-markdown/chip";

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {AssetUrls} from "../parts/asset-urls";

export interface MarkdownViewHost {
    base(): string | null;
    locale(): DisplayLocale;
    /** 没有图片地址服务时（例如 Lab 的场景）图片一律不显示，只有说明。 */
    readonly assets: AssetUrls | null;
    /** 链接小块的目标分类与文件图标（与展示器、PromptEditor 同一份）。 */
    readonly chips: ChipEnv;
    /** 图片不显示时的说明。 */
    readonly imageMissing?: MarkdownText;
}
