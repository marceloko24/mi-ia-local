# Mi IA Local

Chat de inteligencia artificial que corre 100% en el iPhone, sin internet ni APIs pagas (PWA).

## Estado actual: etapa 4 (PWA offline)

La interfaz y las conversaciones ya se pueden usar sin red, una vez que la app se abrió al menos una vez y el service worker terminó de guardar la interfaz.

Dirección de GitHub Pages (cuando esté publicada):

**https://marceloko24.github.io/mi-ia-local/**

### Cómo instalarla en el iPhone

1. En Safari, abrí esa dirección.
2. Tocá el botón Compartir (el cuadrado con la flecha hacia arriba).
3. Elegí **Agregar a inicio**.
4. Confirmá. Se va a crear un ícono en la pantalla de inicio, que abre la app a pantalla completa.

Agregarla al inicio también ayuda a que Safari no borre los datos a los ~7 días de no usarla.

### Lo que ya funciona

- Interfaz de chat para iPhone SE, con tema claro y oscuro
- Conversaciones guardadas en IndexedDB, en este dispositivo
- App shell en caché (HTML, CSS, JS, íconos y manifiesto), con un service worker en modo cache-first
- Distintivo **En línea** / **Sin conexión**, según haya red
- Indicador **Disponible sin conexión**, que solo aparece cuando la interfaz ya está guardada en la caché
- Si enviás un mensaje, se muestra el aviso del motor pendiente. No se inventan respuestas de IA

### Todavía no hay

- Motor de IA local. No se generan respuestas y no se simulan. Eso es la etapa 5.
- Descarga ni ejecución de modelos. El service worker no cachea ni intercepta descargas futuras de modelos (por ejemplo archivos `.gguf`), hasta que se definan con cuidado más adelante.

### Límites honestos

- La primera visita necesita red para descargar la app y cachearla. Recién después se puede recargar en modo avión.
- En iOS, Safari puede borrar los datos de un sitio después de unos 7 días sin usarlo, salvo que esté agregada a la pantalla de inicio.
- `navigator.storage.persist()` se pide en silencio. En iPhone suele no alcanzarse hasta agregar la app al inicio.
- Esta PWA todavía no se probó en un Safari real de iPhone; las pruebas de esta etapa se hicieron en Chrome del entorno de desarrollo, a 375×667.
- Los datos quedan en el navegador de este dispositivo; no se envían a un servidor.

## Cómo abrirla en local

1. Descargá o cloná este repositorio.
2. Desde la carpeta del proyecto, serví los archivos con cualquier servidor estático, por ejemplo:

   ```bash
   python3 -m http.server 8080
   ```

3. Abrí `http://localhost:8080` en el navegador.

También se puede abrir `index.html` de forma directa, pero el service worker y la PWA necesitan un origen (http o https), no un archivo `file://`.
