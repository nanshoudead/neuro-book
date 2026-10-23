/**
 * 第三方插件入口代码装载失败的原因（docs/specs/runtime/plugin-code-loading.md 的“失败与恢复”）：浏览器与服务端的装载器共用。
 * 都在入口的 `activate` 里抛出，由内核按入口激活失败处理，只影响这个入口；消息带码、插件 id、入口 id 与文件位置，设置窗口与
 * 诊断原样显示它。
 *
 * - `code-load-failed`：取不到代码（文件不存在、服务端不可达、超时没有登记）；
 * - `code-shape`：代码执行了，但形状不对（没有登记工厂、没有导出 `activate`）；
 * - `code-threw`：代码执行时抛出（语法错误、模块顶层抛错）；
 * - `module-not-shared`：引用了宿主模块表之外的模块。
 */

export type PluginCodeFailure = "code-load-failed" | "code-shape" | "code-threw" | "module-not-shared";

export class PluginCodeError extends Error {
    readonly code: PluginCodeFailure;
    readonly plugin: string;
    readonly entry: string;
    /** 浏览器里是文件 URL，服务端是安装目录里的相对路径。 */
    readonly url: string;

    constructor(code: PluginCodeFailure, input: {readonly plugin: string; readonly entry: string; readonly url: string; readonly detail: string}) {
        super(`${code}：插件 ${input.plugin} 的入口 ${input.entry}（${input.url}）${input.detail}`);
        this.name = "PluginCodeError";
        this.code = code;
        this.plugin = input.plugin;
        this.entry = input.entry;
        this.url = input.url;
    }
}
