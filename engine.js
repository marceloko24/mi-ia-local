/* Motor de IA local (etapa 5).
   Usa wllama (llama.cpp compilado a WebAssembly), copiado dentro de
   este repositorio en vendor/wllama/. Todo corre en este dispositivo:
   las conversaciones nunca salen a internet. La red solo se usa cuando
   la persona toca «Descargar» para bajar el motor y un modelo. */
import { Wllama, ModelManager } from "./vendor/wllama/wllama.min.js";

var ENGINE_CACHE = "mi-ia-local-engine-v1";
var ACTIVE_KEY = "mi-ia-local-active-model";
var GPU_KEY = "mi-ia-local-use-gpu";
var LOADING_KEY = "mi-ia-local-loading-model";

/* Instrucciones fijas para reducir respuestas inventadas. Un modelo
   chico igual puede equivocarse: esto lo reduce, no lo elimina. */
var SYSTEM_PROMPT = [
  "Sos un asistente que funciona sin internet, dentro del teléfono de la persona. Respondé en español, corto y directo.",
  "- Respondé normalmente lo que es conocimiento general que no cambia: geografía, idiomas, ciencia básica, cuentas.",
  "- No sabés nada que cambie con el tiempo: noticias, resultados de partidos, precios, cotizaciones, clima, la fecha de hoy. Para eso decí: «No lo sé: no tengo internet ni datos actualizados.»",
  "- De la persona solo sabés lo que te contó en esta conversación: recordalo y usalo. Si te pregunta algo suyo que no te contó, decí: «No tengo esa información.»",
  "- Si no conocés a una persona, un libro, un lugar chico o un dato exacto, decí «No lo sé» en vez de adivinar.",
  "- Nunca inventes nombres, números, fechas, citas ni enlaces."
].join("\n");

/* Ejemplos cortos que muestran al modelo cómo responder (elegidos
   probando, ver screens/etapa5/eval-antialucinacion.md). Van siempre
   antes de la conversación real y no se guardan en el historial. */
var FEW_SHOT = [
  { role: "user", content: "¿Cuánto salió el partido de Peñarol el domingo?" },
  { role: "assistant", content: "No lo sé: no tengo internet ni datos actualizados." },
  { role: "user", content: "¿Cuál es la capital de Argentina?" },
  { role: "assistant", content: "Buenos Aires." },
  { role: "user", content: "¿Cómo se llama mi hermano?" },
  { role: "assistant", content: "No tengo esa información." },
  { role: "user", content: "¿Cuánto es 3 + 4 × 5?" },
  { role: "assistant", content: "Primero se multiplica: 4 × 5 = 20. Después se suma: 3 + 20 = 23. Resultado: 23." },
  { role: "user", content: "¿Quién escribió el libro «El faro de las nueve lunas» de Ricardo Albornoz Pereda?" },
  { role: "assistant", content: "No lo sé: no conozco ese libro." },
  { role: "user", content: "¿Cuántos meses tiene un año?" },
  { role: "assistant", content: "12." },
  { role: "user", content: "Mi color favorito es el verde." },
  { role: "assistant", content: "Anotado: tu color favorito es el verde." },
  { role: "user", content: "¿Cuál es mi color favorito?" },
  { role: "assistant", content: "El verde." },
  { role: "user", content: "¿Y cuál es mi comida favorita?" },
  { role: "assistant", content: "No tengo esa información: no me lo dijiste." }
];

/* Muestreo determinista (greedy): el modelo siempre elige la palabra
   más probable, sin improvisar. La penalización de repetición evita
   que se quede repitiendo frases. Elegido probando 0,7, 0,2 y 0. */
var SAMPLING = {
  temperature: 0,
  top_k: 1,
  top_p: 1,
  min_p: 0,
  repeat_penalty: 1.1,
  repeat_last_n: 64
};
var MAX_TOKENS = 256;

/* Modelos ofrecidos. Las URLs apuntan a un commit fijo de Hugging Face
   para que el archivo no cambie. Los tamaños se verificaron con curl -I. */
