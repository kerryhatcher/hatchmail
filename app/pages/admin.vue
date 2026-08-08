<script setup lang="ts">
import { Globe2, LogOut, Mail, Menu, MoreHorizontal, Plus, Search, Shield, ScrollText, Users, X } from 'lucide-vue-next'

interface SessionResponse { user: { id: string; username: string; displayName: string; role: 'user' | 'admin' }; addresses: Array<{ email: string }> }
interface Domain { id: string; name: string; region: 'us' | 'eu'; active: boolean; apiKeyConfigured: boolean; signingKeyConfigured: boolean; addressCount: number; updatedAt: string }
interface Address { id?: string; domainId: string; localPart: string; domain?: string; email?: string; isPrimary: boolean; canSend: boolean }
interface User { id: string; username: string; displayName: string; role: 'user' | 'admin'; status: 'active' | 'suspended'; lastActiveAt: string | null; addresses: Address[] }
interface AuditEvent { id: string; actorName: string | null; action: string; targetType: string | null; targetId: string | null; details: Record<string, unknown>; ipAddress: string | null; createdAt: string }

const session = ref<SessionResponse | null>(null)
const section = ref<'users' | 'domains' | 'audit'>('users')
const users = ref<User[]>([])
const domains = ref<Domain[]>([])
const audit = ref<AuditEvent[]>([])
const search = ref('')
const mobileSidebar = ref(false)
const selectedUser = ref<User | null>(null)
const selectedDomain = ref<Domain | null>(null)
const isNewUser = ref(false)
const isNewDomain = ref(false)
const saving = ref(false)
const editorError = ref('')
const editorSuccess = ref('')
const newPassword = ref('')
const domainSecrets = reactive({ apiKey: '', signingKey: '' })

const initials = computed(() => (session.value?.user.displayName || 'HM').split(/\s+/).map(v => v[0]).join('').slice(0,2).toUpperCase())
const primaryEmail = computed(() => session.value?.addresses[0]?.email || session.value?.user.username || '')
const filteredUsers = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return !needle ? users.value : users.value.filter(user => [user.displayName, user.username, ...user.addresses.map(a => a.email || '')].join(' ').toLowerCase().includes(needle))
})
const filteredDomains = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return !needle ? domains.value : domains.value.filter(domain => domain.name.includes(needle))
})
const drawerOpen = computed(() => (section.value === 'users' && selectedUser.value) || (section.value === 'domains' && selectedDomain.value))

onMounted(async () => {
  try {
    session.value = await $fetch<SessionResponse>('/api/auth/me')
    if (session.value.user.role !== 'admin') return navigateTo('/')
    await Promise.all([loadUsers(), loadDomains()])
  } catch {
    await navigateTo('/login')
  }
})

async function loadUsers() {
  const result = await $fetch<{ users: User[] }>('/api/admin/users')
  users.value = result.users
}
async function loadDomains() {
  const result = await $fetch<{ domains: Domain[] }>('/api/admin/domains')
  domains.value = result.domains
}
async function loadAudit() {
  const result = await $fetch<{ events: AuditEvent[] }>('/api/admin/audit')
  audit.value = result.events
}
async function changeSection(next: 'users' | 'domains' | 'audit') {
  section.value = next
  search.value = ''
  closeDrawer()
  if (next === 'audit') await loadAudit()
  if (next === 'domains') await loadDomains()
  if (next === 'users') await loadUsers()
}

function cloneUser(user: User): User {
  return { ...user, addresses: user.addresses.map(address => ({ ...address })) }
}
function editUser(user: User) {
  isNewUser.value = false
  selectedUser.value = cloneUser(user)
  newPassword.value = ''
  resetMessages()
}
function addUser() {
  isNewUser.value = true
  const firstDomain = domains.value.find(domain => domain.active) || domains.value[0]
  selectedUser.value = {
    id: '', username: '', displayName: '', role: 'user', status: 'active', lastActiveAt: null,
    addresses: firstDomain ? [{ domainId: firstDomain.id, localPart: '', isPrimary: true, canSend: true }] : [],
  }
  newPassword.value = ''
  resetMessages()
}
function addAddress() {
  if (!selectedUser.value) return
  const firstDomain = domains.value.find(domain => domain.active) || domains.value[0]
  if (!firstDomain) return
  selectedUser.value.addresses.push({ domainId: firstDomain.id, localPart: selectedUser.value.username, isPrimary: selectedUser.value.addresses.length === 0, canSend: true })
}
function removeAddress(index: number) {
  if (!selectedUser.value) return
  const wasPrimary = selectedUser.value.addresses[index]?.isPrimary
  selectedUser.value.addresses.splice(index, 1)
  if (wasPrimary && selectedUser.value.addresses[0]) selectedUser.value.addresses[0].isPrimary = true
}
function setPrimary(index: number) {
  if (!selectedUser.value) return
  selectedUser.value.addresses.forEach((address, i) => { address.isPrimary = i === index })
}
function fillUsernameAddress() {
  if (!selectedUser.value || !isNewUser.value) return
  const primary = selectedUser.value.addresses.find(address => address.isPrimary)
  if (primary && !primary.localPart) primary.localPart = selectedUser.value.username
}

