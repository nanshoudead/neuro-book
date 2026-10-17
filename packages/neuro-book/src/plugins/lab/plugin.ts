import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

/**
 * Component Lab（ui.component-lab）：只在开发模式加载，向 `workbench.pages` 贡献 `/lab` 页面。列在开发清单
 * （`src/development-manifest.ts`）而不是产品清单，生产构建不含它的代码。
 */
export const descriptor: PluginDescriptor = {id: "nbook.lab", version: PRODUCT_VERSION, locations: ["browser"]};
