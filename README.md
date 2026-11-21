# Mi IA Local

Chat de inteligencia artificial que corre 100% en el iPhone, sin internet ni APIs pagas (PWA).

## Estado actual: etapa 3 (almacenamiento local)

Esta etapa suma el guardado de conversaciones en el dispositivo, con IndexedDB.

Lo que ya funciona:

- Interfaz de chat para iPhone SE, con tema claro y oscuro
- Historial en un panel lateral, nueva conversación y eliminación confirmada
- Conversaciones y mensajes guardados en IndexedDB (base `mi-ia-local`), en este dispositivo
- Al recargar, se restablece la última conversación abierta
- Si IndexedDB no está disponible (por ejemplo, en algunas ventanas privadas de Safari), la app sigue andando en memoria y muestra un aviso claro: las conversaciones se van a perder al recargar
- El aviso «Motor de IA local pendiente de integración. Todavía no se generan respuestas.» se muestra en pantalla, pero no se guarda como si fuera un mensaje de la IA
- Distintivo «En línea» / «Sin conexión»
- Sección de modelos, todavía como pendiente (etapa 5)

Todavía no hay:

- Motor de IA local. No se generan respuestas y no se simulan.
- Funcionamiento offline como PWA. El service worker es la etapa 4.
- Descarga ni cambio de modelos. Eso es la etapa 5.

## Límites honestos del almacenamiento

- Los datos quedan en el navegador de este dispositivo; no se envían a un servidor.
- En iOS, Safari puede borrar los datos de un sitio después de unos 7 días sin usarlo, salvo que la app esté agregada a la pantalla de inicio. Esta etapa todavía no incluye esa instalación como PWA.
- `navigator.storage.persist()` se pide en silencio, sin molestar. En iPhone suele no alcanzarse hasta agregar la app al inicio.
- El tema y cuál fue la última conversación se recuerdan en `localStorage`.

## Cómo abrirla

1. Descargá o cloná este repositorio.
2. Desde la carpeta del proyecto, serví los archivos con cualquier servidor estático, por ejemplo:

   ```bash
   python3 -m http.server 8080
   ```

3. Abrí `http://localhost:8080` en el navegador.

También se puede abrir `index.html` de forma directa, aunque un servidor local se parece más a cómo se va a usar después.

En un iPhone, la forma práctica de probarla va a ser cuando se publique o se sirva por la red local. Esta etapa todavía no incluye una prueba en Safari real.

No hace falta cuenta, API ni conexión a internet para ver la interfaz y guardar conversaciones. Si no hay red, tiene que verse el distintivo «Sin conexión»; igual no va a responder un modelo todavía.