async function saveUser() {
  if (!selectedUser.value) return
  saving.value = true
  resetMessages()
  try {
    const body = {
      username: selectedUser.value.username,
      displayName: selectedUser.value.displayName,
      role: selectedUser.value.role,
      status: selectedUser.value.status,
      password: newPassword.value || undefined,
      addresses: selectedUser.value.addresses.map(address => ({ domainId: address.domainId, localPart: address.localPart, isPrimary: address.isPrimary, canSend: address.canSend })),
    }
    if (isNewUser.value) {
      if (!newPassword.value) throw new Error('A password is required for a new user.')
      await $fetch('/api/admin/users', { method: 'POST', body })
    } else {
      await $fetch(`/api/admin/users/${selectedUser.value.id}`, { method: 'PUT', body })
    }
    editorSuccess.value = 'User saved.'
    await loadUsers()
    const refreshed = users.value.find(user => user.username === body.username)
    if (refreshed) { selectedUser.value = cloneUser(refreshed); isNewUser.value = false; newPassword.value = '' }
  } catch (error: any) {
    editorError.value = error?.data?.statusMessage || error?.statusMessage || error?.message || 'User could not be saved.'
  } finally {
    saving.value = false
  }
}

async function deleteUser() {
  if (!selectedUser.value || isNewUser.value || !confirm(`Delete ${selectedUser.value.displayName}? This also deletes their stored mail.`)) return
  saving.value = true
  try {
    await $fetch(`/api/admin/users/${selectedUser.value.id}`, { method: 'DELETE' })
    closeDrawer(); await loadUsers()
  } catch (error: any) {
    editorError.value = error?.data?.statusMessage || error?.statusMessage || 'User could not be deleted.'
  } finally { saving.value = false }
}

function editDomain(domain: Domain) {
  isNewDomain.value = false
  selectedDomain.value = { ...domain }
  domainSecrets.apiKey = ''; domainSecrets.signingKey = ''; resetMessages()
}
function addDomain() {
  isNewDomain.value = true
  selectedDomain.value = { id: '', name: '', region: 'us', active: true, apiKeyConfigured: false, signingKeyConfigured: false, addressCount: 0, updatedAt: '' }
  domainSecrets.apiKey = ''; domainSecrets.signingKey = ''; resetMessages()
}
async function saveDomain() {
  if (!selectedDomain.value) return
  saving.value = true; resetMessages()
  try {
    const body = { name: selectedDomain.value.name, region: selectedDomain.value.region, active: selectedDomain.value.active, apiKey: domainSecrets.apiKey || undefined, signingKey: domainSecrets.signingKey || undefined }
    if (isNewDomain.value) await $fetch('/api/admin/domains', { method: 'POST', body })
    else await $fetch(`/api/admin/domains/${selectedDomain.value.id}`, { method: 'PUT', body })
    editorSuccess.value = 'Domain saved.'
    await loadDomains()
    const refreshed = domains.value.find(domain => domain.name === body.name)
    if (refreshed) { selectedDomain.value = { ...refreshed }; isNewDomain.value = false; domainSecrets.apiKey = ''; domainSecrets.signingKey = '' }
  } catch (error: any) {
    editorError.value = error?.data?.statusMessage || error?.statusMessage || 'Domain could not be saved.'
  } finally { saving.value = false }
}

function closeDrawer() { selectedUser.value = null; selectedDomain.value = null; isNewUser.value = false; isNewDomain.value = false; resetMessages() }
function resetMessages() { editorError.value = ''; editorSuccess.value = '' }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never' }
async function logout() { await $fetch('/api/auth/logout', { method: 'POST' }); await navigateTo('/login') }
</script>

