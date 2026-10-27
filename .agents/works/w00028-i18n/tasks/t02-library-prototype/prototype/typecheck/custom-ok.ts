import aZh from "../locales/plugin-a.zh-CN.json";
import bZh from "../locales/plugin-b.zh-CN.json";
import {scoped, typed, type KeyOf, type NamespacedKey} from "./keys";

type Catalogs = {"plugin-a": typeof aZh; "plugin-b": typeof bZh};

declare const rawT: (key: string, params?: Record<string, unknown>) => string;
export const t = typed<Catalogs>(rawT);

// 这些都应当通过
t("plugin-a:title");
t("plugin-a:greeting", {name: "x"});
t("plugin-a:files", {count: 2});           // files_one / files_other 折叠成 files
t("plugin-a:errors.io-error");
t("plugin-b:title");
export const ta = scoped(t, "plugin-a");
ta("errors.not-found");

// 派生出的键集合，写进测试里对照
export const keys: KeyOf<typeof aZh> extends infer K ? K : never = "title" as never;
export type All = NamespacedKey<Catalogs>;
const probe: All[] = ["plugin-a:only-zh", "plugin-a:errors.unknown-outcome", "plugin-b:greeting"];
void probe;
