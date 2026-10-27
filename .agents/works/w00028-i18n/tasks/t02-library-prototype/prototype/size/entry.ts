import i18next from "i18next";

// 用到 init / addResourceBundle / removeResourceBundle / t / changeLanguage / on，避免被 tree-shake 掉
export async function create(): Promise<unknown> {
    const instance = i18next.createInstance();
    await instance.init({lng: "zh-CN", fallbackLng: ["zh-CN"], resources: {}, interpolation: {escapeValue: false}});
    instance.addResourceBundle("zh-CN", "a", {k: "v"});
    instance.on("languageChanged", () => undefined);
    await instance.changeLanguage("en-US");
    instance.removeResourceBundle("zh-CN", "a");
    return instance.t("a:k", {count: 1});
}
(globalThis as Record<string, unknown>).__create = create;
