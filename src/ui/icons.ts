/**
 * Icones au format "contenu interne de <svg>", dessinees sur une grille 24x24
 * et rendues en trait (stroke) pour rester lisibles a petite taille.
 */
export const ICONS: Record<string, string> = {
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14.5 6.5l3 3"/>',
  eraser: '<path d="M8.5 20H20"/><path d="M10.5 20 4 13.5a1.6 1.6 0 0 1 0-2.2l7-7a1.6 1.6 0 0 1 2.2 0l5.3 5.3a1.6 1.6 0 0 1 0 2.2L12.7 20z"/><path d="M8.2 7.3 15 14"/>',
  bucket: '<path d="M11 3.5 4.6 10a1.4 1.4 0 0 0 0 2l5.4 5.4a1.4 1.4 0 0 0 2 0l6.4-6.4z"/><path d="M8 6.5 13.5 12"/><path d="M19.5 14.5c1.2 1.6 1.8 2.7 1.8 3.4a1.8 1.8 0 0 1-3.6 0c0-.7.6-1.8 1.8-3.4z"/>',
  eyedropper: '<path d="M4 20v-3l8.5-8.5 3 3L7 20z"/><path d="m14 4.8 1.6-1.6a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L18.2 9z"/><path d="m12.8 6 5.2 5.2"/>',
  line: '<path d="M4.5 19.5 19.5 4.5"/><circle cx="4.5" cy="19.5" r="1.6"/><circle cx="19.5" cy="4.5" r="1.6"/>',
  rectangle: '<rect x="3.5" y="5.5" width="17" height="13" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  contour: '<path d="M5 18 7 7l6 3 5-4 1 12z"/>',
  curve: '<path d="M3 19c5 0 4-13 9-13s5 8 9 8"/>',
  'select-rect': '<path d="M3.5 6.5v-3h3M17.5 3.5h3v3M20.5 17.5v3h-3M6.5 20.5h-3v-3M3.5 10v4M20.5 10v4M10 3.5h4M10 20.5h4"/>',
  'select-ellipse': '<path d="M12 3.6c4.7 0 8.5 3.8 8.5 8.4S16.7 20.4 12 20.4 3.5 16.6 3.5 12 7.3 3.6 12 3.6z" stroke-dasharray="3 2.4"/>',
  lasso: '<path d="M12 4.5c4.7 0 8 2.5 8 5.6 0 3-3.3 5.5-8 5.5-1.3 0-2.5-.2-3.6-.5"/><path d="M8.4 15.1c-2.7-1-4.4-2.8-4.4-5 0-1.7 1-3.2 2.7-4.2"/><path d="M8.4 15.1c-.6 1.4-.4 2.7.5 3.4.9.7 2 .4 2.3-.5.3-.9-.4-1.7-1.3-1.6-.9.1-1.4.9-1.5 1.7"/>',
  'magic-wand': '<path d="m4 20 9.5-9.5"/><path d="m13 5 1.2 2.6L17 8.8l-2.8 1.2L13 12.6l-1.2-2.6L9 8.8l2.8-1.2z"/><path d="M19 4v3M17.5 5.5h3M18.5 14v2M17.5 15h2"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="m12 3 2.5 2.5M12 3 9.5 5.5M12 21l2.5-2.5M12 21l-2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  hand: '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.4 7-6 7s-6-2.6-6-6v-3a1.5 1.5 0 0 1 3 0v1.5"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.6 4.6M7.5 10.5h6M10.5 7.5v6"/>',
  shading: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
  blur: '<path d="M12 3.5s6 6.4 6 10a6 6 0 0 1-12 0c0-3.6 6-10 6-10z"/><path d="M9.2 13.5a2.8 2.8 0 0 0 2.8 2.8"/>',
  spray: '<path d="M9 9h6v11H9z"/><path d="M10.5 9V6h3v3"/><path d="M17 5h.01M19.5 7.5h.01M17 10h.01M20 12h.01M17.5 14h.01"/>',
  gradient: '<rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path d="M3.5 16.5h17M3.5 13.5h17" opacity=".5"/><path d="M3.5 10.5h17" opacity=".25"/>',

  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 4.5v15M16 4.5v15" stroke-width="3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>',
  prev: '<path d="M18 5v14l-10-7z" fill="currentColor" stroke="none"/><path d="M6 5v14" stroke-width="2"/>',
  next: '<path d="M6 5v14l10-7z" fill="currentColor" stroke="none"/><path d="M18 5v14" stroke-width="2"/>',
  loop: '<path d="M4 11a7 7 0 0 1 7-7h6"/><path d="m14.5 1.5 3 2.5-3 2.5"/><path d="M20 13a7 7 0 0 1-7 7H7"/><path d="m9.5 22.5-3-2.5 3-2.5"/>',
  onion: '<circle cx="9" cy="12" r="5.5" opacity=".35"/><circle cx="12" cy="12" r="5.5" opacity=".65"/><circle cx="15" cy="12" r="5.5"/>',

  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M15.5 5.5h-11a1 1 0 0 0-1 1v11"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13h9l1-13M10 10v6M14 10v6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  'eye-off': '<path d="M4 4l16 16"/><path d="M9.5 9.7a2.8 2.8 0 0 0 3.9 3.9"/><path d="M6.4 6.6C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1M17.9 15.6c2-1.6 3.6-3.6 3.6-3.6S18 5.5 12 5.5c-.8 0-1.6.1-2.3.3"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 7.5-2"/>',
  layers: '<path d="m12 3.5 8.5 4.7L12 13 3.5 8.2z"/><path d="m4.5 12 7.5 4.2 7.5-4.2"/><path d="m4.5 15.8 7.5 4.2 7.5-4.2"/>',
  undo: '<path d="M4 9h10a5.5 5.5 0 0 1 0 11H8"/><path d="m8 4.5-4 4.5 4 4.5"/>',
  redo: '<path d="M20 9H10a5.5 5.5 0 0 0 0 11h6"/><path d="m16 4.5 4 4.5-4 4.5"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>',
  download: '<path d="M12 3.5v12"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M4 17v2.5h16V17"/>',
  upload: '<path d="M12 20.5v-12"/><path d="m7.5 13 4.5-4.5 4.5 4.5"/><path d="M4 5.5h16"/>',
  save: '<path d="M4.5 5.5a1 1 0 0 1 1-1h11l3 3v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/><path d="M8 4.5v5h7v-5M8 19.5v-6h8v6"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3"/>',
  palette: '<path d="M12 3.5c4.7 0 8.5 3.5 8.5 7.8 0 2.4-2 3.7-4 3.7h-1.6c-1.2 0-2 .8-2 1.8 0 .5.2.9.4 1.3.3.4.4.8.4 1.2 0 1-.8 1.7-1.9 1.7-4.7 0-8.4-4-8.4-8.7S7.3 3.5 12 3.5z"/><circle cx="8" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1.1" fill="currentColor" stroke="none"/>',
  film: '<rect x="2.5" y="5.5" width="19" height="13" rx="1.5"/><path d="M7 5.5v13M17 5.5v13M2.5 12h19"/>',
  flip: '<path d="M12 3v18"/><path d="M9 7 4 12l5 5z"/><path d="m15 7 5 5-5 5z" opacity=".5"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3.5V9h-5.5"/>',
  crop: '<path d="M6.5 2.5v15h15"/><path d="M2.5 6.5h15v15"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.6 4.6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="m8 5 7 7-7 7"/>',
  unity: '<path d="m12 3 7 4v10l-7 4-7-4V7z"/><path d="M12 7.5 8.5 9.5v4L12 15.5l3.5-2v-4z"/>',
  godot: '<path d="M4 8.5 12 4l8 4.5v5L12 18l-8-4.5z"/><circle cx="9" cy="10.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="10.5" r="1.3" fill="currentColor" stroke="none"/><path d="M6 15.5 12 19l6-3.5"/>',
  sheet: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M12 3.5v17M3.5 12h17"/>',
  tag: '<path d="M3.5 10.5v-6a1 1 0 0 1 1-1h6l9.5 9.5a1 1 0 0 1 0 1.4l-5.6 5.6a1 1 0 0 1-1.4 0z"/><circle cx="8" cy="8" r="1.4"/>',
  symmetry: '<path d="M12 2.5v19" stroke-dasharray="3 2"/><path d="M9.5 6.5 4 12l5.5 5.5z"/><path d="m14.5 6.5 5.5 5.5-5.5 5.5z"/>',
  merge: '<path d="M12 3.5v9M12 20.5v-4"/><path d="m8.5 9 3.5 3.5L15.5 9"/><path d="M4.5 16.5h15"/>',
  duplicate: '<rect x="3.5" y="3.5" width="12" height="12" rx="1"/><path d="M8.5 20.5h11a1 1 0 0 0 1-1v-11"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  check: '<path d="m5 12.5 5 5 9-11"/>',
}

/** Construit une balise <svg> autonome pour l'icone demandee. */
export function icon(name: string, size = 20, cls = ''): string {
  const body = ICONS[name] ?? ICONS.info
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}
