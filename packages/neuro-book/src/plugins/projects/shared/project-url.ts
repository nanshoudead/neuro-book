/**
 * 打开某个项目的地址（docs/specs/runtime/projects.md 输出第 10 条）：短名写在地址栏，切换项目即整页加载。浏览器里的
 * “打开项目”、书架与开发模式的样例作品（服务端在日志里报告打开它的路径）都经这里，所以放在两端共用的 shared。
 */

export function projectUrl(name: string): string {
    return `/?project=${encodeURIComponent(name)}`;
}
