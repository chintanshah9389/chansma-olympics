import { refreshCapacities, refreshRegistrations } from './storage'

type RealtimeListener = () => void

const listeners = new Set<RealtimeListener>()
let socket: WebSocket | null = null
let reconnectTimer: number | null = null
let intentionalClose = false

function wsUrl(): string {
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(
    /\/$/,
    '',
  )
  if (apiBase) {
    const url = new URL(apiBase)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/ws'
    url.search = ''
    url.hash = ''
    return url.toString()
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function notify(): void {
  // Snapshot so listeners can unsubscribe/resubscribe safely during notify
  for (const listener of [...listeners]) listener()
}

async function handleUpdate(type?: string): Promise<void> {
  if (type === 'capacities-updated') {
    await refreshCapacities()
  } else {
    await Promise.all([refreshRegistrations(), refreshCapacities()])
  }
  notify()
}

function scheduleReconnect(): void {
  if (intentionalClose || reconnectTimer !== null) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    connectRealtime()
  }, 3000)
}

export function connectRealtime(): void {
  intentionalClose = false
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  try {
    socket = new WebSocket(wsUrl())
  } catch (error) {
    console.error('WebSocket connect failed', error)
    scheduleReconnect()
    return
  }

  socket.addEventListener('open', () => {
    console.info('Realtime connected')
  })

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(String(event.data)) as { type?: string }
      if (
        data.type === 'registrations-updated' ||
        data.type === 'capacities-updated' ||
        data.type === 'connected'
      ) {
        void handleUpdate(data.type)
      }
    } catch {
      // ignore bad payloads
    }
  })

  socket.addEventListener('close', () => {
    socket = null
    if (!intentionalClose) scheduleReconnect()
  })

  socket.addEventListener('error', () => {
    socket?.close()
  })
}

export function disconnectRealtime(): void {
  intentionalClose = true
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  socket?.close()
  socket = null
}

export function onRealtimeUpdate(listener: RealtimeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
