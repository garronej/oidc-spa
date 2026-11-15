import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { build } from "esbuild";
import { createRenderer, defineComponent, h, isReadonly, isRef, nextTick } from "vue";
import { parse, compileScript } from "vue/compiler-sfc";
import { renderToString } from "vue/server-renderer";

const { outputFiles, metafile } = await build({
    stdin: {
        contents: `
            export * from "./src/vue";
            export { setBASE_URL_earlyInit } from "./src/core/earlyInit_BASE_URL";
            export { setGetRootRelativeOriginalLocationHref_earlyInit } from "./src/core/earlyInit_rootRelativeOriginalLocationHref";
        `,
        resolveDir: fileURLToPath(new URL("../../", import.meta.url))
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vue"],
    write: false,
    metafile: true,
    plugins: [
        {
            name: "real-oidc-fixture",
            setup(build) {
                build.onResolve({ filter: /^\.\.\/core$/ }, args =>
                    args.importer.endsWith("/vue/createUtils.ts")
                        ? { path: "real-oidc", namespace: "fixture" }
                        : undefined
                );
                build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
                    contents:
                        "export const createOidc = params => globalThis.createOidc_fixture(params);"
                }));
            }
        }
    ]
});

// Compile the same destructured consumer that vue-tsc checks, including its template.
const consumerUrl = new URL("../../tests/vue/Consumer.vue", import.meta.url);
const { descriptor } = parse(readFileSync(consumerUrl, "utf8"), { filename: consumerUrl.pathname });
const consumerScript = compileScript(descriptor, { id: "oidc-consumer", inlineTemplate: true });
const consumerBuild = await build({
    stdin: { contents: consumerScript.content, loader: "ts" },
    format: "cjs",
    write: false
});
const consumerModule = { exports: {} };
runInNewContext(consumerBuild.outputFiles[0].text, {
    module: consumerModule,
    require: createRequire(import.meta.url)
});
const Consumer = consumerModule.exports.default;

function load({ browser = true, createOidc } = {}) {
    const module = { exports: {} };
    const location = new URL("https://app.test/app/");
    let reloads = 0;
    location.reload = () => reloads++;
    const document = {};
    const listeners = new Map();
    const history = {
        pushState: (_state, _title, url) => (location.href = new URL(url, location).href),
        replaceState: (_state, _title, url) => (location.href = new URL(url, location).href)
    };
    const window = {
        location,
        document,
        history,
        setTimeout,
        clearTimeout,
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type, listener) => {
            if (listeners.get(type) === listener) listeners.delete(type);
        }
    };
    runInNewContext(outputFiles[0].text, {
        module,
        require: createRequire(import.meta.url),
        console,
        URL,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        alert() {},
        createOidc_fixture: createOidc,
        ...(browser ? { window, document, navigator: {} } : {})
    });
    const api = module.exports;
    api.setBASE_URL_earlyInit({ BASE_URL: "/app/" });
    api.setGetRootRelativeOriginalLocationHref_earlyInit({
        rootRelativeOriginalLocationHref: "/app/"
    });
    return { ...api, location, history, listeners, getReloads: () => reloads };
}

// Exercise real Vue component lifecycles and reactivity without a browser DOM.
const renderer = createRenderer({
    createElement: type => ({ type, children: [], props: {} }),
    createText: text => ({ text }),
    createComment: () => ({ text: "" }),
    setText: (node, text) => (node.text = text),
    setElementText: (node, text) => (node.children = [{ text }]),
    parentNode: node => node.parent,
    nextSibling: node => {
        const siblings = node.parent?.children ?? [];
        return siblings[siblings.indexOf(node) + 1];
    },
    patchProp: (node, key, _previous, value) => (node.props[key] = value),
    insert(node, parent, anchor) {
        if (node.parent) {
            const siblings = node.parent.children;
            siblings.splice(siblings.indexOf(node), 1);
        }
        const index = anchor ? parent.children.indexOf(anchor) : -1;
        parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
        node.parent = parent;
    },
    remove(node) {
        const siblings = node.parent?.children;
        if (siblings) siblings.splice(siblings.indexOf(node), 1);
        node.parent = undefined;
    }
});

function mount(component) {
    const root = { children: [] };
    const errors = [];
    const app = renderer.createApp(component);
    app.config.errorHandler = error => errors.push(error);
    app.mount(root);
    return { root, errors, unmount: () => app.unmount() };
}

function text(node) {
    return node.text ?? (node.children ?? []).map(text).join("");
}

const flush = async () => {
    await new Promise(resolve => setImmediate(resolve));
    await nextTick();
};

