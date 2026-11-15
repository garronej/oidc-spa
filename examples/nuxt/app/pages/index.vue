<script setup lang="ts">
const sourceUrl = "https://github.com/keycloakify/oidc-spa/tree/main/examples/nuxt";
</script>

<template>
    <article class="home-guide">
        <h1>oidc-spa + Nuxt</h1>
        <p>
            The same todo application as the other oidc-spa examples, built with Nuxt. Nuxt serves the
            pages and API. The API validates access tokens and stores todos for each user.
        </p>
        <p class="guide-note">
            Authentication uses <code>oidc-spa/vue</code> directly. SSR stays enabled, with
            <code>OidcInitializationGate</code> at the root of the application.
        </p>
        <div class="example-links">
            <NuxtLink to="/todo-list">
                <strong>Todo List</strong>
                <span>Your personal todos through Nuxt API handlers.</span>
            </NuxtLink>
        </div>
        <p>
            The <NuxtLink to="/todo-list-admin">admin page</NuxtLink> groups todos by user and lets
            admins delete items. The <NuxtLink to="/account">account page</NuxtLink>
            shows your profile and Keycloak account actions when available.
        </p>
        <section aria-labelledby="integration-heading">
            <h2 id="integration-heading">How the integration is set up</h2>
            <ol>
                <li>
                    <h3>Initialize authentication before mounting the application</h3>
                    <p>
                        <code>nuxt.config.ts</code> registers <code>oidc-spa/nuxt-module</code>, which
                        installs the Vite plugin with DPoP and browser runtime protection enabled. It
                        processes authentication callbacks before Nuxt starts.
                        <code>app/app.vue</code> wraps the header, layouts, and pages in
                        <code>OidcInitializationGate</code>. The server renders the loading fallback, and
                        the browser mounts the application after authentication initialization finishes.
                    </p>
                </li>
                <li>
                    <h3>Define your user and provider configuration</h3>
                    <p>
                        <code>app/oidc.ts</code> uses the same builder as the Vue and React examples.
                        Components destructure <code>useOidc()</code>; Vue templates unwrap the readonly
                        user and inactivity refs. Configuration comes from Nuxt's public runtime config.
                        Mock mode works without an identity provider.
                    </p>
                    <pre><code>const { user } = useOidc({ assert: "user logged in" });</code></pre>
                </li>
                <li>
                    <h3>Protect pages with route middleware</h3>
                    <p>
                        Pages in <code>app/pages/(authenticated)/</code> declare
                        <code>requiresAuth: true</code>. The route group adds no URL segment.
                        <code>app/middleware/auth.global.ts</code> calls <code>enforceLogin()</code>
                        with the router's fully resolved destination. Initialization failures redirect to
                        a public error page. On the server, the middleware lets the root gate render its
                        fallback.
                    </p>
                </li>
                <li>
                    <h3>Read and mutate data through Nuxt's backend</h3>
                    <p>
                        <code>server/api/todos.get.ts</code> and <code>todos.post.ts</code> implement the
                        REST API. The page uses <code>useFetch()</code> and authenticated
                        <code>$fetch()</code> requests. Admin endpoints live under
                        <code>server/api/admin/</code>. Every request is authenticated with
                        <code>oidc-spa/server</code>, and admin operations also check authorization on
                        the server.
                    </p>
                </li>
                <li>
                    <h3>Resume after inactivity logout</h3>
                    <p>
                        The authenticated layout displays inactivity warnings. Automatic logout returns
                        to the public inactivity page, which offers a same-origin link back to the
                        previous page. The route middleware handles sign-in when needed.
                    </p>
                </li>
            </ol>
        </section>
        <footer class="guide-links">
            <a href="https://docs.oidc-spa.dev/">oidc-spa documentation ↗</a>
            <a :href="sourceUrl">Browse the example source ↗</a>
        </footer>
    </article>
</template>
