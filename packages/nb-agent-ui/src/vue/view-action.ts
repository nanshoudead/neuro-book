/**
 * 视图内部流通的 action：宿主的 action，加上只在视图里处理的原图预览。内部组件只发这一种事件，`AgentConversationView`
 * 在一处分派：预览自己打开，其余交给宿主。预览是纯界面行为（docs/specs/ui/agent-conversation-view.md“消息”），
 * 不进公开的 `AgentViewAction`，宿主收不到。
 */
import type {PromptToken} from "../ports";
import type {AgentViewAction} from "../types";
import {promptTokenOutcome} from "../prompt-token-action";

/**
 * 原图预览的请求。附件按 `locator` 经 `services.resolveAttachmentUrl` 取原图；回复 Markdown 里的图片按地址经
 * `services.resolveMarkdownAsset` 取。
 */
export type PreviewImageRequest =
    | {locator: string; name: string}
    | {markdownSrc: string; name: string};

export type ViewAction = AgentViewAction | {type: "image.preview"; image: PreviewImageRequest};

/** 点击输入框或已发送消息里的标签：输入框与消息显示共用，两边的结果才一致。没有可做的事时为 null。 */
export function tokenAction(token: PromptToken, imageLabel: (number: number) => string): ViewAction | null {
    const outcome = promptTokenOutcome(token, imageLabel);
    if (outcome === null) return null;
    return outcome.kind === "action" ? outcome.action : {type: "image.preview", image: outcome.image};
}
