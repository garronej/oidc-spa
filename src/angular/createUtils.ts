import { isPlatformBrowser } from "@angular/common";
import {
    computed,
    DestroyRef,
    ErrorHandler,
    inject,
    InjectionToken,
    Injector,
    makeEnvironmentProviders,
    PLATFORM_ID,
    provideAppInitializer,
    runInInjectionContext,
    signal,
    type Signal,
    type WritableSignal
} from "@angular/core";
import type { HttpInterceptorFn } from "@angular/common/http";
import {
    NavigationCancel,
    NavigationEnd,
    NavigationError,
    NavigationSkipped,
    Router
} from "@angular/router";
import { defer, finalize, from, switchMap } from "rxjs";
import type { CreateClientUser, Oidc_angular, Oidc, OidcSpaUtils, RuntimeConfigs } from "./types";
import { OidcInitializationError } from "../core/OidcInitializationError";
import { Deferred } from "../tools/Deferred";
import { assert } from "../tools/tsafe/assert";
import { id } from "../tools/tsafe/id";
import type { OptionallyAsyncGetterOrDirectValue } from "../tools/GetterOrDirectValue";
import { toFullyQualifiedUrl } from "../tools/toFullyQualifiedUrl";
import { getBASE_URL_earlyInit } from "../core/earlyInit_BASE_URL";

