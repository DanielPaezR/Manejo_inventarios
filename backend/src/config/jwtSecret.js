const crypto = require('crypto');

// Antes, auth.js y server.js usaban `process.env.JWT_SECRET || 'secreto_temporal'`
// cada uno por su cuenta: si la variable de entorno no estaba configurada en
// Railway, los tokens se firmaban y verificaban con un secreto hardcodeado y
// público en el repo, permitiendo forjar tokens válidos (incluso rol
// super_admin). Este módulo centraliza la resolución del secreto para que
// ambos archivos usen siempre el mismo valor.
//
// Si JWT_SECRET no está configurado, en vez de usar un secreto público se
// genera uno aleatorio al arrancar el proceso. Esto cierra el hueco de
// seguridad, pero como efecto secundario invalida todas las sesiones activas
// en cada reinicio/deploy (los usuarios deben volver a iniciar sesión).
// Configura JWT_SECRET en las variables de entorno de Railway para evitarlo.
if (!process.env.JWT_SECRET) {
  console.warn(
    '⚠️  JWT_SECRET no está configurado. Usando un secreto aleatorio generado en este arranque: ' +
    'todas las sesiones se invalidarán en el próximo reinicio o deploy. ' +
    'Configura JWT_SECRET en las variables de entorno de producción.'
  );
}

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');

module.exports = { JWT_SECRET };