const realConfigs = { mode: "real", issuerUri: "https://auth.test", clientId: "app" };

function loggedOut(login = () => new Promise(() => {})) {
    return {
        isUserLoggedIn: false,
        issuerUri: "https://auth.test",
        clientId: "app",
        validRedirectUri: "https://app.test/app/",
        initializationError: undefined,
        login
    };
}

test("Vue export exposes router-based utilities without a React runtime dependency", () => {
    for (const path of Object.keys(metafile.inputs)) {
        assert.doesNotMatch(path, /react|angular|tanstack/);
    }
    const { oidcSpa } = load();
    const utils = oidcSpa
        .withUser(() => ({}))
        .withRuntimeConfigs({ mode: "mock" })
        .createUtils();
    assert.deepEqual(Object.keys(utils).sort(), [
        "OidcInitializationGate",
        "enforceLogin",
        "getOidc",
        "useOidc"
    ]);
    assert.throws(() => utils.useOidc(), /OidcInitializationGate/);
});

test("gate waits for async user creation; refs preserve user identity and update on refresh", async () => {
    const { oidcSpa } = load();
    let finishUser;
    const pendingUser = new Promise(resolve => (finishUser = resolve));
    let configCalls = 0;
    let userCalls = 0;
    let mounted = 0;
    let userRef;
    let currentUser;
    const utils = oidcSpa
        .withUser(async ({ user_current }) => {
            userCalls++;
            currentUser = user_current;
            // Authenticated requests made by createUser must not deadlock.
            const oidc = await utils.getOidc({ assert: "user logged in" });
            assert.equal(await oidc.getAccessToken(), "mocked-access-token");
            if (userCalls === 1) await pendingUser;
            return { name: `User ${userCalls}`, canSeeAdminNavigation: true };
        })
        .withRuntimeConfigs(async () => {
            configCalls++;
            return { mode: "mock" };
        })
        .createUtils();
    const Child = defineComponent({
        setup() {
            mounted++;
            const { user } = utils.useOidc({ assert: "user logged in" });
            userRef = user;
            return () => h(Consumer, { useOidc: utils.useOidc });
        }
    });
    const app = mount(() =>
        h(utils.OidcInitializationGate, null, {
            default: () => [h(Child), h(Child)],
            fallback: () => "Loading"
        })
    );
    await flush();
    assert.equal(configCalls, 1);
    assert.equal(mounted, 0);
    assert.equal(text(app.root), "Loading");
    const [oidc, other] = await Promise.all([utils.getOidc(), utils.getOidc()]);
    assert.equal(oidc, other);
    finishUser();
    await flush();
    assert.equal(mounted, 2);
    assert.equal(text(app.root), "User 1User 1");
    assert(isRef(userRef));
    assert(isReadonly(userRef));
    const firstUser = await oidc.getUser();
    assert.equal(userRef.value, firstUser);
    await oidc.refreshUser();
    await nextTick();
    assert.equal(currentUser, firstUser);
    assert.equal(text(app.root), "User 2User 2");
    assert.equal(configCalls, 1);
    assert.throws(() => utils.useOidc({ assert: "user not logged in" }), /logic error/);
    await assert.rejects(utils.getOidc({ assert: "user not logged in" }), /currently logged in/);
    assert.equal(app.errors.length, 0);
    app.unmount();
});

test("configuration failures render public content and throw from enforceLogin", async () => {
    const { oidcSpa, OidcInitializationError } = load();
    const cause = new Error("runtime configuration unavailable");
    const utils = oidcSpa
        .withUser(() => assert.fail("no user"))
        .withRuntimeConfigs(async () => {
            throw cause;
        })
        .createUtils();
    const app = mount(() =>
        h(utils.OidcInitializationGate, null, {
            default: () => "Public page",
            fallback: () => "Loading"
        })
    );
    await flush();
    assert.equal(text(app.root), "Public page");
    const oidc = utils.useOidc({ assert: "user not logged in" });
    assert(oidc.initializationError instanceof OidcInitializationError);
    assert.equal(oidc.initializationError.cause.cause, cause);
    assert.equal((await utils.getOidc()).initializationError, oidc.initializationError);
    assert.equal(oidc.issuerUri, "https://not-resolved-yet");
    assert.equal(oidc.clientId, "not-resolved-yet");
    assert.equal(oidc.validRedirectUri, "https://app.test/app/");
    assert.throws(() => utils.useOidc({ assert: "user logged in" }), /logic error/);
    await assert.rejects(utils.enforceLogin({ fullPath: "https://app.test/app/account" }), error => {
        assert.equal(error, oidc.initializationError);
        return true;
    });
    app.unmount();
});

