/**
 * 服务端与项目实例的宿主模块表（docs/specs/runtime/plugin-code-loading.md 输出 2）：第三方插件代码导入的共享模块，就是宿主
 * 自己用的这一份。键与平台档案（`nbook/plugin-platform-profile`）的 `SERVER_SHARED_MODULES` 一一对应。
 *
 * 由装载器在第一次装载第三方入口时调用：动态导入，没有第三方入口的进程不必加载 SDK 的实现。
 */

import type {SERVER_SHARED_MODULES} from "nbook/plugin-platform-profile";

export async function serverHostModules(): Promise<Readonly<Record<(typeof SERVER_SHARED_MODULES)[number], object>>> {
    const [reactivity, sdk] = await Promise.all([import("@vue/reactivity"), import("nbook/sdk/index")]);
    return {"@vue/reactivity": reactivity, "@notnotype/nb-plugin-sdk": sdk};
}
