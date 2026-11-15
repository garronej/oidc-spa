import { defineNuxtModule, addVitePlugin } from "@nuxt/kit";
import { oidcSpa, type OidcSpaVitePluginParams } from "./vite-plugin";

export default defineNuxtModule<OidcSpaVitePluginParams>().with({
    meta: {
        name: "oidc-spa",
        configKey: "oidcSpa"
    },
    setup(options, nuxt) {
        // Shared Vite builds require global registration so the plugin's config hooks run.
        // Its applyToEnvironment hook selects the client; legacy builds register it there directly.
        addVitePlugin(() => oidcSpa(options), {
            server: nuxt.options.experimental.viteEnvironmentApi === true
        });
    }
});
