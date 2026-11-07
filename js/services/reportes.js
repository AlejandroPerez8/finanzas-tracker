/** Reportes: agregados que pueden salir del dispositivo, sin nombres ni movimientos. */

import { estadisticasMes } from '../domain/movimientos.js';
import { patrimonio } from '../domain/presupuesto.js';
import { sumarMeses } from '../domain/fechas.js';
import { formatear } from '../domain/money.js';

/** Solo totales por categoría, variaciones y deuda agregada. */
export function agregados(datos, mes) {
  const actual = estadisticasMes(datos.transactions, mes);
  const anterior = estadisticasMes(datos.transactions, sumarMeses(mes, -1));
  const p = patrimonio(datos);
  const variacion = {};
  for (const c of new Set([...Object.keys(actual.byCategory), ...Object.keys(anterior.byCategory)])) {
    variacion[c] = (actual.byCategory[c] || 0) - (anterior.byCategory[c] || 0);
  }
  return {
    mes,
    ingresos: actual.income,
    gastos: actual.expense,
    balance: actual.balance,
    tasaAhorro: actual.savingsRate,
    gastosPorCategoria: actual.byCategory,
    variacionPorCategoria: variacion,
    activos: p.activos,
    pasivos: p.pasivos,
    patrimonioNeto: p.neto,
    deudaTarjetas: p.desglose.tarjetas,
    otrasDeudas: p.desglose.otrasDeudas,
    metasActivas: datos.goals.length,
    cdtActivos: datos.investments.length,
  };
}

/** Prompt para copiar a Claude: lo único de datos que incluye son los agregados. */
export function promptReporte(a) {
  const cat = Object.entries(a.gastosPorCategoria).sort((x, y) => y[1] - x[1]);
  const lineas = cat.map(
    ([c, v]) =>
      `${c}: ${formatear(v)} (${a.variacionPorCategoria[c] >= 0 ? '+' : ''}${formatear(a.variacionPorCategoria[c])} vs. mes anterior)`,
  );
  return `Eres un asesor financiero para una persona en Colombia (COP). Responde en español, en menos de 400 palabras, con markdown simple (## títulos, - listas, ** negritas):
## Diagnóstico del mes
## Qué está funcionando
## Deuda
Prioridad entre pagar deuda y ahorrar, según las cifras.
## Recomendaciones priorizadas
3 a 5 acciones concretas, ordenadas por impacto.
Cierra aclarando que es una guía general y no reemplaza asesoría profesional.

---
Mes: ${a.mes}
Ingresos: ${formatear(a.ingresos)}
Gastos: ${formatear(a.gastos)}
Balance: ${formatear(a.balance)}
Tasa de ahorro: ${a.tasaAhorro} %
Gastos por categoría: ${lineas.join('; ') || 'sin gastos'}
Activos: ${formatear(a.activos)}
Pasivos: ${formatear(a.pasivos)}
Patrimonio neto: ${formatear(a.patrimonioNeto)}
Deuda de tarjetas: ${formatear(a.deudaTarjetas)}
Otras deudas: ${formatear(a.otrasDeudas)}
Metas activas: ${a.metasActivas}
CDT activos: ${a.cdtActivos}`;
}
