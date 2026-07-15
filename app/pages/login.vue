<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {AuthSessionDto, RememberedLoginDto} from "nbook/shared/dto/auth.dto";

definePageMeta({
    layout: false,
});

const route = useRoute();
const router = useRouter();
const themeHostRef = ref<HTMLElement | null>(null);
const username = ref("");
const password = ref("");
const busy = ref(false);
const errorMessage = ref("");
const novelIdeStore = useNovelIdeStore();
const {theme} = storeToRefs(novelIdeStore);
const {mountThemeHost} = useIdeTheme(theme);
const {t} = useI18n();

/**
 * 解析安全的登录后跳转地址。
 */
const resolveRedirect = (): string => {
    return typeof route.query.redirect === "string" && route.query.redirect.trim().startsWith("/") && !route.query.redirect.trim().startsWith("//")
        ? route.query.redirect
        : "/";
};

/**
 * 从本机服务恢复上次登录凭据。Tauri 使用随机 localhost 端口，不能依赖 localStorage。
 */
const restoreRememberedLogin = async (): Promise<void> => {
    try {
        const remembered = await $fetch<RememberedLoginDto>("/api/auth/remembered-login");
        username.value = remembered.username;
        password.value = remembered.password;
    } catch {
        username.value = "";
        password.value = "";
    }
};

/**
 * 登录成功后记住凭据。当前应用是本机桌面封装，优先换取可用性。
 */
const saveRememberedLogin = async (): Promise<void> => {
    await $fetch<RememberedLoginDto>("/api/auth/remembered-login", {
        method: "POST",
        body: {
            username: username.value,
            password: password.value,
        },
    });
};

/**
 * 登录成功后尽力记住凭据，保存失败不阻断登录。
 */
const saveRememberedLoginQuietly = async (): Promise<void> => {
    try {
        await saveRememberedLogin();
    } catch (error) {
        console.warn("保存本机登录凭据失败", error);
    }
};

/**
 * 本地兜底：开发环境同端口时仍兼容旧 localStorage 记录。
 */
const restoreLocalStorageLogin = (): void => {
    if (!import.meta.client || username.value || password.value) {
        return;
    }
    const raw = window.localStorage.getItem("auth:remembered-login");
    if (!raw) {
        return;
    }
    try {
        const remembered = JSON.parse(raw) as Partial<RememberedLoginDto>;
        username.value = typeof remembered.username === "string" ? remembered.username : "";
        password.value = typeof remembered.password === "string" ? remembered.password : "";
    } catch {
        window.localStorage.removeItem("auth:remembered-login");
    }
};

/**
 * 本地兜底：保留一份同端口 localStorage，方便普通浏览器开发模式。
 */
const saveLocalStorageLogin = (): void => {
    if (!import.meta.client) {
        return;
    }
    window.localStorage.setItem("auth:remembered-login", JSON.stringify({
        username: username.value,
        password: password.value,
    } satisfies RememberedLoginDto));
};

/**
 * 登录提交。
 */
const submit = async (): Promise<void> => {
    if (busy.value) {
        return;
    }

    busy.value = true;
    errorMessage.value = "";
    try {
        await $fetch<AuthSessionDto>("/api/auth/login", {
            method: "POST",
            body: {
                username: username.value,
                password: password.value,
            },
        });
        await saveRememberedLoginQuietly();
        saveLocalStorageLogin();
        await router.push(resolveRedirect());
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : t("auth.loginFailed");
    } finally {
        busy.value = false;
    }
};

onMounted(() => {
    mountThemeHost(themeHostRef.value);
    void (async () => {
        await restoreRememberedLogin();
        restoreLocalStorageLogin();
        try {
            const session = await $fetch<AuthSessionDto>("/api/auth/me");
            if (!session.authEnabled || session.user) {
                await router.replace(resolveRedirect());
            }
        } catch {
            // 路由守卫已经处理常规鉴权失败；这里仅兜底 auth disabled / 已登录场景。
        }
    })();
});
</script>

<template>
    <!-- 登录页外壳 -->
    <div ref="themeHostRef" class="auth-page min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
        <div class="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
            <div class="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 shadow-2xl">
                <div class="mb-6">
                    <div class="text-2xl font-semibold">{{ t("auth.loginTitle") }}</div>
                    <div class="mt-2 text-sm text-[var(--text-secondary)]">{{ t("auth.loginDescription") }}</div>
                </div>

                <form class="space-y-4" @submit.prevent="submit">
                    <label class="block">
                        <div class="mb-2 text-sm text-[var(--text-secondary)]">{{ t("auth.username") }}</div>
                        <FormInput v-model="username" autocomplete="username" :placeholder="t('auth.usernamePlaceholder')" />
                    </label>

                    <label class="block">
                        <div class="mb-2 text-sm text-[var(--text-secondary)]">{{ t("auth.password") }}</div>
                        <FormInput v-model="password" type="password" autocomplete="current-password" :placeholder="t('auth.passwordPlaceholder')" />
                    </label>

                    <div v-if="errorMessage" class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                        {{ errorMessage }}
                    </div>

                    <button
                        type="submit"
                        class="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[var(--accent-main)] px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="busy"
                    >
                        {{ busy ? t("auth.loggingIn") : t("auth.loginButton") }}
                    </button>

                    <p class="pt-1 text-center text-xs text-[var(--text-secondary)]">
                        {{ t("auth.testSiteHintBefore") }}
                        <a class="text-[var(--accent-text)] hover:underline" href="mailto:notnotype@qq.com">notnotype@qq.com</a>
                        {{ t("auth.testSiteHintAfter") }}
                    </p>
                </form>
            </div>
        </div>
    </div>
</template>
