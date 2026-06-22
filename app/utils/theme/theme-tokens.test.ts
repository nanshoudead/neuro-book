import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {clearThemeVars, applyThemeVars} from "nbook/app/utils/theme/apply-theme";
import {themeTokens, themeVarKeys, type IdeTheme} from "nbook/app/utils/theme/theme-tokens";

const fallbackCssPath = fileURLToPath(new URL("../../styles/theme-vars.css", import.meta.url));

const semanticStatusKeys = [
    "--status-info",
    "--status-info-bg",
    "--status-info-border",
    "--status-success",
    "--status-success-bg",
    "--status-success-border",
    "--status-warning",
    "--status-warning-bg",
    "--status-warning-border",
    "--status-danger",
    "--status-danger-bg",
    "--status-danger-border",
] as const;

describe("theme semantic status tokens", () => {
    it("keeps complete semantic status tokens for every IDE theme", () => {
        for (const [theme, vars] of Object.entries(themeTokens) as Array<[IdeTheme, typeof themeTokens[IdeTheme]]>) {
            for (const key of semanticStatusKeys) {
                expect(vars[key], `${theme} should define ${key}`).toBeTruthy();
            }
        }
    });

    it("includes semantic status tokens in applied and cleared theme keys", () => {
        for (const key of semanticStatusKeys) {
            expect(themeVarKeys).toContain(key);
        }

        const styleValues = new Map<string, string>();
        const host = {
            style: {
                getPropertyValue: (key: string): string => styleValues.get(key) ?? "",
                removeProperty: (key: string): string => {
                    const previousValue = styleValues.get(key) ?? "";
                    styleValues.delete(key);
                    return previousValue;
                },
                setProperty: (key: string, value: string): void => {
                    styleValues.set(key, value);
                },
            },
        } as HTMLElement;
        applyThemeVars(host, themeTokens.sepia);
        expect(host.style.getPropertyValue("--status-warning")).toBe(themeTokens.sepia["--status-warning"]);

        clearThemeVars(host);
        expect(host.style.getPropertyValue("--status-warning")).toBe("");
    });

    it("keeps SSR fallback aligned with sepia semantic status tokens", async () => {
        const css = await readFile(fallbackCssPath, "utf8");
        for (const key of semanticStatusKeys) {
            expect(css).toContain(`${key}: ${themeTokens.sepia[key]};`);
        }
    });
});
