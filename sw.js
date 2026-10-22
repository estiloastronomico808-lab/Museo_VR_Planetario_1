/* =========================================================
   SERVICE WORKER - Museo Virtual del Sistema Solar
   =========================================================
   Estrategias:
   - Precaché (al instalar): la "cáscara" de la app: index,
     manifest, iconos, logo y la librería model-viewer.
   - Modelos 3D (.glb): cache-first y BAJO DEMANDA. Cada modelo
     se guarda la primera vez que se muestra (o cuando la app
     precarga el siguiente), así no se gastan datos móviles de
     más. Después abre sin conexión.
   - Navegación: network-first con respaldo a index.html offline.
   - Librerías y demás recursos externos: stale-while-revalidate.

   Para publicar una nueva versión, cambia CACHE_VERSION.
   ========================================================= */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `museo-solar-${CACHE_VERSION}`;

// Archivos propios (rutas relativas al scope del service worker).
const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './img/logo-planetario.png'
];

// Librería externa que usa index.html (misma versión).
const CDN_ASSETS = [
  'https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Los archivos propios son obligatorios: si fallan, no se instala.
    await cache.addAll(LOCAL_ASSETS);

    // La librería externa se intenta; un fallo no bloquea la instalación
    // (se guardará después al usarse).
    await Promise.allSettled(
      CDN_ASSETS.map((url) => cache.add(new Request(url, { mode: 'cors' })))
    );

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('museo-solar-') && n !== CACHE_NAME)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;

  // Navegación: red primero, y si no hay conexión, index.html en caché.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match('./index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  const isLocal = url.origin === self.location.origin;
  const isModel = isLocal && /\.(glb|gltf|usdz|bin)$/i.test(url.pathname);

  // Modelos 3D: cache-first, se guardan la primera vez que se piden.
  if (isModel) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
      }
      return res;
    })());
    return;
  }

  // Todo lo demás: stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);

    const network = fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          cache.put(req, res.clone());
        }
        return res;
      })
      .catch(() => null);

    return cached || (await network) || Response.error();
  })());
});
