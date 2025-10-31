import { createKeycloakUtils, isKeycloak } from "oidc-spa/keycloak";
import { useOidc, withLoginEnforced } from "~/oidc";

const REQUIRED_ROLE = "realm-admin";

const AdminOnly = withLoginEnforced(() => {
    const { decodedIdToken, issuerUri } = useOidc({ assert: "user logged in" });

    const keycloakUtils = isKeycloak({ issuerUri }) ? createKeycloakUtils({ issuerUri }) : undefined;

    if (!decodedIdToken.realm_access?.roles.includes(REQUIRED_ROLE)) {
        return (
            <section className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-100">
                <p>
                    You need the <code>{REQUIRED_ROLE}</code> role to view this page.
                </p>
            </section>
        );
    }

    return (
        <section className="space-y-6">
            <div className="space-y-1">
                <h1 className="text-xl font-semibold text-white">Administration Page</h1>
                <p className="text-sm text-slate-300">
                    Access is granted because your ID token includes the <code>{REQUIRED_ROLE}</code>{" "}
                    role.
                </p>
            </div>

            {keycloakUtils !== undefined && (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
                    <a
                        className="inline-flex items-center text-slate-200 underline decoration-slate-700 underline-offset-4 transition-colors hover:decoration-slate-400"
                        href={keycloakUtils.adminConsoleUrl}
                        target="_blank"
                        rel="noreferrer"
                    >
                        Open the Keycloak administration console
                    </a>
                </div>
            )}
        </section>
    );
});

export default AdminOnly;
