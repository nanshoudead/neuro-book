/**
 * 表单取文字（docs/specs/ui/forms.md 输出 24，docs/specs/ui/i18n.md）：读宿主注入的翻译端口，本包目录的键绑定命名空间
 * `nb-form`、按源语言目录核对。
 *
 * 端口从哪来，按先后：
 * 1. 宿主注入的端口（nb-ui 的 `TEXT_PORT_KEY`）。宿主要登记本包目录（`@notnotype/nb-form/locales`），语言以它为准，
 *    `SchemaForm`、`SchemaField` 的 `locale` 属性不起作用。
 * 2. 没有注入时，表单的根（`SchemaForm`、`SchemaField`）按自己的 `locale`（缺省 zh-CN）建包内的缺省端口并 provide：
 *    字段、控件与嵌套的 nb-ui 控件拿到同一个。
 * 3. 在表单的根之外、上面也没有注入时（调用方在自己的组件里调用 `useFormText` 给 `describeIssues` 用），用包内的缺省
 *    端口，语言 zh-CN。
 *
 * 不直接用 nb-ui 的 `useText()`：它在没有注入时给 nb-ui 的缺省端口，那里没有本包目录，只会显示键名。也不在“端口取不到
 * 本包的键”时再兜底：端口取不到时返回键名或（测试环境的宿主引擎）抛错，没有可靠的判据。
 *
 * 语言映射不交给端口，按 `resolveText` 在本包解析：`FormText` 的映射一支不核对语言标签（`../text.ts`），端口只认标签合法
 * 的映射，交给它会让以前能显示的映射变成空白。标签合法时两边的回退相同（当前语言 → en-US → 第一项）。
 */

import {computed, inject, provide, readonly, ref} from "vue";
import type {Ref} from "vue";

import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "@notnotype/nb-ui/locales";
import type {TextParams} from "@notnotype/nb-ui/text";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import type {MinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {formRef, issueWording} from "../builtin-text";
import type {FormTextKey} from "../builtin-text";
import {NB_FORM_CATALOGS, NB_FORM_NAMESPACE} from "../locales";
import {isFormTextRef, resolveText} from "../text";
import type {FormText} from "../text";
import type {FormIssue} from "../validate";

let translator: MinimalTranslator | undefined;
let fallbackPort: TextPort | undefined;

/** nb-ui 与本包的目录、最小实现；按需建一次，所有缺省端口共用。 */
function packageTranslator(): MinimalTranslator {
    translator ??= createMinimalTranslator({catalogs: {[NB_UI_NAMESPACE]: NB_UI_CATALOGS, [NB_FORM_NAMESPACE]: NB_FORM_CATALOGS}});
    return translator;
}

function packagePort(locale: Readonly<Ref<string>>): TextPort {
    const text = packageTranslator();
    return {locale, t: (value) => text.translate(value, locale.value), variants: (value) => text.variants(value)};
}

function defaultPort(): TextPort {
    fallbackPort ??= packagePort(readonly(ref("zh-CN")));
    return fallbackPort;
}

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
 * 表单的根在 `setup` 里调用：有注入的端口就用它；没有时按 `locale` 建包内的缺省端口并 provide 给子树。返回根自己用的
 * 文字函数（Vue 的 `inject` 只看祖先，提供方自己调用 `useFormText` 拿不到它 provide 的端口）。
 */
export function provideFormText(locale: () => string | undefined): FormTextApi {
    const injected = inject(TEXT_PORT_KEY, null);
    if (injected !== null) return textApi(injected);
    const port = packagePort(computed(() => locale() ?? "zh-CN"));
    provide(TEXT_PORT_KEY, port);
    return textApi(port);
}

/** 组件在 `setup` 里调用。读注入的组件要在同名 `.md` 里声明 `state:inject`。 */
export function useFormText(): FormTextApi {
    return textApi(inject(TEXT_PORT_KEY, null) ?? defaultPort());
}

/** 一条问题显示出来的文字（输出 7）：调用方的问题用它自己的文字，schema 的问题按码写。 */
export function issueText(issue: FormIssue, text: FormTextApi): string {
    const wording = text.text(issueWording(issue));
    // JSON 字段里的问题带着值里的位置（`/a/0`），不写出来用户找不到是哪一处。
    const at = issue.params.at;
    return typeof at === "string" && at !== "" ? `${wording}（${at}）` : wording;
}
