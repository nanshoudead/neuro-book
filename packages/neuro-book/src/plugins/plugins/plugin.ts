/**
 * `nbook.plugins`：第三方插件的安装、启停与卸载（docs/specs/runtime/plugin-install.md）。
 *
 * 服务端入口拥有安装目录与登记表并提供远程服务；浏览器入口贡献设置窗口的插件页。插件集合在进程生命期内不变，
 * 因此启用、禁用与安装都在下一次启动生效（plugin-hot-plug 尚未实现），页面与合同都按这个事实说明。
 */

import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

export const descriptor: PluginDescriptor = {id: "nbook.plugins", version: PRODUCT_VERSION, locations: ["server", "browser"]};
