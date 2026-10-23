/**
 * 版本租约的子进程：像同一状态根上另一个服务端那样启动一次（处理待生效变化、回收、写下租约），把本次集合的版本作为一行
 * JSON 打到标准输出，放下租约后退出。参数：安装根。只由 `plugins.test.ts` 启动。
 */

import {prepareInstalledPlugins} from "../startup";

const [root] = process.argv.slice(2);
if (root === undefined) throw new Error("用法：prepare-child.ts <安装根>");
const prepared = await prepareInstalledPlugins({root, productVersion: "0.1.0", safeMode: false});
console.log(JSON.stringify(prepared.startup.plugins.map((plugin) => `${plugin.id}@${plugin.version}`)));
await prepared.release();
