/** 渲染层入口的 smoke：按包名导入，挂一个注入了语言的零件，看它用对了语言。 */

import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {defineComponent, h} from "vue";

import {AgentDeliveryNotice, provideAgentView} from "@notnotype/nb-agent-ui/vue";

describe("渲染层入口", () => {
    it("从包名导入：provideAgentView 交出的语言传到零件上", () => {
        const Host = defineComponent({
            setup() {
                provideAgentView({locale: () => "en-US"});
                return () => h(AgentDeliveryNotice);
            },
        });
        expect(mount(Host).text()).toContain("Send again");
    });
});
