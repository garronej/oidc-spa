<script setup lang="ts">
import { RouterView } from "vue-router";
import AutoLogoutWarningOverlay from "../../components/AutoLogoutWarningOverlay.vue";
</script>

<template>
    <RouterView />
    <AutoLogoutWarningOverlay />
</template>
