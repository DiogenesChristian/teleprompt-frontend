/* Globo Flow — service worker (US06: operação sem IA/internet)
 *
 * - Pré-carrega todas as telas, estilos, scripts e ícones na instalação.
 * - Navegação: tenta a rede; sem rede, usa a página em cache; se ela não
 *   estiver em cache, mostra offline.html.
 * - Demais arquivos: cache primeiro, atualizando em segundo plano.
 *
 * Os roteiros não passam pelo service worker: ficam no armazenamento local
 * do navegador (js/store.js).
 */
const CACHE = 'globo-flow-v13';
const CORE = [
  './', 'index.html', 'login.html', 'editor.html', 'teleprompter.html',
  'historico.html', 'configuracoes.html', 'offline.html', 'manifest.webmanifest',
  'css/style.css',
  'js/config.js', 'js/icons.js', 'js/data.js', 'js/store.js', 'js/app.js', 'js/api.js', 'js/suggestions.js',
  'js/login.js', 'js/roteiros.js', 'js/editor.js', 'js/pace.js', 'js/teleprompter.js',
  'js/historico.js', 'js/configuracoes.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'status') {
    caches.open(CACHE).then((c) => c.keys()).then((keys) => {
      event.source && event.source.postMessage({ type: 'sw-status', cache: CACHE, files: keys.length });
    });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Chamadas à API nunca vêm do cache.
  if (url.pathname.includes('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('offline.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
