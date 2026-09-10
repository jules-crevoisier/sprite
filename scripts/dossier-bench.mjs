/**
 * Banc du dossier de travail, et de ce que chaque navigateur en sait faire.
 *
 * Chrome et Edge ouvrent un dossier ET le reecrivent. Firefox et Safari ne
 * savent que le lire. La faute a eviter n'est pas de mal lire — c'est de
 * laisser croire qu'on enregistre alors qu'on ne le fait pas. Ce banc verifie
 * donc les deux moities separement :
 *
 * - qu'un dossier lu par `webkitdirectory` se parcourt exactement comme un
 *   dossier natif, sous-dossiers compris ;
 * - qu'il se declare EN LECTURE SEULE de bout en bout, et que rien dans la
 *   chaine ne tente une ecriture qui echouerait.
 *
 * Le tout tourne dans un vrai navigateur, parce que `File`, `FileList` et
 * `webkitRelativePath` n'existent pas ailleurs.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { readdirSync, readFileSync } from 'node:fs'

const PORT = 5500 + Math.floor(Math.random() * 200)
const ADRESSE = `http://127.0.0.1:${PORT}/`

let navigateur = null
try {
  for (const d of readdirSync('/opt/pw-browsers')) {
    if (/^chromium-\d+$/.test(d)) { navigateur = `/opt/pw-browsers/${d}/chrome-linux/chrome`; break }
  }
} catch { /* installation locale */ }

const bilan = []
const check = (nom, ok, detail = '') => {
  bilan.push({ nom, ok: !!ok })
  console.log(`${ok ? '  ok  ' : ' ECHEC'} ${nom}${detail ? ` — ${detail}` : ''}`)
}

/** Ferme tout et sort avec le bilan. Appelable depuis n'importe ou. */
async function conclure() {
  try { await browser?.close() } catch { /* deja fermee */ }
  serveur?.kill()
  const rates = bilan.filter((b) => !b.ok)
  console.log(`\n${bilan.length - rates.length}/${bilan.length} verifications`)
  process.exit(rates.length ? 1 : 0)
}

let serveur = spawn('node_modules/.bin/vite',
  ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
process.on('exit', () => serveur.kill())

let vivant = false
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(ADRESSE)).ok) { vivant = true; break } } catch { /* pas pret */ }
  await new Promise((r) => setTimeout(r, 250))
}
if (!vivant) { console.error('le serveur ne repond pas'); process.exit(1) }

let browser = await chromium.launch(navigateur ? { executablePath: navigateur } : {})
const page = await browser.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto(ADRESSE, { waitUntil: 'networkidle' })

console.log('\n--- un dossier lu se parcourt comme un dossier natif ---')

const m = await page.evaluate(async () => {
  const d = await import('/src/io/dossier.ts')
  const disque = await import('/src/io/disque.ts')

  /* Un dossier de projet plausible : des sprites, une palette, un
   * sous-dossier, et deux fichiers qui ne nous regardent pas. */
  const fichier = (chemin, contenu = 'x') => {
    const f = new File([contenu], chemin.split('/').pop(), { type: '' })
    // `webkitRelativePath` est en lecture seule : on le pose comme le
    // navigateur le ferait, sans quoi rien ne serait testable.
    Object.defineProperty(f, 'webkitRelativePath', { value: chemin })
    return f
  }
  const fichiers = [
    fichier('projet/heros.pixelforge', '{}'),
    fichier('projet/slime.pixelforge', '{}'),
    fichier('projet/tuiles.png'),
    fichier('projet/donjon.gpl'),
    fichier('projet/notes.txt'),
    fichier('projet/package.json'),
    fichier('projet/ennemis/chauve.pixelforge', '{}'),
    fichier('projet/ennemis/rat.aseprite'),
    fichier('projet/node_modules/truc.png'),
    fichier('projet/.git/index.png'),
  ]

  const racine = d.dossierDepuisFichiers(fichiers)
  const haut = await d.lireDossier(racine)
  const sous = await racine.getDirectoryHandle('ennemis')
  const dedans = await d.lireDossier(sous)

  /* Ce qu'une poignee de fichier rend vraiment. */
  const poignee = haut.fichiers.find((f) => f.nom === 'heros.pixelforge')?.poignee
  const relu = poignee ? await (await poignee.getFile()).text() : null

  /* Le meme dossier, mais sans chemin relatif : certains navigateurs ne
   * remplissent pas `webkitRelativePath` sur un choix de fichiers isoles. */
  const plat = d.dossierDepuisFichiers(
    [new File(['{}'], 'seul.pixelforge')], 'sans-nom')
  const contenuPlat = await d.lireDossier(plat)

  return {
    nom: racine.name,
    lectureSeule: racine.lectureSeule === true,
    fichiers: haut.fichiers.map((f) => `${f.nom}:${f.genre}`),
    sousDossiers: haut.sousDossiers.map((s) => s.nom),
    marques: haut.fichiers.map((f) => f.lectureSeule),
    dedans: dedans.fichiers.map((f) => `${f.nom}:${f.genre}`),
    dedansMarques: dedans.fichiers.every((f) => f.lectureSeule),
    relu,
    inscriptible: disque.poigneeInscriptible(poignee),
    aCreateWritable: poignee ? 'createWritable' in poignee : true,
    ecriture: poignee ? await disque.ecrireFichier(poignee, 'neuf').catch(() => 'jete') : null,
    autoriseSansRien: await d.autoriser(racine),
    platNom: plat.name,
    platFichiers: contenuPlat.fichiers.map((f) => f.nom),
    parcourt: d.parcoursDossierDisponible(),
    ecritSurPlace: d.dossierDisponible(),
  }
})

