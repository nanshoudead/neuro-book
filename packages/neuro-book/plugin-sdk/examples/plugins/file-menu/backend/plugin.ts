/**
 * `example.file-menu` 的服务端入口：向贡献点 `menu.items` 提交两个菜单项。读这个文件学向别的插件定义的贡献点提交的写法：
 *
 * - 这个贡献点不是 SDK 的助手管的（助手只有视图、命令、状态栏条目这些），声明写在入口的 `rawContributions` 里，实现在
 *   激活产出的 `rawContributions` 里按“贡献点 → 贡献 id → 实现”交出，两边按贡献 id 对上。贡献 id 用 `plugin.id` 拼，
 *   类型是字面量：漏交一项实现编译不过；放过编译的错误（例如声明被拒）在激活时的输出核对报出（`missing-implementation`）。
 * - 与 `example.menu` 之间没有服务依赖，只引用它的合同模块（贡献点 id 与声明、实现的类型）。menu 没装、受阻或还没
 *   激活，本入口照常激活，贡献等着接收者（docs/specs/runtime/plugins.md 输出第 18 条）。
 *
 * 对应的场景：`scenarios/03-contribution-point.test.ts`。
 */

import {MENU_POINT} from "../../menu/shared/contracts";
import type {MenuItemDeclaration, MenuItemImplementation} from "../../menu/shared/contracts";
import {plugin} from "../shared/contracts";

const OPEN = `${plugin.id}.open` as const;
const CLOSE = `${plugin.id}.close` as const;

export const fileMenuBackendPlugin = plugin.definition([
    plugin.entry({
        location: "server",
        // 启动即激活：实现要等本入口激活才交出，菜单项要能执行，本入口就得先激活。
        //
        // 更好的写法是“菜单打开时才激活”：menu 拥有一个激活事件前缀（`activationEventPrefixes`，例如 `onMenu`），
        // 本入口写 `activationEvents: ["onMenu:file"]`，菜单打开时 menu 触发这个事件（docs/specs/runtime/plugins.md
        // 输出第 21 条），用激活上下文的 `context.activation.trigger("onMenu:file")`。示例的 menu 没有“打开菜单”这一步，
        // 为了让场景 3 简单，这里仍启动即激活。
        activationEvents: ["onStartup"],
        rawContributions: [
            {capability: MENU_POINT, id: OPEN, declaration: {title: "打开文件"} satisfies MenuItemDeclaration},
            {capability: MENU_POINT, id: CLOSE, declaration: {title: "关闭文件"} satisfies MenuItemDeclaration},
        ],
        activate: () => ({
            rawContributions: {[MENU_POINT]: {
                [OPEN]: {run: async () => "已打开"} satisfies MenuItemImplementation,
                [CLOSE]: {run: async () => "已关闭"} satisfies MenuItemImplementation,
            }},
        }),
    }),
]);
