import {
    defineComponent,
    h,
    onMounted,
    shallowRef,
    shallowReadonly,
    triggerRef,
    type Component,
    type DefineComponent,
    type PropType,
    type SlotsType,
    type VNodeChild
} from "vue";
import type {
    OidcSpaUtils,
    RuntimeConfigs,
    CreateClientUser,
    Oidc_vue,
    Oidc,
    AutoLogoutState
} from "./types";
import { OidcInitializationError } from "../core/OidcInitializationError";
import { isBrowser } from "../tools/isBrowser";
import type { OptionallyAsyncGetterOrDirectValue } from "../tools/GetterOrDirectValue";
import { toFullyQualifiedUrl } from "../tools/toFullyQualifiedUrl";
import { getBASE_URL_earlyInit } from "../core/earlyInit_BASE_URL";

export function createUtils<User>(params: {
    createUser: CreateClientUser<User>;
    getRuntimeConfigsOrRuntimeConfigs: OptionallyAsyncGetterOrDirectValue<void, RuntimeConfigs>;
}): OidcSpaUtils<User> {
    const { createUser, getRuntimeConfigsOrRuntimeConfigs } = params;

    function initializationFailed(params: {
        initializationError: OidcInitializationError;
        config:
            | {
                  issuerUri: string;
                  clientId: string;
              }
            | undefined;
    }): Oidc.NotLoggedIn {
        const { initializationError, config } = params;

        return {
            isUserLoggedIn: false,
            issuerUri:
                config === undefined
                    ? "https://not-resolved-yet"
                    : toFullyQualifiedUrl({
                          urlish: config.issuerUri,
                          doAssertNoQueryParams: true,
                          doOutputWithTrailingSlash: false,
                          rootUrl_fullyQualified: window.location.origin
                      }),
            clientId: config === undefined ? "not-resolved-yet" : config.clientId,
            get validRedirectUri(): string {
                return toFullyQualifiedUrl({
                    urlish: getBASE_URL_earlyInit(),
                    doAssertNoQueryParams: true,
                    doOutputWithTrailingSlash: true,
                    rootUrl_fullyQualified: window.location.origin
                });
            },
            login: async () => {
                alert("Authentication is currently unavailable. Please try again later.");
                return new Promise<never>(() => {});
            },
            initializationError
        };
    }

    async function initialize(): Promise<Oidc<User>> {
        let runtimeConfigs: RuntimeConfigs;

        try {
            runtimeConfigs =
                typeof getRuntimeConfigsOrRuntimeConfigs === "function"
                    ? await getRuntimeConfigsOrRuntimeConfigs()
                    : getRuntimeConfigsOrRuntimeConfigs;
        } catch (error) {
            return initializationFailed({
                initializationError: new OidcInitializationError({
                    isAuthServerLikelyDown: false,
                    messageOrCause: new Error(
                        "Error thrown while evaluating the runtime configs getter on the client",
                        // @ts-expect-error
                        { cause: error }
                    )
                }),
                config: undefined
            });
        }

        switch (runtimeConfigs.mode) {
            case "mock": {
                const { createMockOidc } = await import("../core/createMockOidc");

                return createMockOidc<User>({
                    createUser_mock: params => createUser({ isMock: true, ...params }),
                    isUserInitiallyLoggedIn: runtimeConfigs.isUserInitiallyLoggedIn ?? true,
                    issuerUri_mock: runtimeConfigs.issuerUri_mock,
                    clientId_mock: runtimeConfigs.clientId_mock,
                    idTokenClaims_mock: runtimeConfigs.idTokenClaims_mock,
                    idToken_mock: runtimeConfigs.idToken_mock,
                    accessToken_mock: runtimeConfigs.accessToken_mock,
                    refreshToken_mock: runtimeConfigs.refreshToken_mock
                });
            }
            case "real": {
                const { createOidc } = await import("../core");

                try {
                    return await createOidc<User>({
                        issuerUri: runtimeConfigs.issuerUri,
                        clientId: runtimeConfigs.clientId,
                        idleSessionLifetimeInSeconds: runtimeConfigs.idleSessionLifetimeInSeconds,
                        scopes: runtimeConfigs.scopes,
                        transformAuthorizationUrl: runtimeConfigs.transformAuthorizationUrl,
                        authorizationParams: runtimeConfigs.authorizationParams,
                        tokenParams: runtimeConfigs.tokenParams,
                        sessionRestorationMethod: runtimeConfigs.sessionRestorationMethod,
                        debugLogs: runtimeConfigs.debugLogs,
                        __oidcProviderMetadata: runtimeConfigs.__oidcProviderMetadata,
                        autoLogout_returnToUrl: runtimeConfigs.autoLogout_returnToUrl,
                        disableDPoP: runtimeConfigs.disableDPoP,
                        warnUserSecondsBeforeAutoLogout: runtimeConfigs.warnUserSecondsBeforeAutoLogout,
                        createUser: params => createUser({ isMock: false, ...params })
                    });
                } catch (error) {
                    if (!(error instanceof OidcInitializationError)) {
                        throw error;
                    }

                    return initializationFailed({
                        initializationError: error,
                        config: {
                            issuerUri: runtimeConfigs.issuerUri,
                            clientId: runtimeConfigs.clientId
                        }
                    });
                }
            }
        }
    }

    let returnToUrl_temporaryOverride: string | undefined;
    let clearReturnToUrlOverride: (() => void) | undefined;
    let prClient: Promise<Oidc<User>> | undefined;
    let prInitialized: Promise<void> | undefined;
    let oidc_vue: Oidc_vue<User> | undefined;

    function notLoggedIn(oidc: Oidc.NotLoggedIn): Oidc_vue.NotLoggedIn {
        return {
            isUserLoggedIn: false,
            issuerUri: oidc.issuerUri,
            clientId: oidc.clientId,
            get validRedirectUri() {
                return oidc.validRedirectUri;
            },
            initializationError: oidc.initializationError,
            autoLogoutState: shallowReadonly(shallowRef({ shouldDisplayWarning: false as const })),
            login: ({ doesCurrentHrefEnforceLogin = false, ...rest }) =>
                oidc.login({ ...rest, doesCurrentHrefEnforceLogin })
        };
    }

    async function initializeView(oidc: Oidc<User>): Promise<void> {
        if (!oidc.isUserLoggedIn) {
            oidc_vue = notLoggedIn(oidc);
            return;
        }

        // The gate/guard waits for getUser() before exposing this ref to components.
        const user = shallowRef<User>(undefined as User);
        const autoLogoutState = shallowRef<AutoLogoutState>({ shouldDisplayWarning: false });
        let hasReceivedUser = false;

        const { unsubscribeFromUserChange } = oidc.subscribeToUserChange(({ user: nextUser }) => {
            hasReceivedUser = true;
            if (Object.is(user.value, nextUser)) {
                // Honor user-change notifications even when the object retains its identity.
                triggerRef(user);
            } else {
                user.value = nextUser;
            }
        });
        const { unsubscribeFromAutoLogoutState } = oidc.subscribeToAutoLogoutState(state => {
            autoLogoutState.value = state;
        });

        try {
            // As in React, initialize from current tokens; refreshUser() renews explicitly.
            const initialUser = await oidc.getUser();
            if (!hasReceivedUser) {
                user.value = initialUser;
            }
        } catch (error) {
            unsubscribeFromUserChange();
            unsubscribeFromAutoLogoutState();

            if (!(error instanceof OidcInitializationError)) {
                throw error;
            }

            oidc_vue = notLoggedIn({
                isUserLoggedIn: false,
                issuerUri: oidc.issuerUri,
                clientId: oidc.clientId,
                validRedirectUri: oidc.validRedirectUri,
                initializationError: error,
                login: () => {
                    console.warn(
                        "oidc-spa: Calling login while user already logged in but the user " +
                            "object couldn't be constructed, reloading the page"
                    );
                    window.location.reload();
                    return new Promise<never>(() => {});
                }
            });
            return;
        }

        oidc_vue = {
            isUserLoggedIn: true,
            issuerUri: oidc.issuerUri,
            clientId: oidc.clientId,
            validRedirectUri: oidc.validRedirectUri,
            logout: oidc.logout,
            renewTokens: oidc.renewTokens,
            startAuthorization: oidc.startAuthorization,
            authorizationResult: oidc.authorizationResult,
            isNewBrowserSession: oidc.isNewBrowserSession,
            autoLogoutState: shallowReadonly(autoLogoutState),
            user: shallowReadonly(user),
            refreshUser: oidc.refreshUser
        };
    }

    function triggerClientInitializationIfNotAlreadyDone(): void {
        if (prClient !== undefined) {
            return;
        }

        prClient = initialize().then(oidc => {
            if (!oidc.isUserLoggedIn) {
                return oidc;
            }

            const oidc_proxy: Oidc.LoggedIn<User> = {
                ...oidc,
                getTokens: params => {
                    if (params === undefined) {
                        return oidc.getTokens();
                    }
                    return oidc.getTokens({
                        ...params,
                        returnToUrl: params.returnToUrl ?? returnToUrl_temporaryOverride
                    });
                },
                getAccessToken: async params => {
                    const { accessToken } = await oidc_proxy.getTokens(params);
                    return accessToken;
                }
            };
            return oidc_proxy;
        });

        // Keep client availability separate from user readiness: createUser may call getOidc()
        // to obtain an access token without waiting for itself to finish.
        prInitialized = prClient.then(initializeView);
        // A getOidc()-only consumer need not await UI initialization. Gates/guards still
        // observe unexpected initialization failures through the original promise.
        void prInitialized.catch(() => {});
    }

    function useOidc(params?: { assert?: undefined }): Oidc_vue<User>;
    function useOidc(params: { assert: "user logged in" }): Oidc_vue.LoggedIn<User>;
    function useOidc(params: { assert: "user not logged in" }): Oidc_vue.NotLoggedIn;
    function useOidc(params?: { assert?: "user logged in" | "user not logged in" }): Oidc_vue<User> {
        if (!isBrowser) {
            throw new Error(
                "oidc-spa: useOidc() can't be used in SSR'd components. " +
                    "Wrap the component in <OidcInitializationGate />."
            );
        }

        if (oidc_vue === undefined) {
            throw new Error(
                "oidc-spa: OIDC initialization is not complete. " +
                    "Wrap components calling useOidc() in <OidcInitializationGate />."
            );
        }

        if (
            (params?.assert === "user logged in" && !oidc_vue.isUserLoggedIn) ||
            (params?.assert === "user not logged in" && oidc_vue.isUserLoggedIn)
        ) {
            throw new Error(
                "oidc-spa: There is a logic error in the application. " +
                    `This component asserted '${params.assert}', but the current state differs.`
            );
        }

        return oidc_vue;
    }

    function getOidc(params?: { assert?: undefined }): Promise<Oidc<User>>;
    function getOidc(params: { assert: "user logged in" }): Promise<Oidc.LoggedIn<User>>;
    function getOidc(params: { assert: "user not logged in" }): Promise<Oidc.NotLoggedIn>;
    async function getOidc(params?: {
        assert?: "user logged in" | "user not logged in";
    }): Promise<Oidc<User>> {
        if (!isBrowser) {
            throw new Error("oidc-spa: getOidc() can't be used on the server");
        }

        triggerClientInitializationIfNotAlreadyDone();
        const oidc = await prClient!;

        if (params?.assert === "user logged in" && !oidc.isUserLoggedIn) {
            throw new Error(
                "oidc-spa: Called getOidc({ assert: 'user logged in' }) but the user is not currently logged in."
            );
        }
        if (params?.assert === "user not logged in" && oidc.isUserLoggedIn) {
            throw new Error(
                "oidc-spa: Called getOidc({ assert: 'user not logged in' }) but the user is currently logged in."
            );
        }

        return oidc;
    }

    async function enforceLogin(toHref: string): Promise<void | never> {
        if (!isBrowser) {
            throw new Error("oidc-spa: enforceLogin cannot be used on the server");
        }

        // A new attempt supersedes any destination whose navigation was cancelled.
        clearReturnToUrlOverride?.();
        await getOidc();
        await prInitialized;
        const oidc = useOidc();

        if (!oidc.isUserLoggedIn && oidc.initializationError !== undefined) {
            throw oidc.initializationError;
        }

        // The router supplies its resolved URL, including the history base and hash mode.
        const returnToUrl = new URL(toHref).href;
        const isUrlAlreadyReplaced =
            window.location.href.replace(/\/$/, "") === returnToUrl.replace(/\/$/, "");

        if (!oidc.isUserLoggedIn) {
            await oidc.login({
                returnToUrl,
                doesCurrentHrefEnforceLogin: isUrlAlreadyReplaced
            });
        }

        if (isUrlAlreadyReplaced) {
            return;
        }

        // Match React: token acquisition during a pending navigation must return to its
        // destination if renewal needs a foreground redirect, rather than the old page.
        clearReturnToUrlOverride?.();
        returnToUrl_temporaryOverride = returnToUrl;
        const history = window.history;
        const history_pushState = history.pushState;
        const history_replaceState = history.replaceState;
        const onNavigated = () => {
            history.pushState = history_pushState;
            history.replaceState = history_replaceState;
            returnToUrl_temporaryOverride = undefined;
            clearReturnToUrlOverride = undefined;
            window.removeEventListener("popstate", onNavigated);
        };
        clearReturnToUrlOverride = onNavigated;
        window.addEventListener("popstate", onNavigated);

        history.pushState = function pushState(...args) {
            onNavigated();
            return history_pushState.call(history, ...args);
        };
        history.replaceState = function replaceState(...args) {
            onNavigated();
            return history_replaceState.call(history, ...args);
        };
    }

    function withLoginEnforced<Props extends Record<string, unknown>>(params: {
        component: Component<Props>;
        errorComponent?: Component<{ oidcInitializationError: OidcInitializationError }>;
    }): DefineComponent<Props> {
        const { component: Component, errorComponent: ErrorComponent } = params;

        return defineComponent({
            name: `${Component.name ?? "Component"}WithLoginEnforced`,
            inheritAttrs: false,
            setup(_props, { attrs, slots }) {
                const oidc = useOidc();

                onMounted(async () => {
                    if (!oidc.isUserLoggedIn && oidc.initializationError === undefined) {
                        await oidc.login({ doesCurrentHrefEnforceLogin: true });
                    }
                });

                return () => {
                    if (oidc.isUserLoggedIn) {
                        return h(Component, attrs as Props, slots);
                    }

                    const { initializationError } = oidc;
                    if (initializationError === undefined) {
                        return null;
                    }

                    if (ErrorComponent !== undefined) {
                        return h(ErrorComponent, { oidcInitializationError: initializationError });
                    }

                    return h("div", { role: "alert" }, [
                        h("p", "Authentication initialization failed."),
                        h("pre", { style: { whiteSpace: "pre-wrap" } }, initializationError.message),
                        h(
                            "button",
                            { type: "button", onClick: () => window.location.reload() },
                            "Reload page"
                        )
                    ]);
                };
            }
        }) as unknown as DefineComponent<Props>;
    }

    const OidcInitializationGate = defineComponent({
        name: "OidcInitializationGate",
        props: {
            fallback: { type: null as unknown as PropType<VNodeChild> }
        },
        slots: Object as SlotsType<{
            default?: () => VNodeChild;
            fallback?: () => VNodeChild;
        }>,
        setup(props, { slots }) {
            const isReadyToRender = shallowRef(false);

            onMounted(async () => {
                triggerClientInitializationIfNotAlreadyDone();
                await prInitialized;
                isReadyToRender.value = true;
            });

            return () =>
                isReadyToRender.value ? slots.default?.() : slots.fallback?.() ?? props.fallback ?? null;
        }
    });

    return { useOidc, getOidc, enforceLogin, withLoginEnforced, OidcInitializationGate };
}
