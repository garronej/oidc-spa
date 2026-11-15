<script setup lang="ts">
import AutoLogoutWarningOverlay from "~/components/AutoLogoutWarningOverlay.vue";
</script>

<template>
    <div>
        <slot />
        <AutoLogoutWarningOverlay />
    </div>
</template>
