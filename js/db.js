/**
 * Persistencia: IndexedDB con respaldo en localStorage. Mismas base y clave que la v4.
 * Antes de migrar se guarda una instantánea; si la migración falla, los datos quedan intactos.
 */

import { migrar, VERSION_ACTUAL } from './services/migraciones.js';

const DB_NOMBRE = 'finanzas-tracker-db';
const DB_ALMACEN = 'kv';
export const CLAVE_DATOS = 'finance-data';

let conexion = null;
let intentado = false;

function abrir() {
  return new Promise((resolve) => {
    if (intentado) return resolve(conexion);
    intentado = true;
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NOMBRE, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_ALMACEN);
      req.onsuccess = () => {
        conexion = req.result;
        resolve(conexion);
      };
      req.onerror = () => resolve(null);
    } catch (err) {
      console.warn('IndexedDB no disponible', err);
      resolve(null);
    }
  });
}

async function leer(clave) {
  const db = await abrir();
  if (db) {
    const valor = await new Promise((resolve) => {
      const req = db.transaction(DB_ALMACEN, 'readonly').objectStore(DB_ALMACEN).get(clave);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    if (valor) return valor;
  }
  try {
    return localStorage.getItem(clave);
  } catch (err) {
    console.warn('localStorage no disponible', err);
    return null;
  }
}

/** Escribe en ambos almacenes. Lanza si ninguno pudo guardar: nunca se reporta éxito falso. */
async function escribir(clave, valor) {
  let guardado = false;
  const db = await abrir();
  if (db) {
    guardado = await new Promise((resolve) => {
      const tx = db.transaction(DB_ALMACEN, 'readwrite');
      tx.objectStore(DB_ALMACEN).put(valor, clave);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  }
  try {
    localStorage.setItem(clave, valor);
    guardado = true;
  } catch (err) {
    // El respaldo puede llenarse; solo es fatal si IndexedDB tampoco guardó.
    if (!guardado) console.error('No se pudo guardar', err);
  }
  if (!guardado) throw new Error('No se pudieron guardar los datos en este dispositivo');
}

/**
 * Carga y migra. Con datos corruptos o migración fallida devuelve `error` y no sobrescribe nada.
 * @returns {Promise<{datos:object|null, error:string|null, migro:boolean}>}
 */
export async function cargar() {
  const crudo = await leer(CLAVE_DATOS);
  if (!crudo) return { datos: migrar({}).datos, error: null, migro: false };
  let original;
  try {
    original = JSON.parse(crudo);
  } catch (err) {
    return { datos: null, error: `Datos ilegibles: ${err.message}`, migro: false };
  }
  try {
    const previa = original.schemaVersion ?? 1;
    if (previa !== VERSION_ACTUAL) await escribir(`${CLAVE_DATOS}.respaldo.v${previa}`, crudo);
    const { datos, migro } = migrar(original);
    if (migro) await escribir(CLAVE_DATOS, JSON.stringify(datos));
    return { datos, error: null, migro };
  } catch (err) {
    return { datos: null, error: err.message, migro: false };
  }
}

/** Guarda el estado completo. */
export const guardar = (datos) => escribir(CLAVE_DATOS, JSON.stringify(datos));

/** Tamaño aproximado de los datos en bytes. */
export const tamanoDatos = (datos) => new Blob([JSON.stringify(datos)]).size;
