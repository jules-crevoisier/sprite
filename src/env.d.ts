/**
 * Variables d'environnement lues a la construction.
 *
 * L'identifiant client OAuth n'est pas un secret — il voyage en clair dans
 * toute requete de connexion — mais il change d'un deploiement a l'autre et
 * n'a donc rien a faire dans le depot : il arrive par la configuration, ou
 * par le dialogue de reglages pour qui deploie le site tel quel.
 */
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
