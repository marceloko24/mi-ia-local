# Mi IA Local

Chat de inteligencia artificial que corre 100% en el iPhone, sin internet ni APIs pagas (PWA).

## Estado actual: etapa 5 (motor de IA local)

La app ya tiene un motor de IA real que corre dentro del navegador: [wllama](https://github.com/ngxson/wllama) 3.13.0 (llama.cpp compilado a WebAssembly), copiado en `vendor/wllama/`. No usa servidores, APIs comerciales ni cuentas, y las conversaciones nunca salen del dispositivo.

Dirección de GitHub Pages:

**https://marceloko24.github.io/mi-ia-local/**

### Cómo instalarla en el iPhone

1. En Safari, abrí esa dirección.
2. Tocá el botón Compartir (el cuadrado con la flecha hacia arriba).
3. Elegí **Agregar a inicio**.
4. Confirmá. Se va a crear un ícono en la pantalla de inicio, que abre la app a pantalla completa.

Agregarla al inicio también ayuda a que Safari no borre los datos (y el modelo) a los ~7 días de no usarla.

### Cómo empezar a chatear

1. Con Wi‑Fi, abrí la app y tocá el ícono del cubo (**Modelos**).
2. En el modelo recomendado tocá **Descargar**. La app muestra cuánto se va a bajar y pide confirmación; nada se descarga sin ese «Sí, descargar».
3. Cuando diga **Descargado**, cerrá el panel y escribí un mensaje. La primera vez el modelo tarda unos segundos en cargarse en memoria.
4. Desde ahí, funciona en modo avión.

### Modelos disponibles

| Modelo | Tamaño | Origen | Notas |
|---|---|---|---|
| Qwen2.5 0.5B Instruct Q4_K_M | 397.808.192 bytes (398 MB) | [bartowski/Qwen2.5-0.5B-Instruct-GGUF](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF), commit `41ba88d` | Recomendado. Apache 2.0. Responde más preguntas que los otros, pero todavía inventa datos a veces. |
| Qwen3 0.6B Q4_K_M | 484.220.320 bytes (484 MB) | [bartowski/Qwen_Qwen3-0.6B-GGUF](https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF), commit `60b85c0` | «Más prudente». Apache 2.0. En las pruebas casi no inventó, pero a veces dice «No lo sé» aunque la pregunta sea fácil. Se usa sin el modo «pensar». |
| Llama 3.2 1B Instruct Q4_K_M | 807.694.464 bytes (808 MB) | [bartowski/Llama-3.2-1B-Instruct-GGUF](https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF), commit `067b946` | Experimental en 3 GB de RAM: puede cerrarse por falta de memoria. En las pruebas se negó a responder preguntas simples. |

Además, con el primer modelo se baja el motor desde este mismo sitio: 18,9 MB en Safari/iPhone (versión «compat») o 10,2 MB en Chrome.

### Cómo se reduce que invente (y por qué no se puede garantizar)

Agustín pidió que la IA no invente nada. Se aplicó esto en `engine.js`:

- **Muestreo determinista**: temperatura 0 (siempre la palabra más probable), con una penalización leve de repetición (1,1 sobre los últimos 64 tokens). Se probaron 0,7, 0,2 y 0, y con 0 hubo menos invenciones.
- **Instrucciones en español**: no tiene internet; para noticias, partidos, precios, clima o la fecha tiene que decir «No lo sé»; de la persona solo usa lo que le contó; no inventa nombres, números, fechas, citas ni enlaces.
- **Ejemplos fijos** de respuestas correctas, que van antes de cada conversación y no se guardan.
- **Respuestas más cortas**: máximo 256 tokens.
- Un aviso fijo bajo el cuadro de texto: «La IA local puede equivocarse. Verificá datos importantes.»

**No se puede garantizar que nunca invente.** Un modelo de 0,5B no sabe cuándo no sabe; las instrucciones bajan el problema, no lo eliminan. Con 34 preguntas de prueba, Qwen2.5 0.5B pasó de 17 a 9 respuestas con datos inventados o falsos, y Qwen3 0.6B tuvo 3, aunque se negó a responder 4 preguntas fáciles. El detalle está en [docs/eval-antialucinacion.md](docs/eval-antialucinacion.md).

### Dónde se guarda cada cosa

- Conversaciones: IndexedDB, en este dispositivo.
- Modelos: Origin Private File System (OPFS) del navegador, gestionado por wllama.
- Motor (`.wasm`): Cache API (`mi-ia-local-engine-v1`), guardado solo al descargar un modelo.
- Interfaz: service worker `mi-ia-local-shell-v4` (incluye `engine.js` y `vendor/wllama/wllama.min.js`).

### Lo que ya funciona

- Chat con tema claro y oscuro, historial, nueva conversación y borrar conversaciones.
- Panel **Modelos**: tamaño, descarga con confirmación y progreso, cancelar descarga, elegir el modelo en uso, eliminar modelo, espacio usado (`navigator.storage.estimate`) y pedido de almacenamiento persistente (`navigator.storage.persist`).
- Respuestas reales del modelo, escritas a medida que se generan, con el indicador de generación y un botón para **detener**. La respuesta se guarda en IndexedDB.
- Sin modelo descargado, la app lo avisa y no inventa respuestas. Si el motor falla, muestra el error en español.

### Qué se probó y dónde

Todo en Chrome headless (Linux, Playwright) con pantalla de 375×667, **no** en un iPhone ni en Safari:

- Descarga real de Qwen2.5 0.5B desde Hugging Face con la interfaz (≈37 s en el servidor de pruebas).
- Respuesta real del modelo («La capital de Uruguay es Montevideo.»), con el motor normal y con el motor «compat» que usa Safari (forzado en Chrome).
- Con la red cortada (modo sin conexión del navegador): recarga de la app y respuesta real del modelo.
- Conversación de varios turnos, detener una respuesta, eliminar el modelo.
- Velocidad en ese servidor (un hilo): ~4 tokens/s, y 4–12 s hasta la primera palabra. En el iPhone puede ser distinto.

### Límites honestos (iPhone SE 2020, 3 GB)

- **Todavía no se probó en el iPhone.** Esa es la etapa 6.
- Safari no tiene JSPI ni Memory64, así que usa la versión «compat» de wllama, que el propio proyecto describe como más lenta.
- GitHub Pages no permite los encabezados COOP/COEP, así que no hay `SharedArrayBuffer`: el motor corre en **un solo hilo**.
- Memoria: el modelo de 0.5B ocupa ~400 MB más el contexto (2048 tokens). iOS puede cerrar la pestaña si se queda sin memoria; si pasa durante la carga, la app lo avisa la próxima vez que se abre.
- La GPU (WebGPU) está desactivada por defecto; hay un interruptor experimental en **Modelos**.
- Safari puede borrar datos de sitios que no se usan en ~7 días si la app no está en la pantalla de inicio. Si se borra el modelo, hay que descargarlo de nuevo.
- La calidad de un modelo de 0.5B es limitada: puede inventar datos o confundirse en conversaciones largas. El historial se recorta para que entre en el contexto.

## Cómo abrirla en local

1. Descargá o cloná este repositorio.
2. Desde la carpeta del proyecto, serví los archivos con cualquier servidor estático, por ejemplo:

   ```bash
   python3 -m http.server 8080
   ```

3. Abrí `http://localhost:8080` en el navegador.

También se puede abrir `index.html` de forma directa, pero el service worker y la PWA necesitan un origen (http o https), no un archivo `file://`.
