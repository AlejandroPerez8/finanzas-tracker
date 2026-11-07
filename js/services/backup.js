/** Exportación e importación de copias, con cifrado opcional AES-GCM y PBKDF2. */

const ITERACIONES = 310000;

/** Copia sin secretos: el token, la URL y la clave nunca salen en un export. */
export function exportable(datos) {
  const copia = structuredClone(datos);
  if (copia.settings?.ingesta) {
    delete copia.settings.ingesta.token;
    delete copia.settings.ingesta.url;
  }
  delete copia.settings?.pinHash;
  delete copia.settings?.apiKey;
  return copia;
}

/** Valida la forma mínima de una copia antes de reemplazar los datos. */
export function validarCopia(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    throw new Error('La copia no tiene el formato esperado');
  for (const campo of ['accounts', 'transactions']) {
    if (obj[campo] !== undefined && !Array.isArray(obj[campo]))
      throw new Error(`El campo ${campo} no es una lista`);
  }
  if (obj.schemaVersion !== undefined && !Number.isInteger(obj.schemaVersion))
    throw new Error('schemaVersion inválido');
  return obj;
}

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivarClave(clave, sal) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sal, iterations: ITERACIONES, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Cifra un objeto con una clave escrita por el usuario. */
export async function cifrar(obj, clave) {
  if (!clave || clave.length < 8) throw new Error('La clave debe tener al menos 8 caracteres');
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const llave = await derivarClave(clave, sal);
  const cifrado = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    llave,
    new TextEncoder().encode(JSON.stringify(obj)),
  );
  return {
    formato: 'finanzas-cifrado-v1',
    iteraciones: ITERACIONES,
    sal: b64(sal),
    iv: b64(iv),
    datos: b64(cifrado),
  };
}

/** ¿Es un archivo cifrado por `cifrar`? */
export const estaCifrado = (obj) => obj?.formato === 'finanzas-cifrado-v1';

/** Descifra; una clave incorrecta produce un error comprensible. */
export async function descifrar(paquete, clave) {
  const llave = await derivarClave(clave, deB64(paquete.sal));
  try {
    const plano = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deB64(paquete.iv) },
      llave,
      deB64(paquete.datos),
    );
    return JSON.parse(new TextDecoder().decode(plano));
  } catch {
    throw new Error('Clave incorrecta o archivo dañado');
  }
}