check('le nom du dossier vient du chemin, pas d\'un secours',
  m.nom === 'projet', m.nom)
check('on retrouve les sprites, l\'image et la palette',
  m.fichiers.join(' ') === 'donjon.gpl:palette heros.pixelforge:projet slime.pixelforge:projet tuiles.png:image',
  m.fichiers.join(', '))
check('et l\'on n\'y trouve ni les notes ni le package.json',
  !m.fichiers.some((f) => f.startsWith('notes') || f.startsWith('package')),
  'un dossier de jeu en contient toujours, ils n\'ont rien a faire dans la liste')
check('les sous-dossiers sont la, sans node_modules ni .git',
  m.sousDossiers.join(',') === 'ennemis',
  `${m.sousDossiers.join(', ')} — les parcourir figerait l'interface pour rien`)
check('on entre dans un sous-dossier et l\'on y trouve son contenu',
  m.dedans.join(' ') === 'chauve.pixelforge:projet rat.aseprite:aseprite', m.dedans.join(', '))
check('un fichier du dossier se lit vraiment',
  m.relu === '{}', JSON.stringify(m.relu))
check('un fichier isole, sans chemin relatif, ne casse rien',
  m.platNom === 'sans-nom' && m.platFichiers.join(',') === 'seul.pixelforge',
  `${m.platNom} / ${m.platFichiers.join(', ')}`)

console.log('\n--- et il se declare en lecture seule, de bout en bout ---')

check('le dossier se dit en lecture seule', m.lectureSeule)
check('chaque fichier qu\'on en tire porte la meme marque',
  m.marques.every(Boolean) && m.dedansMarques,
  'la marque suit le FICHIER : une fois ouvert dans un onglet, il n\'a plus de dossier')
check('sa poignee n\'a PAS de createWritable',
  m.aCreateWritable === false,
  'une poignee qui aurait la methode aurait l\'air inscriptible, et echouerait a l\'usage')
check('elle se declare non inscriptible', m.inscriptible === false)
check('et ecrireFichier refuse au lieu de jeter',
  m.ecriture === false,
  'une exception ferait parler l\'interface d\'une « autorisation refusee » sans rapport')
check('l\'autorisation, elle, est acquise : on peut lire',
  m.autoriseSansRien === true, 'sinon le panneau demanderait un droit qui n\'existe pas ici')

console.log('\n--- ce que l\'interface en dit ---')

/* Le texte compte autant que le code : « ce navigateur ne sait pas ouvrir un
 * dossier » etait FAUX pour Firefox, qui sait le lire. Une phrase fausse
 * decourage d'essayer ce qui marche. */
