import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";

const handleRequest = createStartHandler(options => {
    // Start sets TSS_PRERENDERING in the build's preview process. A request header
    // cannot enable rendering in the deployed API function.
    if (import.meta.env.DEV || process.env.TSS_PRERENDERING === "true") {
        return defaultStreamHandler(options);
    }

    return new Response("Not Found", { status: 404 });
});

const serverEntry: { fetch: RequestHandler<Register> } = {
    fetch(request, options) {
        const { pathname } = new URL(request.url);

        if (
            !import.meta.env.DEV &&
            process.env.TSS_PRERENDERING !== "true" &&
            !pathname.startsWith("/api/") &&
            !pathname.startsWith("/_serverFn/")
        ) {
            return new Response("Not Found", { status: 404 });
        }

        return handleRequest(request, options);
    }
};

export default serverEntry;
