import type { Bitmap } from '../core/bitmap'

/** Declenche le telechargement d'un blob dans le navigateur. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Le revoke immediat annulerait le telechargement dans certains navigateurs.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  download(new Blob([text], { type: `${mime};charset=utf-8` }), filename)
}

/** Encode un bitmap en PNG via le canvas. */
export function bitmapToPngBlob(bm: Bitmap, scale = 1): Promise<Blob> {
  const src = bm.toCanvas()
  let canvas = src
  if (scale > 1) {
    canvas = document.createElement('canvas')
    canvas.width = bm.width * scale
    canvas.height = bm.height * scale
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Encodage PNG impossible'))), 'image/png')
  })
}

export async function bitmapToPngBytes(bm: Bitmap, scale = 1): Promise<Uint8Array> {
  const blob = await bitmapToPngBlob(bm, scale)
  return new Uint8Array(await blob.arrayBuffer())
}

/** Nettoie une chaine pour l'utiliser comme nom de fichier. */
export function safeName(name: string): string {
  return name.trim().replace(/[^\w\-. ]+/g, '_').replace(/\s+/g, '_') || 'sprite'
}

/** Ouvre un selecteur de fichiers et retourne les fichiers choisis. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.addEventListener('change', () => resolve(input.files ? [...input.files] : []))
    input.click()
  })
}

export function readFileAsText(file: File): Promise<string> {
  return file.text()
}

export async function loadImageBitmap(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Image illisible'))
      img.src = url
    })
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