const panneau = readFileSync(new URL('../src/ui/dossier-panel.ts', import.meta.url), 'utf8')
check('le panneau distingue « ouvrir » de « reecrire »',
  panneau.includes('parcoursDossierDisponible') && panneau.includes('choisirDossierEnLecture'),
  'un seul test pour deux capacites differentes ne peut pas dire la verite')
check('il ne dit plus a Firefox qu\'il ne sait pas ouvrir un dossier',
  !panneau.includes('Firefox et Safari n’ont pas encore l’API'),
  'ils ont webkitdirectory depuis toujours ; c\'est l\'ecriture sur place qui leur manque')
check('et il annonce la limite AVANT qu\'on travaille',
  panneau.includes('rangera dans Mes projets'),
  'l\'apprendre au premier Ctrl+S, c\'est l\'apprendre trop tard')

const commandes = readFileSync(new URL('../src/ui/commands.ts', import.meta.url), 'utf8')
check('Ctrl+S ne tente pas une ecriture qu\'il sait impossible',
  commandes.includes('poigneeInscriptible'),
  'essayer puis rattraper marche aussi, mais le message arrive apres avoir laisse croire')

const io = readFileSync(new URL('../src/io/dossier.ts', import.meta.url), 'utf8')
check('un dossier en lecture seule n\'est pas retenu d\'une session a l\'autre',
  io.includes('if (d?.lectureSeule) { await retenirDossier(null); return }'),
  'ranger des instantanes ferait rouvrir la page sur le contenu de la veille')

console.log('\n--- le chemin complet, sur un navigateur sans l\'API ---')

