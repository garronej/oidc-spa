# TanStack Start: static frontend and live APIs

The same todo app as `examples/tanstack-start`, with all production frontend HTML served
by Vercel's CDN. React renders only during the build. The deployed JavaScript function
handles API routes and server functions, including oidc-spa's runtime configuration endpoint.

| URL                                                                            | Production response                |
| ------------------------------------------------------------------------------ | ---------------------------------- |
| `/`                                                                            | Prerendered home page              |
| `/inactivity-logout`                                                           | Prerendered inactivity logout page |
| `/?code=…&state=…` or `/?error=…&state=…`                                      | Static SPA shell                   |
| `/account`, `/todo-list-api`, `/todo-list-server-function`, `/todo-list-admin` | Static SPA shell                   |
| `/api/*`, `/_serverFn/*`                                                       | Live backend function              |
| Existing assets                                                                | Static files                       |

Protected pages initialize authentication and render in the browser. Both todo implementations
use the same per-user store, and backend middleware independently validates tokens and permissions.

## How the static deployment works

`vite.config.ts` enables Start's SPA mode and explicitly prerenders `/` and
`/inactivity-logout`. Automatic route discovery and link crawling are disabled so protected
pages are not prerendered. The build produces three HTML files:

-   `index.html`
-   `inactivity-logout/index.html`
-   `_shell.html`

The shell is generated using a separate build request, `/?__spa_shell`, with Start's shell
header. The distinct URL prevents Start's prerender queue from deduplicating it with `/`.
The query is only for generating the shell; visitors do not navigate to it.

The Vercel rules in `vite.config.ts` run before Nitro's default routing:

1. Requests to `/` containing `state` receive `_shell.html`, preserving the browser URL
   and all authentication parameters. This covers successful and failed authorization responses.
2. API routes and server functions reach Nitro's backend function.
3. Existing frontend files are served from the CDN, including the two prerendered pages.
4. Other page URLs receive `_shell.html`.

This ordering matters: after login, `oidcEarlyInit` restores the destination URL before
Start initializes. The callback must receive the route-independent shell rather than the
home page's HTML. The shell uses Start's normal pending rendering; it contains no home-page content.

`src/server.ts` allows document rendering in development and in Start's build-time prerender
process (`TSS_PRERENDERING`). In production it rejects document requests, and its render
callback returns 404 even if an unknown API request falls through to it. Request headers
cannot enable React rendering. Do not set `TSS_PRERENDERING` in deployment environment variables.

The inactivity page's resume link uses `ClientOnly` because `return_url` belongs to the
visitor's URL, not the build-time page. The initial static fallback is a link to home.

## Development

From the repository root:

```sh
yarn start-tanstack-start-ssg-example
```

This builds oidc-spa, installs the example dependencies, copies the local library build,
and starts Vite at <http://app.localhost:3000>.

Or, from this directory:

```sh
yarn install
yarn dev
```

Choose `OIDC_PROVIDER` and configure its settings in `.env`. Use `OIDC_PROVIDER=mock`
to explore without an identity provider. Register the application's root URL as the
provider's redirect URI. SPA mode is enabled only for builds: the development server renders
public pages on demand, so their content is visible with JavaScript disabled. The static
routing described above applies to the production Vercel deployment.

## Test the production build locally

Stop the development server, then run from this directory:

```sh
yarn build:vercel
yarn preview
```

Open <http://app.localhost:3000>. This serves the actual `.vercel/output` HTML and
JavaScript, interprets the generated Vercel routing rules used by this example, and invokes
the built API function. It loads `.env` for the backend; React rendering remains disabled.
Change `PORT` if needed, keeping your identity provider's allowed redirect URLs in sync.

With JavaScript disabled, `/` and `/inactivity-logout` display their prerendered content.
Protected routes display only the static shell. Reenable JavaScript to test login, callback
restoration, and the live APIs. After editing sources, rebuild before previewing again.

## Deploy to Vercel

Import this repository and select `examples/tanstack-start-ssg` as the project root.
Enable access to files outside the project root. The included `vercel.json` selects
TanStack Start and builds/copies the local oidc-spa package during installation.
Vercel detects Nitro's deployment preset; use the default `yarn build` command.

Set the provider variables from `.env` in Vercel's environment settings. They remain runtime
configuration: the browser obtains the permitted values through a live server function.
Configure the provider's redirect URI and allowed origin for the deployed application.

For persistent todos, set `KV_REST_API_URL` and `KV_REST_API_TOKEN` for an Upstash Redis store.
The local filesystem store is for local development and is not persistent storage on Vercel.

To generate and inspect the Vercel artifact locally:

```sh
yarn build:vercel
```

The generated `.vercel/output/config.json` includes the CDN routing rules, static HTML
is in `.vercel/output/static`, and the API function is in
`.vercel/output/functions/__server.func`. Deploying the prebuilt artifact requires Vercel's
normal project/environment setup; the artifact does not contain your runtime secrets.
