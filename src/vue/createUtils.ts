import {
    defineComponent,
    onMounted,
    onUnmounted,
    shallowRef,
    shallowReadonly,
    triggerRef,
    type ShallowRef,
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
    AutoLogoutState,
    RouteLocationNormalizedGenericLike
} from "./types";
import { OidcInitializationError } from "../core/OidcInitializationError";
import { Deferred } from "../tools/Deferred";
import { isBrowser } from "../tools/isBrowser";
import { assert, type Equals } from "../tools/tsafe/assert";
import { id } from "../tools/tsafe/id";
import type { OptionallyAsyncGetterOrDirectValue } from "../tools/GetterOrDirectValue";
import { toFullyQualifiedUrl } from "../tools/toFullyQualifiedUrl";
import { getBASE_URL_earlyInit } from "../core/earlyInit_BASE_URL";

export function createUtils<User>(params: {
    createUser: CreateClientUser<User>;
    getRuntimeConfigsOrRuntimeConfigs: OptionallyAsyncGetterOrDirectValue<void, RuntimeConfigs>;
}): OidcSpaUtils<User> {
    const getRuntimeConfigs = (() => {
        const { getRuntimeConfigsOrRuntimeConfigs } = params;

        if (typeof getRuntimeConfigsOrRuntimeConfigs === "function") {
            const getRuntimeConfigs = getRuntimeConfigsOrRuntimeConfigs;

            return getRuntimeConfigs;
        } else {
            const runtimeConfigs = getRuntimeConfigsOrRuntimeConfigs;

            return () => runtimeConfigs;
        }
    })();

    const { createUser } = params;

    const dClientCtx = new Deferred<
        | {
              isUserLoggedIn: false;
              oidc: Oidc.NotLoggedIn;
          }
        | {
              isUserLoggedIn: true;
              oidc: Oidc.LoggedIn<User>;
              dUser: Deferred<
                  | {
                        hasCreateUserThrown: true;
                        initializationError: OidcInitializationError;
                    }
                  | {
                        hasCreateUserThrown: false;
                        user: Readonly<ShallowRef<User>>;
                    }
              >;
          }
    >();

    const { triggerClientInitializationIfNotAlreadyDone } = (() => {
        function createOidcNotLoggedInLike(params: {
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

        const d = new Deferred<void>();

        const prInitialization = d.pr.then(async () => {
            const runtimeConfigs = await (async () => {
                let runtimeConfigs: RuntimeConfigs;

                try {
                    runtimeConfigs = await getRuntimeConfigs();
                } catch (error) {
                    dClientCtx.resolve({
                        isUserLoggedIn: false,
                        oidc: createOidcNotLoggedInLike({
                            config: undefined,
                            initializationError: new OidcInitializationError({
                                isAuthServerLikelyDown: false,
                                messageOrCause: new Error(
                                    "Error thrown while evaluating the runtime configs getter on the client",
                                    // @ts-expect-error
                                    { cause: error }
                                )
                            })
                        })
                    });

                    await new Promise<never>(() => {});

                    assert(false);
                }

                return runtimeConfigs;
            })();

            switch (runtimeConfigs.mode) {
                case "mock":
                    {
                        const { createMockOidc } = await import("../core/createMockOidc");

                        const oidc = await createMockOidc<User>({
                            createUser_mock: params =>
                                createUser({
                                    isMock: true,
                                    ...params
                                }),
                            isUserInitiallyLoggedIn: runtimeConfigs.isUserInitiallyLoggedIn ?? true,

                            issuerUri_mock: runtimeConfigs.issuerUri_mock,
                            clientId_mock: runtimeConfigs.clientId_mock,
                            idTokenClaims_mock: runtimeConfigs.idTokenClaims_mock,
                            idToken_mock: runtimeConfigs.idToken_mock,
                            accessToken_mock: runtimeConfigs.accessToken_mock,
                            refreshToken_mock: runtimeConfigs.refreshToken_mock
                        });

                        if (!oidc.isUserLoggedIn) {
                            dClientCtx.resolve({
                                isUserLoggedIn: false,
                                oidc
                            });
                            break;
                        }

                        dClientCtx.resolve({
                            isUserLoggedIn: true,
                            oidc,
                            dUser: new Deferred()
                        });
                    }
                    break;
                case "real":
                    {
                        const { createOidc } = await import("../core");

                        let oidc: Oidc<User>;

                        try {
                            oidc = await createOidc<User>({
                                issuerUri: runtimeConfigs.issuerUri,
                                clientId: runtimeConfigs.clientId,
                                idleSessionLifetimeInSeconds:
                                    runtimeConfigs.idleSessionLifetimeInSeconds,
                                scopes: runtimeConfigs.scopes,
                                transformAuthorizationUrl: runtimeConfigs.transformAuthorizationUrl,
                                authorizationParams: runtimeConfigs.authorizationParams,
                                tokenParams: runtimeConfigs.tokenParams,
                                sessionRestorationMethod: runtimeConfigs.sessionRestorationMethod,
                                debugLogs: runtimeConfigs.debugLogs,
                                __oidcProviderMetadata: runtimeConfigs.__oidcProviderMetadata,
                                autoLogout_returnToUrl: runtimeConfigs.autoLogout_returnToUrl,
                                disableDPoP: runtimeConfigs.disableDPoP,
                                warnUserSecondsBeforeAutoLogout:
                                    runtimeConfigs.warnUserSecondsBeforeAutoLogout,
                                createUser: params =>
                                    createUser({
                                        isMock: false,
                                        ...params
                                    })
                            });
                        } catch (error) {
                            if (!(error instanceof OidcInitializationError)) {
                                throw error;
                            }

                            dClientCtx.resolve({
                                isUserLoggedIn: false,
                                oidc: createOidcNotLoggedInLike({
                                    initializationError: error,
                                    config: {
                                        issuerUri: runtimeConfigs.issuerUri,
                                        clientId: runtimeConfigs.clientId
                                    }
                                })
                            });

                            break;
                        }

                        if (!oidc.isUserLoggedIn) {
                            dClientCtx.resolve({
                                isUserLoggedIn: false,
                                oidc
                            });
                            break;
                        }

                        dClientCtx.resolve({
                            isUserLoggedIn: true,
                            oidc,
                            dUser: new Deferred()
                        });
                    }
                    break;
            }

            resolve_dUser: {
                const { hasResolved, value: ctx } = dClientCtx.getState();

                assert(hasResolved, "49332832");

                if (!ctx.isUserLoggedIn) {
                    break resolve_dUser;
                }

                const { oidc, dUser } = ctx;

                // getOidc() can be used without a gate observing user readiness.
                void dUser.pr.catch(() => {});

                let user: ShallowRef<User> | undefined = undefined;

                const { unsubscribeFromUserChange } = oidc.subscribeToUserChange(
                    ({ user: user_next }) => {
                        if (user === undefined) {
                            user = shallowRef(user_next);
                        } else if (Object.is(user.value, user_next)) {
                            triggerRef(user);
                        } else {
                            user.value = user_next;
                        }
                    }
                );

                try {
                    // Initialize from the current tokens; refreshUser() explicitly renews them.
                    const user_initial = await oidc.getUser();
                    // A cached user may be returned without a new notification.
                    user ??= shallowRef(user_initial);
                } catch (error) {
                    unsubscribeFromUserChange();
                    if (!(error instanceof OidcInitializationError)) {
                        throw error;
                    }
                    dUser.resolve({
                        hasCreateUserThrown: true,
                        initializationError: error
                    });
                    break resolve_dUser;
                }

                assert(user !== undefined, "293302");

                dUser.resolve({
                    hasCreateUserThrown: false,
                    user: shallowReadonly(user)
                });
            }
        });

        prInitialization.catch(error => {
            const { hasResolved, value: ctx } = dClientCtx.getState();

            if (!hasResolved) {
                dClientCtx.reject(error);
            } else if (ctx.isUserLoggedIn) {
                ctx.dUser.reject(error);
            }
        });

        function triggerClientInitializationIfNotAlreadyDone(): void {
            d.resolve();
        }

        return { triggerClientInitializationIfNotAlreadyDone };
    })();

    const { useOidc } = (() => {
        const { autoLogoutState } = (() => {
            const autoLogoutState = shallowRef<AutoLogoutState>({ shouldDisplayWarning: false });

            dClientCtx.pr.then(
                ctx => {
                    const { oidc } = ctx;

                    if (!oidc.isUserLoggedIn) {
                        return;
                    }

                    oidc.subscribeToAutoLogoutState(autoLogoutState_next => {
                        autoLogoutState.value = autoLogoutState_next;
                    });
                },
                () => {}
            );

            return { autoLogoutState: shallowReadonly(autoLogoutState) };
        })();

        const autoLogoutState_notLoggedIn = shallowReadonly(
            shallowRef({ shouldDisplayWarning: false as const })
        );

        const getLogin = (() => {
            let login: Oidc_vue.NotLoggedIn["login"] | undefined;

            return (oidc: Oidc.NotLoggedIn) =>
                (login ??= ({ doesCurrentHrefEnforceLogin = false, ...rest }) =>
                    oidc.login({
                        ...rest,
                        doesCurrentHrefEnforceLogin
                    }));
        })();

        function useOidc(params?: { assert?: undefined }): Oidc_vue<User>;
        function useOidc(params: { assert: "user logged in" }): Oidc_vue.LoggedIn<User>;
        function useOidc(params: { assert: "user not logged in" }): Oidc_vue.NotLoggedIn;
        function useOidc(params?: { assert?: "user logged in" | "user not logged in" }): Oidc_vue<User> {
            if (!isBrowser) {
                throw new Error(
                    [
                        "oidc-spa: useOidc() can't be used in SSR'd components.",
                        "You can prevent this component from rendering on the server",
                        "by wrapping it into <OidcInitializationGate />"
                    ].join(" ")
                );
            }

            const { assert: assert_params } = params ?? {};

            type State =
                | {
                      isUserLoggedIn: false;
                      oidc: Oidc.NotLoggedIn;
                  }
                | {
                      isUserLoggedIn: true;
                      oidc: Oidc.LoggedIn<User>;
                      user: Readonly<ShallowRef<User>>;
                  };

            const state = ((): State => {
                const { hasResolved, value: ctx } = dClientCtx.getState();

                if (!hasResolved) {
                    throw new Error(
                        "oidc-spa: OIDC initialization is not complete. " +
                            "Wrap components calling useOidc() in <OidcInitializationGate />."
                    );
                }

                if (!ctx.isUserLoggedIn) {
                    return {
                        isUserLoggedIn: false,
                        oidc: ctx.oidc
                    };
                }

                const { hasResolved: hasResolved_user, value: ctx_user } = ctx.dUser.getState();

                if (!hasResolved_user) {
                    throw new Error(
                        "oidc-spa: OIDC initialization is not complete. " +
                            "Wrap components calling useOidc() in <OidcInitializationGate />."
                    );
                }

                if (ctx_user.hasCreateUserThrown) {
                    return {
                        isUserLoggedIn: false as const,
                        oidc: id<Oidc.NotLoggedIn>({
                            isUserLoggedIn: false,
                            issuerUri: ctx.oidc.issuerUri,
                            clientId: ctx.oidc.clientId,
                            validRedirectUri: ctx.oidc.validRedirectUri,
                            login: () => {
                                console.warn(
                                    [
                                        "oidc-spa: Calling login while user already logged in but the user",
                                        "object couldn't be constructed, reloading the page"
                                    ].join(" ")
                                );
                                window.location.reload();
                                return new Promise<never>(() => {});
                            },
                            initializationError: ctx_user.initializationError
                        })
                    };
                }

                return {
                    isUserLoggedIn: true as const,
                    oidc: ctx.oidc,
                    user: ctx_user.user
                };
            })();

            check_assertion: {
                if (assert_params === undefined) {
                    break check_assertion;
                }

                const getMessage = (v: string) =>
                    [
                        "oidc-spa: There is a logic error in the application.",
                        `If this component is mounted the user is supposed ${v}.`,
                        "An explicit assertion was made in this sense."
                    ].join(" ");

                switch (assert_params) {
                    case "user logged in":
                        if (!state.isUserLoggedIn) {
                            throw new Error(getMessage("to be logged in but currently they arn't"));
                        }
                        break;
                    case "user not logged in":
                        if (state.isUserLoggedIn) {
                            throw new Error(getMessage("not to be logged in but currently they are"));
                        }
                        break;
                    default:
                        assert<Equals<typeof assert_params, never>>(false);
                }
            }

            if (!state.isUserLoggedIn) {
                return id<Oidc_vue.NotLoggedIn>({
                    isUserLoggedIn: false,
                    initializationError: state.oidc.initializationError,
                    get issuerUri() {
                        return state.oidc.issuerUri;
                    },
                    get clientId() {
                        return state.oidc.clientId;
                    },
                    get validRedirectUri() {
                        return state.oidc.validRedirectUri;
                    },
                    autoLogoutState: autoLogoutState_notLoggedIn,
                    login: getLogin(state.oidc)
                });
            }

            return id<Oidc_vue.LoggedIn<User>>({
                isUserLoggedIn: true,
                issuerUri: state.oidc.issuerUri,
                clientId: state.oidc.clientId,
                validRedirectUri: state.oidc.validRedirectUri,
                logout: state.oidc.logout,
                renewTokens: state.oidc.renewTokens,
                startAuthorization: state.oidc.startAuthorization,
                authorizationResult: state.oidc.authorizationResult,
                isNewBrowserSession: state.oidc.isNewBrowserSession,
                autoLogoutState,
                user: state.user,
                refreshUser: state.oidc.refreshUser
            });
        }

        return { useOidc };
    })();

    let returnToUrl_temporaryOverride: string | undefined = undefined;

    let clearReturnToUrlOverride: (() => void) | undefined;

    const { getOidc } = (() => {
        let oidc_cached: Oidc<User> | undefined = undefined;

        function getOidc(params?: { assert?: undefined }): Promise<Oidc<User>>;
        function getOidc(params: { assert: "user logged in" }): Promise<Oidc.LoggedIn<User>>;
        function getOidc(params: { assert: "user not logged in" }): Promise<Oidc.NotLoggedIn>;
        async function getOidc(params?: {
            assert?: "user logged in" | "user not logged in";
        }): Promise<Oidc<User>> {
            if (!isBrowser) {
                throw new Error(
                    [
                        "oidc-spa: getOidc() can't be used on the server",
                        "if you use it in a loader, make sure to mark the route",
                        "as `ssr: false`."
                    ].join(" ")
                );
            }

            triggerClientInitializationIfNotAlreadyDone();

            const ctx = await dClientCtx.pr;

            if (params?.assert === "user logged in" && !ctx.isUserLoggedIn) {
                throw new Error(
                    [
                        "oidc-spa: Called getOidc({ assert: 'user logged in' })",
                        "but the user is not currently logged in."
                    ].join(" ")
                );
            }
            if (params?.assert === "user not logged in" && ctx.isUserLoggedIn) {
                throw new Error(
                    [
                        "oidc-spa: Called getOidc({ assert: 'user not logged in' })",
                        "but the user is currently logged in."
                    ].join(" ")
                );
            }

            if (oidc_cached !== undefined) {
                return oidc_cached;
            }

            oidc_cached = (() => {
                if (ctx.oidc.isUserLoggedIn) {
                    const { oidc } = ctx;
                    const oidc_proxy = id<Oidc.LoggedIn<User>>({
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
                        getAccessToken: async (params): Promise<string> => {
                            const { accessToken } = await oidc_proxy.getTokens(params);
                            return accessToken;
                        }
                    });
                    return oidc_proxy;
                } else {
                    return ctx.oidc;
                }
            })();

            return oidc_cached;
        }

        return { getOidc };
    })();

    async function enforceLogin(to: RouteLocationNormalizedGenericLike): Promise<void | never> {
        if (!isBrowser) {
            throw new Error("oidc-spa: enforceLogin cannot be used on the server");
        }

        // A new attempt supersedes any destination whose navigation was cancelled.
        clearReturnToUrlOverride?.();
        triggerClientInitializationIfNotAlreadyDone();

        const ctx = await dClientCtx.pr;

        if (!ctx.isUserLoggedIn && ctx.oidc.initializationError !== undefined) {
            throw ctx.oidc.initializationError;
        }

        const returnToUrl = toFullyQualifiedUrl({
            urlish: to.fullPath,
            doAssertNoQueryParams: false,
            rootUrl_fullyQualified: ctx.oidc.validRedirectUri
        });
        const isUrlAlreadyReplaced =
            window.location.href.replace(/\/$/, "") === returnToUrl.replace(/\/$/, "");

        if (!ctx.isUserLoggedIn) {
            await ctx.oidc.login({
                returnToUrl,
                doesCurrentHrefEnforceLogin: isUrlAlreadyReplaced
            });
            assert(false, "333203");
        }

        set_returnToUrl_getTokens: {
            if (isUrlAlreadyReplaced) {
                break set_returnToUrl_getTokens;
            }

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

        {
            const ctx_user = await ctx.dUser.pr;

            if (ctx_user.hasCreateUserThrown) {
                throw ctx_user.initializationError;
            }
        }
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

            let isActive = true;

            onMounted(async () => {
                triggerClientInitializationIfNotAlreadyDone();

                const ctx = await dClientCtx.pr;

                if (!isActive) {
                    return;
                }

                if (ctx.isUserLoggedIn) {
                    await ctx.dUser.pr;
                    if (!isActive) {
                        return;
                    }
                }

                isReadyToRender.value = true;
            });

            onUnmounted(() => {
                isActive = false;
            });

            return () =>
                isReadyToRender.value ? slots.default?.() : slots.fallback?.() ?? props.fallback ?? null;
        }
    });

    return { useOidc, getOidc, enforceLogin, OidcInitializationGate };
}
