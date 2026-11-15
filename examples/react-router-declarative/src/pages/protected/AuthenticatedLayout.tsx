import { Outlet } from "react-router";
import { withLoginEnforced } from "~/oidc";
import { AutoLogoutWarningOverlay } from "~/components/AutoLogoutWarningOverlay";

export const AuthenticatedLayout = withLoginEnforced({
    component: function AuthenticatedLayout() {
        return (
            <>
                <Outlet />
                <AutoLogoutWarningOverlay />
            </>
        );
    }
});
