<script setup lang="ts">
const form = reactive({ bootstrapToken: '', displayName: '', username: '', password: '' })
const busy = ref(false)
const errorMessage = ref('')

async function submit() {
  busy.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/setup', { method: 'POST', body: form })
    await navigateTo('/admin')
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.statusMessage || 'Setup failed.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card auth-card--wide">
      <HatchLogo />
      <div class="auth-heading">
        <h1>Initialize Hatchmail</h1>
        <p>Create the first administrator. This endpoint closes automatically after the first account exists.</p>
      </div>
      <form class="stack-form" @submit.prevent="submit">
        <label>
          <span>Bootstrap token</span>
          <input v-model="form.bootstrapToken" type="password" autocomplete="off" required>
        </label>
        <label>
          <span>Display name</span>
          <input v-model="form.displayName" autocomplete="name" required>
        </label>
        <label>
          <span>Username</span>
          <input v-model="form.username" autocomplete="username" required>
        </label>
        <label>
          <span>Password</span>
          <input v-model="form.password" type="password" minlength="12" autocomplete="new-password" required>
          <small>At least 12 characters.</small>
        </label>
        <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
        <button class="primary-button full" :disabled="busy">
          {{ busy ? 'Creating administrator…' : 'Create administrator' }}
        </button>
      </form>
      <NuxtLink class="subtle-link" to="/login">Back to sign in</NuxtLink>
    </section>
  </main>
</template>
