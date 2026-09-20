/**
 * Proxy CORS minimal pour Cloudflare Workers (gratuit).
 *
 * Rôle : télécharger une image hébergée sur *.googleusercontent.com et la
 * renvoyer avec des en-têtes CORS permissifs, pour les cas (rares) où le
 * téléchargement direct depuis l'outil échoue.
 *
 * Usage : GET https://<mon-worker>.workers.dev/?url=<URL_IMAGE_ENCODEE>
 *
 * Sécurité : le proxy est volontairement restreint au domaine
 * googleusercontent.com pour éviter d'en faire un proxy CORS ouvert
 * utilisable pour contourner la protection d'autres sites.
 */

const ALLOWED_HOSTNAME_SUFFIX = '.googleusercontent.com';

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get('url');

    if (!target) {
      return new Response('Paramètre "url" manquant.', { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return new Response('URL invalide.', { status: 400 });
    }

    // On n'autorise que les images Google (Wayfarer, Google Photos, etc.)
    const hostname = targetUrl.hostname;
    const isAllowed =
      hostname === 'googleusercontent.com' || hostname.endsWith(ALLOWED_HOSTNAME_SUFFIX);

    if (!isAllowed) {
      return new Response('Domaine non autorisé par ce proxy.', { status: 403 });
    }

    if (targetUrl.protocol !== 'https:') {
      return new Response('Seules les URL HTTPS sont autorisées.', { status: 400 });
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': 'wayfarer-gps-exif-proxy' },
      });
    } catch (e) {
      return new Response('Échec du téléchargement de l\'image cible.', { status: 502 });
    }

    if (!upstream.ok) {
      return new Response(`L'image cible a renvoyé une erreur (${upstream.status}).`, {
        status: upstream.status,
      });
    }

    // On relaie le corps de la réponse tel quel, en ajoutant les en-têtes CORS
    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Cache-Control', 'public, max-age=3600');

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
