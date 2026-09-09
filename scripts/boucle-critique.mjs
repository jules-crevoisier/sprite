/**
 * La boucle : dessiner, mesurer, faire juger, corriger, recommencer.
 *
 * Les trois pieces existaient separement — le verificateur qui compte, la
 * planche qui montre, le critique qui juge. Tant qu'un humain les enchainait a
 * la main, on ne pouvait pas savoir si le procede CONVERGE ou s'il oscille :
 * corriger ce que le tour precedent avait pose, puis le reposer au tour
 * suivant. Ce script enchaine, et garde la trace de tout.
 *
 * Un tour :
 *
 *   1. la planche et le rapport du verificateur, tous deux calcules ;
 *   2. les constats bloquants d'abord — ce qui se compte ne se discute pas ;
 *   3. le critique lit la planche et rend un verdict par critere ;
 *   4. si tout est TENU, c'est fini : on s'arrete sur un succes, pas sur un
 *      plafond de tours ;
 *   5. sinon un ouvrier applique les corrections, et les bancs decident si
 *      elles restent. Un tour qui casse un banc est annule.
 *
 * Deux garde-fous, parce qu'une boucle qui ne sait pas s'arreter coute cher :
 * un plafond de tours, et la detection d'oscillation — si le dessin repasse
 * par un etat deja visite, on tourne en rond et on le dit.
 *
 *     node scripts/boucle-critique.mjs --art HEROS
 *     node scripts/boucle-critique.mjs --art HEROS --tours 3 --trace /tmp/t
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const lire = (nom, def = null) => {
  const i = args.indexOf(`--${nom}`)
  return i >= 0 ? args[i + 1] : def
}

const ART = lire('art')
const MASCOTTE = lire('mascotte')
const TOURS = Number(lire('tours', '5'))
const TRACE = lire('trace', join(process.env.TMPDIR ?? '/tmp', 'boucle-critique'))
const SEC = lire('sec') !== null   // n'appelle personne, montre l'enchainement

if (!ART && !MASCOTTE) {
  console.error('Il faut --art NOM ou --mascotte id')
  process.exit(1)
}
const SUJET = ART ? ['--art', ART] : ['--mascotte', MASCOTTE]
const NOM = ART ?? MASCOTTE

/** Les bancs qui doivent rester verts. Un tour qui en casse un est annule. */
const BANCS = ['qualite-bench.mjs', 'vues-bench.mjs', 'rotation-bench.mjs']

mkdirSync(TRACE, { recursive: true })
const journal = []
const dire = (s) => { console.log(s); journal.push(s) }

/** Le fichier ou vit le dessin, et son etat, pour reperer une oscillation. */
const FICHIER = ART ? 'src/demo/art.ts' : 'src/ui/mascots.ts'
const etatDuDessin = () =>
  createHash('sha256').update(readFileSync(FICHIER, 'utf8')).digest('hex').slice(0, 12)

const lancer = (cmd, argv, opts = {}) =>
  spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })

/** La planche et le rapport. Rend le chemin des deux, et le rapport en texte. */
function mesurer(tour) {
  const png = join(TRACE, `tour-${tour}.png`)
  const r = lancer('node', ['scripts/planche-critique.mjs', ...SUJET, '--out', png])
  if (r.status !== 0) {
    dire(`  la planche a echoue : ${(r.stderr || '').trim().split('\n').pop()}`)
    return null
  }
  const txt = png.replace(/\.png$/, '.txt')
  return { png, txt, rapport: existsSync(txt) ? readFileSync(txt, 'utf8').trim() : '' }
}

/** Un appel a Claude, en une fois, sans session. Rend sa reponse en texte. */
function demander(prompt, agent) {
  if (SEC) return `[sec] ${agent ?? 'ouvrier'} aurait ete appele`
  const argv = ['-p', prompt, '--permission-mode', 'acceptEdits']
  if (agent) argv.push('--agent', agent)
  const r = lancer('claude', argv, { cwd: process.cwd() })
  if (r.status !== 0) throw new Error(`claude a repondu ${r.status} : ${(r.stderr || '').slice(0, 400)}`)
  return (r.stdout ?? '').trim()
}