<template>
  <div v-if="session" class="admin-shell">
    <aside class="sidebar" :class="{ 'mobile-open': mobileSidebar }">
      <div class="sidebar-brand"><HatchLogo light /></div>
      <nav class="sidebar-nav">
        <NuxtLink class="sidebar-link" to="/"><Mail /><span>Mail</span></NuxtLink>
        <button class="sidebar-button active"><Shield /><span>Admin</span></button>
        <button class="sidebar-button" :class="{ active: section === 'users' }" @click="changeSection('users'); mobileSidebar = false"><Users /><span>Users</span></button>
        <button class="sidebar-button" :class="{ active: section === 'domains' }" @click="changeSection('domains'); mobileSidebar = false"><Globe2 /><span>Domains</span></button>
        <button class="sidebar-button" :class="{ active: section === 'audit' }" @click="changeSection('audit'); mobileSidebar = false"><ScrollText /><span>Audit log</span></button>
      </nav>
      <div class="sidebar-footer">
        <div class="account-chip"><div class="avatar sm">{{ initials }}</div><div class="account-copy"><strong>{{ session.user.displayName }}</strong><span>{{ primaryEmail }}</span></div><button class="icon-button" style="color:white;margin-left:auto" title="Sign out" @click="logout"><LogOut /></button></div>
      </div>
    </aside>

    <main class="admin-main">
      <section class="admin-content" :class="{ 'has-drawer': drawerOpen }">
        <button class="icon-button mobile-menu" aria-label="Open admin menu" style="margin-bottom:16px" @click="mobileSidebar = !mobileSidebar"><Menu /></button>
        <template v-if="section === 'users'">
          <div class="page-heading"><div><h1>Users</h1><p>Manage access, addresses, and administrator privileges.</p></div><button class="outline-button" @click="addUser"><Plus :size="18" /> Add user</button></div>
          <div class="filter-row"><label class="search-box"><Search /><input v-model="search" placeholder="Search users"></label></div>
          <div class="table-wrap">
            <table><thead><tr><th>Status</th><th>User</th><th>Email addresses</th><th>Role</th><th>Last active</th><th>Actions</th></tr></thead>
              <tbody><tr v-for="user in filteredUsers" :key="user.id" class="row-click" :class="{ selected: selectedUser?.id === user.id }" @click="editUser(user)"><td><span class="status-dot" :class="{ suspended: user.status === 'suspended' }" />{{ user.status === 'active' ? 'Active' : 'Suspended' }}</td><td>{{ user.displayName }}</td><td><div class="email-stack"><span v-for="address in user.addresses" :key="address.email">{{ address.email }}</span><span v-if="!user.addresses.length" style="color:var(--muted)">No address</span></div></td><td>{{ user.role === 'admin' ? 'Admin' : 'User' }}</td><td>{{ formatDate(user.lastActiveAt) }}</td><td><button class="icon-button" @click.stop="editUser(user)"><MoreHorizontal /></button></td></tr></tbody>
            </table><div v-if="!filteredUsers.length" class="table-empty">No users found.</div>
          </div>
        </template>

        <template v-else-if="section === 'domains'">
          <div class="page-heading"><div><h1>Domains</h1><p>Configure hosted mail domains and their Mailgun credentials.</p></div><button class="outline-button" @click="addDomain"><Plus :size="18" /> Add domain</button></div>
          <div class="filter-row"><label class="search-box"><Search /><input v-model="search" placeholder="Search domains"></label></div>
          <div class="table-wrap"><table><thead><tr><th>Status</th><th>Domain</th><th>Region</th><th>API key</th><th>Signing key</th><th>Addresses</th><th>Actions</th></tr></thead><tbody><tr v-for="domain in filteredDomains" :key="domain.id" class="row-click" :class="{ selected: selectedDomain?.id === domain.id }" @click="editDomain(domain)"><td><span class="status-dot" :class="{ inactive: !domain.active }" />{{ domain.active ? 'Active' : 'Inactive' }}</td><td>{{ domain.name }}</td><td>{{ domain.region.toUpperCase() }}</td><td>{{ domain.apiKeyConfigured ? 'Configured' : 'Missing' }}</td><td>{{ domain.signingKeyConfigured ? 'Configured' : 'Missing' }}</td><td>{{ domain.addressCount }}</td><td><button class="icon-button" @click.stop="editDomain(domain)"><MoreHorizontal /></button></td></tr></tbody></table><div v-if="!filteredDomains.length" class="table-empty">No domains configured.</div></div>
        </template>

        <template v-else>
          <div class="page-heading"><div><h1>Audit log</h1><p>Review authentication, mail, and administrative activity.</p></div><button class="outline-button" @click="loadAudit">Refresh</button></div>
          <div class="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead><tbody><tr v-for="entry in audit" :key="entry.id"><td>{{ formatDate(entry.createdAt) }}</td><td>{{ entry.actorName || 'System' }}</td><td>{{ entry.action }}</td><td>{{ entry.targetType || '—' }}</td><td class="audit-details">{{ JSON.stringify(entry.details) }}</td><td>{{ entry.ipAddress || '—' }}</td></tr></tbody></table><div v-if="!audit.length" class="table-empty">No audit events yet.</div></div>
        </template>
      </section>
    </main>

    <aside v-if="section === 'users' && selectedUser" class="editor-drawer">
      <div class="drawer-header"><button class="icon-button drawer-close" @click="closeDrawer"><X /></button><h2>{{ isNewUser ? 'Add user' : 'Edit user' }}</h2><strong>{{ selectedUser.displayName || 'New user' }}</strong><span>{{ selectedUser.addresses.find(a => a.isPrimary)?.email || selectedUser.username || 'No email address' }}</span></div>
      <div class="drawer-body">
        <label class="field"><span>Display name</span><input v-model="selectedUser.displayName"></label>
        <label class="field"><span>Username</span><input v-model="selectedUser.username" @blur="fillUsernameAddress"><small>Used for login. The primary email address can use the same local part.</small></label>
        <div class="field"><span>Addresses</span><div class="address-editor"><div v-for="(address, index) in selectedUser.addresses" :key="address.id || index" class="address-row"><input v-model="address.localPart" placeholder="username"><select v-model="address.domainId"><option v-for="domain in domains" :key="domain.id" :value="domain.id">{{ domain.name }}</option></select><button class="icon-button" title="Remove address" @click="removeAddress(index)"><X /></button><div class="address-options"><label><input type="radio" :checked="address.isPrimary" @change="setPrimary(index)"> Primary</label><label><input v-model="address.canSend" type="checkbox"> Can send</label></div></div><button class="outline-button" :disabled="!domains.length" @click="addAddress"><Plus :size="16" /> Add address</button></div></div>
        <label class="field"><span>Role</span><select v-model="selectedUser.role"><option value="user">User</option><option value="admin">Admin</option></select></label>
        <label class="field"><span>Status</span><select v-model="selectedUser.status"><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
        <label class="field"><span>{{ isNewUser ? 'Password' : 'New password' }}</span><input v-model="newPassword" type="password" minlength="12" autocomplete="new-password" :required="isNewUser"><small>{{ isNewUser ? 'At least 12 characters.' : 'Leave blank to keep the current password.' }}</small></label>
        <p v-if="editorError" class="form-error">{{ editorError }}</p><p v-if="editorSuccess" class="form-success">{{ editorSuccess }}</p>
      </div>
      <div class="drawer-footer"><button v-if="!isNewUser" class="danger-button" :disabled="saving || selectedUser.id === session.user.id" @click="deleteUser">Delete</button><button class="outline-button" @click="closeDrawer">Cancel</button><button class="primary-button" :disabled="saving" @click="saveUser">{{ saving ? 'Saving…' : 'Save changes' }}</button></div>
    </aside>

    <aside v-if="section === 'domains' && selectedDomain" class="editor-drawer">
      <div class="drawer-header"><button class="icon-button drawer-close" @click="closeDrawer"><X /></button><h2>{{ isNewDomain ? 'Add domain' : 'Edit domain' }}</h2><strong>{{ selectedDomain.name || 'New mail domain' }}</strong><span>Mailgun configuration</span></div>
      <div class="drawer-body">
        <label class="field"><span>Domain</span><input v-model="selectedDomain.name" placeholder="example.org"></label>
        <label class="field"><span>Mailgun region</span><select v-model="selectedDomain.region"><option value="us">United States</option><option value="eu">Europe</option></select></label>
        <label class="field"><span>Mailgun API key</span><input v-model="domainSecrets.apiKey" type="password" autocomplete="off" :placeholder="selectedDomain.apiKeyConfigured ? 'Configured — enter to replace' : 'key-…'"><small>Encrypted before storage in D1.</small></label>
        <label class="field"><span>Webhook signing key</span><input v-model="domainSecrets.signingKey" type="password" autocomplete="off" :placeholder="selectedDomain.signingKeyConfigured ? 'Configured — enter to replace' : 'Signing key'"><small>Used to verify inbound Mailgun posts.</small></label>
        <label class="field"><span>Status</span><select v-model="selectedDomain.active"><option :value="true">Active</option><option :value="false">Inactive</option></select></label>
        <div v-if="selectedDomain.name" class="helper-box"><strong>Mailgun inbound route</strong><br>Create a receiving route for this domain that forwards matching recipients to:<code>https://YOUR-HATCHMAIL-HOST/webhooks/mailgun/inbound</code>Hatchmail resolves the full recipient address internally, so one endpoint can serve every configured domain.</div>
        <p v-if="editorError" class="form-error">{{ editorError }}</p><p v-if="editorSuccess" class="form-success">{{ editorSuccess }}</p>
      </div>
      <div class="drawer-footer"><button class="outline-button" @click="closeDrawer">Cancel</button><button class="primary-button" :disabled="saving" @click="saveDomain">{{ saving ? 'Saving…' : 'Save changes' }}</button></div>
    </aside>
  </div>
  <div v-else class="auth-page"><div>Loading administration…</div></div>
</template>
