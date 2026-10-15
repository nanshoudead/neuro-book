/**
 * 预览控件拿令牌的接口（docs/specs/workbench/html-preview.md 输出 2）：插件把远程服务 `nbook.files.preview` 与窗口绑定的项目
 * 包成这一层交给控件，控件不认识远程服务与项目。
 */

export type PreviewGrant = {readonly ok: true; readonly token: string; readonly base: string} | {readonly ok: false; readonly reason: string};

export interface PreviewAccess {
    /** 为窗口绑定的这部作品签一个令牌；`base` 带应用源、以 `/` 结尾。 */
    open(): Promise<PreviewGrant>;
    /** 作废自己签的令牌；失败（断线）只记诊断，门面释放时服务端照样作废。 */
    close(token: string): void;
}
