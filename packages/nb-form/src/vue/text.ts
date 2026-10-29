/**
 * 表单取文字（docs/specs/ui/forms.md 输出 24，docs/specs/ui/i18n.md）：读宿主注入的翻译端口，本包目录的键绑定命名空间
 * `nb-form`、按源语言目录核对。
 *
 * 端口从哪来，按先后：
 * 1. 宿主注入的端口（nb-ui 的 `TEXT_PORT_KEY`）。宿主要登记本包目录（`@notnotype/nb-form/locales`），语言以它为准，
 *    `SchemaForm`、`SchemaField` 的 `locale` 属性不起作用。
 * 2. 没有注入时，表单的根（`SchemaForm`、`SchemaField`）按自己的 `locale`（缺省 zh-CN）建 nb-ui 的缺省端口并 provide：
 *    字段、控件、嵌套的 nb-ui 控件与嵌进来的别的共享包拿到同一个。
 * 3. 在表单的根之外、上面也没有注入时（调用方在自己的组件里调用 `useFormText` 给 `describeIssues` 用），用 nb-ui 的缺省
 *    端口，语言 zh-CN。
 *
 * 缺省端口的目录是所有已导入共享包登记的（nb-ui 的 `registerDefaultCatalog`）：本模块导入时登记本包目录。登记放在 Vue 层，
 * 不放进 `../locales`：核心只许 `import type` 自 nb-ui（`../boundary.test.ts`）。
 *
 * 语言映射不交给端口，按 `resolveText` 在本包解析：`FormText` 的映射一支不核对语言标签（`../text.ts`），端口只认标签合法
 * 的映射，交给它会让以前能显示的映射变成空白。标签合法时两边的回退相同（当前语言 → en-US → 第一项）。
 */

import type {Ref} from "vue";

import type {TextParams} from "@notnotype/nb-ui/text";
import {provideDefaultText, registerDefaultCatalog, useText} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {formRef, issueWording} from "../builtin-text";
import type {FormTextKey} from "../builtin-text";
import {NB_FORM_CATALOGS, NB_FORM_NAMESPACE, NB_FORM_SOURCE_LOCALE} from "../locales";
import {isFormTextRef, resolveText} from "../text";
import type {FormText} from "../text";
import type {FormIssue} from "../validate";

registerDefaultCatalog(NB_FORM_NAMESPACE, NB_FORM_CATALOGS, NB_FORM_SOURCE_LOCALE);

export interface FormTextApi {
    /** 当前语言；交给自定义控件的 `locale` 属性。 */
    readonly locale: Readonly<Ref<string>>;
    /** 本包目录里的一条。 */
    t(key: FormTextKey, params?: TextParams): string;
    /** 描述、选项源或调用方给的文字；没有时是空字符串。 */
    text(value: FormText | undefined): string;
}

function textApi(port: TextPort): FormTextApi {
    return {
        locale: port.locale,
        t: (key, params) => port.t(formRef(key, params)),
        text(value) {
            if (value === undefined) return "";
            if (typeof value === "string") return value;
            return isFormTextRef(value) ? port.t(value) : resolveText(value, port.locale.value);
        },
    };
}

/**
 * 表单的根在 `setup` 里调用：有注入的端口就用它；没有时按 `locale` 建缺省端口并 provide 给子树（nb-ui 的 `provideDefaultText`）。
 * 返回根自己用的文字函数（Vue 的 `inject` 只看祖先，提供方自己调用 `useFormText` 拿不到它 provide 的端口）。
 */
export function provideFormText(locale: () => string | undefined): FormTextApi {
    return textApi(provideDefaultText(locale));
}

/** 组件在 `setup` 里调用。读注入的组件要在同名 `.md` 里声明 `state:inject`。 */
export function useFormText(): FormTextApi {
    return textApi(useText());
}

/** 一条问题显示出来的文字（输出 7）：调用方的问题用它自己的文字，schema 的问题按码写。 */
export function issueText(issue: FormIssue, text: FormTextApi): string {
    const wording = text.text(issueWording(issue));
    // JSON 字段里的问题带着值里的位置（`/a/0`），不写出来用户找不到是哪一处。
    const at = issue.params.at;
    return typeof at === "string" && at !== "" ? text.t("format.noted", {text: wording, note: at}) : wording;
}
