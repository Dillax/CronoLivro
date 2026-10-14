/* CronoLeitura — Service Worker
 * Estratégia: app shell em cache, "stale-while-revalidate" para arquivos do próprio site.
 * Requisições para outros domínios (Google Livros, Open Library, capas) vão direto à rede.
 * Para publicar uma nova versão, altere VERSION.
 */
const VERSION = 'v2.5.1';
const CACHE = 'cronoleitura-' + VERSION;
const COVERS = 'cronoleitura-capas'; // capas de outros sites (mantido entre versões)
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Um arquivo ausente não derruba a instalação inteira.
      Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== COVERS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // capas de livros (imagens de outros sites): guarda uma cópia para aparecer offline
    // só a exibição comum (no-cors); a cópia para o celular (cors) vai direto à rede
    if (req.destination === 'image' && req.mode === 'no-cors') {
      event.respondWith(
        caches.open(COVERS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
          return res;
        }).catch(() => hit || Response.error())))
      );
    }
    return; // APIs: rede direta
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return network.then(
        (res) =>
          res ||
          (req.mode === 'navigate'
            ? caches.match('./index.html')
            : new Response('', { status: 504, statusText: 'Offline' }))
      );
    })
  );
});
