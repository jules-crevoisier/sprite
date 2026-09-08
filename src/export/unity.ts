import type { Sprite } from '../core/document'
import type { SheetResult } from './spritesheet'

/** Hachage stable : deux exports du meme sprite gardent les memes identifiants. */
function hash32(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** GUID Unity : 32 caracteres hexadecimaux, derive du nom pour rester stable. */
export function unityGuid(seed: string): string {
  let out = ''
  for (let i = 0; i < 4; i++) out += hash32(`${seed}#${i}`).toString(16).padStart(8, '0')
  return out.slice(0, 32)
}

export interface UnityOptions {
  /** Pixels par unite Unity ; typiquement la taille d'une tuile. */
  pixelsPerUnit: number
  /** 0 = point (pixel art), 1 = bilineaire. */
  filterMode: 0 | 1 | 2
  /** Compression : 0 = aucune, recommande pour le pixel art. */
  compression: 0 | 1 | 2 | 3
  generateAnimations: boolean
  /** Images par seconde des clips generes. */
  sampleRate: number
}

export const DEFAULT_UNITY_OPTIONS: UnityOptions = {
  pixelsPerUnit: 16,
  filterMode: 0,
  compression: 0,
  generateAnimations: true,
  sampleRate: 60,
}

const spriteName = (sprite: Sprite, index: number, tag: string | null): string =>
  `${sprite.name}_${tag ? `${tag}_` : ''}${index}`

/**
 * Fichier .meta de TextureImporter avec le decoupage en sprites.
 * Unity attend une origine en bas a gauche : les Y sont donc inverses.
 */
export function buildUnityMeta(
  sprite: Sprite,
  sheet: SheetResult,
  textureGuid: string,
  options: Partial<UnityOptions> = {},
): string {
  const o = { ...DEFAULT_UNITY_OPTIONS, ...options }
  const sheetH = sheet.bitmap.height

  // Un slice comportant une zone centrale definit les bordures 9-slice.
  const nineSlice = sprite.slices.find((s) => s.center)
  const border = nineSlice && nineSlice.center
    ? {
        x: nineSlice.center.x,
        y: nineSlice.bounds.h - (nineSlice.center.y + nineSlice.center.h),
        z: nineSlice.bounds.w - (nineSlice.center.x + nineSlice.center.w),
        w: nineSlice.center.y,
      }
    : { x: 0, y: 0, z: 0, w: 0 }

  const sprites = sheet.frames.map((f, i) => {
    const name = spriteName(sprite, f.index, f.tag)
    return {
      name,
      internalID: 21300000 + i * 2,
      spriteID: unityGuid(`${sprite.name}/${name}`),
      rect: {
        x: f.frame.x,
        y: sheetH - (f.frame.y + f.frame.h),
        width: f.frame.w,
        height: f.frame.h,
      },
    }
  })

  const spriteBlocks = sprites.map((s) => `    - serializedVersion: 2
      name: ${s.name}
      rect:
        serializedVersion: 2
        x: ${s.rect.x}
        y: ${s.rect.y}
        width: ${s.rect.width}
        height: ${s.rect.height}
      alignment: 9
      pivot: {x: ${sprite.pivot.x}, y: ${sprite.pivot.y}}
      border: {x: ${border.x}, y: ${border.y}, z: ${border.z}, w: ${border.w}}
      outline: []
      physicsShape: []
      tessellationDetail: 0
      bones: []
      spriteID: ${s.spriteID}
      internalID: ${s.internalID}
      vertices: []
      indices: 
      edges: []
      weights: []`).join('\n')

  const nameTable = sprites.map((s) => `      ${s.name}: ${s.internalID}`).join('\n')
  const idTable = sprites.map((s) => `  - first:
      213: ${s.internalID}
    second: ${s.name}`).join('\n')

  return `fileFormatVersion: 2
guid: ${textureGuid}
TextureImporter:
  internalIDToNameTable:
${idTable || '  []'}
  externalObjects: {}
  serializedVersion: 12
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: 1
    linearTexture: 0
    fadeOut: 0
    borderMipMap: 0
    mipMapsPreserveCoverage: 0
    alphaTestReferenceValue: 0.5
    mipMapFadeDistanceStart: 1
    mipMapFadeDistanceEnd: 3
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
  isReadable: 0
  streamingMipmaps: 0
  streamingMipmapsPriority: 0
  vTOnly: 0
  ignoreMasterTextureLimit: 0
  grayScaleToAlpha: 0
  generateCubemap: 6
  cubemapConvolution: 0
  seamlessCubemap: 0
  textureFormat: 1
  maxTextureSize: 8192
  textureSettings:
    serializedVersion: 2
    filterMode: ${o.filterMode}
    aniso: 1
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 50
  spriteMode: 2
  spriteExtrude: 1
  spriteMeshType: 0
  alignment: 0
  spritePivot: {x: ${sprite.pivot.x}, y: ${sprite.pivot.y}}
  spritePixelsToUnits: ${o.pixelsPerUnit}
  spriteBorder: {x: ${border.x}, y: ${border.y}, z: ${border.z}, w: ${border.w}}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: 1
  spriteTessellationDetail: -1
  textureType: 8
  textureShape: 1
  singleChannelComponent: 0
  flipbookRows: 1
  flipbookColumns: 1
  maxTextureSizeSet: 0
  compressionQualitySet: 0
  textureFormatSet: 0
  ignorePngGamma: 0
  applyGammaDecoding: 0
  swizzle: 50462976
  cookieLightType: 0
  platformSettings:
  - serializedVersion: 3
    buildTarget: DefaultTexturePlatform
    maxTextureSize: 8192
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: ${o.compression}
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
  spriteSheet:
    serializedVersion: 2
    sprites:
${spriteBlocks || '    []'}
    outline: []
    physicsShape: []
    bones: []
    spriteID: 
    internalID: 0
    vertices: []
    indices: 
    edges: []
    weights: []
    secondaryTextures: []
    nameFileIdTable:
${nameTable || '      {}'}
  spritePackingTag: 
  pSDRemoveMatte: 0
  pSDShowRemoveMatteOption: 0
  userData: 
  assetBundleName: 
  assetBundleVariant: 
`
}

/**
 * Un AnimationClip par tag, referencant directement les sprites de la planche.
 * Le clip est pret a etre glisse sur un Animator.
 */
export function buildUnityAnimations(
  sprite: Sprite,
  sheet: SheetResult,
  textureGuid: string,
  options: Partial<UnityOptions> = {},
): { name: string; content: string }[] {
  const o = { ...DEFAULT_UNITY_OPTIONS, ...options }
  const out: { name: string; content: string }[] = []

  const groups: { name: string; frames: number[]; loop: boolean }[] = sheet.tags.length
    ? sheet.tags.map((t) => ({
        name: t.name,
        frames: sheet.frames
          .map((f, i) => ({ f, i }))
          .filter(({ f }) => f.index >= t.from && f.index <= t.to)
          .map(({ i }) => i),
        loop: t.repeat === 0,
      }))
    : [{ name: sprite.name, frames: sheet.frames.map((_, i) => i), loop: true }]

  for (const group of groups) {
    if (!group.frames.length) continue
    let time = 0
    const keys: string[] = []
    for (const i of group.frames) {
      const f = sheet.frames[i]
      const internalID = 21300000 + i * 2
      keys.push(`    - time: ${time.toFixed(4)}
      value: {fileID: ${internalID}, guid: ${textureGuid}, type: 3}`)
      time += (f.duration || 100) / 1000
    }
    out.push({
      name: `${sprite.name}_${group.name}.anim`,
      content: `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!74 &7400000
AnimationClip:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${sprite.name}_${group.name}
  serializedVersion: 7
  m_Legacy: 0
  m_Compressed: 0
  m_UseHighQualityCurve: 1
  m_RotationCurves: []
  m_CompressedRotationCurves: []
  m_EulerCurves: []
  m_PositionCurves: []
  m_ScaleCurves: []
  m_FloatCurves: []
  m_PPtrCurves:
  - serializedVersion: 2
    curve:
${keys.join('\n')}
    attribute: m_Sprite
    path: 
    classID: 212
    script: {fileID: 0}
    flags: 2
  m_SampleRate: ${o.sampleRate}
  m_WrapMode: 0
  m_Bounds:
    m_Center: {x: 0, y: 0, z: 0}
    m_Extent: {x: 0, y: 0, z: 0}
  m_ClipBindingConstant:
    genericBindings: []
    pptrCurveMapping: []
  m_AnimationClipSettings:
    serializedVersion: 2
    m_AdditiveReferencePoseClip: {fileID: 0}
    m_AdditiveReferencePoseTime: 0
    m_StartTime: 0
    m_StopTime: ${time.toFixed(4)}
    m_OrientationOffsetY: 0
    m_Level: 0
    m_CycleOffset: 0
    m_HasAdditiveReferencePose: 0
    m_LoopTime: ${group.loop ? 1 : 0}
    m_LoopBlend: 0
    m_LoopBlendOrientation: 0
    m_LoopBlendPositionY: 0
    m_LoopBlendPositionXZ: 0
    m_KeepOriginalOrientation: 0
    m_KeepOriginalPositionY: 1
    m_KeepOriginalPositionXZ: 0
    m_HeightFromFeet: 0
    m_Mirror: 0
  m_EditorCurves: []
  m_EulerEditorCurves: []
  m_HasGenericRootTransform: 0
  m_HasMotionFloatCurves: 0
  m_Events: []
`,
    })
  }
  return out
}
