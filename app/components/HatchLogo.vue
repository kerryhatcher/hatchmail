<script setup lang="ts">
withDefaults(defineProps<{ compact?: boolean; light?: boolean }>(), { compact: false, light: false })
</script>

<template>
  <div class="brand" :class="{ 'brand--compact': compact, 'brand--light': light }">
    <span class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" role="img">
        <path d="M7 10.5A9 9 0 0 1 25 12v8.25A4.75 4.75 0 0 1 20.25 25H11.75A4.75 4.75 0 0 1 7 20.25V10.5Z" />
        <path d="M11 9.5V8.8A5 5 0 0 1 21 9v.5" />
      </svg>
    </span>
    <span v-if="!compact" class="brand-name">Hatchmail</span>
  </div>
</template>
