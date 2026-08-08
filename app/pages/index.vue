<script setup lang="ts">
import {
  Archive, ArrowLeft, ChevronDown, Download, FileText, Forward, Inbox, LogOut, Mail,
  Menu, MoreHorizontal, Paperclip, PenLine, Reply, ReplyAll, Search, Send, Settings,
  Star, Tag, Trash2, X,
} from 'lucide-vue-next'

interface Address { id: string; email: string; isPrimary: boolean; canSend: boolean }
interface SessionResponse { user: { id: string; username: string; displayName: string; role: 'user' | 'admin' }; addresses: Address[] }
interface ListMessage { id: string; direction: string; folder: string; sender: string | null; from: string | null; to: string[]; subject: string; preview: string; isRead: boolean; isStarred: boolean; attachmentCount: number; timestamp: string }
interface MessageDetail extends ListMessage { bodyText: string; cc: string[]; bcc: string[]; attachments: Array<{ id: string; filename: string; contentType: string; size: number; downloadUrl: string }> }

const session = ref<SessionResponse | null>(null)
const folder = ref('inbox')
const unreadCount = ref(0)
const messages = ref<ListMessage[]>([])
const selected = ref<MessageDetail | null>(null)
const busy = ref(true)
const search = ref('')
const mobileSidebar = ref(false)
const mobileMessageOpen = ref(false)
const composeOpen = ref(false)
const composeBusy = ref(false)
const composeError = ref('')
const composeFiles = ref<File[]>([])
const compose = reactive({ fromAddressId: '', to: '', cc: '', bcc: '', subject: '', text: '' })

const filteredMessages = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return messages.value
  return messages.value.filter(message => [message.sender, message.from, message.subject, message.preview, ...(message.to || [])]
    .filter(Boolean).join(' ').toLowerCase().includes(needle))
})

const primaryEmail = computed(() => session.value?.addresses.find(address => address.isPrimary)?.email || session.value?.addresses[0]?.email || session.value?.user.username || '')
const initials = computed(() => (session.value?.user.displayName || session.value?.user.username || 'HM').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase())

onMounted(async () => {
  try {
    session.value = await $fetch<SessionResponse>('/api/auth/me')
    const defaultAddress = session.value.addresses.find(address => address.isPrimary && address.canSend) || session.value.addresses.find(address => address.canSend)
    compose.fromAddressId = defaultAddress?.id || ''
    await loadFolder('inbox')
  } catch {
    await navigateTo('/login')
  } finally {
    busy.value = false
  }
})

async function loadFolder(nextFolder: string) {
  folder.value = nextFolder
  mobileMessageOpen.value = false
  const result = await $fetch<{ unreadCount: number; messages: ListMessage[] }>('/api/messages', { query: { folder: nextFolder } })
  unreadCount.value = result.unreadCount
  messages.value = result.messages
  selected.value = null
  if (result.messages[0] && window.innerWidth > 820) await openMessage(result.messages[0].id, false)
}

async function openMessage(id: string, mobile = true) {
  const result = await $fetch<{ message: MessageDetail }>(`/api/messages/${id}`)
  selected.value = result.message
  const row = messages.value.find(message => message.id === id)
  if (row) row.isRead = true
  if (folder.value === 'inbox') unreadCount.value = messages.value.filter(message => !message.isRead).length
  if (mobile) mobileMessageOpen.value = true
}

async function patchMessage(id: string, patch: Record<string, unknown>) {
  await $fetch(`/api/messages/${id}`, { method: 'PATCH', body: patch })
  if (patch.folder) await loadFolder(folder.value)
  else {
    const row = messages.value.find(message => message.id === id)
    if (row && typeof patch.isStarred === 'boolean') row.isStarred = patch.isStarred
    if (selected.value?.id === id && typeof patch.isStarred === 'boolean') selected.value.isStarred = patch.isStarred
  }
}

function beginCompose(seed?: { to?: string; subject?: string; text?: string }) {
  compose.to = seed?.to || ''
  compose.cc = ''
  compose.bcc = ''
  compose.subject = seed?.subject || ''
  compose.text = seed?.text || ''
  composeFiles.value = []
  composeError.value = ''
  composeOpen.value = true
}

function reply(all = false) {
  if (!selected.value) return
  const sender = extractEmail(selected.value.from || selected.value.sender || '')
  const cc = all ? selected.value.cc.filter(address => address !== primaryEmail.value) : []
  beginCompose({ to: [sender, ...cc].filter(Boolean).join(', '), subject: replySubject(selected.value.subject), text: `\n\n--- Original message ---\n${selected.value.bodyText}` })
}

function forwardMessage() {
  if (!selected.value) return
  beginCompose({ subject: forwardSubject(selected.value.subject), text: `\n\n--- Forwarded message ---\nFrom: ${selected.value.from || selected.value.sender || ''}\n\n${selected.value.bodyText}` })
}

