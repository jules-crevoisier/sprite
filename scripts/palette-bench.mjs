#!/usr/bin/env node
/**
 * Le banc des GROUPES de palette.
 *
 * ## Ce qu'un groupe est
 *
 * Une famille de teintes, sous un nom : « herbe », « peau », « métal ».
 * C'est délibérément la même chose qu'une rampe devinée par `extractRamps` —
 * la différence tient en un mot : ici, c'est la personne qui le dit.
 *
 * ## Ce que ce banc protège
 *
 * Trois règles, et la dernière est la seule qui compte vraiment.
 *
 * 1. Une couleur n'appartient qu'à UN groupe. Sinon les outils choisiraient
 *    au hasard lequel des deux fait foi.
 * 2. Un groupe reste trié de l'ombre à la lumière : c'est une rampe, et une
 *    rampe dont le cran suivant est parfois plus sombre ne sert à rien.
 * 3. Un groupe déclaré PRIME sur la rampe devinée, et seulement pour ses
 *    couleurs. Le vert d'un feuillage et le vert d'un pantalon tombent dans
 *    la même famille quand on devine par teinte ; déclarer l'un ne doit pas
 *    faire perdre l'autre.
 */
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 4700 + Math.floor(Math.random() * 200)
const URL = `http://127.0.0.1:${PORT}/`

let navigateur = null
try {
  for (const dossier of readdirSync('/opt/pw-browsers')) {
    if (/^chromium-\d+$/.test(dossier)) {
      navigateur = `/opt/pw-browsers/${dossier}/chrome-linux/chrome`
      break
    }
  }
} catch { /* installation locale */ }

const bilan = []
const check = (nom, ok, detail = '') => {
  bilan.push({ nom, ok: !!ok })
  console.log(`${ok ? '  ok  ' : ' ECHEC'} ${nom}${detail ? ` — ${detail}` : ''}`)
}

const serveur = spawn('node_modules/.bin/vite',
  ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
process.on('exit', () => serveur.kill())
let vivant = false
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(URL)).ok) { vivant = true; break } } catch { /* pas pret */ }
  await new Promise((r) => setTimeout(r, 250))
}
if (!vivant) { console.error('le serveur ne repond pas'); process.exit(1) }

const browser = await chromium.launch(navigateur ? { executablePath: navigateur } : {})
const page = await browser.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(URL, { waitUntil: 'networkidle' })

const m = await page.evaluate(async () => {
  const { Palette } = await import('/src/core/palette.ts')
  const { Bitmap } = await import('/src/core/bitmap.ts')
  const { rgba, luminance } = await import('/src/core/color.ts')
  const { RampIndex } = await import('/src/smart/analysis.ts')
  const { serializeSprite, deserializeSprite } = await import('/src/io/project.ts')
  const { Sprite } = await import('/src/core/document.ts')

  const sombre = rgba(30, 80, 30, 255)
  const moyen = rgba(74, 142, 72, 255)
  const clair = rgba(130, 200, 120, 255)
  const bleu = rgba(60, 90, 190, 255)
  const out = {}

  /* 1. Ranger */
  {
    const p = new Palette('essai', [])
    p.creerGroupe('herbe', [clair, sombre, moyen])
    const g = p.groupes[0]
    out.ranger = {
      combien: p.groupes.length,
      trie: g.couleurs.map(luminance).every((v, i, l) => i === 0 || l[i - 1] <= v),
      dansPalette: [clair, sombre, moyen].every((c) => p.colors.includes(c)),
    }
    // Un meme nom ne cree pas un doublon : il complete.
    p.creerGroupe('herbe', [bleu])
    out.ranger.apresDoublon = p.groupes.length
    out.ranger.taille = p.groupes[0].couleurs.length
  }

  /* 2. Une couleur n'est que dans UN groupe */
  {
    const p = new Palette('essai', [])
    p.creerGroupe('herbe', [moyen])
    p.creerGroupe('pantalon', [])
    p.ajouterAuGroupe('pantalon', moyen)
    out.exclusif = {
      herbe: p.groupes[0].couleurs.length,
      pantalon: p.groupes[1].couleurs.length,
      trouve: p.groupeDe(moyen)?.nom ?? null,
    }
  }

  /* 3. Renommer, defaire */
  {
    const p = new Palette('essai', [])
    p.creerGroupe('herbe', [moyen])
    p.creerGroupe('peau', [clair])
    out.renommer = {
      pris: p.renommerGroupe('herbe', 'peau'),
      libre: p.renommerGroupe('herbe', 'mousse'),
      vide: p.renommerGroupe('mousse', '   '),
      nom: p.groupes[0].nom,
    }
    p.retirerGroupe('mousse')
    out.renommer.apresRetrait = { groupes: p.groupes.length, couleurs: p.colors.includes(moyen) }
  }

  /* 4. Le groupe declare prime sur la rampe devinee */
  {
    // Deux familles que la devinette confond : trois verts proches.
    const bm = new Bitmap(8, 8)
    const tous = [sombre, moyen, clair, bleu]
    for (let i = 0; i < bm.u32.length; i++) bm.u32[i] = tous[i % tous.length]
    const sans = RampIndex.fromBitmapsAndGroups([bm], [])
    const avec = RampIndex.fromBitmapsAndGroups([bm], [{ nom: 'herbe', couleurs: [sombre, moyen] }])
    out.prime = {
      sansGroupe: sans.rampOf(moyen)?.colors.length ?? 0,
      avecGroupe: avec.rampOf(moyen)?.colors.length ?? 0,
      nom: avec.rampOf(moyen)?.label ?? '',
      // Le clair n'est dans aucun groupe : il garde la rampe devinee.
      clairEncoreRange: (avec.rampOf(clair)?.colors.length ?? 0) > 0,
      clairHorsHerbe: !(avec.rampOf(clair)?.colors ?? []).includes(sombre),
      // Le bleu, lui, n'a jamais bouge.
      bleu: (avec.rampOf(bleu)?.colors ?? []).length,
    }
  }

  /* 5. L'aller-retour par le fichier de projet */
  {
    const sprite = new Sprite(8, 8, new Palette('essai', []))
    sprite.palette.creerGroupe('herbe', [sombre, moyen])
    sprite.palette.creerGroupe('ciel', [bleu])
    const relu = await deserializeSprite(serializeSprite(sprite))
    out.fichier = {
      groupes: relu.palette.groupes.map((g) => `${g.nom}:${g.couleurs.length}`).join(','),
      memesCouleurs: relu.palette.groupes[0].couleurs.includes(sombre),
    }
    // Un projet d'avant les groupes se relit sans en avoir.
    const vieux = JSON.parse(serializeSprite(sprite))
    delete vieux.palette.groupes
    const ancien = await deserializeSprite(JSON.stringify(vieux))
    out.fichier.ancien = ancien.palette.groupes.length
  }

  return out
})