test("destructured template consumers safely skip user access when logged out", async () => {
    const { oidcSpa } = load();
    const utils = oidcSpa
        .withUser(() => assert.fail("a logged-out client has no user"))
        .withRuntimeConfigs({ mode: "mock", isUserInitiallyLoggedIn: false })
        .createUtils();
    const app = mount(() =>
        h(utils.OidcInitializationGate, null, {
            default: () => h(Consumer, { useOidc: utils.useOidc })
        })
    );
    await flush();
    assert.equal(text(app.root), "");
    assert.equal(utils.useOidc().isUserLoggedIn, false);
    assert.equal(app.errors.length, 0);
    app.unmount();
});

test("user-change notifications update rendered consumers even when user identity is retained", async () => {
    const user = { revision: 1 };
    let publishUser;
    const { oidcSpa } = load({
        createOidc: () => ({
            ...loggedOut(),
            isUserLoggedIn: true,
            getUser: async () => user,
            subscribeToUserChange: callback => {
                publishUser = callback;
                return { unsubscribeFromUserChange() {} };
            },
            subscribeToAutoLogoutState: () => ({ unsubscribeFromAutoLogoutState() {} })
        })
    });
    const utils = oidcSpa
        .withUser(() => user)
        .withRuntimeConfigs(realConfigs)
        .createUtils();
    const Child = defineComponent({
        setup() {
            const { user } = utils.useOidc({ assert: "user logged in" });
            return () => String(user.value.revision);
        }
    });
    const app = mount(() => h(utils.OidcInitializationGate, null, { default: () => h(Child) }));
    await flush();
    const oidc = await utils.getOidc();
    assert.equal(text(app.root), "1");
    user.revision++;
    publishUser({ user });
    await nextTick();
    assert.equal(await oidc.getUser(), user);
    assert.equal(text(app.root), "2");
    app.unmount();
});

test("a client with an already cached user populates the Vue ref", async () => {
    const user = { name: "Cached user" };
    const { oidcSpa } = load({
        createOidc: () => ({
            ...loggedOut(),
            isUserLoggedIn: true,
            getUser: async () => user,
            subscribeToUserChange: () => ({ unsubscribeFromUserChange() {} }),
            subscribeToAutoLogoutState: () => ({ unsubscribeFromAutoLogoutState() {} })
        })
    });
    const utils = oidcSpa
        .withUser(() => ({}))
        .withRuntimeConfigs(realConfigs)
        .createUtils();
    await utils.enforceLogin({ fullPath: "https://app.test/app/" });
    assert.equal(utils.useOidc({ assert: "user logged in" }).user.value, user);
});

test("a failed user factory cannot pass a protected route guard", async () => {
    const { oidcSpa, OidcInitializationError } = load();
    const utils = oidcSpa
        .withUser(async () => {
            throw new Error("invalid claims");
        })
        .withRuntimeConfigs({ mode: "mock" })
        .createUtils();
    const app = mount(() => h(utils.OidcInitializationGate, null, { default: () => "Public page" }));
    await flush();
    const oidc = utils.useOidc({ assert: "user not logged in" });
    assert(oidc.initializationError instanceof OidcInitializationError);
    await assert.rejects(utils.enforceLogin({ fullPath: "https://app.test/app/account" }), error => {
        assert.equal(error, oidc.initializationError);
        return true;
    });
    assert.equal(text(app.root), "Public page");
    app.unmount();
});

for (const fullPath of ["/", "/account?tab=profile#details"]) {
    test(`route protection waits for user creation without a mounted gate: ${fullPath}`, async () => {
        const { oidcSpa } = load();
        let finishUser;
        const pendingUser = new Promise(resolve => (finishUser = resolve));
        let token;
        const user = { name: "Alice" };
        const utils = oidcSpa
            .withUser(async () => {
                const oidc = await utils.getOidc({ assert: "user logged in" });
                token = await oidc.getAccessToken();
                await pendingUser;
                return user;
            })
            .withRuntimeConfigs({ mode: "mock" })
            .createUtils();
        let activated = false;
        const guard = utils.enforceLogin({ fullPath }).then(() => (activated = true));
        await flush();
        assert.equal(token, "mocked-access-token");
        assert.equal(activated, false);
        assert.throws(() => utils.useOidc(), /initialization is not complete/);
        finishUser();
        await guard;
        assert.equal(activated, true);
        assert.equal(utils.useOidc({ assert: "user logged in" }).user.value, user);
    });

    test(`route protection throws user-creation errors without a mounted gate: ${fullPath}`, async () => {
        const { oidcSpa, OidcInitializationError } = load();
        const cause = new Error("profile unavailable");
        const utils = oidcSpa
            .withUser(() => {
                throw cause;
            })
            .withRuntimeConfigs({ mode: "mock" })
            .createUtils();
        let failure;
        await assert.rejects(utils.enforceLogin({ fullPath }), error => {
            failure = error;
            return error instanceof OidcInitializationError && error.message.includes(cause.message);
        });
        assert.equal(utils.useOidc({ assert: "user not logged in" }).initializationError, failure);
        const oidc = await utils.getOidc({ assert: "user logged in" });
        assert.equal(await oidc.getAccessToken(), "mocked-access-token");
    });
}

