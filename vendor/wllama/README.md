# wllama (copia local del motor)

Motor de IA local: [wllama](https://github.com/ngxson/wllama) 3.13.0, que es llama.cpp compilado a WebAssembly. Licencia MIT (ver `LICENCE`).

Los archivos se copian dentro del repositorio para que la app no dependa de un CDN y funcione sin internet:

| Archivo | Origen (npm) | Tamaño |
|---|---|---|
| `wllama.min.js` | `@wllama/wllama@3.13.0` → `esm/index.min.js` | 219 KB |
| `wllama.wasm` | `@wllama/wllama@3.13.0` → `esm/wasm/wllama.wasm` (Chrome y navegadores con JSPI + Memory64) | 10,2 MB |
| `compat/wllama.js` | `@wllama/wllama-compat@3.13.0` → `wasm/wllama.js` (Safari / iPhone) | 174 KB |
| `compat/wllama.wasm` | `@wllama/wllama-compat@3.13.0` → `wasm/wllama.wasm` (Safari / iPhone) | 18,8 MB |

El conector de GitHub que usa el asistente no puede subir archivos binarios, así que el workflow `.github/workflows/vendor-wllama.yml` descarga esos paquetes de npm, comprueba las sumas de `SHA256SUMS` y commitea los archivos. Si una suma no coincide, el workflow falla y no commitea nada.
