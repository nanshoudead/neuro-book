/**
 * Lab 里扮演宿主时的触发菜单数据：`@` 没输入时列目录、输入了按目录分组搜索，`$` 技能。引用写以 `/` 开头的作品根地址
 * （docs/specs/ui/prompt-editor.md 输出 3），由 `promptReferenceText` 拼出。
 */

import type {PromptEditorMenu, PromptEditorMenuItem} from "nbook/plugins/markdown/web/components/prompt/prompt-editor.types";
import {promptReferenceText} from "nbook/plugins/markdown/web/components/prompt/prompt-text";

const FILES = [
    {path: "正文/第一章.md", title: "第一章 雨夜", group: "正文", iconClass: "i-lucide-file-text"},
    {path: "正文/第二章.md", title: "第二章 旧钟", group: "正文", iconClass: "i-lucide-file-text"},
    {path: "正文/第三章.md", title: "第三章 学徒", group: "正文", iconClass: "i-lucide-file-text"},
    {path: "设定/地点/钟表铺.md", title: "钟表铺", group: "设定", iconClass: "i-lucide-map-pin"},
    {path: "设定/人物/学徒.md", title: "失踪的学徒", group: "设定", iconClass: "i-lucide-user-round"},
    {path: "资料/采访 记录.md", title: "采访 记录", group: "资料", iconClass: "i-lucide-file"},
];
const FOLDERS = ["正文", "设定", "资料"];
const SKILLS = [
    {name: "writer", description: "按大纲续写"},
    {name: "reviewer", description: "审读并给出修改意见"},
    {name: "summarize", description: "总结章节"},
];

const matches = (text: string, query: string): boolean => text.toLowerCase().includes(query.toLowerCase());

function fileItems(query: string, grouped: boolean): PromptEditorMenuItem[] {
    return FILES.filter((file) => matches(file.title, query) || matches(file.path, query)).map((file) => ({
        id: `file:${file.path}`,
        label: file.title,
        description: file.path,
        iconClass: file.iconClass,
        ...(grouped ? {group: file.group} : {}),
        insertText: promptReferenceText(file.title, `/${file.path}`),
    }));
}

export function referenceMenu(query: string): PromptEditorMenu {
    const folder = FOLDERS.find((name) => query.startsWith(`/${name}/`));
    if (folder !== undefined) return {title: folder, items: fileItems(query.slice(folder.length + 2), false).filter((item) => item.description?.startsWith(`${folder}/`))};
    if (query === "") {
        return {
            title: "引用",
            items: FOLDERS.map((name) => ({id: `folder:${name}`, label: name, description: "逐级选择", iconClass: "i-lucide-folder", insertText: `@/${name}/`, continues: true})),
        };
    }
    return {items: fileItems(query, true), emptyText: `没有找到“${query}”`};
}

/** 技能菜单；数据没到时是“正在加载”，宿主在数据到达后换一个新的解析函数。 */
export function skillMenu(loaded: boolean, query: string): PromptEditorMenu {
    if (!loaded) return {title: "技能", items: [], loading: true};
    return {
        title: "技能",
        items: SKILLS.filter((skill) => matches(skill.name, query)).map((skill) => ({id: skill.name, label: skill.name, description: skill.description, iconClass: "i-lucide-sparkles", insertText: `$${skill.name}`})),
    };
}
