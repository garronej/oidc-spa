import type { UserManager as OidcClientTsUserManager } from "../vendor/frontend/oidc-client-ts-and-jwt-decode";
import { toFullyQualifiedUrl } from "../tools/toFullyQualifiedUrl";
import { assert, type Equals } from "../vendor/frontend/tsafe";
import { StateData } from "./StateData";
import type { NonPostableEvt } from "../tools/Evt";
import { type StatefulEvt, createStatefulEvt } from "../tools/StatefulEvt";
import { Deferred } from "../tools/Deferred";

const GLOBAL_CONTEXT_KEY = "__oidc-spa.loginOrGoToAuthSever.globalContext";

declare global {
    interface Window {
        [GLOBAL_CONTEXT_KEY]: {
            evtHasLoginBeenCalled: StatefulEvt<boolean>;
        };
    }
}

window[GLOBAL_CONTEXT_KEY] ??= {
    evtHasLoginBeenCalled: createStatefulEvt(() => false)
};

const globalContext = window[GLOBAL_CONTEXT_KEY];

type Params = Params.Login | Params.GoToAuthServer;

namespace Params {
    type Common = {
        redirectUrl: string;
        extraQueryParams_local: Record<string, string> | undefined;
        transformUrlBeforeRedirect_local: ((url: string) => string) | undefined;
    };

    export type Login = Common & {
        action: "login";
        doNavigateBackToLastPublicUrlIfTheTheUserNavigateBack: boolean;
        doForceReloadOnBfCache: boolean;
        doForceInteraction: boolean;
    };

    export type GoToAuthServer = Common & {
        action: "go to auth server";
    };
}

export function getPrSafelyRestoredFromBfCacheAfterLoginBackNavigation() {
    const dOut = new Deferred<void>();

    const { unsubscribe } = globalContext.evtHasLoginBeenCalled.subscribe(hasLoginBeenCalled => {
        if (!hasLoginBeenCalled) {
            unsubscribe();
            dOut.resolve();
        }
    });

    return dOut.pr;
}

