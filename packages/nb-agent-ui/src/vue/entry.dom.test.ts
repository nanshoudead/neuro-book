/**
 * 渲染层入口的 smoke：按包名导入，照 README“挂载”一节的最小宿主原样写一遍，让那段示例过类型检查并真的跑起来。
 * 改 README 的示例时一起改这里。
 */

import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {defineComponent, h, shallowRef, watchEffect, type PropType} from "vue";

import {acceptSubmission, applyComposerAction, createAgentContext, createAgentViewRegistry, type AgentLocale, type AgentViewAction} from "@notnotype/nb-agent-ui";
import {AgentConversationView, builtinContributions} from "@notnotype/nb-agent-ui/vue";

const MinimalHost = defineComponent({
    props: {locale: {type: String as PropType<AgentLocale>, required: true}, send: {type: Function as PropType<(text: string) => void>, required: true}},
    setup(props, {expose}) {
        const ctx = shallowRef(createAgentContext({interaction: {canSend: true, canStop: true}}));
        const registry = createAgentViewRegistry([...builtinContributions]);

        function handle(action: AgentViewAction) {
            const composer = applyComposerAction(ctx.value.composer, action);
            if (composer !== null) {
                ctx.value = {...ctx.value, composer};
                return;
            }
            if (action.type === "composer.submit") {
                props.send(action.text);
                ctx.value = {...ctx.value, composer: acceptSubmission(ctx.value.composer, action.text)};
            }
        }

        watchEffect((onCleanup) => {
            if (ctx.value.run.status === "idle") return;
            const timer = setInterval(() => (ctx.value = {...ctx.value, now: Date.now()}), 1000);
            onCleanup(() => clearInterval(timer));
        });

        expose({ctx, handle});
        return () => h(AgentConversationView, {ctx: ctx.value, services: {}, registry, locale: props.locale, onAction: handle});
    },
});

describe("渲染层入口", () => {
    it("README 的最小宿主：界面文字跟着 locale；草稿回声写回，发送后草稿清空并记进输入历史", () => {
        const sent: string[] = [];
        const host = mount(MinimalHost, {props: {locale: "en-US", send: (text: string) => sent.push(text)}});
        expect(host.text()).toContain("No messages yet");
        const view = host.getComponent(AgentConversationView);
        view.vm.$emit("action", {type: "composer.draftChanged", text: "继续写"});
        view.vm.$emit("action", {type: "composer.submit", text: "继续写", delivery: "prompt"});
        expect(sent).toEqual(["继续写"]);
        // expose 出去的 ref 在 vm 上已解包。
        const {ctx} = host.vm as unknown as {ctx: ReturnType<typeof createAgentContext>};
        expect(ctx.composer.draft).toEqual({text: "", version: 1});
        expect(ctx.composer.recall).toEqual(["继续写"]);
        host.unmount();
    });
});
