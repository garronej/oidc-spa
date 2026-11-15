<script setup lang="ts">
import { OidcInitializationGate } from "./oidc";
</script>

<template>
    <OidcInitializationGate>
        <AppHeader />
        <main>
            <NuxtLayout>
                <NuxtPage />
            </NuxtLayout>
        </main>
    </OidcInitializationGate>
</template>
