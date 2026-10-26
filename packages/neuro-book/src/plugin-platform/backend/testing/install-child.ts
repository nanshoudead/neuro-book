/**
 * 场景 15 的子进程：像另一个服务端进程那样，对同一个安装根安装一个插件，把结果作为一行 JSON 打到标准输出。
 * 参数：安装根、插件文件夹。只由 `plugins.test.ts` 启动。
 */

import {ACME_PROFILE} from "../../testing/profile";
import {createPluginInventory} from "../inventory";
import {NO_INSTALLED_PLUGINS} from "../startup";

const [root, source] = process.argv.slice(2);
if (root === undefined || source === undefined) throw new Error("用法：install-child.ts <安装根> <插件文件夹>");
const inventory = createPluginInventory({root, profile: ACME_PROFILE, builtin: [], startup: NO_INSTALLED_PLUGINS, record: () => undefined});
console.log(JSON.stringify(await inventory.install(source)));
