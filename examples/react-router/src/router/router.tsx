import { createBrowserRouter, type LoaderFunctionArgs } from "react-router-dom";
import { Layout } from "./Layout";
import { ProtectedPage } from "../pages/ProtectedPage";
import { PublicPage } from "../pages/PublicPage";
import { getOidc } from "oidc";

export const router = createBrowserRouter([
    {
        path: "/",
        Component: Layout,
        children: [
            {
                path: "protected",
                Component: ProtectedPage,
                loader: protectedRouteLoader
            },
            {
                index: true,
                Component: PublicPage
            }
        ]
    }
]);

async function protectedRouteLoader({ request }: LoaderFunctionArgs) {
    const oidc = await getOidc();

    if (!oidc.isUserLoggedIn) {
        // Replace the href without reloading the page.
        // This is a way to make oidc-spa know where to redirect the user
        // if the authentication process is successful.
        history.pushState({}, "", request.url);

        // After the successful login the user will be redirected to location.href (here).
        // location.href is request.url because we replaced the href above.
        await oidc.login({ doesCurrentHrefRequiresAuth: true });

        // Never here, the login method redirects the user to the identity provider.
    }

    return null;
}
