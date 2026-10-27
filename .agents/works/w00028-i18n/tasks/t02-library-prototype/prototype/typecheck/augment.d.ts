import "i18next";

import type aZh from "../locales/plugin-a.zh-CN.json";
import type bZh from "../locales/plugin-b.zh-CN.json";

declare module "i18next" {
    // 每个包/插件各自增加一项（ResourceNamespaceMap 是 i18next 为 monorepo 提供的，避免多个包重复声明 CustomTypeOptions.resources 的 TS2717）
    interface ResourceNamespaceMap {
        "plugin-a": typeof aZh;
        "plugin-b": typeof bZh;
    }
    interface CustomTypeOptions {
        // 不设默认命名空间，调用点必须写 `<ns>:`
        defaultNS: false;
    }
}
