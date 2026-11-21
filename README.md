# Mi IA Local

Chat de inteligencia artificial que corre 100% en el iPhone, sin internet ni APIs pagas (PWA).

## Estado actual: etapa 2 (interfaz)

Esta etapa incluye solo la interfaz de conversación:

- Pantalla de chat inspirada en un cliente de mensajería moderno, pensada para iPhone SE (375×667)
- Tema claro y oscuro: sigue `prefers-color-scheme` y se puede cambiar a mano (la elección queda en `localStorage`)
- Mensajes del usuario y avisos del sistema claramente distintos
- Botón de nueva conversación
- Historial en un panel lateral, con eliminación confirmada
- Indicador de generación (puntos) preparado en la interfaz, visible solo si un motor real está generando
- Distintivo «En línea» / «Sin conexión», según `navigator.onLine`
- Sección de modelos, todavía como pendiente (etapa 5)

Todavía no hay:

- Motor de IA local. Si enviás un mensaje, se muestra este aviso y no se inventa ninguna respuesta: «Motor de IA local pendiente de integración. Todavía no se generan respuestas.»
- Guardado persistente. El historial vive solo en memoria y se pierde al recargar. IndexedDB es la etapa 3.
- Funcionamiento offline como PWA. El service worker es la etapa 4.
- Descarga ni cambio de modelos. Eso es la etapa 5.

## Cómo abrirla

1. Descargá o cloná este repositorio.
2. Desde la carpeta del proyecto, serví los archivos con cualquier servidor estático, por ejemplo:

   ```bash
   python3 -m http.server 8080
   ```

3. Abrí `http://localhost:8080` en el navegador.

También se puede abrir `index.html` de forma directa, aunque un servidor local se parece más a cómo se va a usar después.

En un iPhone, la forma práctica de probarla va a ser cuando se publique o se sirva por la red local. Esta etapa todavía no incluye instalación como app ni una prueba en Safari real.

No hace falta cuenta, API ni conexión a internet para ver la interfaz. Si no hay red, tiene que verse el distintivo «Sin conexión»; igual no va a responder un modelo todavía.