var CATALOG = [
  {
    id: "qwen2.5-0.5b-q4km",
    name: "Qwen2.5 0.5B Instruct (Q4_K_M)",
    description: "Recomendado para iPhone SE. El más liviano; responde más preguntas, pero en nuestras pruebas todavía inventó datos a veces.",
    url: "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/41ba88dbac95fed2528c92514c131d73eb5a174b/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
    size: 397808192,
    license: "Apache 2.0",
    recommended: true,
    warning: ""
  },
  {
    id: "qwen3-0.6b-q4km",
    name: "Qwen3 0.6B (Q4_K_M)",
    description: "El más prudente en nuestras pruebas: casi nunca inventó, pero muchas veces dice «No lo sé» aunque la respuesta sea fácil.",
    url: "https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/60b85c0e3d8fe0f6474f406922a26d12aca4550d/Qwen_Qwen3-0.6B-Q4_K_M.gguf",
    size: 484220320,
    license: "Apache 2.0",
    recommended: false,
    badge: "Más prudente",
    warning: "",
    /* Sin el modo «pensar» de Qwen3: en un iPhone sería demasiado lento. */
    chatTemplateKwargs: { enable_thinking: false }
  },
  {
    id: "llama3.2-1b-q4km",
    name: "Llama 3.2 1B Instruct (Q4_K_M)",
    description: "El doble de pesado y más lento. En nuestras pruebas casi no inventó, pero se negó a responder preguntas simples y no recordó lo que se le contó.",
    url: "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/067b946cf014b7c697f3654f621d577a3e3afd1c/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    size: 807694464,
    license: "Llama 3.2 Community License",
    recommended: false,
    warning: "Experimental en un iPhone de 3 GB: Safari puede cerrar la app por falta de memoria."
  }
];

function detectNeedCompat() {
  var jspi = typeof WebAssembly !== "undefined" && !!WebAssembly.Suspending;
  var mem64 = false;
  try {
    new WebAssembly.Memory({ address: "i64", initial: BigInt(1) });
    mem64 = true;
  } catch (err) {
    mem64 = false;
  }
  return !jspi || !mem64;
}

/* Para pruebas en un navegador de escritorio: localStorage
   "mi-ia-local-force-compat" = "1" fuerza el mismo motor que usa Safari. */
var FORCE_COMPAT = (function () {
  try { return localStorage.getItem("mi-ia-local-force-compat") === "1"; } catch (err) { return false; }
})();
var NEED_COMPAT = FORCE_COMPAT || detectNeedCompat();

/* Archivos del motor que necesita este navegador. Safari en iPhone no
   tiene JSPI ni Memory64, así que usa la versión «compat» (Asyncify). */
var ENGINE_FILES = NEED_COMPAT
  ? [
      { key: "worker", path: "./vendor/wllama/compat/wllama.js", size: 173601, type: "text/javascript" },
      { key: "wasm", path: "./vendor/wllama/compat/wllama.wasm", size: 18755784, type: "application/wasm" }
    ]
  : [
      { key: "wasm", path: "./vendor/wllama/wllama.wasm", size: 10244628, type: "application/wasm" }
    ];

var ENGINE_SIZE = ENGINE_FILES.reduce(function (sum, f) { return sum + f.size; }, 0);

var modelManager = new ModelManager({ allowOffline: true });
var wllama = null;
var loadedId = null;
var listeners = [];
var state = {
  status: "idle", // idle | downloading | loading | ready | generating | error
  message: "",
  progress: null
};

function emit() {
  listeners.forEach(function (fn) {
    try { fn(getState()); } catch (err) { /* ignore */ }
  });
}

function setState(patch) {
  Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
  emit();
}

function getState() {
  return {
    status: state.status,
    message: state.message,
    progress: state.progress,
    loadedId: loadedId,
    activeId: getActiveId(),
    compat: NEED_COMPAT
  };
}

function readLS(key) {
  try { return localStorage.getItem(key); } catch (err) { return null; }
}
function writeLS(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (err) { /* ignore */ }
}

function getActiveId() { return readLS(ACTIVE_KEY); }
function findModel(id) {
  return CATALOG.filter(function (m) { return m.id === id; })[0] || null;
}

function absolute(url) {
  return new URL(url, document.baseURI).href;
}

