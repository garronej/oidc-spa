<script setup lang="ts">
import type { UseOidc } from "../../src/vue";

const { useOidc } = defineProps<{
    useOidc: UseOidc<{ name: string }>;
}>();

const { isUserLoggedIn, user } = useOidc();

// @ts-expect-error user access requires checking isUserLoggedIn
user.value.name;
</script>

<template>
    <template v-if="isUserLoggedIn">
        {{ user.name }}
        <!-- @vue-expect-error the user model has no missingProperty field -->
        {{ user.missingProperty }}
    </template>
</template>
