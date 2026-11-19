<script setup lang="ts">
import { useOidc } from "./oidc";

const oidc = useOidc();
</script>

<template>
    <AppHeader />
    <main>
        <NuxtPage />
    </main>
    <AutoLogoutWarningOverlay v-if="oidc.isUserLoggedIn" />
</template>