async function engineCacheStatus() {
  if (!("caches" in window)) return { cached: false, bytes: 0 };
  var cache = await caches.open(ENGINE_CACHE);
  var bytes = 0;
  var all = true;
  for (var i = 0; i < ENGINE_FILES.length; i++) {
    var hit = await cache.match(absolute(ENGINE_FILES[i].path));
    if (hit) bytes += ENGINE_FILES[i].size;
    else all = false;
  }
  return { cached: all, bytes: bytes };
}

/* Descarga los archivos del motor desde este mismo sitio (GitHub Pages)
   y los guarda en la Cache API. Solo se llama después de que la persona
   tocó «Descargar». */
async function downloadEngine(onProgress, signal) {
  if (!("caches" in window)) throw new Error("Este navegador no permite guardar el motor (Cache API no disponible).");
  var cache = await caches.open(ENGINE_CACHE);
  var done = 0;
  for (var i = 0; i < ENGINE_FILES.length; i++) {
    var file = ENGINE_FILES[i];
    var url = absolute(file.path);
    var existing = await cache.match(url);
    if (existing) {
      done += file.size;
      if (onProgress) onProgress(done);
      continue;
    }
    var response = await fetch(url, { cache: "no-store", signal: signal });
    if (!response.ok) throw new Error("No se pudo descargar el motor (" + response.status + ").");
    var reader = response.body.getReader();
    var chunks = [];
    var got = 0;
    while (true) {
      var r = await reader.read();
      if (r.done) break;
      chunks.push(r.value);
      got += r.value.byteLength;
      if (onProgress) onProgress(done + got);
    }
    var blob = new Blob(chunks, { type: file.type });
    if (blob.size !== file.size) {
      throw new Error("El archivo del motor llegó incompleto (" + blob.size + " de " + file.size + " bytes).");
    }
    await cache.put(url, new Response(blob, { headers: { "Content-Type": file.type, "Content-Length": String(blob.size) } }));
    done += file.size;
  }
}

async function engineResources() {
  var cache = await caches.open(ENGINE_CACHE);
  var out = {};
  for (var i = 0; i < ENGINE_FILES.length; i++) {
    var file = ENGINE_FILES[i];
    var hit = await cache.match(absolute(file.path));
    if (!hit) throw new Error("Falta el motor en este dispositivo. Descargá un modelo de nuevo para bajarlo.");
    if (file.key === "worker") {
      out.worker = await hit.text();
    } else {
      var blob = await hit.blob();
      out.wasmUrl = URL.createObjectURL(new Blob([blob], { type: "application/wasm" }));
    }
  }
  return out;
}

async function listInstalled() {
  var models = await modelManager.getModels();
  var byUrl = {};
  models.forEach(function (m) { byUrl[m.url] = m; });
  return CATALOG.map(function (entry) {
    var m = byUrl[entry.url];
    return { id: entry.id, installed: !!m, bytes: m ? m.size : 0 };
  });
}

var currentDownload = null;

async function download(id, onProgress) {
  var entry = findModel(id);
  if (!entry) throw new Error("Modelo desconocido.");
  if (navigator.onLine === false) throw new Error("No hay conexión. Conectate a internet para descargar el modelo.");
  var controller = new AbortController();
  currentDownload = { id: id, controller: controller };
  var engineStatus = await engineCacheStatus();
  var engineTodo = engineStatus.cached ? 0 : ENGINE_SIZE;
  var total = engineTodo + entry.size;
  setState({ status: "downloading", message: "Descargando " + entry.name, progress: { id: id, loaded: 0, total: total } });
  try {
    if (navigator.storage && navigator.storage.persist) {
      try { await navigator.storage.persist(); } catch (err) { /* ignore */ }
    }
    if (engineTodo) {
      await downloadEngine(function (bytes) {
        var p = { id: id, loaded: bytes, total: total };
        setState({ progress: p });
        if (onProgress) onProgress(p);
      }, controller.signal);
    }
    await modelManager.downloadModel(entry.url, {
      signal: controller.signal,
      progressCallback: function (info) {
        var p = { id: id, loaded: engineTodo + info.loaded, total: total };
        setState({ progress: p });
        if (onProgress) onProgress(p);
      }
    });
    if (!getActiveId()) writeLS(ACTIVE_KEY, id);
    setState({ status: loadedId ? "ready" : "idle", message: "", progress: null });
  } catch (err) {
    var aborted = controller.signal.aborted;
    setState({ status: loadedId ? "ready" : "idle", message: "", progress: null });
    if (aborted) throw new Error("Descarga cancelada.");
    throw err;
  } finally {
    currentDownload = null;
  }
}

