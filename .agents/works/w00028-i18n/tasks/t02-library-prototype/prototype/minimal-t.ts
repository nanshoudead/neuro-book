/**
 * 共享包用的最小 `t`：不依赖 i18next，只支持 `{{name}}` 插值与 `_one`/`_other` 复数。
 * 与 i18next 的差别（见 spike 测试）：缺键回退、非数字 count 的处理都按“更安全”的方向写，不追求逐字一致。
 */

export type Messages = Readonly<Record<string, string>>;
export type Params = Readonly<Record<string, string | number | undefined>>;

export interface MinimalTranslator {
    (key: string, params?: Params): string;
}

export function createMinimalT(messagesByLanguage: Readonly<Record<string, Messages>>, language: string, fallbackLanguages: readonly string[] = []): MinimalTranslator {
    const chain = [language, language.split("-")[0] ?? language, ...fallbackLanguages];
    const lookup = (key: string): string | undefined => {
        for (const lng of chain) {
            const hit = messagesByLanguage[lng]?.[key];
            if (hit !== undefined) return hit;
        }
        return undefined;
    };
    const plural = new Intl.PluralRules(language);
    return (key, params) => {
        let message: string | undefined;
        const count = params?.count;
        if (typeof count === "number") {
            // 与 i18next 一致：先按复数类别 `_one`，再 `_other`；都没有时才用不带后缀的键
            message = lookup(`${key}_${plural.select(count)}`) ?? lookup(`${key}_other`) ?? lookup(key);
        } else {
            message = lookup(key);
        }
        if (message === undefined) return key;
        return message.replace(/\{\{\s*(\w+)\s*\}\}/g, (placeholder, name: string) => {
            // 与 i18next 一致：没传这个参数时原样留着 `{{name}}`，传了 undefined 时替换成空串
            if (!params || !(name in params)) return placeholder;
            const value = params[name];
            return value === undefined ? "" : String(value);
        });
    };
}
