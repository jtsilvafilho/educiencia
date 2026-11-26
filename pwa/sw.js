/* Service worker: casca do app em cache + dados do Supabase "rede primeiro". */
var VERSAO = "v6";
var CACHE_CASCA = "aulas-casca-" + VERSAO;
var CACHE_DADOS = "aulas-dados-" + VERSAO;
var CASCA = [
  "./",
  "index.html",
  "styles.css",
  "config.js",
  "app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE_CASCA).then(function (c) { return c.addAll(CASCA); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes
        .filter(function (n) { return n !== CACHE_CASCA && n !== CACHE_DADOS; })
        .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function guardar(req, res) {
  if (res && res.ok) {
    var copia = res.clone();
    caches.open(CACHE_DADOS).then(function (c) { c.put(req, copia); });
  }
  return res;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  /* Requisição com sessão (admin em prévia ou modo teste): só rede, nunca fica no aparelho. */
  if (/\/rest\/v1\//.test(url.pathname) && req.headers.has("Authorization")) return;

  /* Leitura pública do Supabase: config e aulas. Rede primeiro, cópia offline. */
  if (/\/rest\/v1\/(config|aulas)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(function (res) { return guardar(req, res); })
        .catch(function () { return caches.match(req, { ignoreVary: true }); })
    );
    return;
  }

  /* Admin, Auth, materiais (abrem em outra aba), YouTube e links externos: sempre rede. */
  if (url.origin !== location.origin || /\/admin(\.html|\.js|\.css)?$/.test(url.pathname)) return;

  e.respondWith(
    caches.match(req).then(function (hit) { return hit || fetch(req); })
  );
});
