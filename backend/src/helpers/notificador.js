// Envío de avisos al dueño por distintos canales. Cada canal se activa solo
// si sus variables de entorno están configuradas, así que agregar WhatsApp
// el día que se tenga la cuenta de Meta es solo configurar Railway.
//
//  - push:     notificaciones del navegador (web-push, ya configurado con
//              VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT).
//  - whatsapp: WhatsApp Cloud API de Meta. Requiere:
//                WHATSAPP_TOKEN            token permanente del usuario del sistema
//                WHATSAPP_PHONE_NUMBER_ID  id del número que envía
//                WHATSAPP_PLANTILLA_RESUMEN nombre de la plantilla aprobada
//                WHATSAPP_PLANTILLA_IDIOMA  (opcional, por defecto es_CO)
//              Meta exige plantillas aprobadas para escribirle primero a
//              alguien; la del resumen debe tener un solo parámetro de texto
//              en el cuerpo ({{1}}) donde va el resumen.
const webpush = require('web-push');

const pushDisponible = () =>
  Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);

const whatsappDisponible = () =>
  Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_PLANTILLA_RESUMEN);

const canalesDisponibles = () => ({ push: pushDisponible(), whatsapp: whatsappDisponible() });

// Envía un push a cada suscripción; borra las que el navegador revocó.
async function enviarPush(pool, suscripciones, { titulo, cuerpo, url }) {
  if (!pushDisponible() || suscripciones.length === 0) {
    return { enviados: 0, fallidos: 0 };
  }
  const payload = JSON.stringify({ title: titulo, body: cuerpo, url });
  const resultados = await Promise.allSettled(
    suscripciones.map(sub =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        .catch(err => { err.suscripcionId = sub.id; throw err; })
    )
  );
  let enviados = 0;
  let fallidos = 0;
  for (const r of resultados) {
    if (r.status === 'fulfilled') { enviados++; continue; }
    fallidos++;
    if (r.reason?.statusCode === 410 || r.reason?.statusCode === 404) {
      await pool.query('DELETE FROM push_suscripciones WHERE id = $1', [r.reason.suscripcionId]).catch(() => {});
    } else {
      console.error('Error enviando push:', r.reason?.body || r.reason?.message);
    }
  }
  return { enviados, fallidos };
}

// Número colombiano en formato internacional sin "+" (57XXXXXXXXXX).
const normalizarTelefono = (telefono) => {
  const digitos = String(telefono || '').replace(/[^0-9]/g, '');
  if (digitos.length === 10 && digitos.startsWith('3')) return `57${digitos}`;
  if (digitos.length === 12 && digitos.startsWith('57')) return digitos;
  return null;
};

// Envía la plantilla del resumen por WhatsApp Cloud API.
async function enviarWhatsApp(telefono, texto) {
  if (!whatsappDisponible()) {
    return { ok: false, error: 'WhatsApp no está configurado' };
  }
  const destino = normalizarTelefono(telefono);
  if (!destino) {
    return { ok: false, error: 'Número de WhatsApp inválido' };
  }
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const respuesta = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: destino,
      type: 'template',
      template: {
        name: process.env.WHATSAPP_PLANTILLA_RESUMEN,
        language: { code: process.env.WHATSAPP_PLANTILLA_IDIOMA || 'es_CO' },
        // Las plantillas no admiten saltos de línea dentro de un parámetro.
        components: [{ type: 'body', parameters: [{ type: 'text', text: texto.replace(/\s*\n+\s*/g, ' · ').slice(0, 1000) }] }]
      }
    })
  });
  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    console.error('Error enviando WhatsApp:', respuesta.status, detalle);
    return { ok: false, error: `WhatsApp respondió ${respuesta.status}` };
  }
  return { ok: true };
}

module.exports = { canalesDisponibles, enviarPush, enviarWhatsApp, normalizarTelefono };
