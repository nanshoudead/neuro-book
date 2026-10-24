/**
 * 插件描述：插件这个发布单位的身份、版本，以及它在哪些运行位置有入口。宿主按它决定在每个实例里装哪一侧的定义，构建预设
 * 读它生成清单（docs/specs/runtime/plugin-manifest.md）；内核不读它（docs/specs/runtime/plugins.md）。
 *
 * 描述只引用合同模块，不引用任何一侧的实现：宿主装配与构建只看这个文件。
 */

import {plugin} from "./shared/contracts";

/** 报时：把宿主给的时钟包成一项共享服务，交给同一实例里的别的插件；没有不需要代码就能读的声明。 */
export const descriptor = plugin.descriptor();
