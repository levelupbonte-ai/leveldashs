# Kit SEO LevelUp

Un seul outil pour donner à chaque site client le même SEO que levelup-ecosystem.com :
balises Google, aperçus de partage, données structurées (schema.org) et résumé pour
les IA (Google AI Overviews, ChatGPT, Perplexity). Tout vient de la base LevelUp :
ce que tu remplis dans le dashboard (SEO, Paramètres, Services, FAQ, Avis) sort
directement dans les fichiers.

## Utilisation

```bash
node seo-kit/generate.mjs --website ws_xxxxxxxxxxxxxxxx --out ./public --pages /,/services,/contact
```

| Option | Rôle |
|---|---|
| `--website` | id du site (dashboard → Développeurs) |
| `--out` | dossier de sortie (le `public/` du site) |
| `--base` | domaine, si différent de celui enregistré (`https://exemple.com`) |
| `--pages` | pages à mettre dans le sitemap (défaut : `/`) |

Fichiers générés :

| Fichier | Où le mettre |
|---|---|
| `seo-head.html` | à coller dans le `<head>` de la page d'accueil |
| `robots.txt` | racine du site |
| `sitemap.xml` | racine du site |
| `llms.txt` | racine du site |

Pour un site dont on n'a pas le code (WordPress, Wix, Shopify…), le tag LevelUp
(`docs/ecosystem-api.md`) applique le même SEO à distance.

Relance la commande quand les infos changent (nouveaux services, horaires, avis).

## Ce que contient `seo-head.html`

- Titre, description (≈150 caractères : qui, où, quoi), canonical, robots.
- Open Graph et Twitter (aperçu sur Facebook, WhatsApp, LinkedIn, iMessage).
- JSON-LD :
  - `WebSite` ;
  - le type d'entreprise exact (`BarberShop`, `Restaurant`, `HairSalon`…), avec
    adresse, téléphone, horaires, réseaux, catalogue de services et prix ;
  - note moyenne et avis, **uniquement les vrais avis publiés** dans le dashboard
    (Google pénalise les avis inventés) ;
  - `FAQPage` à partir de la FAQ.

## Avoir un résultat Google comme le nôtre (résumé IA + liens de site)

Le fichier fait la moitié du travail. Le reste se fait une fois par client :

1. **Google Search Console** : ajouter le domaine, coller le code de vérification
   dans dashboard → SEO, puis envoyer `sitemap.xml`.
2. **Fiche Google Business Profile** : c'est elle qui alimente le panneau à droite,
   la carte et une grande partie du résumé IA pour une entreprise locale. Même nom,
   même adresse, même téléphone que sur le site.
3. **Avis Google** : plus il y en a, plus le résumé IA est riche.
4. **Contenu clair** : une page par service, une FAQ avec de vraies questions de
   clients. Les IA citent des phrases simples (« Final Stop est un barbershop à
   San Diego qui… »).
5. **Liens sous le résultat (sitelinks)** : Google les choisit lui-même parmi les
   pages bien reliées du menu. Mettre les pages importantes dans le menu et le
   sitemap, et sortir de l'index les pages sans intérêt (mentions légales,
   connexion) avec `noindex`.

Google met en général 1 à 4 semaines à prendre en compte les changements.
