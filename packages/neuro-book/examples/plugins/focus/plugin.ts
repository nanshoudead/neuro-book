/**
 * 插件描述（读法见 `../clock/plugin.ts`）。
 */

import type {PluginDescriptor} from "@notnotype/nb-plugin-sdk";

import {minutesSetting, section} from "./shared/contracts";

/**
 * 专注计时：服务端记着进行中的一次专注与今天完成的次数，窗口里有侧栏视图、状态栏条目与命令。完整示例：设置项、命令、
 * 视图、状态栏条目、服务端远程服务与私有存储都用到了，只用 SDK 的接口。
 */
export const descriptor: PluginDescriptor = {id: "example.focus", version: "0.1.0", locations: ["server", "browser"], contributions: [minutesSetting.contribution, section]};
