# Sistema de Inventario y Ventas

Plataforma web para negocios pequeños (tiendas, estaderos, restaurantes y comercios) que reúne en un solo lugar el punto de venta, el inventario, los proveedores, el dinero del día a día, las estadísticas y un menú en línea para que los clientes pidan desde su celular.

Funciona para **varios negocios a la vez**: cada negocio tiene sus módulos (por ejemplo, una tienda y un puesto de empanadas dentro del mismo local), sus usuarios y sus datos separados. El tipo de negocio (restaurante o tienda) solo cambia los textos: "mesa y menú" o "cliente y catálogo".

---

## Funcionalidades

### Vender
- **Punto de venta** con búsqueda, escáner de código de barras, varias cuentas abiertas a la vez (mesas o clientes), métodos de pago (efectivo, transferencia, tarjeta, fiado y consumo propio) y factura imprimible.
- **Barra del día**: cuánto lleva vendido hoy contra un día normal a la misma hora y cuánto falta para la meta de la semana. Cada vendedor ve sus propias ventas y un **podio semanal del equipo**.
- **Avisos en el carrito**: "quedan 2", o la deuda del cliente al venderle fiado.
- **Pedidos de clientes** desde el menú en línea: confirmación, estado de pago, comprobante de transferencia en revisión y notificaciones push.
- **Ruta de entregas** para domicilios, con mapa y orden de entrega.
- **Facturas**: buscador por número e historial de ventas por día, incluidas las que no tienen cliente.

### Mercancía
- **Productos y categorías** con foto, costo, precio, stock mínimo, productos que no manejan stock (preparados) y productos compartidos entre módulos. Al editar muestra cuánto deja cada unidad y cuánto se vende al mes.
- **Promociones (combos)**: dos o más productos a un precio especial. Al venderse, el combo se reparte entre sus productos con el precio rebajado, así el inventario y las estadísticas siguen cuadrando. Al crearlas, unas burbujas muestran cuánta ganancia se sacrifica y cuánto más hay que vender para que valga la pena.
- **Inventario**: ingreso de mercancía, ajustes, conteos físicos con diferencias y productos con datos incompletos.
- **Proveedores** con calendario de pedidos (día fijo, "avisa" o en pausa).
- **Mis pedidos**: cantidades sugeridas según lo que se vende, la tendencia de las últimas semanas, el stock y el ciclo del proveedor. Se pueden editar antes de recibirlos, se compara el precio con el pedido anterior y se envían por WhatsApp.

### Clientes y marketing
- **Clientes** con historial, fiado y abonos.
- **Menú / catálogo público** (`/menu/:moduloId`): portada grande (o un mosaico de los productos si no hay foto), categorías fijas, ficha de producto, carrito, domicilio con ubicación en el mapa y sección de promociones.
- **Asistente automático** en el menú (OpenAI), que responde preguntas de los clientes con la información del negocio. Su personalidad se configura con campos simples.
- **Marketing**: enlace y QR para imprimir, apariencia del menú y **creador de flyers** para redes con 4 plantillas (Editorial, Vibrante, Noche y Fresco), en formato post o historia.
- **Zona de juegos** (`/menu/:moduloId/juegos`), que se puede apagar por negocio:
  - **Juegos para el celular con podio semanal**: Memoria, Atrapa la fruta, Culebrita, Toque rápido, Cálculo veloz y Tres en raya.
  - **Apoyos para juegos de mesa**: contador de dominó, reloj de ajedrez, anotador de cartas y tiro al blanco.

### Dinero
- **Caja y bolsillos**: caja, cartera, Nequi y dinero de otros módulos, con apertura, cierre, traslados, pagos fijos y cuadre diario.
- **Finanzas del negocio**: ingresos, egresos por categoría, ventas cruzadas entre módulos y estado de resultados.

### Análisis
- **Estadísticas** organizadas por preguntas:
  - **Resumen**: la historia del negocio en capítulos, metas, decisiones de la semana e informe mensual imprimible.
  - **Ventas** y **Productos**: incluye un simulador de precios y las mermas de los conteos.
  - **Dinero**.
  - **Antes y ahora**: el primer mes contra el último.
  - **Clientes en línea**.
- **Resumen semanal** que llega solo los lunes por notificación push. El canal de WhatsApp queda listo para cuando se configure la cuenta de Meta.
- **Reportes** descargables.

### Equipo y ajustes
- Roles: **super admin** (crea negocios y usuarios), **administrador** (dueño del negocio) y **trabajador**.
- El administrador puede dar o quitar a cada trabajador acceso a secciones extra: productos, inventario, proveedores, clientes y facturas.
- Configuración por módulo: domicilios, zona de juegos, asistente, resumen semanal y equipo.

---

## Tecnología

| Parte | Tecnología |
|---|---|
| Frontend | React 18 + Vite, React Router, lucide-react, Leaflet (mapas), jsPDF, qrcode, PWA con notificaciones push |
| Backend | Node.js + Express, PostgreSQL (`pg`, SQL directo), JWT, bcrypt, web-push, OpenAI SDK |
| Base de datos | PostgreSQL (fechas guardadas en UTC y mostradas en hora de Colombia) |
| Imágenes | Cloudinary (subida directa desde el navegador) |
| Despliegue | Railway: un solo servicio que compila el frontend y lo sirve desde el backend |

