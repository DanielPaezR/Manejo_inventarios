const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024; // 5MB
const LADO_MAXIMO = 1600; // px: de sobra para el menú y las facturas
const COMPRIMIR_DESDE = 1.5 * 1024 * 1024;

// Las fotos de la cámara del celular pesan varios MB (y en iPhone pueden
// venir en HEIC): se reducen a máximo 1600 px en JPEG antes de subirlas.
// Si el navegador no puede leer la imagen, se deja el archivo como venía
// y las validaciones de abajo dicen qué pasa.
async function reducirImagen(file) {
  const necesita = file.size > COMPRIMIR_DESDE || !TIPOS_PERMITIDOS.includes(file.type);
  if (!necesita || !file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const escala = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Sube una imagen a Cloudinary (unsigned upload, directo desde el
 * navegador) y devuelve su secure_url. Valida tipo/tamaño ANTES de subir
 * para no esperar la red cuando ya se sabe que va a fallar.
 */
export async function subirImagenCloudinary(archivo) {
  const file = await reducirImagen(archivo);
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error('Falta configurar Cloudinary (VITE_CLOUDINARY_CLOUD_NAME / VITE_CLOUDINARY_UPLOAD_PRESET)');
  }

  if (!TIPOS_PERMITIDOS.includes(file.type)) {
    throw new Error('Solo se permiten imágenes JPG, PNG o WEBP');
  }

  if (file.size > TAMANO_MAXIMO_BYTES) {
    throw new Error('La imagen no puede pesar más de 5MB');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || 'Error al subir la imagen a Cloudinary');
  }

  return data.secure_url;
}
