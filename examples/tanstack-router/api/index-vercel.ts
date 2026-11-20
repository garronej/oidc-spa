import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../server/app.js";

// Vercel owns the HTTP server; this function forwards each request to Express.
export default function requestHandler(req: IncomingMessage, res: ServerResponse) {
    app(req, res);
}