---

## Estructura

```
inventario-app/
├── backend/
│   ├── server.js            # API REST (rutas de todo el sistema)
│   └── src/
│       ├── middleware/      # autenticación, acceso por módulo, permisos
│       ├── helpers/         # resumen del negocio, promociones, asistente, juegos, notificaciones…
│       └── reports/         # reportes en PDF y Excel
├── frontend/
│   ├── src/
│   │   ├── components/      # pantallas (Ventas, Estadísticas, MenuPublico, Marketing…)
│   │   │   └── juegos/      # zona de juegos y apoyos de mesa
│   │   ├── utils/           # flyers, permisos, textos por tipo de negocio…
│   │   ├── services/        # cliente HTTP (privado y público)
│   │   └── App.jsx          # rutas
│   └── public/              # íconos de la PWA
├── database/init.sql        # esquema inicial
├── package.json             # scripts de compilación y arranque para Railway
└── railway.json
```

---

## Correr en local

Requisitos: Node.js 18 o superior y una base de datos PostgreSQL.

```bash
# 1. Dependencias
npm install --prefix backend
npm install --prefix frontend

# 2. Variables de entorno (ver tabla de abajo)
#    backend/.env   y   frontend/.env.local

# 3. Backend (puerto 5000)
npm run dev --prefix backend

# 4. Frontend (puerto 5173)
npm run dev --prefix frontend
```

Para apuntar el frontend al backend local, en `frontend/.env.local` va `VITE_API_URL=http://localhost:5000`.

### Variables de entorno

**Backend** (`backend/.env` o variables del servicio en Railway):

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL |
| `JWT_SECRET` | Firma de las sesiones |
| `PORT` | Puerto del servidor (Railway lo asigna) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Notificaciones push (pedidos nuevos y resumen semanal) |
| `OPENAI_API_KEY` | Asistente del menú. Sin ella, el asistente no aparece |
| `OPENAI_CHAT_MODEL` | Opcional; por defecto `gpt-4o-mini` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_PLANTILLA_RESUMEN` | Opcional: resumen semanal por WhatsApp Cloud API |
| `WHATSAPP_PLANTILLA_IDIOMA`, `WHATSAPP_API_VERSION` | Opcional (por defecto `es_CO` y `v21.0`) |

**Frontend** (`frontend/.env`):

| Variable | Para qué |
|---|---|
| `VITE_API_URL` | URL del backend |
| `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET` | Subida de fotos |
| `VITE_VAPID_PUBLIC_KEY` | Suscripción a notificaciones push |

> Nunca subas al repositorio archivos `.env` ni credenciales. Los archivos `credenciales-*.txt` y la carpeta `impresos/` están en `.gitignore`.

---

## Despliegue (Railway)

El servicio usa `railway.json`:
- **Build:** `npm run build`, que compila el frontend e instala el backend.
- **Start:** `npm start`, que levanta `backend/server.js`. Ese servidor atiende la API en `/api/...` y sirve el frontend compilado para todas las demás rutas.

Cada push a `main` se despliega solo.

### Cambios de base de datos
El esquema base está en `database/init.sql`. Las tablas y columnas que se agregaron después se crean con `ALTER TABLE ... IF NOT EXISTS` directamente en la base de producción. Entre ellas:
- bolsillos y pagos fijos;
- calendario de proveedores;
- tipo de negocio;
- pago y comprobante de pedidos;
- asistente (`bot_*`, `bot_mensajes`);
- permisos de usuarios;
- metas y resumen semanal (`resumen_envios`);
- promociones (`promociones`, `promocion_items` y columnas `promocion_*` en los detalles de venta y de pedido);
- zona de juegos (`juego_puntajes`, `modulos.juegos_activos`).

El código está hecho para seguir funcionando aunque alguna de estas columnas opcionales todavía no exista.

---

## Rutas principales

| Ruta | Quién | Qué es |
|---|---|---|
| `/login` | Todos | Ingreso |
| `/ventas`, `/pedidos-cliente`, `/ruta-entregas`, `/facturas` | Admin y trabajadores | Vender y atender pedidos |
| `/productos`, `/inventario`, `/proveedores`, `/pedidos` | Admin (o trabajadores con permiso) | Mercancía |
| `/clientes`, `/marketing` | Admin | Clientes y marketing |
| `/finanzas`, `/finanzas-negocio`, `/estadisticas`, `/reportes` | Admin | Dinero y análisis |
| `/configuracion` | Admin | Ajustes del módulo |
| `/negocios` | Super admin | Negocios, módulos y usuarios |
| `/menu/:moduloId` | Público | Menú / catálogo con pedidos |
| `/menu/:moduloId/juegos` | Público | Zona de juegos |

---

## Licencia

Software privado. Todos los derechos reservados.
