/**
 * 插件描述（读法见 `../clock/plugin.ts`）。counter 的两个入口写在同一份后端定义里（`backend/plugin.ts`），各在本位置的
 * 实例里激活。
 */

import {plugin} from "./shared/contracts";

/** 计数器：别的插件（例如窗口里的面板）直接用它的远程合同读写并订阅变化。 */
export const descriptor = plugin.descriptor();
