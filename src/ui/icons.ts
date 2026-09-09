/**
 * Jeu d'icones de l'interface, base sur Lucide.
 *
 * La bibliotheque est empaquetee avec l'application : la politique de
 * securite de la version deployee interdit tout script ou style externe,
 * donc pas de CDN. Les imports nommes permettent au bundler de ne garder
 * que les icones reellement utilisees.
 */
import {
  Pencil, Eraser, PaintBucket, Pipette, Slash, Square, Circle, Spline, PenTool,
  Blend, Contrast, Droplet, SprayCan, SquareDashed, CircleDashed, Lasso,
  WandSparkles, Move, Hand, ZoomIn,
  Play, Pause, SkipBack, SkipForward, Repeat, Ghost,
  Plus, Minus, Copy, CopyPlus, Trash2, Eye, EyeOff, Lock, LockOpen, Layers,
  Undo2, Redo2, Grid3x3, Download, Upload, Save, Settings2, Palette, Film,
  FlipHorizontal2, RotateCw, Crop, Search, X, ChevronRight, Check, Info, Tag,
  Merge, LayoutGrid, Box, Gamepad2, SquarePlus,
  PanelBottom, PanelRight, PanelLeft, Columns2, Sparkles, Bone, PersonStanding,
  Shuffle, SlidersHorizontal, Image as ImageIcon, Package, Scissors,
  ClipboardPaste, Leaf, Dices, RefreshCw, Maximize2, Group, ZoomOut, Scan,
  FolderOpen, HardDriveDownload,
  Swords,
} from 'lucide'

/** Structure d'une icone Lucide : [balise, attributs, enfants?]. */
type IconNode = [string, Record<string, string | number>, IconNode[]?]

/** Noms de l'application vers icones Lucide. */
const SOURCE: Record<string, IconNode> = {
  // Outils
  pencil: Pencil as IconNode,
  eraser: Eraser as IconNode,
  bucket: PaintBucket as IconNode,
  eyedropper: Pipette as IconNode,
  line: Slash as IconNode,
  rectangle: Square as IconNode,
  ellipse: Circle as IconNode,
  contour: PenTool as IconNode,
  curve: Spline as IconNode,
  gradient: Blend as IconNode,
  shading: Contrast as IconNode,
  blur: Droplet as IconNode,
  spray: SprayCan as IconNode,
  'select-rect': SquareDashed as IconNode,
  'select-ellipse': CircleDashed as IconNode,
  lasso: Lasso as IconNode,
  'magic-wand': WandSparkles as IconNode,
  move: Move as IconNode,
  hand: Hand as IconNode,
  zoom: ZoomIn as IconNode,
  'zoom-in': ZoomIn as IconNode,
  'zoom-out': ZoomOut as IconNode,
  fit: Scan as IconNode,

  // Lecture
  play: Play as IconNode,
  pause: Pause as IconNode,
  stop: Square as IconNode,
  prev: SkipBack as IconNode,
  next: SkipForward as IconNode,
  loop: Repeat as IconNode,
  onion: Ghost as IconNode,
  'frame-empty': SquarePlus as IconNode,

  // Edition
  plus: Plus as IconNode,
  minus: Minus as IconNode,
  copy: Copy as IconNode,
  duplicate: CopyPlus as IconNode,
  trash: Trash2 as IconNode,
  eye: Eye as IconNode,
  'eye-off': EyeOff as IconNode,
  lock: Lock as IconNode,
  unlock: LockOpen as IconNode,
  layers: Layers as IconNode,
  undo: Undo2 as IconNode,
  redo: Redo2 as IconNode,
  grid: Grid3x3 as IconNode,
  merge: Merge as IconNode,
  crop: Crop as IconNode,
  flip: FlipHorizontal2 as IconNode,
  rotate: RotateCw as IconNode,
  symmetry: Columns2 as IconNode,
  cut: Scissors as IconNode,
  paste: ClipboardPaste as IconNode,

  // Fichiers et export
  download: Download as IconNode,
  upload: Upload as IconNode,
  save: Save as IconNode,
  sheet: LayoutGrid as IconNode,
  film: Film as IconNode,
  armes: Swords as IconNode,
  unity: Box as IconNode,
  godot: Gamepad2 as IconNode,
  image: ImageIcon as IconNode,
  package: Package as IconNode,

  // Bibliotheque de projets
  library: FolderOpen as IconNode,
  'save-as': HardDriveDownload as IconNode,

  // Interface
  settings: Settings2 as IconNode,
  sliders: SlidersHorizontal as IconNode,
  palette: Palette as IconNode,
  search: Search as IconNode,
  close: X as IconNode,
  chevron: ChevronRight as IconNode,
  check: Check as IconNode,
  info: Info as IconNode,
  tag: Tag as IconNode,
  'panel-bottom': PanelBottom as IconNode,
  'panel-right': PanelRight as IconNode,
  'panel-left': PanelLeft as IconNode,
  layout: Maximize2 as IconNode,
  group: Group as IconNode,

  // Fonctions assistees
  smart: Sparkles as IconNode,
  bone: Bone as IconNode,
  rig: PersonStanding as IconNode,
  variants: Shuffle as IconNode,
  detail: Leaf as IconNode,
  dice: Dices as IconNode,
  refresh: RefreshCw as IconNode,
}

/** Serialise les enfants d'une icone Lucide en balises SVG. */
function serialize(children: IconNode[]): string {
  return children
    .map(([tag, attrs]) => {
      const props = Object.entries(attrs)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
        .join(' ')
      return `<${tag} ${props}/>`
    })
    .join('')
}

/** Contenu interne des icones, indexe par nom applicatif. */
export const ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCE).map(([name, node]) => [name, serialize(node[2] ?? [])]),
)

/** Balise <svg> complete pour l'icone demandee. */
export function icon(name: string, size = 20, cls = ''): string {
  const body = ICONS[name] ?? ICONS.info
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}
