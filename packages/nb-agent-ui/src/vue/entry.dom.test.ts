/** 渲染层入口的 smoke：按包名导入，挂对话视图，看它用对了语言。 */

import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";

import {createAgentContext, createAgentViewRegistry} from "@notnotype/nb-agent-ui";
import {AgentConversationView, builtinContributions} from "@notnotype/nb-agent-ui/vue";

describe("渲染层入口", () => {
    it("从包名导入：最小宿主挂上对话视图，界面文字跟着 locale", () => {
        const view = mount(AgentConversationView, {
            props: {ctx: createAgentContext(), services: {}, registry: createAgentViewRegistry([...builtinContributions]), locale: "en-US"},
        });
        expect(view.text()).toContain("No messages yet");
        view.unmount();
    });
});
