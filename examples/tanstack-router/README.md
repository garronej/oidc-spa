# oidc-spa + TanStack Router

A minimal Vite SPA with TanStack Router, an Express REST API, and tRPC. Both APIs
share authentication and todo storage. Bootstrapped with the TanStack CLI:

```sh
npx @tanstack/cli create tanstack-router --router-only --build-tool vite --blank
```

## Run locally

Use Node.js 22.22+ and Yarn. From the repository root:

```sh
yarn
yarn start-tanstack-router-example
```

This uses the workspace build of oidc-spa. Open **http://app.localhost:3000**.
Vite serves the SPA and proxies `/api` to the Express server on port 3001.

In the tracked `.env`, choose `VITE_OIDC_PROVIDER`: `Keycloak`, `Keycloak2`
(introspection), `Auth0`, `EntraID`, or `mock`. Mock mode starts with a signed-in
admin without an identity provider.

Vite embeds `VITE_*` settings into the frontend. Restart development after changing
them; rebuild for production. `server/oidc.ts` reads its settings from `process.env`.
Local development and the Node production server load `.env`. Introspection secrets
and KV credentials have no `VITE_` prefix and stay on the server.

## Pages and integration

-   `/`: public introduction and integration guide.
-   `/todo-list-trpc`: personal todos using tRPC.
-   `/todo-list-api`: the same todos using fetch and Express handlers.
-   `/todo-list-admin`: todos grouped by user ID, with admin-only deletion through tRPC.
-   `/account`: profile information and Keycloak account actions.
-   `/inactivity-logout`: public message with a link to resume the previous page.

`vite.config.ts` configures file-based routing and oidc-spa's Vite plugin. The plugin
runs early initialization before application code, enables browser runtime
protection and DPoP, and skips loading the app in the auth-response iframe when
appropriate. Public pages render while OIDC initializes. The header waits for
`isOidcReady` before showing authentication controls.

`src/oidc.ts` uses `oidc-spa/react`, maps token claims to `User_client`, and
configures the browser client. `src/routes/_authenticated/route.tsx` protects its
children with one `beforeLoad: enforceLogin`. The pathless route leaves URLs
unchanged. `src/main.tsx` mounts `AutoLogoutWarningOverlay` alongside the router so
it can display warnings on every page.

`autoLogout_returnToUrl` uses `router.buildLocation()` to build a typed path and
search parameters for the inactivity page. Its resume link returns to the saved
URL, whose route guard requires login again.

`server/oidc.ts` independently configures access-token validation and exposes
`getUser(req)`. Both the REST handlers in `server/app.ts` and tRPC procedures in
`server/trpc.ts` authenticate requests. Admin procedures additionally enforce the
admin role. `src/trpc.ts` attaches tokens through the tRPC client's header callback;
the REST page uses `fetchWithAuth()` exported from `src/oidc.ts`. oidc-spa handles DPoP
without changing either request implementation.

The tRPC context carries the Express request; each procedure calls `getUser()` where
it needs authentication. Batched procedures share that request, allowing oidc-spa to
reuse its validation of the request's DPoP proof.

`server/data/todos` is copied from the TanStack Start example. It uses local JSON
files or Upstash Redis when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are configured.
The REST page types its response as `TodoItem[]`; tRPC infers its types from the server router.

There is no SSR or TanStack Start server runtime. If you already have a backend,
keep the SPA and replace the example API calls with requests to that backend.

## Build and run

```sh
yarn typecheck
yarn build
yarn start
```

The build produces static files in `dist/client` and a Node server in `dist/server`.
Express serves both the SPA, including deep links, and the APIs on port 3000. `PORT`
overrides the production port; `API_PORT` overrides the development API port. Update
the Vite proxy if you change `API_PORT`.

The production routing and browser cache policy are:

| Request                               | Response                       | Cache-Control                         |
| ------------------------------------- | ------------------------------ | ------------------------------------- |
| `/api` and `/api/*`, all HTTP methods | Express REST or tRPC handler   | `no-store`                            |
| `/assets/*`, GET/HEAD                 | File from `dist/client/assets` | `public, max-age=31536000, immutable` |
| Other existing static files, GET/HEAD | File from `dist/client`        | `no-cache`                            |
| Other page paths, GET/HEAD            | `dist/client/index.html`       | `no-cache`                            |

Vite gives generated assets content hashes in their filenames, so they can be cached
for a year: a changed file gets a new URL. `no-cache` allows storage but requires
revalidation before reuse. Missing files under `/assets/*` return 404 instead of
the SPA HTML. `/assets` is the namespace chosen for build assets; it can be changed
with Vite's `build.assetsDir` if it conflicts with your page URLs (update the server
and hosting rules too).

On a VM or in a container, run `npm start` as a persistent Node process and put a
reverse proxy in front of its `PORT`. You can proxy everything to Express, which
implements the table above, or serve `dist/client` through your web server/CDN and
proxy only `/api` and `/api/*` to Node. Proxy API requests internally, preserving
their method, body, original path, host and protocol; do not send a browser redirect.
The server build leaves npm dependencies external, so the Node deployment also needs
the production dependencies from `package.json`, plus its environment variables.

## Deploy on Vercel

1. Set the project root to `examples/tanstack-router`.
2. Configure the provider variables in Vercel before building. Register the deployed
   origin and redirect URL with your provider. Public settings are embedded at build
   time, so the frontend and backend must use matching provider settings.
3. Set `KV_REST_API_URL` and `KV_REST_API_TOKEN` for persistent todos; the deployed
   API cannot use local filesystem storage.
4. Deploy using the included `vercel.json`. Static files come from `dist/client`,
   `/api/*` requests go to the Express app exported by `api/index.ts`, and other
   paths fall back to `index.html` for client routing.

Vercel uses two deployment conventions here:

-   `outputDirectory: "dist/client"` publishes that directory as static files on the
    CDN. `framework: "vite"` selects Vite build defaults; `buildCommand` explicitly
    runs this project's build script.
-   The source file `api/index.ts` is automatically compiled and packaged as a Node
    function at `/api`. It exports the same Express app as the local server, without
    calling `app.listen()`. Vercel invokes that app for API requests; it does not run
    `npm start` or use `dist/server/index.mjs`.

The first rewrite dispatches `/api/*` to that function. The Express app receives
the original request path (for example `/api/todos`) and handles all API methods,
including POST. Existing static files take precedence over rewrites. The second
rewrite serves `index.html` for page URLs, excluding the API and asset namespaces.
The `headers` rules implement the cache policy in the table above. Static files
can still be cached in Vercel's CDN even when browsers must revalidate the HTML.

The function is compiled separately from the esbuild server bundle. Its relative
server imports therefore include `.js` extensions and explicit `/index.js` paths,
as required by Node's ESM loader. TypeScript resolves these to the corresponding
`.ts` source files during compilation. Extensionless imports can work in Vite,
tsx and esbuild while failing in the deployed function with `ERR_MODULE_NOT_FOUND`.

See Vercel's [Vite deployment guide](https://vercel.com/docs/frameworks/frontend/vite),
[Node function conventions](https://vercel.com/docs/functions/runtimes/node-js), and
[project configuration reference](https://vercel.com/docs/project-configuration/vercel-json).
