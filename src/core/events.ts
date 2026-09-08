type Handler<T> = (payload: T) => void

/** Emetteur minimaliste type-safe utilise pour relier le modele a l'UI. */
export class Emitter<Events> {
  private map = new Map<keyof Events, Set<Handler<never>>>()

  on<K extends keyof Events>(event: K, fn: Handler<Events[K]>): () => void {
    let set = this.map.get(event)
    if (!set) { set = new Set(); this.map.set(event, set) }
    set.add(fn as Handler<never>)
    return () => { set!.delete(fn as Handler<never>) }
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.map.get(event)
    if (!set) return
    for (const fn of [...set]) (fn as Handler<Events[K]>)(payload)
  }
}
