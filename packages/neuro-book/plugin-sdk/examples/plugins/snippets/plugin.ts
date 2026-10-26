/**
 * 插件描述（读法见 `../clock/plugin.ts`）。snippets 只在浏览器窗口里有入口：它不存数据，配置项的读写全交给
 * `nbook.settings`。
 *
 * 和别的示例不同，这份描述多了 `contributions`：配置项是**顶层声明**，没有实现，宿主把它登记进每个运行实例（服务端、
 * 项目实例、窗口），不论这个插件在那个位置有没有入口（docs/specs/runtime/plugin-manifest.md 输出第 11 条、
 * docs/specs/settings/configuration.md 输出第 3 条）。只在窗口里登记会怎样：服务端与项目实例是配置文件的拥有者，它们
 * 不认识这一项，文件里的 `example.snippets/items` 会被当成未声明的键丢掉，写入也被拒为 `undeclared`。
 *
 * 对应的场景：`scenarios/06-settings-page.test.ts`。
 */

import {itemsSetting, plugin} from "./shared/contracts";

/** 常用片段：写作时常插入的几段固定文字，用户设置里一份，每部作品可以另备一份。 */
export const descriptor = plugin.descriptor([itemsSetting]);
