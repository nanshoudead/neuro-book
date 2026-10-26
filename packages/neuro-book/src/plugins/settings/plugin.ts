import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {APPEARANCE_SECTION, APPEARANCE_SECTION_DECLARATION, localeSetting, SETTINGS_SECTIONS_POINT} from "./shared/contracts";

/**
 * 配置：拥有贡献点 `settings.properties`，按默认值、用户层（`<状态根>/settings.json`）与项目层
 * （`<项目目录>/.nbook/settings.json`）合成有效值并推到每个实例（docs/specs/settings/configuration.md）。外观分区是
 * list 分区，和配置项一样写在描述的顶层。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.settings",
    version: PRODUCT_VERSION,
    locations: ["server", "project", "browser"],
    contributions: [localeSetting.contribution, {capability: SETTINGS_SECTIONS_POINT, id: APPEARANCE_SECTION, declaration: APPEARANCE_SECTION_DECLARATION}],
};
