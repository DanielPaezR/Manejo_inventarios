const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const moment = require('moment');
// Español solo donde se pide con .locale('es') (asistente del menú); cargar
// la locale la vuelve global, así que se restaura 'en' para no cambiar nada más.
require('moment/locale/es');
moment.locale('en');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
require('dotenv').config();

// El servidor corre en UTC (confirmado con SHOW timezone en Postgres), pero
// el negocio opera en Colombia (UTC-5, sin horario de verano). moment()
// solo, sin fijar el offset, calcula "hoy"/"inicio de día" según la zona
// horaria del proceso — que en producción es UTC, no Bogotá. Esto hacía
// que los filtros de período de Estadísticas y Finanzas (hoy/semana/mes)
// no coincidieran con el día real en Colombia. ahoraColombia() fija el
// offset explícitamente para que el cálculo sea correcto sin importar en
// qué zona horaria esté corriendo el proceso de Node.
const ahoraColombia = () => moment().utcOffset(-300);

// ==================== IMPORTS DE MIDDLEWARES Y HELPERS ====================
const { authenticateToken, requireAdmin, requireSuperAdmin } = require('./src/middleware/auth');
const { checkAccess } = require('./src/middleware/checkAccess');
const { generarNumeroFactura } = require('./src/helpers/generarNumeroFactura');
const { generarNumeroCliente } = require('./src/helpers/generarNumeroCliente');
const { geocodificar } = require('./src/helpers/geocodificar');
const OpenAI = require('openai');
const { botDisponible, responder: responderBot, limpiarEstilo } = require('./src/helpers/asistenteBot');
const { construirResumen, construirAntesYAhora, metricasPeriodo } = require('./src/helpers/resumenNegocio');
const { cargarPromociones, expandirDetalles, limpiarPromocion } = require('./src/helpers/promociones');
const { guardarPuntaje, podio: podioJuego, campeones: campeonesJuegos, leerPremio, ganadores: ganadoresJuegos, misPremios, canjear: canjearPremio, puntajesRecientes } = require('./src/helpers/juegos');
const { aplicarMigraciones } = require('./src/helpers/migraciones');
const slugs = require('./src/helpers/slugs');
const { productosParaSimulador, mermas, ventasPorEquipo, clientesEnLinea, hoyRapido, miDia } = require('./src/helpers/analisisExtra');
const { enviarResumenModulo, programarResumenSemanal } = require('./src/helpers/resumenSemanal');
const sellos = require('./src/helpers/sellos');
const planes = require('./src/helpers/planes');
const salas = require('./src/helpers/salas');
const respaldos = require('./src/helpers/respaldos');
const { estadoBienvenida, guardarBienvenida } = require('./src/helpers/bienvenida');
const { TIPOS: TIPOS_RECORDATORIO, leerConfig: leerConfigRecordatorios, construirAviso, enviarRecordatorio, programarRecordatorios } = require('./src/helpers/recordatorios');
const { canalesDisponibles, normalizarTelefono } = require('./src/helpers/notificador');

// Divide el ingreso de una venta entre los módulos dueños reales de cada
// línea vendida (duenoPorProducto), no todo al módulo que hizo la venta —
// así Finanzas de cada módulo solo refleja el dinero de sus propios
// productos, sin importar desde qué módulo se vendieron. El reporte de
// "cuánto vendí de productos ajenos" sigue existiendo aparte en
// GET /api/estadisticas/ventas-cruzadas, que no cambia con esto.
//
// Bolsillos: el dinero de cada módulo se lleva separado según dónde está
// físicamente — 'caja' (base + monedas), 'cartera' (lo que se guarda de la
// caja cada noche), 'nequi' (transferencias) y 'otros_modulos' (dinero de
// productos de otro módulo que pasó por esta caja, o al revés). La venta
// en efectivo cae en 'caja' y la transferencia/tarjeta en 'nequi'. Cuando
// la línea es de otro módulo, el ingreso del dueño queda en su
// 'otros_modulos' (lo tiene otro módulo) y el módulo que vendió registra
// un traslado otros_modulos -> caja/nequi (el billete sí entró a su caja,
// pero se lo debe al dueño hasta que se lo entregue).
const BOLSILLOS = ['caja', 'cartera', 'nequi', 'otros_modulos'];
const BOLSILLOS_MANUALES = ['caja', 'cartera', 'nequi'];
const bolsilloPorMetodo = (metodoPago) =>
  (metodoPago === 'transferencia' || metodoPago === 'tarjeta') ? 'nequi' : 'caja';

