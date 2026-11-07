/** Categorías base y normalización de nombres de comercio. */

export const CATEGORIAS_GASTO = [
  'Alimentación',
  'Transporte',
  'Vivienda',
  'Servicios',
  'Entretenimiento',
  'Salud',
  'Educación',
  'Deudas',
  'Transferencias',
  'Cobros bancarios',
  'Otros',
];
export const CATEGORIAS_INGRESO = [
  'Salario',
  'Freelance',
  'Inversiones',
  'Transferencias recibidas',
  'Otros ingresos',
];

/** Texto en mayúsculas, sin tildes, signos ni sufijos societarios, para comparar comercios. */
export function normalizarComercio(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9& ]+/g, ' ')
    .replace(/\b(S A S|SAS|S A|SA|LTDA|S)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
