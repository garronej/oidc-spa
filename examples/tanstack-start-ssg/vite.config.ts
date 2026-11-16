import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { oidcSpa } from "oidc-spa/vite-plugin";

export default defineConfig(({ command }) => ({
    server: {
        port: 3000,
        strictPort: true,
        // Auth0: We use https://app.localhost instead of the default
        // http://localhost to avoid having to grant consent on every reload.
        host: "app.localhost"
    },
    // Start uses Vite preview to generate the HTML during the build.
    preview: {
        host: "127.0.0.1"
    },
    resolve: {
        tsconfigPaths: true
    },
    plugins: [
        tanstackStart({
            srcDirectory: "src",
            spa: {
                // Render public pages on demand in development; emit a static shell for builds.
                enabled: command === "build",
                // A distinct build request avoids deduplicating the shell with the home.
                // It still matches the root route; Start's shell header omits page content.
                maskPath: "/?__spa_shell"
            },
            prerender: {
                enabled: true,
                autoStaticPathsDiscovery: false,
                crawlLinks: false,
                failOnError: true
            },
            pages: [{ path: "/" }, { path: "/inactivity-logout" }]
        }),
        viteReact(),
        nitro({
            vercel: {
                config: {
                    version: 3,
                    routes: [
                        // Keep the callback URL intact for oidcEarlyInit, but serve the shell
                        // instead of the home page's prerendered HTML.
                        {
                            src: "^/$",
                            // @ts-expect-error: Nitro's route types omit `has`, which is supported by Vercel's Build Output API.
                            has: [{ type: "query", key: "state" }],
                            dest: "/_shell.html"
                        },
                        { src: "^/(?:api|_serverFn)(?:/.*)?$", dest: "/__server" },
                        { src: "^/__server(?:/.*)?$", status: 404 },
                        {
                            src: "^/(?:assets|_vercel/immutable)/.*$",
                            headers: { "Cache-Control": "public, max-age=31536000, immutable" },
                            continue: true
                        },
                        { handle: "filesystem" },
                        { src: "^/(?:assets|_vercel/immutable)/.*$", status: 404 },
                        // Every remaining document request uses the static SPA shell.
                        // This terminal rule also prevents Nitro's SSR fallback from running.
                        { src: "^/.*$", dest: "/_shell.html" }
                    ]
                }
            }
        }),
        oidcSpa({
            browserRuntimeFreeze: {
                enabled: true
                //excludes: [ "fetch", "XMLHttpRequest"]
            },
            DPoP: {
                enabled: true,
                mode: "auto"
            }
        })
    ]
}));