function cancelDownload() {
  if (currentDownload) currentDownload.controller.abort();
}

async function remove(id) {
  var entry = findModel(id);
  if (!entry) return;
  if (loadedId === id) await unload();
  var models = await modelManager.getModels({ includeInvalid: true });
  for (var i = 0; i < models.length; i++) {
    if (models[i].url === entry.url) await models[i].remove();
  }
  if (getActiveId() === id) writeLS(ACTIVE_KEY, null);
}

function setActive(id) {
  writeLS(ACTIVE_KEY, id);
  emit();
}

function getUseGpu() { return readLS(GPU_KEY) === "1"; }
function setUseGpu(on) { writeLS(GPU_KEY, on ? "1" : null); }

async function unload() {
  if (wllama) {
    try { await wllama.exit(); } catch (err) { /* ignore */ }
  }
  wllama = null;
  loadedId = null;
  setState({ status: "idle", message: "" });
}

/* Si la página se cerró en medio de una carga (por ejemplo, porque iOS
   se quedó sin memoria), lo avisamos la próxima vez. */
function lastLoadCrashed() {
  return readLS(LOADING_KEY);
}

async function load(id) {
  var entry = findModel(id);
  if (!entry) throw new Error("Modelo desconocido.");
  if (loadedId === id && wllama) return;
  if (wllama) await unload();
  var models = await modelManager.getModels();
  var model = models.filter(function (m) { return m.url === entry.url; })[0];
  if (!model) throw new Error("El modelo no está descargado en este dispositivo.");
  setState({ status: "loading", message: "Cargando " + entry.name + "…" });
  writeLS(LOADING_KEY, id);
  try {
    var res = await engineResources();
    var instance = new Wllama({ default: res.wasmUrl }, {
      allowOffline: true,
      modelManager: modelManager,
      suppressNativeLog: true,
      logger: {
        debug: function () {},
        log: function () {},
        warn: function () { console.warn.apply(console, arguments); },
        error: function () { console.error.apply(console, arguments); }
      }
    });
    if (NEED_COMPAT) {
      instance.setCompat({ wasm: res.wasmUrl, worker: { code: res.worker } }, "firefox_safari");
      /* Usamos siempre los archivos locales del motor compat, sin CDN. */
      instance.getWorkerResources = function () {
        return { wasmPath: res.wasmUrl, jsPath: { code: res.worker }, compat: true };
      };
    } else {
      instance.setCompat(null);
    }
    await instance.loadModel(model, {
      n_ctx: 2048,
      n_batch: 256,
      n_gpu_layers: getUseGpu() ? 999 : 0
    });
    wllama = instance;
    loadedId = id;
    writeLS(LOADING_KEY, null);
    setState({ status: "ready", message: "" });
  } catch (err) {
    writeLS(LOADING_KEY, null);
    wllama = null;
    loadedId = null;
    setState({ status: "error", message: describeError(err) });
    throw new Error(describeError(err));
  }
}

function describeError(err) {
  var text = (err && (err.message || String(err))) || "Error desconocido";
  if (/memory|out of bounds|allocation|OOM|RangeError/i.test(text)) {
    return "No alcanzó la memoria para el modelo. Probá con el modelo más chico o cerrá otras apps. (" + text + ")";
  }
  if (/kv_cache_full|context/i.test(text) && err && err.type === "kv_cache_full") {
    return "La conversación es demasiado larga para el modelo. Empezá una nueva.";
  }
  return text;
}

/* Recorta el historial para que entre en el contexto de 2048 tokens.
   Se estima ~3 caracteres por token y se deja lugar para la respuesta
   y para las instrucciones fijas. */
