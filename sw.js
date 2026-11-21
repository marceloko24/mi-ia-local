/* Service worker de la app shell (v4, etapa 5: menos invenciones). No hace llamadas de red propias
   (ni analítica ni pings): solo responde a pedidos de la página y,
   en la instalación, guarda los archivos de la interfaz. */
(function () {
  "use strict";

  var CACHE_NAME = "mi-ia-local-shell-v4";
  var PRECACHE_REQUIRED = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./storage.js",
    "./engine.js",
    "./vendor/wllama/wllama.min.js",
    "./manifest.json"
  ];
  var PRECACHE_OPTIONAL = [
    "./icons/icon.svg",
    "./icons/apple-touch-icon.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
  ];

  function isModelDownload(url) {
    var path = url.pathname.toLowerCase();
    if (path.indexOf("/models/") !== -1 || path.indexOf("/modelos/") !== -1) {
      return true;
    }
    return /\.(gguf|ggml|safetensors|onnx|pt|pth|ckpt|bin)$/i.test(path);
  }

  function isInScope(requestUrl) {
    var scope = self.registration && self.registration.scope
      ? self.registration.scope
      : new URL("./", self.location.href).href;
    return requestUrl.indexOf(scope) === 0;
  }

  self.addEventListener("install", function (event) {
    event.waitUntil(
      caches.open(CACHE_NAME).then(function (cache) {
        var required = Promise.all(
          PRECACHE_REQUIRED.map(function (url) {
            return fetch(url, { cache: "reload" }).then(function (response) {
              if (!response || !response.ok) {
                throw new Error("No se pudo precachear " + url);
              }
              return cache.put(url, response);
            });
          })
        );
        var optional = Promise.all(
          PRECACHE_OPTIONAL.map(function (url) {
            return fetch(url, { cache: "reload" }).then(function (response) {
              if (response && response.ok) {
                return cache.put(url, response);
              }
            }).catch(function () {
              /* Íconos opcionales: el conector no pudo subir PNG. */
            });
          })
        );
        return required.then(function () { return optional; });
      }).then(function () {
        return self.skipWaiting();
      }).then(function () {
        return self.clients.matchAll({ includeUncontrolled: true, type: "window" });
      }).then(function (clients) {
        clients.forEach(function (client) {
          client.postMessage({ type: "shell-cached", cache: CACHE_NAME });
        });
      })
    );
  });

  self.addEventListener("activate", function (event) {
    event.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key.indexOf("mi-ia-local-shell-") === 0 && key !== CACHE_NAME;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      }).then(function () {
        return self.clients.claim();
      })
    );
  });

  self.addEventListener("fetch", function (event) {
    if (event.request.method !== "GET") return;

    var url;
    try {
      url = new URL(event.request.url);
    } catch (err) {
      return;
    }

    /* Los modelos los guarda engine.js (OPFS), no el service worker. */
    if (isModelDownload(url)) return;
    /* Los .wasm del motor (10–19 MB) no se precachean acá: engine.js los
       guarda en su propia caché solo cuando se autoriza una descarga. */
    if (/\/vendor\/wllama\/.*\.wasm$/.test(url.pathname) || /\/vendor\/wllama\/compat\//.test(url.pathname)) return;
    if (url.origin !== self.location.origin) return;
    if (!isInScope(event.request.url)) return;

    event.respondWith(cacheFirst(event.request));
  });

  function cacheFirst(request) {
    return caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(request, { ignoreSearch: true }).then(function (cached) {
        if (cached) return cached;

        if (request.mode === "navigate") {
          return cache.match("./index.html").then(function (page) {
            if (page) return page;
            return cache.match("./").then(function (root) {
              if (root) return root;
              return networkWithoutCache(request, cache);
            });
          });
        }

        return networkWithoutCache(request, cache);
      });
    });
  }

  function networkWithoutCache(request, cache) {
    return fetch(request).then(function (response) {
      return response;
    }).catch(function (err) {
      if (request.mode === "navigate") {
        return cache.match("./index.html").then(function (page) {
          if (page) return page;
          return cache.match("./");
        }).then(function (fallback) {
          if (fallback) return fallback;
          throw err;
        });
      }
      throw err;
    });
  }
})();
