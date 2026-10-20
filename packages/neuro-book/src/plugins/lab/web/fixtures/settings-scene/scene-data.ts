/**
 * 设置场景的数据：产品里真实的配置项（主题、明暗、界面语言）与外观分区，加几个示例插件的配置项与 page 分区，覆盖通用列表
 * 的每种控件、“其它”分区与 page 的两种排法。每个场景按 id 给出各层的初始内容、标签与要交付的页面。
 */

import {defineComponent, h} from "vue";
import type {Component} from "vue";

import {APPEARANCE_SECTION, APPEARANCE_SECTION_DECLARATION, localeSetting} from "nbook/plugins/settings/shared/contracts";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {appearanceSetting, themeSetting} from "nbook/plugins/workbench/shared/contracts";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";

import SampleModelsPage from "./SampleModelsPage.vue";
import SampleSnippetsPage from "./SampleSnippetsPage.vue";
import {MODELS_SECTION, modelsSettings, notesSettings, SNIPPETS_SECTION, snippetsSettings} from "./scene-settings";
import type {SettingsWindowSceneId} from "./scene-settings";
import {createSettingsHost} from "./settings-host";
import type {HostLayer, HostSection, SettingsHost} from "./settings-host";

type SceneSetting = {readonly plugin: string; readonly definition: SettingDefinition<unknown>};

/** 场景里已接受的全部配置项：产品的三项加示例插件的。 */
export const SCENE_SETTINGS: ReadonlyArray<SceneSetting> = [
    {plugin: "nbook.workbench", definition: themeSetting},
    {plugin: "nbook.workbench", definition: appearanceSetting},
    {plugin: "nbook.settings", definition: localeSetting},
    ...Object.values(notesSettings).map((definition) => ({plugin: "example.notes", definition})),
    ...Object.values(snippetsSettings).map((definition) => ({plugin: "example.snippets", definition})),
    ...Object.values(modelsSettings).map((definition) => ({plugin: "example.models", definition})),
] as ReadonlyArray<SceneSetting>;

const SECTIONS: ReadonlyArray<HostSection> = [
    {id: APPEARANCE_SECTION, plugin: "nbook.settings", kind: "list", declaration: APPEARANCE_SECTION_DECLARATION},
    {id: MODELS_SECTION, plugin: "example.models", declaration: {title: {"zh-CN": "模型服务", "en-US": "Model Providers"}, description: {"zh-CN": "写作助手用的模型与服务商", "en-US": "Models and providers used by the assistant"}, icon: "i-lucide-server", category: "ai", layout: "fill", layers: ["user"]}, kind: "page"},
    {id: SNIPPETS_SECTION, plugin: "example.snippets", declaration: {title: {"zh-CN": "常用片段", "en-US": "Snippets"}, description: {"zh-CN": "写作时常用的固定文字", "en-US": "Fixed text you insert often"}, icon: "i-lucide-text-quote", category: "plugins"}, kind: "page"},
];

/** 场景里那部作品的书名与项目层文件的位置。 */
export const SCENE_BOOK = "雾港";
export const SCENE_PROJECT_FILE = "/home/writer/Documents/NeuroBook/雾港/.nbook/settings.json";

interface SceneSpec {
    readonly user?: HostLayer;
    readonly project?: HostLayer;
    readonly section: string;
    readonly layer?: "user" | "project";
}

const BOOK = {values: {"nbook.workbench/appearance": "light"}} satisfies HostLayer;

