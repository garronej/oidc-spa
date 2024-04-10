/* prettier-ignore-start */

/* eslint-disable */

// @ts-nocheck

// noinspection JSUnusedGlobalSymbols

// This file is auto-generated by TanStack Router

// Import Routes

import { Route as rootRoute } from "./routes/__root";
import { Route as ProtectedImport } from "./routes/protected";
import { Route as IndexImport } from "./routes/index";

// Create/Update Routes

const ProtectedRoute = ProtectedImport.update({
    path: "/protected",
    getParentRoute: () => rootRoute
} as any);

const IndexRoute = IndexImport.update({
    path: "/",
    getParentRoute: () => rootRoute
} as any);

// Populate the FileRoutesByPath interface

declare module "@tanstack/react-router" {
    interface FileRoutesByPath {
        "/": {
            preLoaderRoute: typeof IndexImport;
            parentRoute: typeof rootRoute;
        };
        "/protected": {
            preLoaderRoute: typeof ProtectedImport;
            parentRoute: typeof rootRoute;
        };
    }
}

// Create and export the route tree

export const routeTree = rootRoute.addChildren([IndexRoute, ProtectedRoute]);

/* prettier-ignore-end */
