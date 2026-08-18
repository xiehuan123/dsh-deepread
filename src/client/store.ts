import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

export function createPanelState() {
  const source = createSnapshotStore({ open: false })
  return {
    source,
    actions: {
      togglePanel(): void {
        source.update((draft) => { draft.open = !draft.open })
      },
      closePanel(): void {
        source.update((draft) => { draft.open = false })
      },
    },
  }
}
