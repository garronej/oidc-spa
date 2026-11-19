import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { AutoLogoutWarningOverlay } from "./components/AutoLogoutWarningOverlay";
import { router } from "./router";

createRoot(document.getElementById("app")!).render(
    <StrictMode>
        <RouterProvider router={router} />
        <AutoLogoutWarningOverlay />
    </StrictMode>
);