for (const issuerUri of ["/realms/demo/", "https://auth.test/realms/demo/"]) {
    test(`Vue exposes failed client metadata without obscuring the error: ${issuerUri}`, async () => {
        let failure;
        const { oidcSpa, OidcInitializationError } = load({
            createOidc: () => {
                throw failure;
            }
        });
        failure = new OidcInitializationError({
            isAuthServerLikelyDown: false,
            messageOrCause: "initialization failed"
        });
        const utils = oidcSpa
            .withUser(() => ({}))
            .withRuntimeConfigs({
                mode: "real",
                issuerUri,
                clientId: "configured-client"
            })
            .createUtils();
        const app = mount(() =>
            h(utils.OidcInitializationGate, null, {
                default: () => {
                    const { issuerUri, clientId, initializationError } = utils.useOidc({
                        assert: "user not logged in"
                    });
                    assert.equal(initializationError, failure);
                    return h("span", `${issuerUri} ${clientId}`);
                }
            })
        );
        await flush();
        assert.equal(
            text(app.root),
            `${
                issuerUri.startsWith("/")
                    ? "https://app.test/realms/demo"
                    : "https://auth.test/realms/demo"
            } configured-client`
        );
        assert.equal(app.errors.length, 0);
        await assert.rejects(
            utils.enforceLogin({ fullPath: "https://app.test/app/account" }),
            error => error === failure
        );
        app.unmount();
    });
}

test("logged-out guards preserve the base path, query and fragment and stay pending", async () => {
    const calls = [];
    const { oidcSpa } = load({
        createOidc: () =>
            loggedOut(params => {
                calls.push(params);
                return new Promise(() => {});
            })
    });
    const utils = oidcSpa
        .withUser(() => ({}))
        .withRuntimeConfigs(realConfigs)
        .createUtils();
    let completed = false;
    void utils.enforceLogin({ fullPath: "/account?tab=profile#details" }).then(() => (completed = true));
    await flush();
    assert.equal(completed, false);
    assert.equal(calls[0].returnToUrl, "https://app.test/app/account?tab=profile#details");
    assert.equal(calls[0].doesCurrentHrefEnforceLogin, false);
    void utils.enforceLogin({ fullPath: "/" });
    await flush();
    assert.equal(calls[1].doesCurrentHrefEnforceLogin, true);
    void utils.useOidc().login({});
    assert.equal(calls[2].doesCurrentHrefEnforceLogin, false);
});

test("auto-logout refs update consumers; pending navigation token redirects match React", async () => {
    let publishUser;
    let publishAutoLogout;
    const tokenCalls = [];
    const client = {
        ...loggedOut(),
        isUserLoggedIn: true,
        getUser: async () => {
            publishUser({ user: { name: "Alice" } });
        },
        subscribeToUserChange: callback => {
            publishUser = callback;
            return { unsubscribeFromUserChange() {} };
        },
        subscribeToAutoLogoutState: callback => {
            publishAutoLogout = callback;
            return { unsubscribeFromAutoLogoutState() {} };
        },
        getTokens: async params => {
            tokenCalls.push(params);
            return { accessToken: "token" };
        }
    };
    const { oidcSpa, history, listeners } = load({ createOidc: () => client });
    const utils = oidcSpa
        .withUser(() => ({}))
        .withRuntimeConfigs(realConfigs)
        .createUtils();
    const app = mount(() =>
        h(utils.OidcInitializationGate, null, {
            default: () =>
                h(
                    defineComponent({
                        setup() {
                            const { autoLogoutState } = utils.useOidc();
                            return () =>
                                autoLogoutState.value.shouldDisplayWarning
                                    ? String(autoLogoutState.value.secondsLeftBeforeAutoLogout)
                                    : "No warning";
                        }
                    })
                )
        })
    );
    await flush();
    assert.equal(text(app.root), "No warning");
    const state = {
        shouldDisplayWarning: true,
        secondsLeftBeforeAutoLogout: 12,
        resetAutoLogoutCountdown() {}
    };
    publishAutoLogout(state);
    await nextTick();
    assert.equal(text(app.root), "12");
    assert.equal(utils.useOidc().autoLogoutState.value, state);
    const oidc = await utils.getOidc();
    const originalPushState = history.pushState;
    await utils.enforceLogin({ fullPath: "https://app.test/app/account?tab=profile" });
    assert.equal(await oidc.getAccessToken({ doForceRefresh: true }), "token");
    assert.equal(tokenCalls.at(-1).returnToUrl, "https://app.test/app/account?tab=profile");
    await oidc.getAccessToken({ doForceRefresh: true, returnToUrl: "https://app.test/app/explicit" });
    assert.equal(tokenCalls.at(-1).returnToUrl, "https://app.test/app/explicit");
    history.pushState({}, "", "https://app.test/app/account?tab=profile");
    assert.equal(history.pushState, originalPushState);
    assert.equal(listeners.size, 0);
    await oidc.getTokens({ doForceRefresh: true });
    assert.equal(tokenCalls.at(-1).returnToUrl, undefined);
    await utils.enforceLogin({ fullPath: "https://app.test/app/other" });
    listeners.get("popstate")();
    assert.equal(history.pushState, originalPushState);
    app.unmount();
});

