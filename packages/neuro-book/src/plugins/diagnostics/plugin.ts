import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

/** 运行实例的结构化诊断与日志；服务端与项目子进程在各自获授的日志位置写 JSONL，浏览器写 console。 */
export const descriptor: PluginDescriptor = {id: "nbook.diagnostics", version: PRODUCT_VERSION, locations: ["server", "project", "browser"]};
