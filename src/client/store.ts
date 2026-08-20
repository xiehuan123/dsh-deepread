import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

export interface PanelPosition {
  readonly left: number
  readonly top: number
}

export interface PanelState {
  open: boolean
  position: PanelPosition | null
}

export function createPanelState() {
  const source = createSnapshotStore<PanelState>({ open: false, position: null })
  return {
    source,
    actions: {
      togglePanel(): void {
        source.update((draft) => { draft.open = !draft.open })
      },
      closePanel(): void {
        source.update((draft) => { draft.open = false })
      },
      setPanelPosition(position: PanelPosition): void {
        source.update((draft) => { draft.position = position })
      },
    },
  }
}