const SPECS: Readonly<Record<SettingsWindowSceneId, SceneSpec>> = {
    "user": {user: {values: {"nbook.workbench/appearance": "system"}}, project: BOOK, section: APPEARANCE_SECTION},
    "project": {user: {values: {"nbook.workbench/appearance": "system"}}, project: BOOK, section: APPEARANCE_SECTION, layer: "project"},
    "unbound": {user: {values: {"nbook.workbench/theme": "macos"}}, section: APPEARANCE_SECTION},
    "user-invalid": {user: {values: {"nbook.workbench/appearance": "dark"}, invalid: "第 3 行：缺少逗号"}, project: BOOK, section: APPEARANCE_SECTION},
    "project-invalid": {user: {}, project: {...BOOK, invalid: "第 2 行：同一个键出现了两次", path: SCENE_PROJECT_FILE}, section: APPEARANCE_SECTION, layer: "project"},
    "unreachable": {user: {}, project: {...BOOK, unreachable: true}, section: APPEARANCE_SECTION, layer: "project"},
    "write-failed": {user: {values: {"nbook.workbench/theme": "macos"}}, section: APPEARANCE_SECTION},
    "other": {user: {values: {"example.notes/interval": 120, "example.notes/signature": "——写于雾港"}}, project: {values: {"example.notes/autosave": false}}, section: "other"},
    "page-declared": {project: BOOK, section: SNIPPETS_SECTION},
    "page-blocked": {project: BOOK, section: SNIPPETS_SECTION},
    "page-failed": {project: BOOK, section: SNIPPETS_SECTION},
    "page-stopped": {project: BOOK, section: SNIPPETS_SECTION},
    "page-load-failed": {project: BOOK, section: SNIPPETS_SECTION},
    "page-column": {user: {values: {"example.snippets/items": [{name: "旁白", text: "雾从港口漫上来。"}, {name: "落款", text: "——写于雾港"}]}}, project: {values: {"example.snippets/autoInsert": true}}, section: SNIPPETS_SECTION},
    "page-fill": {user: {values: {"example.models/effort": "high"}}, project: BOOK, section: MODELS_SECTION},
};

/** 页面组件：插件的页面在自己的激活里拿到自己的配置服务，这里同样在交付时绑定。 */
function page(component: Component, settings: SettingsService): Component {
    return defineComponent({
        name: "LabSettingsPage",
        props: {context: {type: Object as () => SettingsPageContext, required: true}},
        setup: (props) => () => h(component, {context: props.context, settings}),
    });
}

export interface SettingsScene {
    readonly host: SettingsHost;
    /** 打开窗口到场景的分区与标签。 */
    open(): void;
    /** 再次交付 page 分区（撤回、加载失败的场景用）。 */
    deliver(): void;
}

export function createSettingsScene(id: SettingsWindowSceneId, notify: (input: NotificationInput) => void, report: (message: string) => void): SettingsScene {
    const spec = SPECS[id];
    const host = createSettingsHost({
        settings: SCENE_SETTINGS,
        sections: SECTIONS,
        ...(spec.user === undefined ? {} : {user: spec.user}),
        ...(spec.project === undefined ? {} : {project: spec.project}),
        projectTitle: SCENE_BOOK,
        notify,
        report,
    });
    const deliver = (): void => {
        host.publish(SNIPPETS_SECTION, async () => page(SampleSnippetsPage, host.service("example.snippets")));
        host.publish(MODELS_SECTION, async () => page(SampleModelsPage, host.service("example.models")));
    };
    // “重试”：入口恢复、重新激活后交付。
    host.onRetry(async () => {
        deliver();
        return {status: "activated"};
    });
    if (id === "write-failed") host.user.failWrites("write-failed");
    if (id === "page-declared") host.entry(SNIPPETS_SECTION, "activating");
    else if (id === "page-blocked") host.entry(SNIPPETS_SECTION, "blocked", "nbook.files/files");
    else if (id === "page-failed") host.entry(SNIPPETS_SECTION, "failed", "读不到片段库：权限不足");
    else if (id === "page-load-failed") host.publish(SNIPPETS_SECTION, async () => {
        throw new Error("页面模块下载失败");
    });
    else {
        deliver();
        if (id === "page-stopped") host.revoke(SNIPPETS_SECTION, "scope-closed");
    }
    return {
        host,
        open: () => void host.window.openWindow({section: spec.section, ...(spec.layer === undefined ? {} : {layer: spec.layer})}),
        deliver,
    };
}
