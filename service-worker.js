// Offline primero: la app completa queda en caché. Cambia VERSION en cada entrega.
const VERSION = '5.3.5';
const CACHE_NAME = `finanzas-tracker-${VERSION}`;
const APP_SHELL = [
  './', './index.html', './manifest.json', './css/styles.css', './css/componentes.css',
  './icons/icon-192.png', './icons/icon-512.png', './data/comercios.json',
  './js/app.js', './js/db.js',
  './js/domain/categorias.js', './js/domain/deudas.js', './js/domain/fechas.js', './js/domain/money.js', './js/domain/movimientos.js', './js/domain/presupuesto.js', './js/domain/salud.js', './js/domain/tarjetas.js',
  './js/parsers/registry.js', './js/parsers/bancolombia/comun.js', './js/parsers/bancolombia/email.js', './js/parsers/bancolombia/sms.js', './js/parsers/bancolombia/patrones.json',
  './js/services/backup.js', './js/services/categorizacion.js', './js/services/conciliacion.js', './js/services/deduplicacion.js', './js/services/exportacion.js', './js/services/ingesta.js', './js/services/migraciones.js', './js/services/registro.js', './js/services/reportes.js', './js/services/sync.js',
  './js/ui/dom.js', './js/ui/ingesta.js', './js/ui/panel.js', './js/ui/principal.js', './js/ui/tarjetas.js', './js/ui/combobox.js',
];

self.addEventListener('install', (event) => {
  // No hay skipWaiting aquí: la versión nueva espera a que el usuario acepte.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'ACTUALIZAR') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Las consultas al script llevan el token: nunca pasan por la caché.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((c) => c || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request).then((c) => c || fetch(request)));
});
