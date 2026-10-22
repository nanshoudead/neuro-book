/**
 * 原图预览的请求，由消息里的图片发出，经轮次、过程块与原始视图转给 `AgentConversationView` 打开预览。
 * 附件按 `locator` 经 `services.resolveAttachmentUrl` 取原图；回复 Markdown 里的图片按地址经
 * `services.resolveMarkdownAsset` 取。
 */
export type PreviewImageRequest =
    | {locator: string; name: string}
    | {markdownSrc: string; name: string};
