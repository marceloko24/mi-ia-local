(function () {
  "use strict";

  var THEME_KEY = "mi-ia-local-theme";
  var LAST_ID_KEY = "mi-ia-local-last-conversation";
  var NOTICE_NO_MODEL =
    "Todavía no hay un modelo de IA descargado en este dispositivo, así que no se generó ninguna respuesta. Abrí «Modelos» para descargar uno.";
  var NOTICE_NO_ENGINE =
    "El motor de IA local no se pudo iniciar en este navegador, así que no se generó ninguna respuesta.";

  /* Motor real: engine.js (wllama / llama.cpp en WebAssembly).
     Nunca se inventan respuestas: si no hay modelo o falla, se muestra un aviso. */
  function getEngine() {
    return window.MiIaLocalEngine || null;
  }

  function formatTime(timestamp) {
    try {
      return new Intl.DateTimeFormat("es-UY", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).format(new Date(timestamp));
    } catch (err) {
      var date = new Date(timestamp);
      return date.getHours().toString().padStart(2, "0") + ":" +
        date.getMinutes().toString().padStart(2, "0");
    }
  }

  function applyTheme(theme) {
    var resolved = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", resolved);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", resolved === "light" ? "#f6f6f7" : "#0e0f11");
    }
    var toggle = document.getElementById("btn-theme");
    if (toggle) {
      toggle.setAttribute(
        "aria-label",
        resolved === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"
      );
    }
  }

  function initTheme() {
    var saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch (err) {
      saved = null;
    }
    if (saved === "light" || saved === "dark") {
      applyTheme(saved);
      return saved;
    }
    var prefersLight = window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    var initial = prefersLight ? "light" : "dark";
    applyTheme(initial);
    return initial;
  }

  var storage = null;
  var state = {
    theme: initTheme(),
    currentId: null,
    pendingDeleteId: null,
    notice: null,
    busy: false,
    streamEl: null,
    modelConfirm: null,
    modelError: null,
    installed: {}
  };

  var els = {
    sidebar: document.getElementById("sidebar"),
    backdrop: document.getElementById("backdrop"),
    menu: document.getElementById("btn-menu"),
    closeSidebar: document.getElementById("btn-close-sidebar"),
    list: document.getElementById("conversation-list"),
    messages: document.getElementById("messages"),
    chat: document.getElementById("chat"),
    typing: document.getElementById("typing-indicator"),
    form: document.getElementById("composer-form"),
    input: document.getElementById("composer-input"),
    send: document.getElementById("btn-send"),
    btnNew: document.getElementById("btn-new"),
    btnNewSidebar: document.getElementById("btn-new-sidebar"),
    btnTheme: document.getElementById("btn-theme"),
    btnModels: document.getElementById("btn-models"),
    modelsDialog: document.getElementById("models-dialog"),
    modelsClose: document.getElementById("btn-models-close"),
    modelsList: document.getElementById("models-list"),
    modelsStorage: document.getElementById("models-storage"),
    modelsEngine: document.getElementById("models-engine"),
    gpuToggle: document.getElementById("gpu-toggle"),
    typingLabel: document.querySelector("#typing-indicator .typing-label"),
    confirmDialog: document.getElementById("confirm-dialog"),
    confirmCancel: document.getElementById("btn-confirm-cancel"),
    confirmDelete: document.getElementById("btn-confirm-delete"),
    status: document.getElementById("status-badge"),
    storageWarning: document.getElementById("storage-warning"),
    offlineReady: document.getElementById("offline-ready")
  };

  function setSidebarOpen(open) {
    els.sidebar.classList.toggle("is-open", open);
    els.sidebar.setAttribute("aria-hidden", open ? "false" : "true");
    els.menu.setAttribute("aria-expanded", open ? "true" : "false");
    els.backdrop.hidden = !open;
  }

  function updateOnlineStatus() {
    var online = navigator.onLine !== false;
    els.status.dataset.online = online ? "true" : "false";
    els.status.textContent = online ? "En línea" : "Sin conexión";
  }

  function setOfflineReady(ready) {
    if (!els.offlineReady) return;
    els.offlineReady.hidden = !ready;
  }

  async function isShellCached() {
    if (!("caches" in window)) return false;
    try {
      var keys = await caches.keys();
      var name = keys.filter(function (key) {
        return key.indexOf("mi-ia-local-shell-") === 0;
      }).pop();
      if (!name) return false;
      var cache = await caches.open(name);
      var candidates = ["./index.html", "./", "index.html"];
      var i;
      for (i = 0; i < candidates.length; i++) {
        var hit = await cache.match(candidates[i], { ignoreSearch: true });
        if (hit) return true;
      }
      var stored = await cache.keys();
      return stored.some(function (request) {
        var path = new URL(request.url).pathname;
        return /index\.html$/.test(path) || /\/mi-ia-local\/?$/.test(path);
      });
    } catch (err) {
      return false;
    }
  }

  async function refreshOfflineReady() {
    setOfflineReady(await isShellCached());
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      var register = navigator.serviceWorker.register("./sw.js", { scope: "./" });
      register.then(function (reg) {
        if (reg.installing) {
          reg.installing.addEventListener("statechange", function (event) {
            if (event.target && event.target.state === "installed") {
              void refreshOfflineReady();
            }
          });
        }
        if (reg.waiting || reg.active) {
          void refreshOfflineReady();
        }
        return navigator.serviceWorker.ready;
      }).then(function () {
        void refreshOfflineReady();
      }).catch(function () {
        /* Si el SW no se instala, simplemente no se muestra "Disponible sin conexión". */
      });
      navigator.serviceWorker.addEventListener("message", function (event) {
        if (event.data && event.data.type === "shell-cached") {
          void refreshOfflineReady();
        }
      });
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        void refreshOfflineReady();
      });
    } catch (err) {
      /* ignore */
    }
  }

  function engineStatus() {
    var engine = getEngine();
    return engine ? engine.getState().status : "idle";
  }

  function syncTypingIndicator() {
    var status = engineStatus();
    var loading = status === "loading";
    var generating = status === "generating";
    els.typing.hidden = !(loading || generating);
    if (els.typingLabel) {
      els.typingLabel.textContent = loading
        ? "Cargando el modelo en memoria…"
        : "La IA está escribiendo";
    }
    var stopMode = state.busy;
    els.send.classList.toggle("is-stop", stopMode);
    els.send.setAttribute("aria-label", stopMode ? "Detener" : "Enviar");
    if (stopMode) {
      els.send.disabled = engineStatus() !== "generating";
    } else {
      els.send.disabled = els.input.value.replace(/^\s+|\s+$/g, "") === "";
    }
  }

  function resizeComposer() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, window.innerHeight * 0.3) + "px";
  }

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function renderEmptyState() {
    els.messages.innerHTML =
      '<div class="empty-state">' +
        "<h2>Empezá una conversación</h2>" +
        "<p>Todo se procesa en este dispositivo: tus mensajes no salen a internet. Para recibir respuestas, descargá un modelo desde «Modelos».</p>" +
      "</div>";
  }

  function appendSystemNotice(notice) {
    var article = document.createElement("article");
    article.className = "msg msg-system" + (notice.kind === "error" ? " msg-error" : "");
    var kicker = document.createElement("span");
    kicker.className = "msg-kicker";
    kicker.textContent = notice.kind === "error" ? "Error del motor" : "Aviso del sistema";
    article.appendChild(kicker);
    article.appendChild(document.createTextNode(notice.text));
    if (notice.action === "models") {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary notice-action";
      btn.textContent = "Abrir Modelos";
      btn.addEventListener("click", openModels);
      article.appendChild(btn);
    }
    els.messages.appendChild(article);
  }

  function renderMessages(conversation) {
    els.messages.innerHTML = "";
    var messages = conversation && conversation.messages ? conversation.messages : [];
    /* El aviso del motor se dibuja, no se guarda como mensaje. */
    var persisted = messages.filter(function (message) {
      return message.role === "user" || message.role === "assistant";
    });

    if (!persisted.length) {
      renderEmptyState();
      syncTypingIndicator();
      return;
    }

    persisted.forEach(function (message) {
      var article = document.createElement("article");
      if (message.role === "user") {
        article.className = "msg msg-user";
        article.textContent = message.content;
      } else {
        article.className = "msg msg-assistant";
        article.textContent = message.content;
      }
      els.messages.appendChild(article);
    });

    var last = persisted[persisted.length - 1];
    if (state.notice && state.notice.conversationId === (conversation && conversation.id)) {
      appendSystemNotice(state.notice);
    } else if (last.role === "user" && !state.busy) {
      appendSystemNotice(defaultNotice());
    }

    syncTypingIndicator();
    scrollToBottom();
  }

  function showStorageWarning(text) {
    if (!els.storageWarning || !text) return;
    els.storageWarning.hidden = false;
    els.storageWarning.textContent = text;
  }

  function readLastId() {
    try {
      return localStorage.getItem(LAST_ID_KEY);
    } catch (err) {
      return null;
    }
  }

  function saveLastId(id) {
    try {
      if (id) localStorage.setItem(LAST_ID_KEY, id);
      else localStorage.removeItem(LAST_ID_KEY);
    } catch (err) {
      /* Si localStorage está bloqueado, al recargar se abre la más reciente. */
    }
  }

  async function renderSidebar() {
    var items = await storage.listConversations();
    els.list.innerHTML = "";
    if (!items.length) {
      var empty = document.createElement("p");
      empty.className = "list-empty";
      empty.textContent = "No hay conversaciones todavía.";
      els.list.appendChild(empty);
      return;
    }

    items.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "conversation-item" + (item.id === state.currentId ? " is-active" : "");
      row.dataset.id = item.id;

      var openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "conversation-open";
      openBtn.innerHTML =
        '<span class="title"></span><span class="meta"></span>';
      openBtn.querySelector(".title").textContent = item.title;
      openBtn.querySelector(".meta").textContent = formatTime(item.updatedAt);
      openBtn.addEventListener("click", function () {
        void switchConversation(item.id);
        setSidebarOpen(false);
      });

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn-delete";
      delBtn.setAttribute("aria-label", "Eliminar conversación");
      delBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 0M10 7V5h4v2M8 7l1 12h6l1-12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      delBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        openConfirm(item.id);
      });

      row.appendChild(openBtn);
      row.appendChild(delBtn);
      els.list.appendChild(row);
    });
  }

  async function refreshCurrent() {
    var conversation = state.currentId
      ? await storage.getConversation(state.currentId)
      : null;
    renderMessages(conversation);
    await renderSidebar();
  }

  async function ensureConversation() {
    if (state.currentId) {
      var existing = await storage.getConversation(state.currentId);
      if (existing) return existing;
    }
    var created = await storage.createConversation();
    state.currentId = created.id;
    saveLastId(created.id);
    return created;
  }

  async function switchConversation(id) {
    var conversation = await storage.getConversation(id);
    if (!conversation) return;
    state.currentId = id;
    saveLastId(id);
    renderMessages(conversation);
    await renderSidebar();
  }

  async function startNewConversation() {
    if (state.currentId) {
      var current = await storage.getConversation(state.currentId);
      if (current && current.messages.length === 0) {
        setSidebarOpen(false);
        els.input.focus();
        return current;
      }
    }
    var created = await storage.createConversation();
    state.currentId = created.id;
    saveLastId(created.id);
    renderMessages(created);
    await renderSidebar();
    setSidebarOpen(false);
    els.input.focus();
    return created;
  }

  function openConfirm(id) {
    state.pendingDeleteId = id;
    els.confirmDialog.hidden = false;
    els.confirmDelete.focus();
  }

  function closeConfirm() {
    state.pendingDeleteId = null;
    els.confirmDialog.hidden = true;
  }

  async function confirmDelete() {
    var id = state.pendingDeleteId;
    closeConfirm();
    if (!id) return;
    await storage.deleteConversation(id);
    if (state.currentId === id) {
      var remaining = await storage.listConversations();
      if (remaining.length) {
        await switchConversation(remaining[0].id);
      } else {
        var created = await storage.createConversation();
        state.currentId = created.id;
        saveLastId(created.id);
        renderMessages(created);
        await renderSidebar();
      }
    } else {
      await renderSidebar();
    }
  }

  function defaultNotice() {
    var engine = getEngine();
    if (!engine) return { kind: "info", text: NOTICE_NO_ENGINE };
    return { kind: "info", text: NOTICE_NO_MODEL, action: "models" };
  }

  function openModels() {
    els.modelsDialog.hidden = false;
    state.modelError = null;
    void renderModels();
    els.modelsClose.focus();
  }

  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return "—";
    var units = ["B", "KB", "MB", "GB"];
    var value = bytes;
    var i = 0;
    while (value >= 1000 && i < units.length - 1) {
      value = value / 1000;
      i++;
    }
    var digits = i >= 2 && value < 100 ? 1 : 0;
    return value.toLocaleString("es-UY", { maximumFractionDigits: digits, minimumFractionDigits: digits }) + " " + units[i];
  }

  function makeButton(text, className, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  async function renderModels() {
    var engine = getEngine();
    els.modelsList.innerHTML = "";
    if (!engine) {
      var p = document.createElement("p");
      p.className = "models-error";
      p.textContent = "El motor de IA no se pudo cargar en este navegador (el archivo engine.js no se inició). Probá recargar la app.";
      els.modelsList.appendChild(p);
      els.modelsStorage.textContent = "";
      els.modelsEngine.textContent = "";
      return;
    }
    var st = engine.getState();
    var installedList = [];
    try {
      installedList = await engine.listInstalled();
    } catch (err) {
      state.modelError = "No se pudo leer qué modelos hay guardados: " + (err && err.message ? err.message : err);
    }
    var installed = {};
    installedList.forEach(function (x) { installed[x.id] = x; });
    state.installed = installed;
    var engineCache = { cached: false, bytes: 0 };
    try { engineCache = await engine.engineCacheStatus(); } catch (err) { /* ignore */ }
    var activeId = engine.getActiveId();

    els.modelsList.innerHTML = "";
    if (state.modelError) {
      var e = document.createElement("p");
      e.className = "models-error";
      e.setAttribute("role", "alert");
      e.textContent = state.modelError;
      els.modelsList.appendChild(e);
    }

    engine.catalog.forEach(function (m) {
      var card = document.createElement("section");
      card.className = "model-card";
      var head = document.createElement("div");
      head.className = "model-head";
      var name = document.createElement("h3");
      name.textContent = m.name;
      head.appendChild(name);
      if (m.recommended || m.badge) {
        var badge = document.createElement("span");
        badge.className = "model-badge";
        badge.textContent = m.recommended ? "Recomendado" : m.badge;
        head.appendChild(badge);
      }
      card.appendChild(head);

      var meta = document.createElement("p");
      meta.className = "model-meta";
      meta.textContent = formatBytes(m.size) + " · Licencia " + m.license;
      card.appendChild(meta);

      var desc = document.createElement("p");
      desc.className = "model-desc";
      desc.textContent = m.description;
      card.appendChild(desc);

      if (m.warning) {
        var warn = document.createElement("p");
        warn.className = "model-warning";
        warn.textContent = m.warning;
        card.appendChild(warn);
      }

      var isInstalled = !!(installed[m.id] && installed[m.id].installed);
      var downloading = st.status === "downloading" && st.progress && st.progress.id === m.id;
      var actions = document.createElement("div");
      actions.className = "model-actions";

      if (downloading) {
        var pct = st.progress.total ? Math.floor((st.progress.loaded / st.progress.total) * 100) : 0;
        var bar = document.createElement("div");
        bar.className = "progress";
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        bar.setAttribute("aria-valuenow", String(pct));
        var fill = document.createElement("i");
        fill.style.width = pct + "%";
        bar.appendChild(fill);
        card.appendChild(bar);
        var ptxt = document.createElement("p");
        ptxt.className = "model-meta";
        ptxt.textContent = "Descargando… " + pct + "% (" + formatBytes(st.progress.loaded) + " de " + formatBytes(st.progress.total) + "). Dejá la app abierta.";
        card.appendChild(ptxt);
        actions.appendChild(makeButton("Cancelar descarga", "btn-secondary", function () {
          engine.cancelDownload();
        }));
      } else if (isInstalled) {
        var status = document.createElement("p");
        status.className = "model-status";
        var loadedHere = st.loadedId === m.id;
        status.textContent = activeId === m.id
          ? (loadedHere ? "Descargado · En uso (cargado en memoria)" : "Descargado · Elegido para chatear")
          : "Descargado en este dispositivo";
        card.appendChild(status);
        if (activeId !== m.id) {
          actions.appendChild(makeButton("Usar este modelo", "btn-primary", function () {
            engine.setActive(m.id);
            void renderModels();
          }));
        }
        if (state.modelConfirm && state.modelConfirm.id === m.id && state.modelConfirm.type === "delete") {
          var q = document.createElement("p");
          q.className = "model-confirm";
          q.textContent = "¿Eliminar este modelo del dispositivo? Libera " + formatBytes(m.size) + ". Para volver a usarlo hay que descargarlo otra vez.";
          card.appendChild(q);
          actions.appendChild(makeButton("Cancelar", "btn-secondary", function () {
            state.modelConfirm = null;
            void renderModels();
          }));
          actions.appendChild(makeButton("Sí, eliminar", "btn-danger", function () {
            state.modelConfirm = null;
            void removeModel(m.id);
          }));
        } else {
          actions.appendChild(makeButton("Eliminar", "btn-secondary", function () {
            state.modelConfirm = { id: m.id, type: "delete" };
            void renderModels();
          }));
        }
      } else if (state.modelConfirm && state.modelConfirm.id === m.id && state.modelConfirm.type === "download") {
        var extra = engineCache.cached ? 0 : engine.engineSize;
        var c = document.createElement("p");
        c.className = "model-confirm";
        c.textContent = "Se van a descargar " + formatBytes(m.size) + " del modelo desde huggingface.co" +
          (extra ? " y " + formatBytes(extra) + " del motor desde este sitio" : "") +
          ". Total: " + formatBytes(m.size + extra) + ". Conviene usar Wi‑Fi. Tus conversaciones no se envían.";
        card.appendChild(c);
        actions.appendChild(makeButton("Cancelar", "btn-secondary", function () {
          state.modelConfirm = null;
          void renderModels();
        }));
        actions.appendChild(makeButton("Sí, descargar", "btn-primary", function () {
          state.modelConfirm = null;
          void downloadModel(m.id);
        }));
      } else {
        var dl = makeButton("Descargar (" + formatBytes(m.size) + ")", "btn-primary", function () {
          state.modelConfirm = { id: m.id, type: "download" };
          void renderModels();
        });
        if (st.status === "downloading" || navigator.onLine === false) dl.disabled = true;
        actions.appendChild(dl);
        if (navigator.onLine === false) {
          var off = document.createElement("p");
          off.className = "model-meta";
          off.textContent = "Sin conexión: para descargar hace falta internet.";
          card.appendChild(off);
        }
      }
      card.appendChild(actions);
      els.modelsList.appendChild(card);
    });

    els.modelsEngine.textContent = engineCache.cached
      ? "Motor (llama.cpp / wllama" + (engine.compat ? ", versión compatible con Safari" : "") + "): descargado, " + formatBytes(engine.engineSize) + "."
      : "Motor (llama.cpp / wllama" + (engine.compat ? ", versión compatible con Safari" : "") + "): " + formatBytes(engine.engineSize) + ", se baja junto con el primer modelo.";

    var info = await engine.storageInfo();
    var parts = [];
    if (info.usage !== null && info.usage !== undefined) {
      parts.push("Espacio usado por la app: " + formatBytes(info.usage) +
        (info.quota ? " de " + formatBytes(info.quota) + " permitidos" : ""));
    } else {
      parts.push("Este navegador no informa cuánto espacio se usa.");
    }
    if (info.persisted === true) parts.push("Almacenamiento persistente: activado.");
    else if (info.persisted === false) parts.push("Almacenamiento persistente: no concedido (en iPhone, agregá la app a la pantalla de inicio).");
    els.modelsStorage.innerHTML = "";
    var sp = document.createElement("p");
    sp.textContent = parts.join(" ");
    els.modelsStorage.appendChild(sp);
    if (info.persisted === false) {
      els.modelsStorage.appendChild(makeButton("Pedir que no se borre", "btn-secondary", function () {
        void engine.requestPersist().then(function () { return renderModels(); });
      }));
    }
    if (els.gpuToggle) els.gpuToggle.checked = engine.getUseGpu();
  }

  async function downloadModel(id) {
    var engine = getEngine();
    if (!engine) return;
    state.modelError = null;
    var lastRender = 0;
    var unsub = function (p) {
      var now = Date.now();
      if (!els.modelsDialog.hidden && now - lastRender > 400) {
        lastRender = now;
        void renderModels();
      }
    };
    try {
      var promise = engine.download(id, unsub);
      void renderModels();
      await promise;
    } catch (err) {
      state.modelError = "No se pudo descargar: " + (err && err.message ? err.message : err);
    }
    await renderModels();
  }

  async function removeModel(id) {
    var engine = getEngine();
    if (!engine) return;
    try {
      await engine.remove(id);
      var left = await engine.listInstalled();
      var any = left.some(function (x) { return x.installed; });
      if (!any) await engine.deleteEngine();
    } catch (err) {
      state.modelError = "No se pudo eliminar: " + (err && err.message ? err.message : err);
    }
    await renderModels();
  }

  function closeModels() {
    els.modelsDialog.hidden = true;
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme(state.theme);
    try {
      localStorage.setItem(THEME_KEY, state.theme);
    } catch (err) {
      /* Si el almacenamiento está bloqueado, el tema igual cambia en esta sesión. */
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (state.busy) {
      var running = getEngine();
      if (running) running.stop();
      return;
    }
    var text = els.input.value.replace(/^\s+|\s+$/g, "");
    if (!text) return;
    if (!storage) return;

    var conversation = await ensureConversation();
    await storage.appendMessage(conversation.id, { role: "user", content: text });
    saveLastId(conversation.id);
    state.notice = null;

    els.input.value = "";
    resizeComposer();
    await runAssistant(conversation.id);
  }

  async function pickModel(engine) {
    var list = await engine.listInstalled();
    var installed = list.filter(function (x) { return x.installed; });
    if (!installed.length) return null;
    var active = engine.getActiveId();
    var chosen = installed.filter(function (x) { return x.id === active; })[0] || installed[0];
    if (chosen.id !== active) engine.setActive(chosen.id);
    return chosen.id;
  }

  async function runAssistant(conversationId) {
    var engine = getEngine();
    if (!engine) {
      state.notice = { conversationId: conversationId, kind: "info", text: NOTICE_NO_ENGINE };
      await refreshCurrent();
      return;
    }
    var modelId = null;
    try {
      modelId = await pickModel(engine);
    } catch (err) {
      modelId = null;
    }
    if (!modelId) {
      state.notice = { conversationId: conversationId, kind: "info", text: NOTICE_NO_MODEL, action: "models" };
      await refreshCurrent();
      return;
    }

    state.busy = true;
    await refreshCurrent();
    syncTypingIndicator();
    try {
      await engine.load(modelId);
    } catch (err) {
      state.busy = false;
      state.notice = {
        conversationId: conversationId,
        kind: "error",
        text: "No se pudo cargar el modelo: " + (err && err.message ? err.message : err) + " No se generó ninguna respuesta.",
        action: "models"
      };
      await refreshCurrent();
      return;
    }

    var conversation = await storage.getConversation(conversationId);
    var history = conversation.messages.filter(function (m) {
      return m.role === "user" || m.role === "assistant";
    }).map(function (m) {
      return { role: m.role, content: m.content };
    });

    var bubble = document.createElement("article");
    bubble.className = "msg msg-assistant is-streaming";
    var onScreen = state.currentId === conversationId;
    if (onScreen) {
      els.messages.appendChild(bubble);
      scrollToBottom();
    }
    state.streamEl = bubble;

    var result = null;
    var failure = null;
    try {
      result = await engine.generate(history, function (partial) {
        bubble.textContent = partial;
        if (state.currentId === conversationId) scrollToBottom();
      });
    } catch (err) {
      failure = err;
    }
    state.busy = false;
    state.streamEl = null;

    if (result && result.text.replace(/\s+/g, "")) {
      var content = result.text.replace(/^\s+|\s+$/g, "");
      await storage.appendMessage(conversationId, { role: "assistant", content: content });
      if (result.stopped) {
        state.notice = { conversationId: conversationId, kind: "info", text: "Respuesta detenida. Se guardó lo que el modelo alcanzó a escribir." };
      }
    } else if (failure) {
      state.notice = {
        conversationId: conversationId,
        kind: "error",
        text: "El modelo falló al responder: " + (failure.message || failure) + " No se generó ninguna respuesta."
      };
    } else if (result && result.stopped) {
      state.notice = { conversationId: conversationId, kind: "info", text: "Respuesta detenida antes de que el modelo escribiera algo." };
    } else {
      state.notice = { conversationId: conversationId, kind: "error", text: "El modelo terminó sin escribir texto." };
    }
    await refreshCurrent();
    syncTypingIndicator();
  }

  function onInputChange() {
    syncTypingIndicator();
    resizeComposer();
  }

  function onComposerKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!els.send.disabled && !state.busy) {
        els.form.requestSubmit();
      }
    }
  }

  function onGlobalKeydown(event) {
    if (event.key !== "Escape") return;
    if (!els.confirmDialog.hidden) {
      closeConfirm();
      return;
    }
    if (!els.modelsDialog.hidden) {
      closeModels();
      return;
    }
    if (els.sidebar.classList.contains("is-open")) {
      setSidebarOpen(false);
    }
  }

  els.menu.addEventListener("click", function () {
    setSidebarOpen(!els.sidebar.classList.contains("is-open"));
  });
  els.closeSidebar.addEventListener("click", function () {
    setSidebarOpen(false);
  });
  els.backdrop.addEventListener("click", function () {
    setSidebarOpen(false);
  });
  els.btnNew.addEventListener("click", function () {
    void startNewConversation();
  });
  els.btnNewSidebar.addEventListener("click", function () {
    void startNewConversation();
  });
  els.btnTheme.addEventListener("click", toggleTheme);
  els.btnModels.addEventListener("click", openModels);
  els.modelsClose.addEventListener("click", closeModels);
  els.modelsDialog.addEventListener("click", function (event) {
    if (event.target === els.modelsDialog) closeModels();
  });
  els.confirmCancel.addEventListener("click", closeConfirm);
  els.confirmDelete.addEventListener("click", function () {
    void confirmDelete();
  });
  els.confirmDialog.addEventListener("click", function (event) {
    if (event.target === els.confirmDialog) closeConfirm();
  });
  els.form.addEventListener("submit", function (event) {
    void handleSubmit(event);
  });
  els.input.addEventListener("input", onInputChange);
  els.input.addEventListener("keydown", onComposerKeydown);
  document.addEventListener("keydown", onGlobalKeydown);
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  if (els.gpuToggle) {
    els.gpuToggle.addEventListener("change", function () {
      var engine = getEngine();
      if (!engine) return;
      engine.setUseGpu(els.gpuToggle.checked);
      /* Se aplica en la próxima carga del modelo. */
      void engine.unload().then(function () { return renderModels(); });
    });
  }

  function hookEngine() {
    var engine = getEngine();
    if (!engine || hookEngine.done) return;
    hookEngine.done = true;
    engine.onChange(function () {
      syncTypingIndicator();
    });
    var crashed = engine.lastLoadCrashed();
    if (crashed) {
      engine.clearCrashFlag();
      showStorageWarning("La última vez la carga del modelo no terminó. Puede que el iPhone se haya quedado sin memoria. Cerrá otras apps o probá con el modelo más chico.");
    }
  }
  if (getEngine()) hookEngine();
  window.addEventListener("mi-ia-local-engine-ready", hookEngine);

  if (window.matchMedia) {
    var media = window.matchMedia("(prefers-color-scheme: light)");
    var onSchemeChange = function (event) {
      var saved = null;
      try {
        saved = localStorage.getItem(THEME_KEY);
      } catch (err) {
        saved = null;
      }
      if (saved === "light" || saved === "dark") return;
      state.theme = event.matches ? "light" : "dark";
      applyTheme(state.theme);
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onSchemeChange);
    } else if (typeof media.addListener === "function") {
      media.addListener(onSchemeChange);
    }
  }

  updateOnlineStatus();
  syncTypingIndicator();
  registerServiceWorker();
  void refreshOfflineReady();
  void (async function start() {
    try {
      if (!window.MiIaLocalStorage || typeof window.MiIaLocalStorage.open !== "function") {
        showStorageWarning("No se pudo cargar el módulo de almacenamiento. Las conversaciones no se van a guardar.");
        return;
      }
      storage = await window.MiIaLocalStorage.open();
      if (storage.warning) {
        showStorageWarning(storage.warning);
      }
      await restoreSession();
    } catch (err) {
      showStorageWarning("No se pudo iniciar el almacenamiento. Las conversaciones no se van a guardar.");
    }
  })();

  async function restoreSession() {
    var list = await storage.listConversations();
    var lastId = readLastId();
    if (lastId) {
      var found = await storage.getConversation(lastId);
      if (found) {
        state.currentId = found.id;
        await refreshCurrent();
        return;
      }
    }
    if (list.length) {
      state.currentId = list[0].id;
      saveLastId(list[0].id);
      await refreshCurrent();
      return;
    }
    var created = await storage.createConversation();
    state.currentId = created.id;
    saveLastId(created.id);
    await refreshCurrent();
  }
})();
