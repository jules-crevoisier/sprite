import type { ToolId } from '../core/editor'
import type { Tool } from './types'
import {
  pencilTool, eraserTool, bucketTool, eyedropperTool,
  sprayTool, blurTool, shadingTool, gradientTool,
} from './draw-tools'
import { lineTool, rectangleTool, ellipseTool, contourTool, curveTool } from './shape-tools'
import {
  selectRectTool, selectEllipseTool, lassoTool, magicWandTool,
  moveTool, handTool, zoomTool,
} from './select-tools'
import { rigTool } from './rig-tool'

export * from './types'
export { beginMove, applyMove, endMove } from './select-tools'
export { rigState, refreshPose, seamSettings } from './rig-tool'

/** Ordre d'affichage dans la barre d'outils, groupe par famille. */
export const TOOL_LIST: Tool[] = [
  pencilTool, eraserTool, bucketTool, eyedropperTool,
  lineTool, curveTool, rectangleTool, ellipseTool, contourTool,
  gradientTool, shadingTool, blurTool, sprayTool,
  selectRectTool, selectEllipseTool, lassoTool, magicWandTool, moveTool,
  rigTool,
  handTool, zoomTool,
]

export const TOOLS: Record<ToolId, Tool> = Object.fromEntries(
  TOOL_LIST.map((t) => [t.id, t]),
) as Record<ToolId, Tool>

export function toolById(id: ToolId): Tool { return TOOLS[id] ?? pencilTool }

/** Recherche l'outil associe a une combinaison clavier ("U", "Shift+U"). */
export function toolByShortcut(combo: string): Tool | null {
  const norm = combo.toLowerCase()
  return TOOL_LIST.find((t) => t.shortcut.toLowerCase() === norm) ?? null
}