export function createUtils<User>(params: {
    providerAwaitsInitialization: boolean;
    createUser: CreateClientUser<User>;
}): OidcSpaUtils<User> {
    const { providerAwaitsInitialization, createUser } = params;

    // Provider configuration stays in Angular's injection context. Imperative access belongs
    // to one active browser app; SSR requests each get an independent, pending runtime.
    let dRuntime = new Deferred<Runtime>();
    let activeRuntime: Runtime | undefined;

    function createRuntime() {
        const injector = inject(Injector);
        const destroyRef = inject(DestroyRef);
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
                            user: Signal<User>;
                        }
                  >;
              }
        >();

        const initialized = signal(false);
        type AutoLogoutState = ReturnType<Oidc_angular.LoggedIn<User>["autoLogoutState"]>;
        const autoLogoutState = signal<AutoLogoutState>({ shouldDisplayWarning: false });
        const cleanups = new Set<() => void>();
        let isRunningGetRuntimeConfigs = false;
        let isEvaluatingInterceptor = false;
        let destroyed = false;
        let returnToUrl_temporaryOverride: string | undefined;
        let clearReturnToUrlOverride: (() => void) | undefined;

        destroyRef.onDestroy(() => {
            destroyed = true;
            cleanups.forEach(cleanup => cleanup());
            cleanups.clear();
        });

        function registerCleanup(cleanup: () => void): () => void {
            let active = true;
            const unsubscribe = () => {
                if (!active) return;
                active = false;
                cleanups.delete(unsubscribe);
                cleanup();
            };
            if (destroyed) {
                unsubscribe();
            } else {
                cleanups.add(unsubscribe);
            }
            return unsubscribe;
        }

        const { initialize } = (() => {
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
                        window.alert("Authentication is currently unavailable. Please try again later.");
                        return new Promise<never>(() => {});
                    },
                    initializationError
                };
            }

            let hasStarted = false;

            function initialize(
                getRuntimeConfigsOrRuntimeConfigs: OptionallyAsyncGetterOrDirectValue<
                    void,
                    RuntimeConfigs
                >
            ): Promise<true> {
                if (hasStarted) return prInitialized;
                hasStarted = true;

                const prInitialization = (async () => {
                    let runtimeConfigs: RuntimeConfigs;

                    isRunningGetRuntimeConfigs = true;
                    try {
                        runtimeConfigs = await (typeof getRuntimeConfigsOrRuntimeConfigs === "function"
                            ? runInInjectionContext(injector, getRuntimeConfigsOrRuntimeConfigs)
                            : getRuntimeConfigsOrRuntimeConfigs);
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
                        return;
                    } finally {
                        isRunningGetRuntimeConfigs = false;
                    }

                    if (destroyed) return;

                    switch (runtimeConfigs.mode) {
                        case "mock":
                            {
                                const { createMockOidc } = await import("../core/createMockOidc");

                                const oidc = await createMockOidc<User>({
                                    createUser_mock: params =>
                                        runInInjectionContext(injector, () =>
                                            createUser({
                                                isMock: true,
                                                ...params
                                            })
                                        ),
                                    isUserInitiallyLoggedIn:
                                        runtimeConfigs.isUserInitiallyLoggedIn ?? true,

                                    issuerUri_mock: runtimeConfigs.issuerUri_mock,
                                    clientId_mock: runtimeConfigs.clientId_mock,
                                    idTokenClaims_mock: runtimeConfigs.idTokenClaims_mock,
                                    idToken_mock: runtimeConfigs.idToken_mock,
                                    accessToken_mock: runtimeConfigs.accessToken_mock,
                                    refreshToken_mock: runtimeConfigs.refreshToken_mock
                                });

                                if (destroyed) return;

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
                                        transformAuthorizationUrl:
                                            runtimeConfigs.transformAuthorizationUrl,
                                        authorizationParams: runtimeConfigs.authorizationParams,
                                        tokenParams: runtimeConfigs.tokenParams,
                                        sessionRestorationMethod:
                                            runtimeConfigs.sessionRestorationMethod,
                                        debugLogs: runtimeConfigs.debugLogs,
                                        __oidcProviderMetadata: runtimeConfigs.__oidcProviderMetadata,
                                        autoLogout_returnToUrl: runtimeConfigs.autoLogout_returnToUrl,
                                        disableDPoP: runtimeConfigs.disableDPoP,
                                        warnUserSecondsBeforeAutoLogout:
                                            runtimeConfigs.warnUserSecondsBeforeAutoLogout,
                                        createUser: params =>
                                            runInInjectionContext(injector, () =>
                                                createUser({
                                                    isMock: false,
                                                    ...params
                                                })
                                            )
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

                                if (destroyed) return;

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
                        void dUser.pr.catch(() => {});

                        registerCleanup(
                            oidc.subscribeToAutoLogoutState(state => autoLogoutState.set(state))
                                .unsubscribeFromAutoLogoutState
                        );

                        let user: WritableSignal<User> | undefined = undefined;

                        const unsubscribeFromUserChange = registerCleanup(
                            oidc.subscribeToUserChange(({ user: user_next }) => {
                                if (destroyed) return;
                                if (user === undefined) {
                                    user = signal(user_next);
                                } else {
                                    user.set(user_next);
                                }
                            }).unsubscribeFromUserChange
                        );

                        try {
                            // Initialize from the current tokens; refreshUser() explicitly renews them.
                            const user_initial = await oidc.getUser();
                            // A cached user may be returned without a new notification.
                            user ??= signal(user_initial);
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
                            user: user.asReadonly()
                        });
                    }
                })();

                prInitialization.catch(error => {
                    const { hasResolved, value: ctx } = dClientCtx.getState();

                    if (!hasResolved) {
                        dClientCtx.reject(error);
                    } else if (ctx.isUserLoggedIn) {
                        ctx.dUser.reject(error);
                    }
                });

                return prInitialized;
            }

            return { initialize };
        })();

        function getClientCtx(caller: string) {
            initialized();
            const state = dClientCtx.getState();
            if (!state.hasResolved) {
                // Only the interceptor retries pending auth reads. Application reads must be gated.
                if (isEvaluatingInterceptor) throw dClientCtx.pr;
                throw new Error(
                    `oidc-spa: ${caller} accessed before core authentication is ready. ` +
                        "Gate your UI with @defer (when oidc.prInitialized | async)."
                );
            }
            return state.value;
        }

        function getCore(caller: string): Oidc<User> {
            const { oidc } = getClientCtx(caller);
            if (!oidc.isUserLoggedIn && oidc.initializationError !== undefined) {
                throw oidc.initializationError;
            }
            return oidc;
        }

        function getLoggedInCore(caller: string) {
            const oidc = getCore(caller);
            if (!oidc.isUserLoggedIn) {
                throw new Error(`oidc-spa: ${caller} called/accessed but the user is not logged in.`);
            }
            return oidc;
        }

        function getInitializationError(): OidcInitializationError | undefined {
            const ctx = getClientCtx("initializationError");

            if (!ctx.isUserLoggedIn) {
                return ctx.oidc.initializationError;
            }

            const { hasResolved, value: ctx_user } = ctx.dUser.getState();

            if (!hasResolved) {
                throw new Error(
                    "oidc-spa: initializationError accessed before oidc.prInitialized resolved."
                );
            }

            return ctx_user.hasCreateUserThrown ? ctx_user.initializationError : undefined;
        }

        const prInitialized = (async () => {
            const ctx = await dClientCtx.pr;

            if (ctx.isUserLoggedIn) {
                await ctx.dUser.pr;
            }

            initialized.set(true);
            return true as const;
        })();
        // The provider observes unexpected failures, including in non-blocking mode.
        void prInitialized.catch(() => {});

        const oidc: Omit<Oidc_angular.LoggedIn<User>, "isUserLoggedIn"> & {
            isUserLoggedIn: boolean;
            login: Oidc_angular.NotLoggedIn["login"];
            readonly initializationError: OidcInitializationError | undefined;
        } = {
            prInitialized,
            get initializationError() {
                return getInitializationError();
            },
            get issuerUri() {
                return getClientCtx("issuerUri").oidc.issuerUri;
            },
            get clientId() {
                return getClientCtx("clientId").oidc.clientId;
            },
            get validRedirectUri() {
                return getClientCtx("validRedirectUri").oidc.validRedirectUri;
            },
            get isUserLoggedIn() {
                const ctx = getClientCtx("isUserLoggedIn");

                if (!ctx.isUserLoggedIn) {
                    return false;
                }

                const { hasResolved, value: ctx_user } = ctx.dUser.getState();

                // Interceptors can read authentication state before the user is ready.
                return !hasResolved || !ctx_user.hasCreateUserThrown;
            },
            get isNewBrowserSession() {
                return getLoggedInCore("isNewBrowserSession").isNewBrowserSession;
            },
            get authorizationResult() {
                return getLoggedInCore("authorizationResult").authorizationResult;
            },
            async login({ doesCurrentHrefEnforceLogin = false, ...rest } = {}) {
                await prInitialized;
                const ctx = getClientCtx("login");
                if (ctx.isUserLoggedIn) {
                    if (getInitializationError() !== undefined) {
                        console.warn(
                            "oidc-spa: The user object could not be constructed, reloading the page."
                        );
                        window.location.reload();
                        return new Promise<never>(() => {});
                    }
                    throw new Error(
                        "oidc-spa: login() called while already logged in. Use startAuthorization() instead."
                    );
                }
                return ctx.oidc.login({ ...rest, doesCurrentHrefEnforceLogin });
            },
            async logout(params) {
                await dClientCtx.pr;
                return getLoggedInCore("logout").logout(params);
            },
            async renewTokens() {
                await dClientCtx.pr;
                return getLoggedInCore("renewTokens").renewTokens();
            },
            async startAuthorization(params) {
                await dClientCtx.pr;
                return getLoggedInCore("startAuthorization").startAuthorization(params);
            },
            autoLogoutState: computed(() =>
                initialized() && getInitializationError() !== undefined
                    ? { shouldDisplayWarning: false as const }
                    : autoLogoutState()
            ),
            user: computed(() => {
                initialized();
                const { hasResolved, value: ctx } = dClientCtx.getState();

                if (!hasResolved) {
                    throw new Error(
                        "oidc-spa: User accessed before oidc.prInitialized resolved. " +
                            "Gate your UI with @defer (when oidc.prInitialized | async). " +
                            "Do not wait for the user from inside createUser."
                    );
                }

                if (!ctx.isUserLoggedIn) {
                    getLoggedInCore("user");
                    assert(false);
                }

                const { hasResolved: hasResolved_user, value: ctx_user } = ctx.dUser.getState();

                if (!hasResolved_user) {
                    throw new Error(
                        isEvaluatingInterceptor
                            ? "oidc-spa: shouldInjectAccessToken accessed the user before it was ready. " +
                              "Requests made by createUser must depend only on authentication state, not on the user being constructed."
                            : "oidc-spa: User accessed before oidc.prInitialized resolved. " +
                              "Gate your UI with @defer (when oidc.prInitialized | async). " +
                              "Do not wait for the user from inside createUser."
                    );
                }

                if (ctx_user.hasCreateUserThrown) {
                    throw ctx_user.initializationError;
                }

                return ctx_user.user();
            }),
            async refreshUser() {
                await prInitialized;
                const error = getInitializationError();
                if (error !== undefined) throw error;
                return getLoggedInCore("refreshUser").refreshUser();
            }
        };

        const { getOidc } = (() => {
            let oidc_cached: Oidc<User> | undefined = undefined;

            async function getOidc(params?: {
                assert?: "user logged in" | "user not logged in";
            }): Promise<Oidc<User>> {
                const ctx = await dClientCtx.pr;

                checkAssertion(ctx.oidc, params?.assert, "getOidc");

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
                            },
                            subscribeToTokensChange: next => ({
                                unsubscribeFromTokensChange: registerCleanup(
                                    oidc.subscribeToTokensChange(next).unsubscribeFromTokensChange
                                )
                            }),
                            subscribeToUserChange: next => ({
                                unsubscribeFromUserChange: registerCleanup(
                                    oidc.subscribeToUserChange(next).unsubscribeFromUserChange
                                )
                            }),
                            subscribeToAutoLogoutState: next => ({
                                unsubscribeFromAutoLogoutState: registerCleanup(
                                    oidc.subscribeToAutoLogoutState(next).unsubscribeFromAutoLogoutState
                                )
                            })
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

        function setReturnToUrlOverride(returnToUrl: string, router: Router) {
            clearReturnToUrlOverride?.();
            returnToUrl_temporaryOverride = returnToUrl;
            // Angular's navigation events also clear the override when a navigation is cancelled
            // or fails, cases where history.pushState/replaceState are never called.
            const subscription = router.events.subscribe(event => {
                if (
                    event instanceof NavigationEnd ||
                    event instanceof NavigationCancel ||
                    event instanceof NavigationError ||
                    event instanceof NavigationSkipped
                )
                    clearReturnToUrlOverride?.();
            });
            clearReturnToUrlOverride = registerCleanup(() => {
                subscription.unsubscribe();
                returnToUrl_temporaryOverride = undefined;
                clearReturnToUrlOverride = undefined;
            });
        }

        return {
            oidc,
            initialize,
            getOidc,
            getCore,
            setReturnToUrlOverride,
            prClientCtx: dClientCtx.pr,
            get isRunningGetRuntimeConfigs() {
                return isRunningGetRuntimeConfigs;
            },
            evaluateInterceptor<T>(callback: () => T): T {
                const previous = isEvaluatingInterceptor;
                isEvaluatingInterceptor = true;
                try {
                    return callback();
                } finally {
                    isEvaluatingInterceptor = previous;
                }
            }
        };
    }

    type Runtime = ReturnType<typeof createRuntime>;
    const runtimeToken = new InjectionToken<Runtime>("oidc-spa runtime");

    function checkAssertion(
        oidc: {
            readonly isUserLoggedIn: boolean;
            readonly initializationError?: OidcInitializationError;
        },
        assertion: "user logged in" | "user not logged in" | undefined,
        caller: string
    ) {
        if (assertion !== undefined && oidc.isUserLoggedIn !== (assertion === "user logged in")) {
            if (assertion === "user logged in" && oidc.initializationError !== undefined) {
                throw oidc.initializationError;
            }
            throw new Error(
                `oidc-spa: Called ${caller}({ assert: '${assertion}' }), but the user is ${
                    oidc.isUserLoggedIn ? "logged in" : "not logged in"
                }.`
            );
        }
    }

    function provideOidc(
        getRuntimeConfigsOrRuntimeConfigs: OptionallyAsyncGetterOrDirectValue<void, RuntimeConfigs>
    ) {
        return makeEnvironmentProviders([
            { provide: runtimeToken, useFactory: createRuntime },
            provideAppInitializer(() => {
                if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
                const runtime = inject(runtimeToken);
                if (activeRuntime !== undefined && activeRuntime !== runtime) {
                    throw new Error(
                        "oidc-spa: Each createUtils() instance supports one active application injector. Call createUtils() separately for independent applications."
                    );
                }
                if (activeRuntime === undefined) {
                    activeRuntime = runtime;
                    dRuntime.resolve(runtime);
                    inject(DestroyRef).onDestroy(() => {
                        activeRuntime = undefined;
                        dRuntime = new Deferred<Runtime>();
                    });
                }
                const prInitialized = runtime.initialize(getRuntimeConfigsOrRuntimeConfigs);
                if (providerAwaitsInitialization) return prInitialized;
                const errorHandler = inject(ErrorHandler, { optional: true });
                void prInitialized.catch(error => {
                    if (errorHandler !== null) {
                        errorHandler.handleError(error);
                    } else {
                        console.error(error);
                    }
                });
            })
        ]);
    }

    function injectOidc(params?: {
        assert?: "user logged in" | "user not logged in";
    }): Oidc_angular<User> {
        const { oidc } = inject(runtimeToken);
        if (params?.assert !== undefined) {
            checkAssertion(oidc, params.assert, "injectOidc");
        }
        return oidc as unknown as Oidc_angular<User>;
    }

    async function getOidc(params?: {
        assert?: "user logged in" | "user not logged in";
    }): Promise<Oidc<User>> {
        if (typeof window === "undefined" || typeof window.document === "undefined") {
            throw new Error("oidc-spa: getOidc() cannot be used on the server.");
        }
        const runtime = await dRuntime.pr;
        return runtime.getOidc(params);
    }

    return {
        provideOidc,
        // @ts-expect-error: Assertion overloads are enforced at runtime.
        injectOidc,
        // @ts-expect-error: Assertion overloads are enforced at runtime.
        getOidc,
        createOidcInterceptor: ({
            shouldInjectAccessToken
        }: Parameters<OidcSpaUtils<User>["createOidcInterceptor"]>[0]) => {
            const interceptor: HttpInterceptorFn = (req, next) => {
                const runtime = inject(runtimeToken);
                const injector = inject(Injector);
                const evaluate = () =>
                    runInInjectionContext(injector, () =>
                        runtime.evaluateInterceptor(() => shouldInjectAccessToken(req))
                    );
                let decision: boolean | undefined;
                try {
                    decision = evaluate();
                } catch (error) {
                    if (error !== runtime.prClientCtx) throw error;
                }
                if (decision === false) return next(req);

                return defer(() => {
                    const timer = setTimeout(() => {
                        if (!runtime.isRunningGetRuntimeConfigs) return;
                        console.warn(
                            `oidc-spa: Probable deadlock: ${req.method} ${req.urlWithParams} is waiting for authentication ` +
                                "while provideOidc's configuration is loading. Requests used to load that configuration " +
                                "must return false from shouldInjectAccessToken before reading authentication state."
                        );
                    }, 4_000);
                    return from(runtime.prClientCtx).pipe(
                        switchMap(() => {
                            if (!(decision ?? evaluate())) return next(req);
                            const oidc = runtime.getCore("createOidcInterceptor");
                            if (!oidc.isUserLoggedIn) {
                                throw new Error(
                                    `oidc-spa: Attempted to attach an access token to ${req.method} ${req.urlWithParams}, but the user is not logged in.`
                                );
                            }
                            return from(oidc.getAccessToken()).pipe(
                                switchMap(accessToken =>
                                    next(
                                        req.clone({
                                            setHeaders: { Authorization: `Bearer ${accessToken}` }
                                        })
                                    )
                                )
                            );
                        }),
                        finalize(() => clearTimeout(timer))
                    );
                });
            };
            return interceptor;
        },
        enforceLoginGuard: async (
            route: Parameters<import("@angular/router").CanActivateFn>[0],
            state?: Parameters<import("@angular/router").CanActivateFn>[1]
        ): Promise<true> => {
            if (!isPlatformBrowser(inject(PLATFORM_ID))) {
                throw new Error(
                    "oidc-spa: enforceLoginGuard cannot run during server-side rendering. " +
                        "Configure this route with renderMode: RenderMode.Client in your server routes configuration (app.routes.server.ts)."
                );
            }
            const runtime = inject(runtimeToken);
            const router = inject(Router);
            const navigationId = router.getCurrentNavigation()?.id;
            const ctx = await runtime.prClientCtx;
            // Angular can cancel a navigation while authentication is still pending.
            // Its guard promise continues running, so do not redirect or install an override
            // for a route that is no longer being activated.
            if (navigationId !== undefined && router.getCurrentNavigation()?.id !== navigationId)
                return true;
            if (!ctx.isUserLoggedIn && ctx.oidc.initializationError !== undefined) {
                throw ctx.oidc.initializationError;
            }
            const returnToUrl = toFullyQualifiedUrl({
                urlish:
                    state?.url ??
                    router.serializeUrl(
                        router.createUrlTree(
                            route.pathFromRoot.flatMap(snapshot =>
                                snapshot.url.map(segment => segment.path)
                            ),
                            { queryParams: route.queryParams, fragment: route.fragment ?? undefined }
                        )
                    ),
                rootUrl_fullyQualified: ctx.oidc.validRedirectUri,
                doAssertNoQueryParams: false
            });
            const isUrlAlreadyReplaced =
                window.location.href.replace(/\/$/, "") === returnToUrl.replace(/\/$/, "");
            if (!ctx.isUserLoggedIn) {
                await ctx.oidc.login({ returnToUrl, doesCurrentHrefEnforceLogin: isUrlAlreadyReplaced });
                assert(false, "333203");
            }
            if (!isUrlAlreadyReplaced) runtime.setReturnToUrlOverride(returnToUrl, router);

            const ctx_user = await ctx.dUser.pr;
            if (navigationId !== undefined && router.getCurrentNavigation()?.id !== navigationId)
                return true;
            if (ctx_user.hasCreateUserThrown) {
                throw ctx_user.initializationError;
            }
            return true;
        }
    };
}
