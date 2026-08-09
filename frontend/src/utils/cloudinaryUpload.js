const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Sube una imagen a Cloudinary (unsigned upload, directo desde el
 * navegador) y devuelve su secure_url. Valida tipo/tamaño ANTES de subir
 * para no esperar la red cuando ya se sabe que va a fallar.
 */
export async function subirImagenCloudinary(file) {
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
