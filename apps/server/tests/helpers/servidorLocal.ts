// Arranque de servidores HTTP locales para los tests, con un puerto efímero y sin keep-alive.
import type http from 'node:http';

// Sin keep-alive: con la suite en paralelo un test puede pasar más de 5 s entre peticiones y el
// servidor cerraría el socket que fetch reutiliza (ECONNRESET en la siguiente). Se escucha sin
// host a propósito: así el puerto queda enlazado de forma síncrona y los tests pueden leer
// address() justo después; con '127.0.0.1' Node resuelve el host antes y address() devuelve null.
export function escucharLocal<S extends http.Server>(server: S): S {
  server.keepAliveTimeout = 0;
  return server.listen(0);
}
