<script setup lang="ts">
import { RouterView } from "vue-router";
import { OidcInitializationGate } from "./oidc";
import AppHeader from "./components/AppHeader.vue";
</script>

<template>
    <OidcInitializationGate>
        <AppHeader />
        <main>
            <RouterView />
        </main>
    </OidcInitializationGate>
</template>