console.log('\n--- ranger des teintes dans une famille ---')
check('un groupe se crée avec ses couleurs', m.ranger.combien === 1)
check('et reste trié de l\'ombre à la lumière', m.ranger.trie,
  'un groupe EST une rampe : le cran suivant doit être plus clair')
check('les couleurs rangées entrent aussi dans la palette', m.ranger.dansPalette,
  'un groupe qui montre ce que la palette ignore serait un mensonge')
check('deux fois le même nom complète le groupe, il n\'en crée pas un second',
  m.ranger.apresDoublon === 1 && m.ranger.taille === 4,
  `${m.ranger.apresDoublon} groupe, ${m.ranger.taille} couleurs`)

console.log('\n--- une couleur n\'est que dans un groupe ---')
check('la ranger ailleurs la sort du premier',
  m.exclusif.herbe === 0 && m.exclusif.pantalon === 1,
  'sinon les outils choisiraient au hasard lequel des deux fait foi')
check('et on retrouve son groupe', m.exclusif.trouve === 'pantalon')

console.log('\n--- renommer, défaire ---')
check('un nom déjà pris est refusé', m.renommer.pris === false)
check('un nom libre est accepté', m.renommer.libre === true && m.renommer.nom === 'mousse')
check('un nom vide est refusé', m.renommer.vide === false)
check('défaire un groupe garde ses couleurs dans la palette',
  m.renommer.apresRetrait.groupes === 1 && m.renommer.apresRetrait.couleurs,
  'on range, on ne jette pas')

console.log('\n--- le groupe déclaré prime sur la rampe devinée ---')
check('sans groupe, la devinette range les trois verts ensemble',
  m.prime.sansGroupe >= 3, `${m.prime.sansGroupe} couleurs dans la rampe devinée`)
check('avec un groupe, la famille est celle qu\'on a déclarée',
  m.prime.avecGroupe === 2 && m.prime.nom === 'herbe',
  `${m.prime.avecGroupe} couleurs, « ${m.prime.nom} »`)
check('ce qui n\'est dans aucun groupe garde sa rampe devinée',
  m.prime.clairEncoreRange && m.prime.clairHorsHerbe,
  'on ne punit pas celui qui n\'a rien rangé')
check('et les autres familles ne bougent pas', m.prime.bleu >= 1)

console.log('\n--- l\'aller-retour par le fichier ---')
check('les groupes partent dans le projet et en reviennent',
  m.fichier.groupes === 'herbe:2,ciel:1' && m.fichier.memesCouleurs,
  m.fichier.groupes)
check('un projet enregistré avant les groupes se relit sans erreur',
  m.fichier.ancien === 0, 'un champ facultatif, pas une erreur de lecture')

check('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '))

await browser.close()
serveur.kill()

const rates = bilan.filter((c) => !c.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} vérifications réussies`)
process.exit(rates.length ? 1 : 0)
