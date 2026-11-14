import { defineComponent, h, type ShallowRef, type VNodeChild } from "vue";
import {
    oidcSpa,
    OidcInitializationError,
    type Oidc,
    type Oidc_vue,
    type OidcSpaUtils,
    type CreateClientUser,
    type RuntimeConfigs,
    type AutoLogoutState
} from "../../src/vue";
import { assert, type Equals } from "../../src/tools/tsafe/assert";

type User = { displayName: string };

// Never invoked: check the builder, public component props and discriminated unions.
export async function checkTypes() {
    // @ts-expect-error a user factory is required first
    oidcSpa.withRuntimeConfigs({ mode: "mock" });
    // @ts-expect-error utilities require a user factory and runtime configs
    oidcSpa.createUtils();

    const createUser: CreateClientUser<User> = async ({ isMock, user_current }) => {
        assert<Equals<typeof isMock, boolean>>;
        assert<Equals<typeof user_current, User | undefined>>;
        return { displayName: "Alice" };
    };
    const builder = oidcSpa.withUser(createUser);
    // @ts-expect-error a user factory can only be specified once
    builder.withUser(createUser);
    // @ts-expect-error runtime configs are required
    builder.createUtils();
    const utils = builder.withRuntimeConfigs({ mode: "mock" }).createUtils();
    assert<Equals<typeof utils, OidcSpaUtils<User>>>;
    const inferred = oidcSpa
        .withUser(async () => ({ displayName: "Alice" }))
        .withRuntimeConfigs(async (): Promise<RuntimeConfigs> => ({ mode: "mock" }))
        .createUtils();
    assert<Equals<typeof inferred, typeof utils>>;

    const oidc = await utils.getOidc();
    assert<Equals<typeof oidc, Oidc<User>>>;
    const loggedIn = await utils.getOidc({ assert: "user logged in" });
    assert<Equals<typeof loggedIn, Oidc.LoggedIn<User>>>;
    const loggedOut = await utils.getOidc({ assert: "user not logged in" });
    assert<Equals<typeof loggedOut, Oidc.NotLoggedIn>>;

    const state = utils.useOidc();
    assert<Equals<typeof state, Oidc_vue<User>>>;
    if (state.isUserLoggedIn) {
        assert<Equals<typeof state.user.value, User>>;
        assert<Equals<typeof state.initializationError, undefined>>;
    } else {
        assert<Equals<typeof state.initializationError, OidcInitializationError | undefined>>;
        assert<Equals<typeof state.user, undefined>>;
    }
    const { isUserLoggedIn, user } = utils.useOidc();
    if (isUserLoggedIn) {
        assert<Equals<typeof user.value, User>>;
        user.value.displayName.toUpperCase();
    } else {
        assert<Equals<typeof user, undefined>>;
    }
    // @ts-expect-error reading the user requires narrowing the logged-in state
    user.value.displayName;
    const authenticated = utils.useOidc({ assert: "user logged in" });
    assert<Equals<typeof authenticated.user, Readonly<ShallowRef<User>>>>;
    assert<Equals<typeof authenticated.autoLogoutState, Readonly<ShallowRef<AutoLogoutState>>>>;
    // @ts-expect-error consumers cannot replace the user ref
    authenticated.user.value = { displayName: "Bob" };
    // @ts-expect-error consumers cannot replace the auto-logout ref
    authenticated.autoLogoutState.value = { shouldDisplayWarning: false };
    const anonymous = utils.useOidc({ assert: "user not logged in" });
    assert<Equals<typeof anonymous.isUserLoggedIn, false>>;
    anonymous.login({});

    await utils.enforceLogin("https://app.test/account");
    // @ts-expect-error the router must resolve a URL, not pass its route object
    utils.enforceLogin({ fullPath: "/account" });

    const Account = defineComponent({
        props: { label: { type: String, required: true } },
        setup: props => () => h("p", props.label)
    });
    const ErrorComponent = defineComponent({
        props: {
            oidcInitializationError: { type: OidcInitializationError, required: true }
        },
        setup: props => () => h("p", props.oidcInitializationError.message)
    });
    const Wrapped = utils.withLoginEnforced({ component: Account, errorComponent: ErrorComponent });
    type WrappedProps = InstanceType<typeof Wrapped>["$props"];
    const props: WrappedProps = { label: "Account" };
    void props;
    // @ts-expect-error required props survive wrapping
    const missingProps: WrappedProps = {};
    void missingProps;
    // @ts-expect-error props keep their original types
    const invalidProps: WrappedProps = { label: 123 };
    void invalidProps;

    const Gate = utils.OidcInitializationGate;
    type GateProps = InstanceType<typeof Gate>["$props"];
    const gateProps: GateProps = { fallback: "Loading" };
    void gateProps;
    h(Gate, null, {
        default: (): VNodeChild => h(Wrapped, { label: "Account" }),
        fallback: (): VNodeChild => "Loading"
    });
}
