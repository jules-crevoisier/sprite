import type { Sprite } from '../core/document'
import type { SheetResult } from './spritesheet'

export interface GodotOptions {
  /** Chemin de la texture dans le projet Godot. */
  resPath: string
  /** Autoplay / boucle par defaut pour les animations sans tag. */
  loop: boolean
}

/**
 * Ressource SpriteFrames pour Godot 4 : une AtlasTexture par frame et une
 * animation par tag. Le fichier se depose tel quel dans le projet et
 * s'assigne a un AnimatedSprite2D.
 *
 * Godot exprime la vitesse en images par seconde plus un multiplicateur de
 * duree par frame. On prend donc la frame la plus courte comme reference,
 * ce qui reproduit exactement les durees d'origine.
 */
export function buildGodotSpriteFrames(
  sprite: Sprite,
  sheet: SheetResult,
  options: Partial<GodotOptions> = {},
): string {
  const resPath = options.resPath ?? `res://${sprite.name}.png`
  const extId = '1_sheet'

  const groups = sheet.tags.length
    ? sheet.tags.map((t) => ({
        name: t.name,
        indices: sheet.frames
          .map((f, i) => ({ f, i }))
          .filter(({ f }) => f.index >= t.from && f.index <= t.to)
          .map(({ i }) => i),
        loop: t.repeat === 0,
        direction: t.direction,
      }))
    : [{
        name: 'default',
        indices: sheet.frames.map((_, i) => i),
        loop: options.loop ?? true,
        direction: 'forward' as const,
      }]

  const subResources: string[] = []
  sheet.frames.forEach((f, i) => {
    subResources.push(`[sub_resource type="AtlasTexture" id="AtlasTexture_${i}"]
atlas = ExtResource("${extId}")
region = Rect2(${f.frame.x}, ${f.frame.y}, ${f.frame.w}, ${f.frame.h})
`)
  })

  const animations = groups
    .filter((g) => g.indices.length > 0)
    .map((g) => {
      // L'ordre de lecture du tag est materialise directement dans la liste.
      let order = [...g.indices]
      if (g.direction === 'reverse') order.reverse()
      else if (g.direction === 'pingpong' && order.length > 2) {
        order = [...order, ...order.slice(1, -1).reverse()]
      } else if (g.direction === 'pingpong-reverse' && order.length > 2) {
        order = [...order].reverse()
        order = [...order, ...order.slice(1, -1).reverse()]
      }

      const durations = order.map((i) => sheet.frames[i].duration || 100)
      const minMs = Math.max(1, Math.min(...durations))
      const speed = 1000 / minMs
      const frames = order
        .map((i, k) => `{
"duration": ${(durations[k] / minMs).toFixed(3)},
"texture": SubResource("AtlasTexture_${i}")
}`)
        .join(', ')
      return `{
"frames": [${frames}],
"loop": ${g.loop ? 'true' : 'false'},
"name": &"${g.name}",
"speed": ${speed.toFixed(3)}
}`
    })
    .join(', ')

  const loadSteps = subResources.length + 2

  return `[gd_resource type="SpriteFrames" load_steps=${loadSteps} format=3]

[ext_resource type="Texture2D" path="${resPath}" id="${extId}"]

${subResources.join('\n')}
[resource]
animations = [${animations}]
`
}

/**
 * Ressource TileSet minimale (Godot 4) construite sur la grille du sprite.
 * Utile quand la planche sert de tileset plutot que d'animation.
 */
export function buildGodotTileSet(sprite: Sprite, resPath: string): string {
  const tw = sprite.grid.w || 16
  const th = sprite.grid.h || 16
  return `[gd_resource type="TileSet" load_steps=2 format=3]

[ext_resource type="Texture2D" path="${resPath}" id="1_tex"]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]
texture = ExtResource("1_tex")
texture_region_size = Vector2i(${tw}, ${th})

[resource]
tile_size = Vector2i(${tw}, ${th})
sources/0 = SubResource("TileSetAtlasSource_1")
`
}
