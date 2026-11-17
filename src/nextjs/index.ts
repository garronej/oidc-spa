"use client";

export * from "../react";
import { oidcSpa as oidcSpa_react } from "../react";
import type { OidcSpa as OidcSpa_react } from "../react/oidcSpa";
import type { OidcSpaUtils as OidcSpaUtils_react } from "../react";
import { enableStateDataCookie } from "../core/StateDataCookie";

export type OidcSpaUtils<User> = Omit<OidcSpaUtils_react<User>, "enforceLogin">;

type OidcSpa<User, Excluded extends "withUser" | "withRuntimeConfigs" = never> = Omit<
    {
        withUser: <User>(
            ...args: Parameters<typeof oidcSpa_react.withUser<User>>
        ) => OidcSpa<User, Excluded | "withUser">;
    },
    Excluded
> &
    ("withUser" extends Excluded
        ? {
              withRuntimeConfigs: (
                  ...args: Parameters<OidcSpa_react<User, "withUser">["withRuntimeConfigs"]>
              ) => OidcSpa<User, Excluded | "withRuntimeConfigs">;
          }
        : {}) &
    ("withRuntimeConfigs" extends Excluded ? { createUtils: () => OidcSpaUtils<User> } : {});

type CompleteBuilder = typeof oidcSpa_react & OidcSpa_react<unknown, "withUser" | "withRuntimeConfigs">;

function adaptBuilder<User, Excluded extends "withUser" | "withRuntimeConfigs">(
    builder: OidcSpa_react<User, Excluded>
): OidcSpa<User, Excluded> {
    // Used builder methods remain present at runtime even when their types hide them.
    const builder_base = builder as unknown as CompleteBuilder;

    return {
        ...builder,
        withUser: (...args: Parameters<CompleteBuilder["withUser"]>) =>
            adaptBuilder(builder_base.withUser(...args)),
        withRuntimeConfigs: (...args: Parameters<CompleteBuilder["withRuntimeConfigs"]>) =>
            adaptBuilder(builder_base.withRuntimeConfigs(...args)),
        createUtils: () => {
            enableStateDataCookie();
            const { enforceLogin, ...utils } = builder_base.createUtils();
            return utils;
        }
    } as OidcSpa<User, Excluded>;
}

export const oidcSpa = adaptBuilder(oidcSpa_react);
