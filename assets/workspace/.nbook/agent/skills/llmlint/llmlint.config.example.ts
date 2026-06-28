import type {LlmlintConfig} from "./src/types.ts";

export default {
    presets: ["anti-ai-slop"],
    rules: {
        "filler-word-actually": "warn",
        "firstly-secondly": "error",
        "filler-lets": "off",
    },
    files: ["manuscript/**/*.md"],
    ignores: [],
    output: "stylish",
} satisfies LlmlintConfig;
