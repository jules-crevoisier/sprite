#!/usr/bin/env node
/**
 * Le banc de l'image : ce que le Dockerfile copie suffit-il a construire ?
 *
 * ## Pourquoi ce banc existe
 *
 * Dix deploiements de suite ont echoue sur ce message :
 *
 *     Could not resolve entry module "demo.html".
 *
 * `demo.html` etait dans le depot, la construction passait en local, les tests
 * passaient, le typage passait. Il manquait UNIQUEMENT dans l'image : le
 * Dockerfile copiait `index.html` nommement, et la page ajoutee ensuite n'avait
 * jamais ete ajoutee a cette ligne.
 *
 * C'est la pire categorie de defaut — celui qu'aucune verification locale ne
 * peut voir, parce que tout le monde travaille dans un dossier ou le fichier
 * EST la. Le seul endroit ou il se voit est la production.
 *
 * ## Ce qu'il verifie
 *
 * Que chaque page declaree dans `vite.config.ts` figure bien parmi ce que le
 * Dockerfile copie. C'est une lecture statique des deux fichiers : pas de
 * Docker, pas de reseau, une demi-seconde. Un banc qui demanderait Docker ne
 * tournerait jamais sur la machine de quelqu'un, donc ne servirait a rien.
 *
 * ## Ce qu'il ne verifie pas, et qu'on dit
 *
 * Il ne construit pas l'image. Un `COPY src ./src` qui oublierait un dossier
 * frere de `src` lui echapperait. La regle couverte est celle qui a mordu, et
 * la seule qu'on puisse verifier sans Docker : les ENTREES du bundler.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const bilan = []
const check = (nom, ok, detail = '') => {
  bilan.push({ nom, ok: !!ok })
  console.log(`${ok ? '  ok  ' : ' ECHEC'} ${nom}${detail ? ` — ${detail}` : ''}`)
}

const dockerfile = readFileSync('Dockerfile', 'utf8')
const vite = readFileSync('vite.config.ts', 'utf8')

/** Les fichiers que la construction attend comme point d'entree. */
const entrees = [...vite.matchAll(/resolve\(__dirname,\s*'([^']+)'\)/g)].map((m) => m[1])
check('les pages déclarées dans vite.config.ts sont lisibles',
  entrees.length > 0, entrees.join(', '))

check('et chacune existe dans le dépôt',
  entrees.every((f) => existsSync(f)),
  entrees.filter((f) => !existsSync(f)).join(', ') || `${entrees.length} pages`)

/**
 * Ce que le Dockerfile copie, sous forme de motifs.
 *
 * On ne lit que l'etape de construction : l'etape finale copie le resultat, et
 * ses `COPY --from` n'ont rien a voir avec les sources.
 */
const etapeBuild = dockerfile.split(/^FROM /m).find((b) => b.includes('AS build')) ?? ''
const motifs = [...etapeBuild.matchAll(/^COPY\s+(?!--from)(.+)$/gm)]
  .flatMap((m) => m[1].trim().split(/\s+/).slice(0, -1))

const copie = (fichier) => motifs.some((motif) => {
  if (motif === fichier) return true
  if (motif.endsWith('/')) return fichier.startsWith(motif)
  if (!motif.includes('*')) return fichier === motif || fichier.startsWith(`${motif}/`)
  const regex = new RegExp(`^${motif.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`)
  return regex.test(fichier)
})

const oubliees = entrees.filter((f) => !copie(f))
check('le Dockerfile copie bien chacune de ces pages',
  oubliees.length === 0,
  oubliees.length
    ? `absente(s) de l’image : ${oubliees.join(', ')} — la construction échouera en production`
    : motifs.join(' '))

/*
 * Le revers : la regle doit savoir dire non.
 *
 * Le premier essai employait `page-inventee.html`, et la regle l'acceptait —
 * a juste titre, puisque le Dockerfile copie `*.html`. Le controle negatif
 * etait faux, pas la regle. On prend donc un cas que les motifs ne couvrent
 * REELLEMENT pas : une page dans un sous-dossier. `*.html` ne descend pas, et
 * c'est un piege qui merite d'etre ecrit noir sur blanc.
 */
check('et la règle sait refuser ce que le Dockerfile ne copie pas',
  !copie('pages/demo.html') && !copie('polices/fonte.woff2'),
  'une page dans un sous-dossier n’est pas prise par « *.html »')

// Toutes les pages du depot devraient etre declarees : une page presente et
// non declaree ne part pas dans le site, et personne ne s'en apercoit avant
// qu'un lien pointe dessus.
const pagesDuDepot = readdirSync('.').filter((f) => f.endsWith('.html'))
const nonDeclarees = pagesDuDepot.filter((f) => !entrees.includes(f))
check('aucune page du dépôt n’est oubliée par la construction',
  nonDeclarees.length === 0,
  nonDeclarees.length
    ? `déclarez-la dans vite.config.ts : ${nonDeclarees.join(', ')}`
    : `${pagesDuDepot.length} pages`)

const rates = bilan.filter((b) => !b.ok)
console.log(`\n${bilan.length - rates.length}/${bilan.length} verifications reussies`)
process.exit(rates.length ? 1 : 0)
