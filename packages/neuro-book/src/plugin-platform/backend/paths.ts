/**
 * 路径判断，安装与构建预设共用（只在 Node 与 Bun 里用，所以不放 shared）。
 */

import {isAbsolute, relative, sep} from "node:path";

/**
 * `inner` 等于 `outer` 或在它里面。两者都要是同一种写法（都取过真实路径，或都是解析过的绝对路径）。只认 `..` 本身或以
 * `..` 加分隔符开头的相对路径为“在外面”：名为 `..foo` 的子目录在里面。
 */
export function isInside(inner: string, outer: string): boolean {
    const path = relative(outer, inner);
    return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
