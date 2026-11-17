"use client";

import type { PropsWithChildren } from "react";
import { OidcInitializationGate, withLoginEnforced } from "@/lib/oidc";
import { AutoLogoutWarningOverlay } from "@/components/AutoLogoutWarningOverlay";

const ProtectedLayout = withLoginEnforced({
    component: ({ children }: PropsWithChildren) => (
        <>
            {children}
            <AutoLogoutWarningOverlay />
        </>
    ),
    errorComponent: ({ oidcInitializationError }) => (
        <p role="alert">Authentication failed: {oidcInitializationError.message}</p>
    )
});

export default function Layout({ children }: PropsWithChildren) {
    return (
        <OidcInitializationGate>
            <ProtectedLayout>{children}</ProtectedLayout>
        </OidcInitializationGate>
    );
}