function extractEmail(value: string) {
  return value.match(/<([^>]+)>/)?.[1] || value.trim()
}
function replySubject(value: string) { return /^re:/i.test(value) ? value : `Re: ${value}` }
function forwardSubject(value: string) { return /^fwd:/i.test(value) ? value : `Fwd: ${value}` }

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  composeFiles.value = Array.from(input.files || [])
}

async function sendMessage() {
  composeBusy.value = true
  composeError.value = ''
  try {
    const form = new FormData()
    form.set('fromAddressId', compose.fromAddressId)
    form.set('to', compose.to)
    form.set('cc', compose.cc)
    form.set('bcc', compose.bcc)
    form.set('subject', compose.subject)
    form.set('text', compose.text)
    composeFiles.value.forEach(file => form.append('attachment', file, file.name))
    await $fetch('/api/messages/send', { method: 'POST', body: form })
    composeOpen.value = false
    if (folder.value === 'sent') await loadFolder('sent')
  } catch (error: any) {
    composeError.value = error?.data?.statusMessage || error?.statusMessage || 'Message could not be sent.'
  } finally {
    composeBusy.value = false
  }
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/login')
}

function senderLabel(message: ListMessage) {
  if (message.direction === 'outbound') return message.to?.join(', ') || 'Recipients'
  const source = message.from || message.sender || 'Unknown sender'
  return source.replace(/\s*<[^>]+>\s*$/, '') || extractEmail(source)
}

