/**
 * 插件页给内置插件显示的名称与说明。第三方插件的显示名与说明来自它的清单（package.json 的 displayName、description）；
 * 内置插件的描述符没有这两项，服务端的插件列表也不带界面语言，所以放在页面这一侧、按界面语言取。表里没有的 id 只显示 id：
 * 只在开发模式出现的 Lab 不进表，生产产物里不能有它的名字（`check:dist`）。
 */

import type {LocalizedText} from "nbook/shared/localized-text";

export interface BuiltinPluginName {
    readonly name: LocalizedText;
    readonly description: LocalizedText;
}

export const BUILTIN_PLUGIN_NAMES: Readonly<Record<string, BuiltinPluginName>> = {
    "nbook.commands": {name: {"zh-CN": "命令", "en-US": "Commands"}, description: {"zh-CN": "登记与执行命令；命令面板与快捷键执行的都是这里登记的命令。", "en-US": "Registers and runs commands; the command palette and keybindings run the commands registered here."}},
    "nbook.editor": {name: {"zh-CN": "编辑器", "en-US": "Editor"}, description: {"zh-CN": "编辑区的标签与分组、文档的打开与保存。", "en-US": "Editor tabs and groups; opening and saving documents."}},
    "nbook.explorer": {name: {"zh-CN": "资源管理器", "en-US": "Explorer"}, description: {"zh-CN": "侧栏里作品的文件树。", "en-US": "The file tree of your book in the sidebar."}},
    "nbook.files": {name: {"zh-CN": "文件", "en-US": "Files"}, description: {"zh-CN": "读写作品目录里的文件与文件夹。", "en-US": "Reads and writes files and folders in your book."}},
    "nbook.html-preview": {name: {"zh-CN": "HTML 预览", "en-US": "HTML Preview"}, description: {"zh-CN": "在沙箱里预览 HTML 文件。", "en-US": "Previews HTML files in a sandbox."}},
    "nbook.http": {name: {"zh-CN": "本机服务", "en-US": "Local Server"}, description: {"zh-CN": "提供页面与接口的本机 HTTP 服务。", "en-US": "The local HTTP server for pages and APIs."}},
    "nbook.image-viewer": {name: {"zh-CN": "图片查看器", "en-US": "Image Viewer"}, description: {"zh-CN": "查看作品里的图片。", "en-US": "Views images in your book."}},
    "nbook.markdown": {name: {"zh-CN": "Markdown", "en-US": "Markdown"}, description: {"zh-CN": "作品的 Markdown 写法：读写规则、编辑器扩展与显示。", "en-US": "Markdown for your book: reading and writing rules, editor extensions and rendering."}},
    "nbook.plugins": {name: {"zh-CN": "插件管理", "en-US": "Plugin Manager"}, description: {"zh-CN": "安装、启用、禁用与卸载插件。", "en-US": "Installs, enables, disables and uninstalls plugins."}},
    "nbook.projects": {name: {"zh-CN": "作品", "en-US": "Books"}, description: {"zh-CN": "书架、作品的新建与打开。", "en-US": "The bookshelf; creating and opening books."}},
    "nbook.settings": {name: {"zh-CN": "设置", "en-US": "Settings"}, description: {"zh-CN": "设置窗口与设置项的读写。", "en-US": "The settings window and setting values."}},
    "nbook.state": {name: {"zh-CN": "公开状态", "en-US": "Public State"}, description: {"zh-CN": "插件之间共享的界面状态。", "en-US": "UI state shared between plugins."}},
    "nbook.storage": {name: {"zh-CN": "存储", "en-US": "Storage"}, description: {"zh-CN": "插件的记录与偏好。", "en-US": "Records and preferences for plugins."}},
    "nbook.workbench": {name: {"zh-CN": "工作台", "en-US": "Workbench"}, description: {"zh-CN": "工作台的外壳：侧栏、面板、标题栏与状态栏。", "en-US": "The workbench shell: sidebars, panel, title bar and status bar."}},
    "runtime.diagnostics": {name: {"zh-CN": "诊断", "en-US": "Diagnostics"}, description: {"zh-CN": "运行日志与诊断记录。", "en-US": "Runtime logs and diagnostic records."}},
};
