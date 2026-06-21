# TEG Online

Juego web instalable de táctica y estrategia para 2 a 6 participantes, preparado para Chrome móvil y partidas en tiempo real.

## Ejecutar localmente

Requisitos: Node.js 18 o superior.

```powershell
npm install
npm run dev
```

Abrir `http://localhost:5173`.

Otros dispositivos conectados a la misma red pueden entrar usando la dirección de red que muestra la terminal, por ejemplo `http://192.168.0.81:5173`.

## Versión de producción

```powershell
npm run build
npm start
```

La aplicación completa queda disponible en `http://localhost:3100`.

## Compartir temporalmente por Internet

Con `cloudflared.exe` guardado en `.tools`, ejecutar:

```powershell
npm run share
```

El comando inicia el servidor si fuera necesario y muestra una dirección HTTPS temporal de `trycloudflare.com`. Compartir esa dirección solamente con testers. La computadora debe permanecer encendida y la ventana del túnel abierta.

No es necesario abrir puertos del router. Los Quick Tunnels son apropiados para pruebas, no para producción ni disponibilidad permanente.

## Administración

Copiar `.env.example` como `.env` o definir las variables de entorno antes de iniciar:

- `PORT`: puerto del servidor.
- `ADMIN_PIN`: PIN del panel administrativo. Debe cambiarse antes de compartir el servidor.
- `GOOGLE_CLIENT_ID` y `FACEBOOK_APP_ID`: reservadas para activar el acceso social cuando se creen las credenciales.

Los datos se guardan en `data/reinos.sqlite`. La base usa WAL y cada acción de una partida se persiste antes de continuar.

## Controles de calidad

```powershell
npm run check
npm test
npm run build
```

## Componentes principales

- React + TypeScript: PWA e interfaz móvil.
- Node.js + Express + Socket.IO: servidor autoritativo y tiempo real.
- SQLite: usuarios, partidas, amistades, invitaciones y estadísticas.
- SVG y máscaras cartográficas: mapa mundial con 50 siluetas territoriales, islas, fronteras y rutas marítimas.

Las partidas locales se ejecutan en el navegador y se guardan en el dispositivo. Las partidas online, dados, turnos, bots, pactos y reconexiones se resuelven en el servidor.

## Licencia y mapa

El proyecto se distribuye bajo GNU GPL versión 2. La base cartográfica y las siluetas territoriales se adaptaron del proyecto libre TEG — Tenes Empanadas Graciela. Consultar [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
