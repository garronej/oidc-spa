import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const outputDir = fileURLToPath(new URL("../.vercel/output/", import.meta.url));
const publicDir = join(outputDir, "static");

if (!existsSync(join(outputDir, "config.json"))) {
    throw new Error("Run `yarn build:vercel` before `yarn preview`.");
}

if (existsSync(".env")) process.loadEnvFile(".env");

const { routes } = JSON.parse(await readFile(join(outputDir, "config.json"), "utf8"));
const { default: backend } = await import(
    pathToFileURL(join(outputDir, "functions/__server.func/index.mjs"))
);
const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2"
};

async function findStaticFile(pathname) {
    const decodedPath = decodeURIComponent(pathname);

    for (const path of [
        decodedPath,
        `${decodedPath.replace(/\/$/, "")}/index.html`,
        `${decodedPath}.html`
    ]) {
        const filename = resolve(publicDir, `.${path}`);
        if (!filename.startsWith(publicDir + sep)) continue;
        const info = await stat(filename).catch(() => undefined);
        if (info?.isFile()) return filename;
    }
}

async function serveFile(filename) {
    return new Response(await readFile(filename), {
        headers: { "Content-Type": contentTypes[extname(filename)] ?? "application/octet-stream" }
    });
}

// Interpret the generated rules used by this example, including query conditions
// before the filesystem check. Nothing here renders React or loads application sources.
async function dispatch(request, responseHeaders) {
    const url = new URL(request.url);

    for (const route of routes) {
        if (route.handle === "filesystem") {
            const filename = await findStaticFile(url.pathname);
            if (filename) return serveFile(filename);
            continue;
        }

        if (!route.src || !new RegExp(route.src).test(url.pathname)) continue;
        if (
            route.has &&
            !route.has.every(condition => {
                if (condition.type !== "query") {
                    throw new Error(`Unsupported preview route condition: ${condition.type}`);
                }
                return url.searchParams.has(condition.key);
            })
        )
            continue;

        for (const [name, value] of Object.entries(route.headers ?? {}))
            responseHeaders.set(name, value);
        if (route.continue) continue;
        if (route.status) return new Response(null, { status: route.status });
        if (route.dest === "/__server") return backend.fetch(request);

        const filename = await findStaticFile(route.dest);
        return filename ? serveFile(filename) : new Response("Not Found", { status: 404 });
    }

    return new Response("Not Found", { status: 404 });
}

const host = process.env.HOST ?? "app.localhost";
const port = Number(process.env.PORT ?? 3000);
const server = createServer(async (req, res) => {
    try {
        const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers: req.headers,
            ...(req.method === "GET" || req.method === "HEAD"
                ? {}
                : { body: Readable.toWeb(req), duplex: "half" })
        });
        const responseHeaders = new Headers();
        const response = await dispatch(request, responseHeaders);
        response.headers.forEach((value, name) => responseHeaders.set(name, value));
        const headers = Object.fromEntries(responseHeaders);
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) headers["set-cookie"] = cookies;
        res.writeHead(response.status, headers);
        if (response.body && req.method !== "HEAD") {
            await pipeline(Readable.fromWeb(response.body), res);
        } else {
            await response.body?.cancel();
            res.end();
        }
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.writeHead(500);
        res.end("Preview request failed");
    }
});

server.listen(port, host, () => {
    console.log(`Built app: http://${host}:${port}`);
});
