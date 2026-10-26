/**
 * 插件描述（读法见 `../clock/plugin.ts`）。
 */

import {plugin} from "./shared/contracts";

/** 笔记：按写笔记的插件分开存，每个插件只看到自己写的；数据落在 `nbook.storage`，服务端重启后还在。 */
export const descriptor = plugin.descriptor();
