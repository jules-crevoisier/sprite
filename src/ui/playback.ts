import type { Editor } from '../core/editor'
import type { Tag } from '../core/document'

/**
 * Lecture de l'animation : fait avancer la frame active en respectant les
 * durees, la plage du tag courant et son sens de lecture.
 */
export class Playback {
  private ed: Editor
  private raf = 0
  private lastTime = 0
  private accumulator = 0
  private direction = 1
  private loopsDone = 0

  constructor(editor: Editor) {
    this.ed = editor
    editor.events.on('reload', () => this.stop())
  }

  get playing(): boolean { return this.ed.playing }

  toggle(): void { this.ed.playing ? this.stop() : this.play() }

  play(): void {
    if (this.ed.playing) return
    this.ed.playing = true
    this.lastTime = performance.now()
    this.accumulator = 0
    this.direction = 1
    this.loopsDone = 0
    this.ed.events.emit('playback', true)
    const step = (now: number) => {
      if (!this.ed.playing) return
      this.advance(now)
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  stop(): void {
    if (!this.ed.playing) return
    this.ed.playing = false
    cancelAnimationFrame(this.raf)
    this.ed.events.emit('playback', false)
    this.ed.events.emit('doc', undefined)
  }

  /** Plage de frames a jouer : celle du tag courant, ou tout le sprite. */
  private range(): { from: number; to: number; tag: Tag | null } {
    const ed = this.ed
    const tag = ed.playTagOnly ? ed.sprite.tagAt(ed.activeFrame) : null
    if (tag) return { from: tag.from, to: tag.to, tag }
    return { from: 0, to: ed.sprite.frameCount - 1, tag: null }
  }

  private advance(now: number): void {
    const ed = this.ed
    const dt = now - this.lastTime
    this.lastTime = now
    this.accumulator += dt

    const duration = Math.max(10, ed.sprite.frameDurations[ed.activeFrame] ?? 100)
    if (this.accumulator < duration) return
    this.accumulator -= duration

    const { from, to, tag } = this.range()
    if (to <= from) { ed.setActiveFrame(from); return }

    const dir = tag?.direction ?? 'forward'
    let next = ed.activeFrame

    if (dir === 'reverse') {
      next = ed.activeFrame - 1
      if (next < from) { next = to; this.loopsDone++ }
    } else if (dir === 'pingpong' || dir === 'pingpong-reverse') {
      next = ed.activeFrame + this.direction
      if (next > to) { this.direction = -1; next = Math.max(from, to - 1); this.loopsDone++ }
      else if (next < from) { this.direction = 1; next = Math.min(to, from + 1); this.loopsDone++ }
    } else {
      next = ed.activeFrame + 1
      if (next > to) { next = from; this.loopsDone++ }
    }

    // Un tag avec un nombre de repetitions fini finit par s'arreter.
    if (tag && tag.repeat > 0 && this.loopsDone >= tag.repeat) { this.stop(); return }
    ed.setActiveFrame(next)
  }
}