/*
 * On cache `showDirectoryPicker` et l'on refait le geste en entier : cliquer
 * « Choisir un dossier », choisir un vrai dossier du disque, voir la liste,
 * ouvrir un sprite, faire Ctrl+S. C'est la seule facon de savoir que le
 * repli marche VRAIMENT, et pas seulement que les fonctions existent.
 *
 * Chromium sert de doublure pour Firefox : ce qu'on lui retire, c'est
 * exactement ce que Firefox n'a pas.
 */
{
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'pfe-dossier-'))
  // Deux vrais projets, serialises par le moteur lui-meme : un fichier bricole
  // a la main prouverait que le panneau lit du JSON, pas qu'il ouvre un sprite.
  const projets = await page.evaluate(async () => {
    const { demoCharacter } = await import('/src/ui/demo-content.ts')
    const { serializeSprite } = await import('/src/io/project.ts')
    const a = demoCharacter(); a.name = 'heros'
    const b = demoCharacter(); b.name = 'slime'
    return [serializeSprite(a), serializeSprite(b)]
  })
  writeFileSync(join(dir, 'heros.pixelforge'), projets[0])
  writeFileSync(join(dir, 'slime.pixelforge'), projets[1])

  const page2 = await browser.newPage()
  const erreurs2 = []
  page2.on('pageerror', (e) => erreurs2.push(e.message))
  // Avant tout script de la page : l'application lit la capacite au demarrage.
  await page2.addInitScript(() => {
    delete window.showDirectoryPicker
    delete window.showSaveFilePicker
    delete window.showOpenFilePicker
  })
  await page2.goto(ADRESSE, { waitUntil: 'networkidle' })
  await page2.waitForFunction(() => !!window.pixelforge)

  const capacites = await page2.evaluate(async () => {
    const d = await import('/src/io/dossier.ts')
    return { parcourt: d.parcoursDossierDisponible(), ecrit: d.dossierDisponible() }
  })
  check('sans l\'API, on sait encore PARCOURIR un dossier',
    capacites.parcourt === true && capacites.ecrit === false,
    'c\'est toute la difference que l\'ancienne interface ne faisait pas')

  const attente = page2.waitForEvent('filechooser', { timeout: 15000 })
  // Sans `void`, `evaluate` ATTEND la promesse — laquelle attend le selecteur
  // de fichiers, lequel attend que l'evaluation rende la main. Le banc se
  // bloquait la, et l'erreur parlait d'une page fermee.
  await page2.evaluate(() => { void window.pixelforge.dossierPanel.ouvrirUnDossier() })
  // Le selecteur qui ne vient pas est le defaut MEME qu'on veut attraper : un
  // panneau qui, faute d'API native, ne propose plus rien du tout. On le
  // rapporte comme une verification ratee au lieu de laisser le banc tomber
  // sans bilan — une pile d'appels ne dit pas ce qui manque.
  let chooser = null
  try { chooser = await attente } catch { /* rapporte juste en dessous */ }
  check('sans l\'API native, le panneau propose quand meme un selecteur',
    chooser !== null,
    chooser ? 'celui de webkitdirectory' : 'aucun selecteur : le bouton ne fait rien')
  if (!chooser) {
    await page2.close()
    await conclure()
  }
  check('le selecteur demande bien un DOSSIER et non un fichier',
    chooser.isMultiple(), 'un selecteur de fichier unique ne rendrait jamais le dossier')
  await chooser.setFiles(dir)
  await page2.waitForTimeout(600)

  // On interroge le panneau LUI-MEME et non le document : son contenu n'entre
  // dans la page qu'a l'ouverture de l'onglet, et le banc mesurerait alors
  // l'onglet plutot que le dossier.
  const liste = await page2.evaluate(() =>
    [...window.pixelforge.dossierPanel.content.querySelectorAll('.dos-item .dos-nom')]
      .map((e) => e.textContent))
  check('les deux sprites du dossier apparaissent dans le panneau',
    liste.includes('heros.pixelforge') && liste.includes('slime.pixelforge'),
    liste.join(', ') || 'liste vide')

  const ouvert = await page2.evaluate(async () => {
    const lignes = [...window.pixelforge.dossierPanel.content.querySelectorAll('.dos-item')]
    const l = lignes.find((e) => e.textContent.includes('slime.pixelforge'))
    l.click()
    await new Promise((r) => setTimeout(r, 500))
    const app = window.pixelforge
    return {
      nom: app.ed.sprite.name,
      onglets: app.documents.liste.length,
      poignee: app.documents.actif.poignee?.name ?? null,
      inscriptible: typeof app.documents.actif.poignee?.createWritable === 'function',
      pixels: app.ed.sprite.width * app.ed.sprite.height,
    }
  })
  check('un clic ouvre vraiment le sprite, dans son onglet',
    ouvert.nom === 'slime' && ouvert.poignee === 'slime.pixelforge' && ouvert.pixels > 0,
    `« ${ouvert.nom} », ${ouvert.onglets} onglet(s), ${ouvert.pixels} pixels`)
  check('et sa poignee se sait non inscriptible',
    ouvert.inscriptible === false,
    'c\'est elle qui empechera Ctrl+S de promettre une reecriture')

  /* Ctrl+S : il doit ranger dans la bibliotheque, le DIRE, et ne pas laisser
   * le document marque sale — un projet enregistre qui reste sale fait
   * ressortir l'avertissement de fermeture pour rien. */
  const apres = await page2.evaluate(async () => {
    const app = window.pixelforge
    app.ed.run('un pixel', () => { app.ed.peekCel().bitmap.set(0, 0, 0xff0000ff) })
    app.runCommand('file.save')
    await new Promise((r) => setTimeout(r, 800))
    const textes = [...document.querySelectorAll('[class*="toast"]')]
      .map((e) => e.textContent).join(' | ')
    const lib = await import('/src/io/library.ts')
    const projets = await lib.listerProjets().catch(() => [])
    return { textes, projets: projets.map((p) => p.nom ?? '?') }
  })
  check('Ctrl+S le range dans « Mes projets » et le dit',
    /Mes projets/i.test(apres.textes),
    apres.textes || 'aucun message')
  check('et le projet y est vraiment, pas seulement annonce',
    apres.projets.includes('slime'),
    `${apres.projets.join(', ') || 'bibliotheque vide'} — annoncer sans enregistrer serait le pire des deux`)
  check('il ne parle pas d\'une autorisation refusee',
    !/autorisation/i.test(apres.textes),
    'l\'ecriture n\'a pas ete tentee : il n\'y a aucune autorisation en cause')

  check('aucune erreur de page sur le chemin de repli', erreurs2.length === 0, erreurs2.join(' | '))
  await page2.close()
}

check('aucune erreur de page', erreurs.length === 0, erreurs.join(' | '))

await conclure()
