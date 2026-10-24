/**
 * 片段页面的编辑逻辑：对一份列表的增、删、改、移动，以及把改好的整份列表写进**当前标签那一层**。页面组件
 * （`SnippetsPage.vue`）只管画与收集输入，改哪一层、怎么写都在这里；场景 06 直接调用这里的函数核对按层写入，不必
 * 渲染界面。
 *
 * 为什么每次都写整份列表：配置的层与层之间整体覆盖（docs/specs/settings/configuration.md 输出第 6 条），一个键只有
 * 一个值，没有“往数组里加一条”的写法。写入只改这一个键，文件里的注释与别的键原样保留（同一 Spec 输出第 13 条）。
 */

import type {SettingLayer, SettingsService, SettingWriteResult} from "@notnotype/nb-plugin-sdk/settings";

import {itemsSetting} from "../shared/contracts";
import type {Snippet} from "../shared/contracts";

/** 末尾加一条空正文的片段；名字由页面按显示语言给出，用户随后改。 */
export function addSnippet(items: ReadonlyArray<Snippet>, name: string): Snippet[] {
    return [...items, {name, text: ""}];
}

export function removeSnippet(items: ReadonlyArray<Snippet>, index: number): Snippet[] {
    return items.filter((_, at) => at !== index);
}

/** 改一条的名字或正文。 */
export function changeSnippet(items: ReadonlyArray<Snippet>, index: number, change: Partial<Snippet>): Snippet[] {
    return items.map((item, at) => (at === index ? {...item, ...change} : item));
}

/** 上移（`-1`）或下移（`+1`）一条；到头时原样返回。 */
export function moveSnippet(items: ReadonlyArray<Snippet>, index: number, by: -1 | 1): Snippet[] {
    const target = index + by;
    if (target < 0 || target >= items.length) return [...items];
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
}

/**
 * 把整份列表写进 `layer` 这一层。**一定要带 `{layer}`**：缺省是 `"auto"`，本作品层有这个键就写本作品层、否则写用户层
 * （configuration.md 输出第 12 条）——用户在“用户”标签下改，结果却写进了本作品；或在“本作品”标签下第一次改，却写进了
 * 用户设置。页面拿到的 `context.layer` 就是用户此刻看的那一层（settings-window.md 输出第 6 条）。
 *
 * `settings` 必须是**本插件自己的**配置服务：它只能写本插件声明的项，写别的插件的项为 `denied`（configuration.md
 * 输出第 11 条）。失败不抛错，以结果返回，页面据此提示。
 */
export function saveSnippets(settings: SettingsService, layer: SettingLayer, items: ReadonlyArray<Snippet>): Promise<SettingWriteResult> {
    return settings.update(itemsSetting, [...items], {layer});
}
