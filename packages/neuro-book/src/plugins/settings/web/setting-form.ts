/**
 * 配置项声明到表单的映射（docs/specs/ui/forms.md“给下游的映射”的设置，docs/specs/settings/settings-window.md 输出 9）：
 * 通用列表每一项用 `SchemaField` 画，schema 原样交出，声明里给界面的字段转成 `x-form` 的提示。控件选择、草稿与提交时机
 * 都由表单定；这里只做字段改名，以及按选出的控件决定这一行的排法与宽度。
 */

import type {FormHints} from "@notnotype/nb-form";
import {widgetLayout} from "@notnotype/nb-form/vue";
import type {WidgetLayout} from "@notnotype/nb-form/vue";

import type {SettingDeclaration} from "nbook/shared/settings";

/**
 * `choices` → `x-form.choices`（`title` 改名 `label`），动态选项 `{from}` → `x-form.options`；设置窗口还没有把选项来源
 * 交给表单，这样的项按来源不可用显示（docs/specs/ui/forms.md 输出 11）。
 * `ui` 的各项与 `x-form` 同名，照抄。标题与说明由 `SettingsRow` 画，不进提示。
 */
export function settingHints(declaration: SettingDeclaration): FormHints {
    const {choices, ui} = declaration;
    if (choices === undefined) return {...ui};
    if ("from" in choices) return {...ui, options: choices.from};
    return {...ui, choices: choices.map((choice) => ({value: choice.value, label: choice.title, ...(choice.description === undefined ? {} : {description: choice.description})}))};
}

export interface SettingForm {
    readonly hints: FormHints;
    /** 宽排法：控件另起一行（输出 9）。 */
    readonly wide: boolean;
    /** 标签列加控件列时控件的宽度档位。 */
    readonly width: WidgetLayout["width"];
}

/** 声明是冻结的、登记后不变：按声明记住结果，提示每次渲染是同一个对象，表单不必重算描述。 */
const forms = new WeakMap<SettingDeclaration, SettingForm>();

export function settingForm(declaration: SettingDeclaration): SettingForm {
    let form = forms.get(declaration);
    if (form === undefined) {
        const hints = settingHints(declaration);
        const layout = widgetLayout(declaration.schema, hints);
        form = {hints, wide: layout.block, width: layout.width};
        forms.set(declaration, form);
    }
    return form;
}
