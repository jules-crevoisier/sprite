import './styles.css'
import { App } from './ui/app'

/**
 * Point d'entree. L'application entiere vit dans l'onglet : aucun etat n'est
 * envoye a un serveur.
 */
function boot(): void {
  const app = new App()
  // Utile pour bidouiller depuis la console du navigateur.
  ;(window as unknown as { pixelforge: App }).pixelforge = app
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
