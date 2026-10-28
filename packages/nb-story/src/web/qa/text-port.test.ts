/** 问答页的翻译端口（`text-port.ts`）：对话视图里 nb-agent-ui 与 nb-markdown 的文字都翻得出来，中文。 */

import {describe, expect, it} from "bun:test";

import {NB_AGENT_UI_NAMESPACE} from "@notnotype/nb-agent-ui/locales";
import {markdownRef} from "@notnotype/nb-markdown/locales";
import {textRef} from "@notnotype/nb-ui/text";

import {storyTextPort} from "./text-port";

describe("问答页的翻译端口", () => {
    it("nb-markdown 的输入框文字与 nb-agent-ui 的文字都是中文，不是键名", () => {
        const port = storyTextPort();
        expect(port.locale.value).toBe("zh-CN");
        expect(port.t(markdownRef("prompt.historyTitle"))).toBe("输入历史");
        expect(port.t(markdownRef("chip.skill", {name: "reviewer"}))).toBe("技能：reviewer");
        expect(port.t(textRef("composer.send", undefined, NB_AGENT_UI_NAMESPACE))).toBe("发送");
    });
});
