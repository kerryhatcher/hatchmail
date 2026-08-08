<script setup lang="ts">
const username = ref('')
const password = ref('')
const busy = ref(false)
const errorMessage = ref('')

onMounted(async () => {
  try {
    await $fetch('/api/auth/me')
    await navigateTo('/')
  } catch {
    // Expected when signed out.
  }
})

async function submit() {
  busy.value = true
  errorMessage.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { username: username.value, password: password.value } })
    await navigateTo('/')
  } catch (error: any) {
    errorMessage.value = error?.data?.statusMessage || error?.statusMessage || 'Unable to sign in.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card">
      <HatchLogo />
      <div class="auth-heading">
        <h1>Sign in</h1>
        <p>Use your Hatchmail account to continue.</p>
      </div>
      <form class="stack-form" @submit.prevent="submit">
        <label>
          <span>Username</span>
          <input v-model="username" autocomplete="username" required autofocus>
        </label>
        <label>
          <span>Password</span>
          <input v-model="password" type="password" autocomplete="current-password" required>
        </label>
        <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
        <button class="primary-button full" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
      <NuxtLink class="subtle-link" to="/setup">First deployment? Run initial setup</NuxtLink>
    </section>
  </main>
</template>