test("token requests preserve the pending destination while the guard waits for user creation", async () => {
    let finishUser;
    let publishUser;
    const pendingUser = new Promise(resolve => (finishUser = resolve));
    const tokenCalls = [];
    const user = { name: "Alice" };
    const { oidcSpa } = load({
        createOidc: () => ({
            ...loggedOut(),
            isUserLoggedIn: true,
            subscribeToAutoLogoutState: () => ({ unsubscribeFromAutoLogoutState() {} }),
            subscribeToUserChange: callback => {
                publishUser = callback;
                return { unsubscribeFromUserChange() {} };
            },
            getUser: async () => {
                const oidc = await utils.getOidc({ assert: "user logged in" });
                await oidc.getAccessToken({ doForceRefresh: true });
                await pendingUser;
                publishUser({ user });
                return user;
            },
            getTokens: async params => {
                tokenCalls.push(params);
                return { accessToken: "token" };
            }
        })
    });
    const utils = oidcSpa
        .withUser(() => user)
        .withRuntimeConfigs(realConfigs)
        .createUtils();
    const guard = utils.enforceLogin({ fullPath: "/account?tab=profile#details" });
    await flush();
    assert.throws(() => utils.useOidc(), /initialization is not complete/);
    assert.equal(tokenCalls[0].returnToUrl, "https://app.test/app/account?tab=profile#details");
    finishUser();
    await guard;
    assert.equal(utils.useOidc({ assert: "user logged in" }).user.value, user);
});

for (const stage of ["client", "user"]) {
    test(`unexpected ${stage} errors propagate to Vue's component error handler and route guards`, async () => {
        const failure = new Error("unexpected failure");
        const { oidcSpa } = load({
            createOidc: () => {
                if (stage === "client") throw failure;
                return {
                    ...loggedOut(),
                    isUserLoggedIn: true,
                    getUser: async () => {
                        throw failure;
                    },
                    subscribeToUserChange: () => ({ unsubscribeFromUserChange() {} }),
                    subscribeToAutoLogoutState: () => ({ unsubscribeFromAutoLogoutState() {} })
                };
            }
        });
        const utils = oidcSpa
            .withUser(() => ({}))
            .withRuntimeConfigs(realConfigs)
            .createUtils();
        const app = mount(() =>
            h(utils.OidcInitializationGate, null, {
                default: () => assert.fail("must not mount"),
                fallback: () => "Loading"
            })
        );
        await flush();
        assert.equal(app.errors[0], failure);
        await assert.rejects(utils.enforceLogin({ fullPath: "/account" }), error => error === failure);
        app.unmount();
    });
}

test("server imports and reads never initialize browser authentication", async () => {
    const { oidcSpa } = load({ browser: false });
    const utils = oidcSpa
        .withUser(() => ({}))
        .withRuntimeConfigs(() => assert.fail("server initialization"))
        .createUtils();
    assert.throws(() => utils.useOidc(), /SSR/);
    await assert.rejects(utils.getOidc(), /can't be used on the server/);
    await assert.rejects(
        utils.enforceLogin({ fullPath: "https://app.test/app/account" }),
        /cannot be used on the server/
    );
    const markup = await renderToString(
        h(
            utils.OidcInitializationGate,
            { fallback: "Loading" },
            {
                default: () => assert.fail("must not render authenticated UI on the server")
            }
        )
    );
    assert.match(markup, /Loading/);
});
