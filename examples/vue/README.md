# Vue adapter example

The same todo app as `examples/tanstack-router`, implemented with Vue and Vue Router.
It uses `oidc-spa/vue` for authentication, reactive user state, initialization, and
route protection.

## Run locally

Use Node.js 22.22+ and Yarn. From the repository root:

```sh
yarn start-vue-example
```

This builds the library, installs the example dependencies, copies the local build
into the example, and starts Vite and Express. Open **http://app.localhost:3000**.
Vite proxies `/api` to port 3001.

To run against the published library instead, start inside this directory:

```sh
yarn
yarn dev
```

Set `VITE_OIDC_PROVIDER=mock` in `.env` to explore as a signed-in admin without an
external identity provider. Logout and login reload the app with the mock login
state in the URL. Both API implementations use mock validation in this mode.

To use a real provider, choose `Keycloak`, `Keycloak2` (introspection), `Auth0`, or
`EntraID` and replace its placeholder settings in `.env`. Register
`http://app.localhost:3000/` as the redirect URI and allow the app's origin at your
provider. Restart development or rebuild after configuration changes. The browser
and API must use matching provider settings. `VITE_*` values are public and embedded
in the frontend; introspection secrets and KV credentials stay on the server.

## Pages

-   `/`: public introduction and integration guide.
-   `/todo-list-trpc`: personal todos using tRPC.
-   `/todo-list-api`: the same todos using fetch and Express handlers.
-   `/todo-list-admin`: todos grouped by user ID, with admin-only deletion.
-   `/account`: profile information and Keycloak account actions.
-   `/authentication-error`: public authentication failure screen.
-   `/inactivity-logout`: public message and a link to resume the previous page.

## The Vue adapter

`src/oidc.ts` defines the application user and runtime configuration through
`oidcSpa.withUser(...).withRuntimeConfigs(...).createUtils()`, matching the React
adapter's builder. It exports `useOidc`, `getOidc`, `OidcInitializationGate`,
and `enforceLogin`.

-   `App.vue` wraps the header and router view in `OidcInitializationGate`. Its default
    slot mounts after both the client and initial user are ready. A `#fallback` slot
    can display a loading indicator. Public pages remain available on initialization
    failure.
-   `useOidc()` returns the logged-in / logged-out union, including methods and
    `initializationError`. Use `useOidc({ assert: "user logged in" })` in protected
    components for narrowed types.
-   `user` and `autoLogoutState` are readonly shallow refs. Destructure them at the top
    level of `<script setup>` to use Vue's automatic template unwrapping; in TypeScript,
    read `.value`. Login state and methods are ordinary values, as in React.
    Destructure the discriminator and user together: `const { isUserLoggedIn, user } =
useOidc()`. Templates can then use `isUserLoggedIn && user.canSeeAdminNavigation`
    without optional checks. `AppHeader.vue` follows the React example, with separate
    logged-in and logged-out button components using the corresponding assertions.
-   `getOidc()` provides the asynchronous core API outside components. It can also be
    called from `createUser()` to fetch an access token while the user is being built.
-   `enforceLogin(to)` is called by the global navigation guard for routes with
    `meta.requiresAuth`. It accepts the destination route directly. Initialization failures throw
    `OidcInitializationError`; the guard catches that type and redirects to the public
    `/authentication-error` page, which reads `initializationError` through `useOidc()`.
    Unexpected errors propagate to Vue Router's error handling.
-   `fetchWithAuth()` attaches a current access token to REST requests.
    `src/trpc.ts` obtains tokens through the same `getOidc()` for its header callback.

`src/pages/authenticated/` contains the protected pages and their shared `Layout.vue`,
which displays the inactivity warning overlay. This folder is an organizational
convention; the route metadata and guard in `src/router.ts` enforce authentication.
Home, authentication errors, and inactivity logout remain public, and the folder adds no URL segment.

`TodoListApi.vue` and `TodoListTrpc.vue` each contain their own loading and submission
code, so you can read either integration independently. The REST page types its JSON
response as `TodoItem[]`; the tRPC pages use the server router's inferred output types
through `RouterOutputs`. Each page loads its data on mount and reloads after a mutation.

Automatic logout preserves the current URL for the public inactivity page; its resume
link accepts only same-origin destinations.

## Backend and storage

`server/` follows the TanStack Router example. Express and tRPC share
`getUser(req)` and todo storage. Each operation validates authentication; admin
procedures also enforce authorization on the server. Browser runtime protection
and DPoP are enabled by the oidc-spa Vite plugin.

Todos are stored in local `todos_*.json` files, or in Upstash Redis when
`KV_REST_API_URL` and `KV_REST_API_TOKEN` are configured. There is no SSR. If you
already have a backend, replace these example API calls with your own.

## Build and run

```sh
yarn typecheck
yarn build
yarn start
```

The build produces static assets in `dist/client` and a Node server in `dist/server`.
Express serves the SPA, deep links, and APIs on port 3000. `PORT` overrides the
production port; `API_PORT` overrides the development API port. Update Vite's proxy
if you change `API_PORT`.

For Vercel, use `examples/vue` as the project root. The included
`vercel.json` builds the library before installing the example dependencies,
sends `/api/*` to `api/index.ts`, and sends other paths to the SPA. Configure provider
variables before building, and use Redis for persistent todos rather than the
deployment's filesystem.
