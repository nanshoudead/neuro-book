/**
 * `example.menu` 的服务端入口：定义贡献点 `menu.items`、接收贡献，对外提供菜单服务。读这个文件学贡献点的三个环节：
 *
 * 1. **校验**：贡献点的规则写成数据（`schema` 与 `idPrefix`），插件一登记、还没激活就能判断；不合格的只拒绝这一条，
 *    同一插件的其它贡献照常（docs/specs/runtime/plugins.md 输出第 15、23 条）。规则写成数据而不是函数：本插件要装成
 *    第三方插件，清单里放不下函数，宿主登记时也没有插件代码可调（docs/specs/runtime/plugin-manifest.md 的贡献点条目）。
 *    跨条目的规则（例如“同一插件至多十项”）schema 写不出来，放在接收者里。
 * 2. **接收**（`receivers`）：拥有者入口激活时交出接收者。贡献方发布后内核逐条通知它（`published`），此时实现可用；
 *    贡献方或拥有者停止时撤回（`revoke`），每条交付恰好撤回一次（同文输出第 16、17、24 条）。接收者只维护自己的表，
 *    不用关心谁先激活：拥有者晚到时，内核把已经发布的贡献补交给它。
 * 3. **查询声明**（`context.declarations`）：此刻已接受的全部声明，贡献方还没激活也查得到（同文输出第 23 条）。
 *
 * 贡献方与拥有者之间没有服务依赖：menu 缺席时贡献只是等着接收者，不使贡献方受阻或失败（同文输出第 18 条）。
 * `nbook.commands` 的命令、`nbook.state` 的公开键都是这样接入的。
 *
 * 对应的场景：`scenarios/03-contribution-point.test.ts`。
 */

import {defineEntry, diagnosticsKey, provide} from "@notnotype/nb-plugin-sdk";
import type {ContributionHandle, ContributionReceiver, PluginDefinition} from "@notnotype/nb-plugin-sdk";
import {Type} from "typebox";

import {descriptor} from "../plugin";
import {MENU_POINT, menuKey} from "../shared/contracts";
import type {MenuItemDeclaration, MenuItemImplementation, MenuService} from "../shared/contracts";

type MenuHandle = ContributionHandle<MenuItemDeclaration, MenuItemImplementation>;

/**
 * 菜单项声明的结构：标题至少有一个非空白字符，不许多余字段。只能用纯 JSON Schema（不能用 TypeBox 的 `Refine`），
 * 它要写进清单。
 */
const MenuItemSchema = Type.Object({title: Type.String({pattern: "\\S"})}, {additionalProperties: false});

export const menuBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    // 贡献点写在插件顶层：插件一登记，它就存在，别的插件的声明就按它的规则校验。`implementation: "required"` 表示
    // 贡献要写在入口下并在激活时给出实现；`none` 表示只有声明（例如纯配置）。
    // `idPrefix: "plugin"`：贡献 id 要以贡献方的插件 id 加“.”开头，两个插件就不会撞同一个 id。
    contributionPoints: [{id: MENU_POINT, implementation: "required", schema: MenuItemSchema, idPrefix: "plugin"}],
    entries: [
        defineEntry({
            id: "server",
            location: "server",
            provides: [menuKey],
            // 启动即激活。贡献方发布菜单项不会激活本入口（贡献不构成依赖）：不写这一行时，只有依赖 `menuKey` 的插件
            // 激活才带起本入口，没人依赖就一直不激活，菜单项一直等着接收者。
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}],
            // 本入口接收自己插件定义的贡献点；激活产出的 `receivers` 必须恰好对应这里。
            receives: [MENU_POINT],
            activate: (context) => {
                const diagnostics = context.services.require(diagnosticsKey);
                const items = new Map<string, MenuHandle>();
                const receiver: ContributionReceiver<MenuItemDeclaration, MenuItemImplementation> = {
                    // 贡献方发布之后才放进表：在这之前它的激活还可能失败撤回，实现也还取不到。记一条诊断：装成外部插件之后，
                    // 服务端日志里能看到菜单收到了哪一项。
                    published: (handle) => {
                        items.set(handle.id, handle);
                        diagnostics.record({
                            level: "info",
                            event: "example.menu.item-received",
                            message: `菜单收到 ${handle.id}`,
                            data: {item: handle.id, plugin: handle.plugin},
                            source: {plugin: descriptor.id, entry: "server"},
                        });
                    },
                    // 只删自己放进去的那一个：同一个 id 的新一代可能已经放进来了，不能把它误删。
                    revoke: (handle) => {
                        if (items.get(handle.id) === handle) items.delete(handle.id);
                    },
                };
                const menu: MenuService = {
                    items: async () => [...items.values()].map((handle) => ({id: handle.id, title: handle.declaration.title})),
                    titles: async () => context.declarations.list<MenuItemDeclaration>(MENU_POINT).map((item) => ({id: item.id, title: item.declaration.title, plugin: item.plugin})),
                    run: async (id) => {
                        const handle = items.get(id);
                        if (handle === undefined) return {ok: false, code: "unknown-item"};
                        // 每次执行都经 `implementation()` 取实现，不在 `published` 里存下来：撤回之后它会抛错，就不会调到
                        // 已经停止的贡献方的旧实现。
                        return {ok: true, value: await handle.implementation().run()};
                    },
                };
                return {services: [provide(menuKey, menu)], receivers: {[MENU_POINT]: receiver}};
            },
        }),
    ],
};
