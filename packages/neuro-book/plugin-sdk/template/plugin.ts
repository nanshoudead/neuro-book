/**
 * 插件描述：id、版本、运行位置与不需要代码就能读的声明（设置项、设置分区）。构建时读它生成清单；版本要与 package.json 的
 * `version` 相同，改版本时两处一起改。
 */

import type {PluginDescriptor} from "@notnotype/nb-plugin-sdk";

import {greeting, PLUGIN_ID, section} from "./shared/contracts";

export const descriptor: PluginDescriptor = {id: PLUGIN_ID, version: "0.1.0", locations: ["browser"], contributions: [greeting.contribution, section]};
