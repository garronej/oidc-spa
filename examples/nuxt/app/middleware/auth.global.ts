import { enforceLogin } from "../oidc";

export default defineNuxtRouteMiddleware(async to => {
    // Nuxt also runs route middleware during SSR, before the root gate mounts.
    if (import.meta.server) {
        return;
    }

    if (!to.meta.requiresAuth) {
        return;
    }

    try {
        await enforceLogin(to);
    } catch {
        return navigateTo("/authentication-error");
    }
});
