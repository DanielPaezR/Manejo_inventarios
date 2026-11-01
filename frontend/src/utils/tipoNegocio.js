// Textos que cambian según el tipo de negocio (negocios.tipo). La lógica de
// la app es la misma para todos; solo cambia cómo se le habla a cada uno:
// un restaurante atiende mesas y tiene menú, una tienda atiende clientes y
// tiene catálogo.

const TEXTOS = {
  restaurante: {
    cuenta: 'Mesa',
    menu: 'menú',
    Menu: 'Menú',
    nombrePedido: 'Mesa o tu nombre *',
    faltaNombrePedido: 'Ingresa tu nombre o el número de mesa',
    etiquetaNombrePedido: 'Mesa/Nombre',
    sinDomicilio: 'recoger o comer en el lugar'
  },
  tienda: {
    cuenta: 'Cliente',
    menu: 'catálogo',
    Menu: 'Catálogo',
    nombrePedido: 'Tu nombre *',
    faltaNombrePedido: 'Ingresa tu nombre',
    etiquetaNombrePedido: 'Cliente',
    sinDomicilio: 'recoger en la tienda'
  }
};

export const textosNegocio = (tipo) => TEXTOS[tipo] || TEXTOS.restaurante;

// Tipo del negocio del usuario con sesión (guardado al iniciar sesión).
export const tipoNegocioUsuario = () => {
  try {
    return JSON.parse(localStorage.getItem('user'))?.negocio?.tipo || 'restaurante';
  } catch {
    return 'restaurante';
  }
};
