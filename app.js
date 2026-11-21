(function () {
  "use strict";

  var THEME_KEY = "mi-ia-local-theme";
  var ENGINE_NOTICE =
    "Motor de IA local pendiente de integración. Todavía no se generan respuestas.";

  /* ------------------------------------------------------------------ */
  /* Almacenamiento en memoria (etapa 2).                               */
  /* En la etapa 3 se puede reemplazar por IndexedDB respetando         */
  /* esta misma interfaz.                                               */
  /* ------------------------------------------------------------------ */
  function createMemoryStorage() {
    var conversations = [];

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    return {
      async listConversations() {
        return clone(
          conversations
            .slice()
            .sort(function (a, b) {
              return b.updatedAt - a.updatedAt;
            })
            .map(function (item) {
              return {
                id: item.id,
                title: item.title,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt
              };
            })
        );
      },

      async getConversation(id) {
        var found = conversations.find(function (item) {
          return item.id === id;
        });
        return found ? clone(found) : null;
      },

      async createConversation() {
        var now = Date.now();
        var conversation = {
          id: createId(),
          title: "Nueva conversación",
          createdAt: now,
          updatedAt: now,
          messages: []
        };
        conversations.unshift(conversation);
        return clone(conversation);
      },

      async addMessage(conversationId, message) {
        var found = conversations.find(function (item) {
          return item.id === conversationId;
        });
        if (!found) {
          throw new Error("La conversación no existe.");
        }
        var stored = Object.assign({ id: createId(), createdAt: Date.now() }, message);
        found.messages.push(stored);
        found.updatedAt = stored.createdAt;
        if (stored.role === "user" && found.title === "Nueva conversación") {
          found.title = titleFromText(stored.content);
        }
        return clone(stored);
      },

      async deleteConversation(id) {
        conversations = conversations.filter(function (item) {
          return item.id !== id;
        });
      }
    };
  }

  /* El motor real se integra en la etapa 5. Este objeto solo expone
     el estado para que la UI pueda mostrar el indicador de generación
     cuando un motor de verdad esté trabajando. Nunca inventa respuestas. */
  function createEngine() {
    return {
      status: "pending",
      isGenerating: function () {
        return this.status === "generating";
      }
    };
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function titleFromText(text) {
    var compact = String(text || "").replace(/\s+/g, " ").trim();
    if (!compact) return "Nueva conversación";
    return compact.length > 36 ? compact.slice(0, 36).trim() + "…" : compact;
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

  var storage = createMemoryStorage();
  var engine = createEngine();
  var state = {
    theme: initTheme(),
    currentId: null,
    pendingDeleteId: null
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
    confirmDialog: document.getElementById("confirm-dialog"),
    confirmCancel: document.getElementById("btn-confirm-cancel"),
    confirmDelete: document.getElementById("btn-confirm-delete"),
    status: document.getElementById("status-badge")
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

  function syncTypingIndicator() {
    var generating = engine.isGenerating();
    els.typing.hidden = !generating;
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
        "<p>El motor de IA local todavía no está integrado. Tus mensajes quedan en esta sesión, pero no se van a generar respuestas.</p>" +
      "</div>";
  }

  function renderMessages(conversation) {
    els.messages.innerHTML = "";
    if (!conversation || !conversation.messages.length) {
      renderEmptyState();
      syncTypingIndicator();
      return;
    }

    conversation.messages.forEach(function (message) {
      var article = document.createElement("article");
      if (message.role === "user") {
        article.className = "msg msg-user";
        article.textContent = message.content;
      } else if (message.role === "system") {
        article.className = "msg msg-system";
        var kicker = document.createElement("span");
        kicker.className = "msg-kicker";
        kicker.textContent = "Aviso del sistema";
        article.appendChild(kicker);
        article.appendChild(document.createTextNode(message.content));
      } else {
        article.className = "msg msg-assistant";
        article.textContent = message.content;
      }
      els.messages.appendChild(article);
    });

    syncTypingIndicator();
    scrollToBottom();
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
    return created;
  }

  async function switchConversation(id) {
    var conversation = await storage.getConversation(id);
    if (!conversation) return;
    state.currentId = id;
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
        renderMessages(created);
        await renderSidebar();
      }
    } else {
      await renderSidebar();
    }
  }

  function openModels() {
    els.modelsDialog.hidden = false;
    els.modelsClose.focus();
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
    var text = els.input.value.replace(/^\s+|\s+$/g, "");
    if (!text) return;

    var conversation = await ensureConversation();
    await storage.addMessage(conversation.id, { role: "user", content: text });
    await storage.addMessage(conversation.id, {
      role: "system",
      content: ENGINE_NOTICE
    });

    els.input.value = "";
    resizeComposer();
    els.send.disabled = true;
    syncTypingIndicator();
    await refreshCurrent();
  }

  function onInputChange() {
    els.send.disabled = els.input.value.replace(/^\s+|\s+$/g, "") === "";
    resizeComposer();
  }

  function onComposerKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!els.send.disabled) {
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
  void (async function start() {
    var created = await storage.createConversation();
    state.currentId = created.id;
    await refreshCurrent();
  })();
})();
