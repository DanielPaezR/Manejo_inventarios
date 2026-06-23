const { Pool } = require('pg');

async function generarNumeroFactura(moduloId, pool) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const secuencia = await client.query(
      'SELECT * FROM secuencias_factura WHERE modulo_id = $1 FOR UPDATE',
      [moduloId]
    );
    
    if (secuencia.rows.length === 0) {
      await client.query(
        'INSERT INTO secuencias_factura (modulo_id, prefijo, siguiente_numero) VALUES ($1, $2, $3)',
        [moduloId, 'FAC', 1]
      );
      
      const nuevaSecuencia = await client.query(
        'SELECT * FROM secuencias_factura WHERE modulo_id = $1',
        [moduloId]
      );
      
      const numeroActual = nuevaSecuencia.rows[0].siguiente_numero;
      const prefijo = nuevaSecuencia.rows[0].prefijo;
      
      await client.query(
        'UPDATE secuencias_factura SET siguiente_numero = siguiente_numero + 1 WHERE modulo_id = $1',
        [moduloId]
      );
      
      await client.query('COMMIT');
      return `${prefijo}${String(numeroActual).padStart(6, '0')}`;
    }
    
    const numeroActual = secuencia.rows[0].siguiente_numero;
    const prefijo = secuencia.rows[0].prefijo;
    
    await client.query(
      'UPDATE secuencias_factura SET siguiente_numero = siguiente_numero + 1 WHERE modulo_id = $1',
      [moduloId]
    );
    
    await client.query('COMMIT');
    
    return `${prefijo}${String(numeroActual).padStart(6, '0')}`;
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { generarNumeroFactura };