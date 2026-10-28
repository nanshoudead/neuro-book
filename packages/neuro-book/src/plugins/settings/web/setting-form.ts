/**
 * 配置项声明到表单的映射（docs/specs/ui/forms.md“给下游的映射”的设置，docs/specs/settings/settings-window.md 输出 9）：
 * 通用列表每一项用 `SchemaField` 画，schema 原样交出，声明里给界面的字段转成 `x-form` 的提示。控件选择、草稿与提交时机
 * 都由表单定；这里只做字段改名，以及按选出的控件决定这一行的排法与宽度。
 */

import {resolveForm, validateForm} from "@notnotype/nb-form";
import type {FieldKind, FormHints, FormIssue, FormModel} from "@notnotype/nb-form";
import {widgetLayout} from "@notnotype/nb-form/vue";
import type {WidgetLayout} from "@notnotype/nb-form/vue";

import type {DisplayLocale, TextResolver} from "nbook/shared/localized-text";
import type {SettingDeclaration} from "nbook/shared/settings";

/**
 * `choices` → `x-form.choices`（`title` 改名 `label`），动态选项 `{from}` → `x-form.options`；设置窗口还没有把选项来源
 * 交给表单，这样的项按来源不可用显示（docs/specs/ui/forms.md 输出 11）。
 * `ui` 的各项与 `x-form` 同名，照抄。标题与说明由 `SettingsRow` 画，不进提示。选项的文字经 `text` 翻成当前语言再交给表单：
 * 表单的文字只认字符串与语言映射，选项标题可能是文字引用（登记时补的约定键）。
 */
export function settingHints(declaration: SettingDeclaration, text: TextResolver): FormHints {
    const {choices, ui} = declaration;
    if (choices === undefined) return {...ui};
    if ("from" in choices) return {...ui, options: choices.from};
    return {...ui, choices: choices.map((choice) => ({value: choice.value, label: text.t(choice.title), ...(choice.description === undefined ? {} : {description: text.t(choice.description)})}))};
}

/**
 * 结构字段（列表、对象、JSON）的一步编辑常常还不是合法的值（刚加的一项还没填），合格了才写，在那之前留在行里
 * （docs/specs/settings/settings-window.md 输出 14，开发者 2026-10-21 定）。单个值照旧：写入被拒就通知、回到实际值。
 */
const STAGED_KINDS: ReadonlySet<FieldKind> = new Set(["string-list", "object", "object-list", "json"]);

export interface SettingForm {
    readonly hints: FormHints;
    readonly model: FormModel;
    /** 值不合 schema 时先留在行里、不写。 */
    readonly staged: boolean;
    /** 宽排法：控件另起一行（输出 9）。 */
    readonly wide: boolean;
    /** 标签列加控件列时控件的宽度档位。 */
    readonly width: WidgetLayout["width"];
}

/**
 * 声明是冻结的、登记后不变：按声明与语言记住结果，提示每次渲染是同一个对象，表单不必重算描述。提示里的选项文字随语言
 * 变，所以按语言各记一份；同一语言下翻译结果不变，因为窗口的目录在挂载前登记、之后不换（在线替换随热插拔）。
 */
const forms = new WeakMap<SettingDeclaration, Map<DisplayLocale, SettingForm>>();

export function settingForm(declaration: SettingDeclaration, locale: DisplayLocale, text: TextResolver): SettingForm {
    let byLocale = forms.get(declaration);
    if (byLocale === undefined) {
        byLocale = new Map();
        forms.set(declaration, byLocale);
    }
    let form = byLocale.get(locale);
    if (form === undefined) {
        const hints = settingHints(declaration, text);
        const layout = widgetLayout(declaration.schema, hints);
        const model = resolveForm(declaration.schema);
        form = {hints, model, staged: STAGED_KINDS.has(model.root.kind), wide: layout.block, width: layout.width};
        byLocale.set(locale, form);
    }
    return form;
}

/** 值里的错误（警告不挡写入）。 */
export function settingErrors(form: SettingForm, value: unknown): FormIssue[] {
    return validateForm(form.model, value).filter((issue) => issue.severity === "error");
}
