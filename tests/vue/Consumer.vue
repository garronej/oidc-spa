<script setup lang="ts">
import type { UseOidc } from "../../src/vue";

const { useOidc } = defineProps<{
    useOidc: UseOidc<{ name: string; canSeeAdminNavigation: boolean }>;
}>();

const { isUserLoggedIn, user } = useOidc();
</script>

<template>
    <span v-if="isUserLoggedIn && user.canSeeAdminNavigation">{{ user.name }}</span>
</template>
