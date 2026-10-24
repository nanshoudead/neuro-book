/**
 * `example.file-menu` 的合同模块：它不对别的插件公开服务或合同，这里只有插件的身份（读法见
 * `../../clock/shared/contracts.ts`）。插件描述与入口模块都从这里取 `plugin`。
 */

import {definePlugin} from "@notnotype/nb-plugin-sdk";

/** 文件菜单：向 `example.menu` 贡献“打开”“关闭”两项。 */
export const plugin = definePlugin({id: "example.file-menu", version: "0.1.0", locations: ["server"]});
