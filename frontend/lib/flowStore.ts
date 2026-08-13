// lib/flowStore.ts
const store = new Map<string, string>()

export function setFlow(flowId: string, intended: string) {
  store.set(flowId, intended)
  setTimeout(() => store.delete(flowId), 2 * 60 * 1000)
}

export function getFlow(flowId: string) {
  const v = store.get(flowId)
  store.delete(flowId)
  return v
}