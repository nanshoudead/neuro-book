/** @jsxImportSource @notnotype/nb-profile */
/**
 * `nbstory config test` 用的 Profile：没有工具，只要模型回一句话。走的路径与问答相同（同一个 harness、同一份模型
 * 配置），所以请求里的推理档、认证与问答一致。
 */

import {defineProfile, HistorySet, ProfilePrompt, System, toolset} from "@notnotype/nb-profile";
import {Type} from "typebox";

export default defineProfile({
    manifest: {key: "story-qa-probe", version: "1", name: "问答连通性检查", description: "检查问答配置能不能让模型回话。"},
    initialSchema: Type.Object({}),
    tools: toolset(),
    context: () => (
        <ProfilePrompt>
            <System>{"这是一次连通性检查。只回复“好”这一个字。"}</System>
            <HistorySet />
        </ProfilePrompt>
    ),
});
