# 📍 GPS depuis photo — extracteur EXIF pour Wayfarer

Petit outil web 100 % statique qui extrait les coordonnées GPS des métadonnées
EXIF d'une photo à partir de son URL. Pensé pour vérifier rapidement les
propositions de PokéStops sur **Niantic Wayfarer** : colle l'adresse de
l'image, obtiens instantanément une carte, des liens Google Maps/Street View
et les coordonnées.

Aucune clé d'API, aucun serveur applicatif, aucun build : juste du
HTML/CSS/JS vanilla, hébergeable gratuitement sur GitHub Pages.

## Mode d'emploi (le parcours principal)

1. Dans Wayfarer, **clic droit sur la photo** de la proposition → **« Copier
   l'adresse de l'image »**.
2. Colle l'URL dans le grand champ de texte de l'outil (`Ctrl+V`). (url de l'outil : https://rrradassse.github.io/wayfarer-gps-exif/ ) 
3. L'analyse démarre automatiquement au collage (ou clique sur
   « Analyser »). En quelques secondes, tu obtiens :
   - une mini-carte avec un marqueur sur la position ;
   - des liens directs vers **Google Maps** et **Street View** ;
   - les coordonnées en décimal (avec un bouton **Copier**, prêtes à coller
     dans Google Maps) et en degrés/minutes/secondes ;
   - une miniature de la photo, la date de prise de vue et l'appareil si
     ces informations sont disponibles.
4. Le champ reprend automatiquement le focus (texte sélectionné) : colle
   directement l'URL suivante pour enchaîner les vérifications.

Tu peux aussi coller **plusieurs URL** (une par ligne) : un tableau
récapitulatif s'affiche, avec export CSV et clic sur une ligne pour voir sa
carte en détail.

## Comment l'outil récupère les coordonnées

Dans l'ordre, et automatiquement (aucune action de ta part) :

1. **Téléchargement direct** de l'URL telle que collée, puis lecture EXIF.
2. Si aucune coordonnée GPS n'est trouvée : essai des **variantes de
   suffixe** utilisées par `lh3.googleusercontent.com` (`=s0`, `=d`,
   `=s0-d`, sans suffixe), en remplaçant ce qui suit le dernier `=` de
   l'URL. Certaines variantes conservent l'EXIF là où d'autres le
   suppriment.
3. Si le téléchargement échoue à cause d'une restriction **CORS** : la
   requête est retentée via un **proxy Cloudflare Worker**, si tu en as
   configuré un dans le panneau **Paramètres** (⚙️, en haut à droite).
4. **En tout dernier recours**, si tout a échoué : un message clair explique
   la cause (CORS, 404, timeout, URL invalide...) et un encart repliable
   « Analyser un fichier local » apparaît, pour glisser-déposer une image
   téléchargée manuellement.

Si l'image n'a pas de coordonnées GPS, l'outil l'indique clairement mais
affiche quand même les autres métadonnées disponibles (date, appareil...).
Une erreur sur une URL ne bloque jamais l'analyse des autres.

## Publier sur GitHub Pages

1. Crée un dépôt GitHub et pousse ce dossier (voir section Git ci-dessous).
2. Dans le dépôt : **Settings → Pages → Build and deployment → Source :
   Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. L'outil est en ligne à `https://<ton-compte>.github.io/<nom-du-repo>/`.

Aucune étape de build n'est nécessaire : `index.html`, `style.css` et
`app.js` sont servis tels quels.

## Déployer le proxy CORS (Cloudflare Worker, gratuit)

Ce proxy n'est utile qu'en filet de sécurité : dans la plupart des cas,
`lh3.googleusercontent.com` autorise déjà le téléchargement direct en CORS
(vérifié lors du développement de cet outil). Configure-le seulement si tu
rencontres des échecs CORS récurrents.

1. Crée un compte gratuit sur [Cloudflare](https://dash.cloudflare.com/sign-up).
2. Dans le dashboard : **Workers & Pages → Create → Create Worker**.
3. Donne-lui un nom (ex. `wayfarer-gps-proxy`), puis clique sur **Edit
   code** (Quick Edit).
4. Remplace tout le contenu par celui de [`worker/cors-proxy.js`](worker/cors-proxy.js)
   de ce dépôt, puis **Deploy**.
5. Note l'URL du Worker (ex. `https://wayfarer-gps-proxy.mon-compte.workers.dev`).
6. Dans l'outil, ouvre **Paramètres** (⚙️) et colle cette URL dans le champ
   « URL du proxy CORS », puis **Enregistrer**.

Le proxy est volontairement limité aux domaines `*.googleusercontent.com`
pour éviter de devenir un proxy CORS ouvert. Le plan gratuit de Cloudflare
Workers (100 000 requêtes/jour) est largement suffisant pour cet usage.

Alternative : `wrangler deploy` avec le [CLI Cloudflare](https://developers.cloudflare.com/workers/wrangler/)
fonctionne aussi si tu préfères la ligne de commande (crée un projet
Wrangler minimal et copie `worker/cors-proxy.js` dedans).

## Limites connues

- **Google supprime parfois l'EXIF** lors du réencodage des photos
  affichées dans Wayfarer, en particulier après certaines transformations
  de taille. C'est pour ça que l'outil essaie plusieurs variantes d'URL —
  mais si Google a supprimé l'EXIF sur toutes les variantes, aucune
  coordonnée ne peut être retrouvée par cette méthode.
- Le **CORS** peut occasionnellement être restreint ou changer côté Google
  sans préavis ; le proxy Cloudflare Worker sert de filet de sécurité dans
  ce cas.
- L'outil ne fait aucune recherche d'image inversée ni de géolocalisation
  par reconnaissance visuelle : il lit uniquement les métadonnées EXIF déjà
  présentes dans le fichier.

## Structure du dépôt

```
index.html            Interface principale
style.css              Mise en forme (clair/sombre, responsive)
app.js                  Logique : téléchargement, lecture EXIF, carte, export
worker/cors-proxy.js    Proxy CORS Cloudflare Worker (optionnel)
```

## Technologies utilisées (toutes gratuites, via CDN)

- [exifr](https://github.com/MikeKovarik/exifr) — lecture des métadonnées EXIF côté navigateur.
- [Leaflet](https://leafletjs.com/) + [OpenStreetMap](https://www.openstreetmap.org/) — carte et tuiles.

## Licence

MIT — voir [LICENSE](LICENSE).
