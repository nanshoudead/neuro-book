/**
 * 插件描述：构建时读它生成清单。`contributions` 写不需要代码就能读的声明（设置分区、设置项）：插件还没激活，设置窗口就能
 * 列出它们。
 */

import {greeting, main, plugin} from "./shared/contracts";

export const descriptor = plugin.descriptor([main, greeting]);
