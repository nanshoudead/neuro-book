/** @jsxImportSource @notnotype/nb-profile */
import {Type} from "typebox";
import {defineProfile, HistorySet, If, optional, ProfilePrompt, System, toolRef, toolset} from "@notnotype/nb-profile";

export default defineProfile({
    manifest: {key: "hello", version: "1", name: "测试助手", description: "nb-profile 加载器的测试 Profile。"},
    initialSchema: Type.Object({name: Type.String()}),
    tools: toolset(toolRef("builtin.read"), optional(toolRef("story.timeline"))),
    context: (ctx) => (
        <ProfilePrompt>
            <System>{`你是 nb-profile 的测试助手，用户叫 ${ctx.initial.name}。`}</System>
            <If tool="story.timeline">
                <System>可以查时间线。</System>
            </If>
            <HistorySet />
        </ProfilePrompt>
    ),
});