/** Les bancs. Rend la liste de ceux qui echouent. */
function bancsCasses() {
  const casses = []
  for (const banc of BANCS) {
    const r = lancer('node', [`scripts/${banc}`])
    const sortie = `${r.stdout ?? ''}${r.stderr ?? ''}`
    const m = sortie.match(/(\d+)\/(\d+) vérifications/)
    if (!m) { casses.push(`${banc} (pas de bilan)`); continue }
    if (m[1] !== m[2]) casses.push(`${banc} ${m[1]}/${m[2]}`)
  }
  return casses
}

// L'etat de depart des bancs. Un banc deja rouge avant la boucle ne doit pas
// se voir reprocher a un tour qui n'y est pour rien : c'est le DELTA qui
// compte, et le confondre avec l'absolu annulerait tous les tours.
const CASSES_AU_DEPART = SEC ? [] : bancsCasses()
if (CASSES_AU_DEPART.length) {
  dire(`Bancs deja rouges avant la boucle, ils ne seront pas imputes : ${CASSES_AU_DEPART.join(', ')}`)
}

const CRITERES_TENUS = /VERDICT\s*:\s*(TENU|RIEN|AUCUN)/i

const vus = new Map([[etatDuDessin(), 0]])
let fin = null

for (let tour = 1; tour <= TOURS && !fin; tour++) {
  dire(`\n${'='.repeat(64)}\nTour ${tour}/${TOURS} — ${NOM}\n${'='.repeat(64)}`)

  const mes = mesurer(tour)
  if (!mes) { fin = 'la planche ne se calcule plus'; break }
  dire(mes.rapport || '(rapport vide)')

  const critique = demander(
    `Juge la planche du sprite ${NOM}, tour ${tour} de boucle.\n\n`
    + `Planche : ${mes.png}\nRapport du verificateur : ${mes.txt}\n`
    + `Source du dessin : ${FICHIER}\n\n`
    + 'Ce sprite sert de source a une generation de huit directions par '
    + 'rotation : ce qui tient de face doit tenir de trois quarts.\n\n'
    + 'Rends un verdict par critere, TENU ou RATE, et des corrections au pixel '
    + 'pres — quelle ligne, quelle colonne, quelle lettre. Termine par une '
    + 'ligne « VERDICT: ... ». Ne felicite pas.',
    'critique-sprite',
  )
  writeFileSync(join(TRACE, `tour-${tour}-critique.md`), `${critique}\n`)
  dire(critique.split('\n').slice(-14).join('\n'))

  if (CRITERES_TENUS.test(critique)) { fin = `converge au tour ${tour}` ; break }

  const avant = etatDuDessin()
  demander(
    `Applique les corrections de cette critique au sprite ${NOM}, dans ${FICHIER}.\n\n`
    + `${critique}\n\n`
    + 'Regles : ne touche qu\'au dessin et a sa palette. Toutes les lignes du '
    + 'dessin gardent exactement la meme largeur. Si une correction te parait '
    + 'fausse, ne l\'applique pas et ecris pourquoi — un refus mesure vaut '
    + 'mieux qu\'une correction subie.',
  )
  const apres = etatDuDessin()

  if (apres === avant) { fin = `le tour ${tour} n'a rien change` ; break }

  const casses = bancsCasses().filter((c) => !CASSES_AU_DEPART.includes(c))
  if (casses.length) {
    dire(`  bancs casses par ce tour : ${casses.join(', ')} — tour annule`)
    lancer('git', ['checkout', '--', FICHIER])
    fin = `le tour ${tour} cassait ${casses.join(', ')}`
    break
  }

  const dejaVu = vus.get(apres)
  if (dejaVu !== undefined) { fin = `oscillation : retour a l'etat du tour ${dejaVu}` ; break }
  vus.set(apres, tour)
  dire(`  tour ${tour} retenu (${avant} -> ${apres}), bancs verts`)
}

dire(`\n${'='.repeat(64)}\n${fin ?? `plafond de ${TOURS} tours atteint sans converger`}`)
dire(`trace : ${TRACE}`)
writeFileSync(join(TRACE, 'journal.txt'), `${journal.join('\n')}\n`)
