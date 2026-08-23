async function generarNumeroCliente(moduloId, pool) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const secuencia = await client.query(
      'SELECT * FROM secuencias_cliente WHERE modulo_id = $1 FOR UPDATE',
      [moduloId]
    );

    if (secuencia.rows.length === 0) {
      await client.query(
        'INSERT INTO secuencias_cliente (modulo_id, siguiente_numero) VALUES ($1, $2)',
        [moduloId, 1]
      );

      const nuevaSecuencia = await client.query(
        'SELECT * FROM secuencias_cliente WHERE modulo_id = $1',
        [moduloId]
      );

      const numeroActual = nuevaSecuencia.rows[0].siguiente_numero;

      await client.query(
        'UPDATE secuencias_cliente SET siguiente_numero = siguiente_numero + 1 WHERE modulo_id = $1',
        [moduloId]
      );

      await client.query('COMMIT');
      return numeroActual;
    }

    const numeroActual = secuencia.rows[0].siguiente_numero;

    await client.query(
      'UPDATE secuencias_cliente SET siguiente_numero = siguiente_numero + 1 WHERE modulo_id = $1',
      [moduloId]
    );

    await client.query('COMMIT');

    return numeroActual;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { generarNumeroCliente };