function formatWhen(value: string) {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div v-if="!busy && session" class="app-shell">
    <aside class="sidebar" :class="{ 'mobile-open': mobileSidebar }">
      <div class="sidebar-brand"><HatchLogo light /></div>
      <button class="compose-button" @click="beginCompose()"><PenLine /> <span>Compose</span></button>
      <nav class="sidebar-nav" aria-label="Mailbox folders">
        <button class="sidebar-button" :class="{ active: folder === 'inbox' }" @click="loadFolder('inbox'); mobileSidebar = false"><Inbox /><span>Inbox</span><span v-if="unreadCount" class="count">{{ unreadCount }}</span></button>
        <button class="sidebar-button" :class="{ active: folder === 'sent' }" @click="loadFolder('sent'); mobileSidebar = false"><Send /><span>Sent</span></button>
        <button class="sidebar-button" :class="{ active: folder === 'archive' }" @click="loadFolder('archive'); mobileSidebar = false"><Archive /><span>Archive</span></button>
        <button class="sidebar-button" :class="{ active: folder === 'trash' }" @click="loadFolder('trash'); mobileSidebar = false"><Trash2 /><span>Trash</span></button>
        <div class="sidebar-divider" />
        <NuxtLink v-if="session.user.role === 'admin'" class="sidebar-link" to="/admin"><Settings /><span>Admin</span></NuxtLink>
      </nav>
      <div class="sidebar-footer">
        <div class="account-chip">
          <div class="avatar sm">{{ initials }}</div>
          <div class="account-copy"><strong>{{ session.user.displayName }}</strong><span>{{ primaryEmail }}</span></div>
          <button class="icon-button" title="Sign out" style="color:white;margin-left:auto" @click="logout"><LogOut /></button>
        </div>
      </div>
    </aside>

    <main class="app-main">
      <header class="topbar">
        <button class="icon-button mobile-menu" aria-label="Open menu" @click="mobileSidebar = !mobileSidebar"><Menu /></button>
        <label class="search-box"><Search /><input v-model="search" placeholder="Search mail" aria-label="Search mail"></label>
        <div class="topbar-spacer" />
        <label v-if="session.addresses.length" class="address-select"><Mail /><select v-model="compose.fromAddressId" aria-label="Default sending address"><option v-for="address in session.addresses.filter(item => item.canSend)" :key="address.id" :value="address.id">{{ address.email }}</option></select><ChevronDown /></label>
        <div class="avatar md">{{ initials }}</div>
      </header>

      <section class="mail-workspace">
        <div class="message-column">
          <div class="list-toolbar">
            <span class="toolbar-label">{{ folder[0].toUpperCase() + folder.slice(1) }}</span>
            <div class="toolbar-spacer" />
            <span class="toolbar-label">Newest</span><ChevronDown :size="16" />
          </div>
          <div class="message-list">
            <button v-for="message in filteredMessages" :key="message.id" class="message-row" :class="{ selected: selected?.id === message.id, unread: !message.isRead }" @click="openMessage(message.id)">
              <span v-if="!message.isRead" class="unread-dot" />
              <span class="row-top"><span class="row-sender">{{ senderLabel(message) }}</span><span class="row-time">{{ formatWhen(message.timestamp) }}</span></span>
              <span class="row-subject">{{ message.subject || '(no subject)' }}</span>
              <span class="row-preview">{{ message.preview || 'No text preview available.' }}</span>
              <span class="row-star" :class="{ on: message.isStarred }"><Star /></span>
            </button>
            <div v-if="!filteredMessages.length" class="empty-state"><div><strong>No messages</strong>This folder is empty.</div></div>
          </div>
        </div>

        <div class="message-pane" :class="{ 'mobile-hidden': !mobileMessageOpen }">
          <div class="message-toolbar">
            <button class="icon-button mobile-menu" aria-label="Back to message list" @click="mobileMessageOpen = false"><ArrowLeft /></button>
            <template v-if="selected">
              <button class="toolbar-action" @click="reply(false)"><Reply /><span>Reply</span></button>
              <button class="toolbar-action" @click="reply(true)"><ReplyAll /><span>Reply all</span></button>
              <button class="toolbar-action" @click="forwardMessage"><Forward /><span>Forward</span></button>
              <span class="toolbar-separator" />
              <button v-if="selected.folder !== 'archive' && selected.folder !== 'sent'" class="icon-button" title="Archive" @click="patchMessage(selected.id, { folder: 'archive' })"><Archive /></button>
              <button class="icon-button" title="Delete" @click="patchMessage(selected.id, { folder: 'trash' })"><Trash2 /></button>
              <button class="icon-button" title="Star" @click="patchMessage(selected.id, { isStarred: !selected.isStarred })"><Star :fill="selected.isStarred ? 'currentColor' : 'none'" /></button>
              <button class="icon-button" title="Label"><Tag /></button>
              <div class="toolbar-spacer" /><button class="icon-button" title="More"><MoreHorizontal /></button>
            </template>
          </div>

          <div v-if="selected" class="message-scroll">
            <div class="subject-line"><h1 class="message-title">{{ selected.subject || '(no subject)' }}</h1><span class="folder-pill">{{ selected.folder }}</span></div>
            <div class="sender-block">
              <div class="avatar lg">{{ senderLabel(selected).split(/\s+/).map(v => v[0]).join('').slice(0,2).toUpperCase() }}</div>
              <div class="sender-copy"><strong>{{ senderLabel(selected) }}</strong><span class="muted">{{ selected.from || selected.sender }}</span><br><span class="muted">To {{ selected.to.join(', ') }}</span></div>
              <div class="sender-time">{{ new Date(selected.timestamp).toLocaleString() }}</div>
            </div>
            <div v-if="selected.attachments?.length" class="attachment-list">
              <a v-for="attachment in selected.attachments" :key="attachment.id" class="attachment-card" :href="attachment.downloadUrl"><FileText /><strong>{{ attachment.filename }}</strong><span>· {{ formatBytes(attachment.size) }}</span><Download class="download" /></a>
            </div>
            <div class="message-body">{{ selected.bodyText || '[This message contains no plain-text body.]' }}</div>
          </div>
          <div v-else class="empty-state"><div><strong>Select a message</strong>Choose a message from the list to read it.</div></div>
        </div>
      </section>
    </main>

    <div v-if="composeOpen" class="compose-scrim" @click.self="composeOpen = false">
      <form class="compose-window" @submit.prevent="sendMessage">
        <div class="compose-header"><strong>New message</strong><button type="button" class="icon-button" aria-label="Close compose" @click="composeOpen = false"><X /></button></div>
        <div class="compose-fields">
          <label class="compose-line"><span>From</span><select v-model="compose.fromAddressId" required><option v-for="address in session.addresses.filter(item => item.canSend)" :key="address.id" :value="address.id">{{ address.email }}</option></select></label>
          <label class="compose-line"><span>To</span><input v-model="compose.to" type="text" required placeholder="name@example.com"></label>
          <label class="compose-line"><span>Cc</span><input v-model="compose.cc" type="text"></label>
          <label class="compose-line"><span>Bcc</span><input v-model="compose.bcc" type="text"></label>
          <label class="compose-line"><span>Subject</span><input v-model="compose.subject" type="text"></label>
          <textarea v-model="compose.text" class="compose-body" placeholder="Write your message…" required />
          <p v-if="composeError" class="form-error">{{ composeError }}</p>
        </div>
        <div class="compose-footer"><label class="file-label"><Paperclip :size="18" /> Attach files<input type="file" multiple @change="onFiles"></label><span v-if="composeFiles.length" class="file-summary">{{ composeFiles.length }} file{{ composeFiles.length === 1 ? '' : 's' }}</span><button class="primary-button" :disabled="composeBusy || !compose.fromAddressId">{{ composeBusy ? 'Sending…' : 'Send' }}</button></div>
      </form>
    </div>
  </div>
  <div v-else class="auth-page"><div>Loading Hatchmail…</div></div>
</template>
