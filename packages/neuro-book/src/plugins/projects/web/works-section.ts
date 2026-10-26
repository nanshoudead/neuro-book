/**
 * 设置窗口的“作品”分区（docs/specs/workbench/bookshelf.md 输出 21）：`nbook.projects` 向 `settings.sections` 贡献的 column
 * 页面，只在“用户”标签下可用。设置窗口只给页面 `context`；本插件的配置服务、目录选择器的数据来源、显示语言与写不进去时的
 * 通知在这里接上。用渲染函数写：插件的合同测试在 bun test 里导入插件，bun 不能加载 `.vue`。
 */

import {defineComponent, h} from "vue";
import type {Component, PropType, Ref} from "vue";

import type {SettingsPageDeclaration} from "nbook/plugins/settings/shared/contracts";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {Notifications} from "nbook/plugins/workbench/shared/contracts";
import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import type {SettingsFailure, SettingsService} from "nbook/shared/settings";

import type {BrowseOutcome} from "./browse";
import {shelfText} from "./messages";
import type {LibraryInfo} from "./shelf-page";

export const WORKS_SECTION = "nbook.works";

export const WORKS_SECTION_DECLARATION: SettingsPageDeclaration = {
    title: {"zh-CN": "作品", "en-US": "Books"},
    icon: "i-lucide-library",
    category: "app",
    order: 30,
    layout: "column",
    // 作品目录只允许用户层：“本作品”标签下这个分区停用。
    layers: ["user"],
};

export interface WorksPageOptions {
    /** `components/WorksSettingsPage.vue`。 */
    readonly component: Component;
    readonly settings: SettingsService;
    /** 目录选择器的数据来源（`PathPickerDialog` 的 `source`）。 */
    readonly source: {list(path: string | null): Promise<BrowseOutcome>};
    /** 当前有效的作品目录（远程 `library()`）；取不到为 null，诊断由提供方记。没设时页面据此显示缺省目录。 */
    readonly library: () => Promise<LibraryInfo | null>;
    readonly locale: Readonly<Ref<DisplayLocale>>;
    readonly notifications: Notifications;
    /** 记诊断：作品目录没写进设置（用户已经看到通知）。 */
    readonly report: (message: string) => void;
}

export function createWorksPage(options: WorksPageOptions): Component {
    const failed = (failure: {readonly code: SettingsFailure; readonly detail: string}): void => {
        const locale = options.locale.value;
        options.report(`作品目录没有写进设置：${failure.code}：${failure.detail}`);
        // 与书架“作品目录没写进设置”同一种去处（bookshelf.md“失败与恢复”）：通知。
        options.notifications.notify({
            tone: "warning",
            title: localize(shelfText("libraryNotSavedTitle"), locale),
            message: localize(shelfText("libraryChangeNotSaved", {reason: `${failure.code}：${failure.detail}`}), locale),
        });
    };
    return defineComponent({
        name: "WorksSettingsSection",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        // 每次渲染读 context.layer：切换标签时窗口不重建页面，只是层变了（settings-window.md 输出 6）。
        setup: (props) => () => h(options.component, {
            layer: props.context.layer.value,
            settings: options.settings,
            source: options.source,
            readLibrary: options.library,
            locale: options.locale.value,
            onWriteFailed: failed,
        }),
    });
}