function trimHistory(messages) {
  var budget = 2800;
  var out = [];
  var used = 0;
  for (var i = messages.length - 1; i >= 0; i--) {
    var m = messages[i];
    var len = (m.content || "").length;
    if (out.length && used + len > budget) break;
    out.unshift({ role: m.role, content: len > budget ? m.content.slice(-budget) : m.content });
    used += len;
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

function buildMessages(history, opts) {
  opts = opts || {};
  var system = opts.systemPrompt !== undefined ? opts.systemPrompt : SYSTEM_PROMPT;
  var shots = opts.fewShot !== undefined ? opts.fewShot : FEW_SHOT;
  var out = [];
  if (system) out.push({ role: "system", content: system });
  return out.concat(shots, trimHistory(history));
}

function samplingParams(opts) {
  opts = opts || {};
  var params = {};
  var base = opts.sampling || SAMPLING;
  Object.keys(base).forEach(function (k) { params[k] = base[k]; });
  params.max_tokens = opts.maxTokens || MAX_TOKENS;
  return params;
}

var currentGeneration = null;

async function generate(history, onText, opts) {
  if (!wllama || !loadedId) throw new Error("No hay un modelo cargado.");
  var controller = new AbortController();
  currentGeneration = controller;
  setState({ status: "generating", message: "" });
  var text = "";
  var stopped = false;
  try {
    var request = samplingParams(opts);
    request.messages = buildMessages(history, opts);
    var entry = findModel(loadedId);
    if (entry && entry.chatTemplateKwargs) request.chat_template_kwargs = entry.chatTemplateKwargs;
    request.stream = true;
    request.abortSignal = controller.signal;
    var stream = await wllama.createChatCompletion(request);
    for await (var chunk of stream) {
      var delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (delta && delta.content) {
        text += delta.content;
        if (onText) onText(text);
      }
    }
  } catch (err) {
    if (controller.signal.aborted || (err && err.name === "AbortError") || (err && /abort/i.test(err.name || ""))) {
      stopped = true;
    } else {
      setState({ status: "ready", message: "" });
      currentGeneration = null;
      throw new Error(describeError(err));
    }
  }
  currentGeneration = null;
  setState({ status: "ready", message: "" });
  return { text: text, stopped: stopped, modelId: loadedId };
}

function stop() {
  if (currentGeneration) currentGeneration.abort();
}

async function storageInfo() {
  var info = { usage: null, quota: null, persisted: null };
  if (navigator.storage && navigator.storage.estimate) {
    try {
      var est = await navigator.storage.estimate();
      info.usage = est.usage;
      info.quota = est.quota;
    } catch (err) { /* ignore */ }
  }
  if (navigator.storage && navigator.storage.persisted) {
    try { info.persisted = await navigator.storage.persisted(); } catch (err) { /* ignore */ }
  }
  return info;
}

async function requestPersist() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  try { return await navigator.storage.persist(); } catch (err) { return false; }
}

async function deleteEngine() {
  if ("caches" in window) await caches.delete(ENGINE_CACHE);
}

window.MiIaLocalEngine = {
  catalog: CATALOG,
  engineSize: ENGINE_SIZE,
  compat: NEED_COMPAT,
  engineCacheStatus: engineCacheStatus,
  listInstalled: listInstalled,
  download: download,
  cancelDownload: cancelDownload,
  remove: remove,
  setActive: setActive,
  getActiveId: getActiveId,
  getUseGpu: getUseGpu,
  setUseGpu: setUseGpu,
  load: load,
  unload: unload,
  generate: generate,
  stop: stop,
  getState: getState,
  lastLoadCrashed: lastLoadCrashed,
  clearCrashFlag: function () { writeLS(LOADING_KEY, null); },
  storageInfo: storageInfo,
  requestPersist: requestPersist,
  deleteEngine: deleteEngine,
  onChange: function (fn) { listeners.push(fn); },
  /* Configuración expuesta para las pruebas de evaluación. */
  config: {
    systemPrompt: SYSTEM_PROMPT,
    fewShot: FEW_SHOT,
    sampling: SAMPLING,
    maxTokens: MAX_TOKENS,
    buildMessages: buildMessages,
    samplingParams: samplingParams
  }
};
window.dispatchEvent(new Event("mi-ia-local-engine-ready"));
