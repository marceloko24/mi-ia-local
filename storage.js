(function (global) {
  "use strict";

  var DB_NAME = "mi-ia-local";
  var DB_VERSION = 1;
  var STORE_CONVERSATIONS = "conversations";
  var STORE_MESSAGES = "messages";

  function createId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function titleFromText(text) {
    var compact = String(text || "").replace(/\s+/g, " ").trim();
    if (!compact) return "Nueva conversación";
    return compact.length > 36 ? compact.slice(0, 36).trim() + "…" : compact;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function requestToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  function transactionDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(tx.error);
      };
      tx.onabort = function () {
        reject(tx.error || new Error("La transacción se canceló."));
      };
    });
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB no está disponible."));
        return;
      }

      var request;
      try {
        request = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }

      request.onupgradeneeded = function (event) {
        var db = request.result;
        var oldVersion = event.oldVersion || 0;

        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
            var conversations = db.createObjectStore(STORE_CONVERSATIONS, { keyPath: "id" });
            conversations.createIndex("updatedAt", "updatedAt");
          }
          if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
            var messages = db.createObjectStore(STORE_MESSAGES, { keyPath: "id" });
            messages.createIndex("conversationId", "conversationId", { unique: false });
            messages.createIndex("byConversationCreated", ["conversationId", "createdAt"]);
          }
        }
      };

      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
      request.onblocked = function () {
        reject(new Error("IndexedDB está bloqueada por otra pestaña."));
      };
    });
  }

  function createIndexedDbStorage(db) {
    function runTransaction(storeNames, mode, setup) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeNames, mode);
        var settled = false;
        var hasValue = false;
        var value;

        function succeed(next) {
          hasValue = true;
          value = next;
        }

        function fail(error) {
          if (settled) return;
          settled = true;
          reject(error);
        }

        tx.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve(hasValue ? value : undefined);
        };
        tx.onerror = function () {
          fail(tx.error);
        };
        tx.onabort = function () {
          fail(tx.error || new Error("La transacción se canceló."));
        };

        try {
          setup(tx, succeed, fail);
        } catch (err) {
          try { tx.abort(); } catch (abortErr) { /* ignore */ }
          fail(err);
        }
      });
    }

    async function listConversations() {
      return runTransaction(STORE_CONVERSATIONS, "readonly", function (tx, succeed, fail) {
        var request = tx.objectStore(STORE_CONVERSATIONS).getAll();
        request.onsuccess = function () {
          var items = (request.result || [])
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
            });
          succeed(clone(items));
        };
        request.onerror = function () {
          fail(request.error);
        };
      });
    }

    async function getConversation(id) {
      return runTransaction([STORE_CONVERSATIONS, STORE_MESSAGES], "readonly", function (tx, succeed, fail) {
        var convReq = tx.objectStore(STORE_CONVERSATIONS).get(id);
        var msgReq = tx.objectStore(STORE_MESSAGES).index("conversationId").getAll(id);
        var pending = 2;
        var conversation;
        var messages;

        function maybeFinish() {
          pending -= 1;
          if (pending > 0) return;
          if (!conversation) {
            succeed(null);
            return;
          }
          (messages || []).sort(function (a, b) {
            return a.createdAt - b.createdAt;
          });
          succeed(clone({
            id: conversation.id,
            title: conversation.title,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            messages: messages || []
          }));
        }

        convReq.onsuccess = function () {
          conversation = convReq.result;
          maybeFinish();
        };
        convReq.onerror = function () { fail(convReq.error); };
        msgReq.onsuccess = function () {
          messages = msgReq.result || [];
          maybeFinish();
        };
        msgReq.onerror = function () { fail(msgReq.error); };
      });
    }

    async function createConversation() {
      var now = Date.now();
      var conversation = {
        id: createId(),
        title: "Nueva conversación",
        createdAt: now,
        updatedAt: now
      };
      return runTransaction(STORE_CONVERSATIONS, "readwrite", function (tx, succeed, fail) {
        var request = tx.objectStore(STORE_CONVERSATIONS).add(conversation);
        request.onsuccess = function () {
          succeed(clone({
            id: conversation.id,
            title: conversation.title,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            messages: []
          }));
        };
        request.onerror = function () { fail(request.error); };
      });
    }

    async function appendMessage(conversationId, message) {
      var stored = {
        id: createId(),
        conversationId: conversationId,
        role: message.role,
        content: message.content,
        createdAt: Date.now()
      };
      return runTransaction([STORE_CONVERSATIONS, STORE_MESSAGES], "readwrite", function (tx, succeed, fail) {
        var conversations = tx.objectStore(STORE_CONVERSATIONS);
        var getReq = conversations.get(conversationId);
        getReq.onsuccess = function () {
          var found = getReq.result;
          if (!found) {
            fail(new Error("La conversación no existe."));
            try { tx.abort(); } catch (err) { /* ignore */ }
            return;
          }
          found.updatedAt = stored.createdAt;
          if (stored.role === "user" && found.title === "Nueva conversación") {
            found.title = titleFromText(stored.content);
          }
          conversations.put(found);
          tx.objectStore(STORE_MESSAGES).add(stored);
          succeed(clone(stored));
        };
        getReq.onerror = function () { fail(getReq.error); };
      });
    }

    async function renameConversation(id, title) {
      var nextTitle = titleFromText(title);
      return runTransaction(STORE_CONVERSATIONS, "readwrite", function (tx, succeed, fail) {
        var store = tx.objectStore(STORE_CONVERSATIONS);
        var getReq = store.get(id);
        getReq.onsuccess = function () {
          var found = getReq.result;
          if (!found) {
            fail(new Error("La conversación no existe."));
            try { tx.abort(); } catch (err) { /* ignore */ }
            return;
          }
          found.title = nextTitle;
          found.updatedAt = Date.now();
          store.put(found);
          succeed(clone(found));
        };
        getReq.onerror = function () { fail(getReq.error); };
      });
    }

    async function deleteConversation(id) {
      return runTransaction([STORE_CONVERSATIONS, STORE_MESSAGES], "readwrite", function (tx, succeed, fail) {
        var messages = tx.objectStore(STORE_MESSAGES);
        var keysReq = messages.index("conversationId").getAllKeys(id);
        keysReq.onsuccess = function () {
          (keysReq.result || []).forEach(function (key) {
            messages.delete(key);
          });
          tx.objectStore(STORE_CONVERSATIONS).delete(id);
          succeed();
        };
        keysReq.onerror = function () { fail(keysReq.error); };
      });
    }

    return {
      backend: "indexeddb",
      warning: null,
      listConversations: listConversations,
      getConversation: getConversation,
      createConversation: createConversation,
      appendMessage: appendMessage,
      renameConversation: renameConversation,
      deleteConversation: deleteConversation
    };
  }

  function createMemoryStorage(warning) {
    var conversations = [];

    return {
      backend: "memory",
      warning: warning,
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

      async appendMessage(conversationId, message) {
        var found = conversations.find(function (item) {
          return item.id === conversationId;
        });
        if (!found) {
          throw new Error("La conversación no existe.");
        }
        var stored = {
          id: createId(),
          conversationId: conversationId,
          role: message.role,
          content: message.content,
          createdAt: Date.now()
        };
        found.messages.push(stored);
        found.updatedAt = stored.createdAt;
        if (stored.role === "user" && found.title === "Nueva conversación") {
          found.title = titleFromText(stored.content);
        }
        return clone(stored);
      },

      async renameConversation(id, title) {
        var found = conversations.find(function (item) {
          return item.id === id;
        });
        if (!found) {
          throw new Error("La conversación no existe.");
        }
        found.title = titleFromText(title);
        found.updatedAt = Date.now();
        return clone(found);
      },

      async deleteConversation(id) {
        conversations = conversations.filter(function (item) {
          return item.id !== id;
        });
      }
    };
  }

  function quietlyRequestPersistence() {
    try {
      if (global.navigator && global.navigator.storage &&
          typeof global.navigator.storage.persist === "function") {
        global.navigator.storage.persist().catch(function () {
          /* Sin aviso: en iOS esto suele no concederse hasta agregar la app al inicio. */
        });
      }
    } catch (err) {
      /* ignore */
    }
  }

  var FALLBACK_WARNING =
    "No se pudo usar el almacenamiento del dispositivo (IndexedDB). Las conversaciones se van a perder al recargar. En Safari, esto puede pasar en una ventana privada.";

  async function openStorage() {
    quietlyRequestPersistence();
    try {
      var db = await openDatabase();
      var storage = createIndexedDbStorage(db);
      /* Prueba corta para detectar un IndexedDB que abre pero no escribe. */
      await storage.listConversations();
      return storage;
    } catch (err) {
      return createMemoryStorage(FALLBACK_WARNING);
    }
  }

  global.MiIaLocalStorage = {
    open: openStorage,
    titleFromText: titleFromText
  };
})(window);
