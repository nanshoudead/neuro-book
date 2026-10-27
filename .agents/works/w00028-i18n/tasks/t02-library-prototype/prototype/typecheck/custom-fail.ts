import aZh from "../locales/plugin-a.zh-CN.json";
import bZh from "../locales/plugin-b.zh-CN.json";
import {scoped, typed} from "./keys";

type Catalogs = {"plugin-a": typeof aZh; "plugin-b": typeof bZh};
declare const rawT: (key: string, params?: Record<string, unknown>) => string;
const t = typed<Catalogs>(rawT);

t("plugin-a:titel");                       // EXPECT-ERROR: 键拼错
t("plugin-b:only-zh");                     // EXPECT-ERROR: 键在另一个命名空间
t("plugin-c:title");                       // EXPECT-ERROR: 命名空间不存在
t("plugin-a:errors.io-eror");              // EXPECT-ERROR: 嵌套键拼错
t("plugin-a:files_other");                 // EXPECT-ERROR: 带复数后缀的写法不允许
t("plugin-a:greeting", {name: {x: 1}});    // EXPECT-ERROR: 参数值类型
scoped(t, "plugin-a")("greeting2");        // EXPECT-ERROR: 作用域内键拼错
