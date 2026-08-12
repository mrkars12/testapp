let socket: WebSocket | null = null

let listeners: ((msg: any) => void)[] = []

export function connectWS(userId: number) {

  if (socket) return // 🔥 يمنع التكرار

  socket = new WebSocket(`ws://localhost:8080/ws?user_id=${userId}`)

  socket.onmessage = (event) => {

    const data = JSON.parse(event.data)

    listeners.forEach(cb => cb(data))
  }

  socket.onclose = () => {
    socket = null
  }
}

export function subscribeWS(cb: (msg: any) => void) {
  listeners.push(cb)
}