export function createLoginOrGoToAuthServer(params: {
    configId: string;
    oidcClientTsUserManager: OidcClientTsUserManager;
    getExtraQueryParams: (() => Record<string, string>) | undefined;
    transformUrlBeforeRedirect: ((url: string) => string) | undefined;
    homeAndCallbackUrl: string;
    evtIsUserLoggedIn: NonPostableEvt<boolean>;
    log: typeof console.log | undefined;
}) {
    const {
        configId,
        oidcClientTsUserManager,
        getExtraQueryParams,
        transformUrlBeforeRedirect,
        homeAndCallbackUrl,
        evtIsUserLoggedIn,
        log
    } = params;

    const LOCAL_STORAGE_KEY_TO_CLEAR_WHEN_USER_LOGGED_IN = `oidc-spa.login-redirect-initiated:${configId}`;

    let lastPublicUrl: string | undefined = undefined;

    function loginOrGoToAuthServer(params: Params): Promise<never> {
        const {
            redirectUrl: redirectUrl_params,
            extraQueryParams_local,
            transformUrlBeforeRedirect_local,
            ...rest
        } = params;

        log?.("Calling loginOrGoToAuthServer", { params });

        login_specific_handling: {
            if (rest.action !== "login") {
                break login_specific_handling;
            }

            if (globalContext.evtHasLoginBeenCalled.current) {
                log?.("login() has already been called, ignoring the call");
                return new Promise<never>(() => {});
            }

            globalContext.evtHasLoginBeenCalled.current = true;

            bf_cache_handling: {
                if (rest.doForceReloadOnBfCache) {
                    window.removeEventListener("pageshow", () => {
                        location.reload();
                    });
                    break bf_cache_handling;
                }

                localStorage.setItem(LOCAL_STORAGE_KEY_TO_CLEAR_WHEN_USER_LOGGED_IN, "true");

                const callback = () => {
                    window.removeEventListener("pageshow", callback);

                    log?.(
                        "We came back from the login pages and the state of the app has been restored"
                    );

                    if (rest.doNavigateBackToLastPublicUrlIfTheTheUserNavigateBack) {
                        if (lastPublicUrl !== undefined) {
                            log?.(`Loading last public route: ${lastPublicUrl}`);
                            window.location.href = lastPublicUrl;
                        } else {
                            log?.("We don't know the last public route, navigating back in history");
                            window.history.back();
                        }
                    } else {
                        log?.("The current page doesn't require auth...");

                        if (
                            localStorage.getItem(LOCAL_STORAGE_KEY_TO_CLEAR_WHEN_USER_LOGGED_IN) === null
                        ) {
                            log?.("but the user is now authenticated, reloading the page");
                            location.reload();
                        } else {
                            log?.("and the user doesn't seem to be authenticated, avoiding a reload");
                            globalContext.evtHasLoginBeenCalled.current = false;
                        }
                    }
                };

                window.addEventListener("pageshow", callback);
            }
        }

        const redirectUrl = toFullyQualifiedUrl({
            urlish: redirectUrl_params,
            doAssertNoQueryParams: false
        });

        log?.(`redirectUrl: ${redirectUrl}`);

        const stateData: StateData = {
            context: "redirect",
            redirectUrl,
            extraQueryParams: {},
            hasBeenProcessedByCallback: false,
            configId,
            action: "login",
            redirectUrl_consentRequiredCase: (() => {
                switch (rest.action) {
                    case "login":
                        return lastPublicUrl ?? homeAndCallbackUrl;
                    case "go to auth server":
                        return redirectUrl;
                }
            })()
        };

        const transformUrl_oidcClientTs = (url: string) => {
            (
                [
                    [getExtraQueryParams?.(), transformUrlBeforeRedirect],
                    [extraQueryParams_local, transformUrlBeforeRedirect_local]
                ] as const
            ).forEach(([extraQueryParams, transformUrlBeforeRedirect], i) => {
                const urlObj_before = i === 0 ? undefined : new URL(url);

                add_extra_query_params: {
                    if (extraQueryParams === undefined) {
                        break add_extra_query_params;
                    }

                    const url_obj = new URL(url);

                    for (const [name, value] of Object.entries(extraQueryParams)) {
                        url_obj.searchParams.set(name, value);
                    }

                    url = url_obj.href;
                }

                apply_transform_before_redirect: {
                    if (transformUrlBeforeRedirect === undefined) {
                        break apply_transform_before_redirect;
                    }
                    url = transformUrlBeforeRedirect(url);
                }

                update_state: {
                    if (urlObj_before === undefined) {
                        break update_state;
                    }

                    for (const [name, value] of new URL(url).searchParams.entries()) {
                        const value_before = urlObj_before.searchParams.get(name);

                        if (value_before === value) {
                            continue;
                        }

                        stateData.extraQueryParams[name] = value;
                    }

                }
            });

            return url;
        };

        const redirectMethod = (() => {
            switch (rest.action) {
                case "login":
                    return rest.doNavigateBackToLastPublicUrlIfTheTheUserNavigateBack
                        ? "replace"
                        : "assign";
                case "go to auth server":
                    return "assign";
            }
        })();

        log?.(`redirectMethod: ${redirectMethod}`);

        return oidcClientTsUserManager
            .signinRedirect({
                state: stateData,
                redirectMethod,
                prompt: (() => {
                    switch (rest.action) {
                        case "go to auth server":
                            return undefined;
                        case "login":
                            return rest.doForceInteraction ? "consent" : undefined;
                    }
                    assert<Equals<typeof rest, never>>;
                })(),
                transformUrl: transformUrl_oidcClientTs
            })
            .then(() => new Promise<never>(() => {}));
    }

    const { unsubscribe } = evtIsUserLoggedIn.subscribe(isLoggedIn => {
        unsubscribe();

        if (isLoggedIn) {
            localStorage.removeItem(LOCAL_STORAGE_KEY_TO_CLEAR_WHEN_USER_LOGGED_IN);
        } else {
            const realPushState = history.pushState.bind(history);
            history.pushState = function pushState(...args) {
                lastPublicUrl = window.location.href;
                return realPushState(...args);
            };
        }
    });

    return {
        loginOrGoToAuthServer
    };
}