const registrarIngresosVenta = async (client, { negocioId, moduloVendedorId, metodoPago, ventaId, numeroFactura, usuarioId, detalles, duenoPorProducto }) => {
  const bolsillo = bolsilloPorMetodo(metodoPago);
  const montoPorDueno = new Map();
  for (const detalle of detalles) {
    const duenoId = duenoPorProducto.get(detalle.producto_id);
    const subtotal = detalle.subtotal !== undefined ? Number(detalle.subtotal) : detalle.cantidad * detalle.precio_unitario;
    montoPorDueno.set(duenoId, (montoPorDueno.get(duenoId) || 0) + subtotal);
  }

  for (const [duenoId, monto] of montoPorDueno) {
    const esAjeno = Number(duenoId) !== Number(moduloVendedorId);
    await client.query(
      `INSERT INTO movimientos_caja
       (negocio_id, modulo_id, tipo, origen, monto, concepto, venta_id, usuario_id, bolsillo)
       VALUES ($1, $2, 'ingreso', 'venta', $3, $4, $5, $6, $7)`,
      [negocioId, duenoId, monto, `Venta #${numeroFactura}`, ventaId, usuarioId, esAjeno ? 'otros_modulos' : bolsillo]
    );
    if (esAjeno && monto > 0) {
      await client.query(
        `INSERT INTO traslados_bolsillo (negocio_id, modulo_id, origen, destino, monto, tipo, concepto, venta_id, usuario_id)
         VALUES ($1, $2, 'otros_modulos', $3, $4, 'venta_cruzada', $5, $6, $7)`,
        [negocioId, moduloVendedorId, bolsillo, monto, `Venta #${numeroFactura} (producto de otro módulo)`, ventaId, usuarioId]
      );
    }
  }
};
const { JWT_SECRET } = require('./src/config/jwtSecret');

// ==================== IMPORTS DE REPORTES ====================
const generarReporteVentasDiarias = require('./src/reports/reporteVentasDiarias');
const generarReporteInventario = require('./src/reports/reporteInventario');
const generarReporteFinancieroMensual = require('./src/reports/reporteFinanciero');
const generarExcelProductos = require('./src/reports/excelProductos');
const generarExcelVentas = require('./src/reports/excelVentas');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// CONEXIÓN A POSTGRESQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

console.log('🔍 Conexión BD configurada con DATABASE_URL:', !!process.env.DATABASE_URL);

// CONFIGURACIÓN DE WEB PUSH (notificaciones de pedidos nuevos)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('🔔 Web Push configurado');
} else {
  console.warn('⚠️ VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT no configuradas — las notificaciones push no se enviarán.');
}

// Log de rutas
app.use((req, res, next) => {
  console.log('📍 Ruta solicitada:', req.method, req.url);
  next();
});

// ==================== RUTAS (src/rutas) ====================
// Cada grupo de rutas vive en su propio archivo. Se registran en este orden
// (el orden importa en Express). ctx lleva lo definido arriba y lo que cada
// grupo exporta para los siguientes.
const ctx = {
  express, cors, bcrypt, jwt, Pool, moment, path, crypto, webpush, ahoraColombia,
  authenticateToken, requireAdmin, requireSuperAdmin, checkAccess, generarNumeroFactura,
  generarNumeroCliente, geocodificar, OpenAI, botDisponible, responderBot, limpiarEstilo,
  construirResumen, construirAntesYAhora, metricasPeriodo, cargarPromociones, expandirDetalles,
  limpiarPromocion, guardarPuntaje, podioJuego, campeonesJuegos, leerPremio, ganadoresJuegos,
  misPremios, canjearPremio, puntajesRecientes, aplicarMigraciones, productosParaSimulador, mermas,
  ventasPorEquipo, clientesEnLinea, hoyRapido, miDia, enviarResumenModulo, programarResumenSemanal,
  sellos, planes, salas, respaldos, estadoBienvenida, guardarBienvenida, TIPOS_RECORDATORIO,
  leerConfigRecordatorios, construirAviso, enviarRecordatorio, programarRecordatorios,
  canalesDisponibles, normalizarTelefono, BOLSILLOS, BOLSILLOS_MANUALES, bolsilloPorMetodo,
  registrarIngresosVenta, JWT_SECRET, generarReporteVentasDiarias, generarReporteInventario,
  generarReporteFinancieroMensual, generarExcelProductos, generarExcelVentas, app, PORT, pool,
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, slugs
};

// /api/menu/elixir/... funciona igual que /api/menu/64/...: el enlace con
// nombre se traduce al número del módulo antes de cada ruta.
app.param('moduloId', slugs.resolverModuloId(pool));
const GRUPOS_DE_RUTAS = [
  'cuentas',
  'negocios',
  'productos',
  'ventas',
  'clientes',
  'estadisticas',
  'proveedores',
  'finanzas',
  'inventario',
  'finanzasNegocio',
  'reportes',
  'gestionInventario',
  'usuarios',
  'pedidosCliente',
  'menuPublico',
  'juegos',
  'asistente'
];
for (const grupo of GRUPOS_DE_RUTAS) {
  Object.assign(ctx, require(`./src/rutas/${grupo}`)(ctx));
}
const { calendarioDelModulo } = ctx;

// ==================== RUTAS DE SALUD ====================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Servidor funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

// ==================== SERVIR FRONTEND ====================

app.use(express.static(path.join(__dirname, '../frontend/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// ==================== INICIAR SERVIDOR ====================

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📊 Sistema de Inventario con Módulos`);
  console.log(`💾 Base de datos: ${process.env.DB_NAME || 'inventario_negocio'}`);
});

// Aplica las migraciones pendientes de backend/migrations al arrancar.
// Después, les da enlace con nombre a los menús que aún no tienen.
aplicarMigraciones(pool)
  .then(() => slugs.asegurarSlugs(pool))
  .catch(error => console.error('Error aplicando migraciones:', error.message));

programarResumenSemanal(pool);
programarRecordatorios(pool, calendarioDelModulo);
respaldos.programarRespaldos(pool);