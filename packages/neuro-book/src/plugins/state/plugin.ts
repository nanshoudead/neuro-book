import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

/** 公开状态：拥有贡献点 `state.public`，在每个运行实例里提供公开键的同步读取。 */
export const descriptor: PluginDescriptor = {id: "nbook.state", version: PRODUCT_VERSION, locations: ["server", "project", "browser"]};
