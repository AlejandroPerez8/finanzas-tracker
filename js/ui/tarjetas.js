/** Pantalla de tarjetas, deudas, simulador, flujo de caja y comparador con CDT. */

import {
  h,
  montar,
  monto,
  campo,
  entradaMonto,
  selector,
  vacio,
  encabezado,
  seguro,
  graficoLineas,
} from './dom.js';
import { aEntero, formatear } from '../domain/money.js';
import { diaBogota } from '../domain/fechas.js';
import {
  saldoTarjeta,
  cupoDisponible,
  utilizacion,
  proximasFechas,
  alertasTarjeta,
  estadoDiferida,
  pagoMinimoEstimado,
  costoPagoMinimo,
  amortizacion,
  tasaMensual,
  actualizarCiclos,
  cicloVigente,
} from '../domain/tarjetas.js';
import { compararEstrategias, flujoCaja, pagarVsCdt } from '../domain/deudas.js';
import { detectarRecurrentes } from '../domain/presupuesto.js';
import { estadisticasMes, saldoCuenta, saldoDeuda } from '../domain/movimientos.js';
import { sumarMeses } from '../domain/fechas.js';

// Par categórico validado (azul/aqua), distinto de los colores de ingreso/gasto/marca.
const COLORES = { avalancha: '#3987E5', bola_de_nieve: '#C98500' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** `2026-11-15` → `15 de nov`. */
const fechaLegible = (dia) => `${Number(dia.slice(8, 10))} de ${MESES[Number(dia.slice(5, 7)) - 1]}`;

export function crearTarjetasUI(ctx) {
  const accion = (fn) => seguro(fn, ctx.toast);
  let formularioAbierto = false;
  let presupuestoSim = '';

  const nuevaTarjeta = () => {
    const alias = h('input', { type: 'text', placeholder: 'Visa Bancolombia' });
    const ultimos4 = h('input', {
      type: 'text',
      inputmode: 'numeric',
      maxlength: '4',
      pattern: '\\d{4}',
      placeholder: '1234',
      autocomplete: 'off',
    });
    const franquicia = selector(
      [
        ['Visa', 'Visa'],
        ['Mastercard', 'Mastercard'],
        ['Amex', 'American Express'],
        ['Otra', 'Otra'],
      ],
      'Visa',
    );
    const cupo = entradaMonto({ placeholder: '5000000' });
    const saldo = entradaMonto({ placeholder: '0' });
    const corte = h('input', {
      type: 'number',
      inputmode: 'numeric',
      min: '1',
      max: '31',
      placeholder: '15',
    });
    const limite = h('input', {
      type: 'number',
      inputmode: 'numeric',
      min: '1',
      max: '31',
      placeholder: '30',
    });
    const tasa = h('input', {
      type: 'number',
      inputmode: 'decimal',
      min: '0',
      step: '0.01',
      placeholder: '26.82',
    });
    const manejo = entradaMonto({ placeholder: '0' });
    const guardar = accion(async () => {
      const d = {
        alias: alias.value.trim(),
        ultimos4: ultimos4.value.trim(),
        diaCorte: Number(corte.value),
        diaLimitePago: Number(limite.value),
        tasaEA: Number(tasa.value),
        cupoTotal: aEntero(cupo.value),
      };
      if (!d.alias) throw new Error('Escribe un alias');
      if (!/^\d{4}$/.test(d.ultimos4)) throw new Error('Escribe solo los últimos 4 dígitos');
      if (!(d.diaCorte >= 1 && d.diaCorte <= 31 && d.diaLimitePago >= 1 && d.diaLimitePago <= 31))
        throw new Error('Los días deben estar entre 1 y 31');
      if (!(d.cupoTotal > 0)) throw new Error('Escribe el cupo total');
      if (!(tasa.value !== '' && d.tasaEA >= 0)) throw new Error('Escribe la tasa efectiva anual');
      ctx.datos().tarjetas.push({
        ...d,
        id: ctx.uid('c'),
        banco: 'Bancolombia',
        franquicia: franquicia.value,
        saldoInicial: aEntero(saldo.value),
        cuotaManejo: aEntero(manejo.value),
        estado: 'activa',
      });
      formularioAbierto = false;
      await ctx.guardar();
      ctx.toast('Tarjeta guardada');
      ctx.renderAll();
    });
    return h(
      'div',
      { class: 'formulario' },
      campo('Alias', alias),
      campo('Últimos 4 dígitos', ultimos4),
      campo('Franquicia', franquicia),
      campo('Cupo total', cupo),
      campo('Deuda actual', saldo),
      campo('Día de corte', corte),
      campo('Día límite de pago', limite),
      campo('Tasa efectiva anual (%)', tasa),
      campo('Cuota de manejo mensual', manejo),
      h(
        'p',
        { class: 'nota' },
        'Nunca escribas el número completo, el CVV ni claves. La app no los necesita.',
      ),
      h('button', { class: 'btn-accent', onclick: guardar }, 'Guardar tarjeta'),
    );
  };

  function formPago(t, saldo) {
    const datos = ctx.datos();
    if (!datos.accounts.length)
      return h('p', { class: 'nota' }, 'Crea una cuenta en Ahorro para registrar pagos.');
    const cuenta = selector(
      datos.accounts.map((a) => [a.id, a.name]),
      datos.accounts[0].id,
    );
    const valor = entradaMonto({ placeholder: 'Monto', 'aria-label': 'Monto del pago' });
    const minimo = pagoMinimoEstimado(saldo, t.tasaEA);
    const registrar = accion(async () => {
      const amount = aEntero(valor.value);
      if (amount <= 0) throw new Error('Escribe el monto del pago');
      const c = datos.accounts.find((a) => a.id === cuenta.value);
      const disponible = saldoCuenta(c, datos.transactions);
      if (
        amount > disponible &&
        !(await ctx.preguntar(`La cuenta tiene ${formatear(disponible)}, menos que el pago. ¿Continuar?`))
      )
        return;
      if (
        amount > saldo &&
        !(await ctx.preguntar(
          `El pago supera la deuda de ${formatear(saldo)} y dejaría saldo a favor. ¿Continuar?`,
        ))
      )
        return;
      datos.transactions.push({
        id: ctx.uid('t'),
        date: diaBogota(),
        type: 'pago_tarjeta',
        amount,
        accountId: c.id,
        tarjetaId: t.id,
        category: '',
        note: '',
        origen: 'manual',
        estado: 'confirmado',
        fuentes: [],
      });
      datos.ciclos = actualizarCiclos(datos.ciclos, datos.transactions, t.id);
      await ctx.guardar();
      ctx.toast('Pago registrado. No cuenta como gasto.');
      ctx.renderAll();
    });
    return h(
      'div',
      { class: 'formulario' },
      campo('Desde', cuenta),
      valor,
      h(
        'div',
        { class: 'btn-row' },
        h(
          'button',
          {
            class: 'btn-ghost',
            onclick: () => {
              valor.value = minimo;
            },
          },
          `Mínimo ${formatear(minimo)}`,
        ),
        h(
          'button',
          {
            class: 'btn-ghost',
            onclick: () => {
              valor.value = Math.max(0, saldo);
            },
          },
          'Total',
        ),
      ),
      h('button', { class: 'btn-accent', onclick: registrar }, 'Registrar pago'),
    );
  }

  function formExtracto(t) {
    const fechaCorte = h('input', { type: 'date', value: proximasFechas(t).corte });
    const limite = h('input', { type: 'date', value: proximasFechas(t).limitePago });
    const total = entradaMonto({ placeholder: 'Pago total' });
    const minimo = entradaMonto({ placeholder: 'Pago mínimo' });
    const interes = entradaMonto({ placeholder: 'Intereses cobrados' });
    const guardar = accion(async () => {
      const datos = ctx.datos();
      if (!fechaCorte.value || !limite.value) throw new Error('Escribe las fechas del extracto');
      if (limite.value < fechaCorte.value) throw new Error('La fecha límite no puede ser anterior al corte');
      if (aEntero(total.value) <= 0) throw new Error('Escribe el pago total del extracto');
      if (aEntero(minimo.value) > aEntero(total.value))
        throw new Error('El pago mínimo no puede superar el total');
      datos.ciclos.push({
        id: ctx.uid('ci'),
        tarjetaId: t.id,
        fechaCorte: fechaCorte.value,
        fechaLimitePago: limite.value,
        saldoAlCorte: aEntero(total.value),
        pagoMinimo: aEntero(minimo.value),
        pagoTotal: aEntero(total.value),
        pagado: false,
        interesesCausados: aEntero(interes.value),
      });
      if (aEntero(interes.value) > 0) {
        datos.transactions.push({
          id: ctx.uid('t'),
          date: fechaCorte.value,
          type: 'interes',
          amount: aEntero(interes.value),
          tarjetaId: t.id,
          accountId: null,
          category: 'Deudas',
          note: 'Intereses del extracto',
          origen: 'manual',
          estado: 'confirmado',
          fuentes: [],
        });
      }
      await ctx.guardar();
      ctx.toast('Extracto guardado');
      ctx.renderAll();
    });
    return h(
      'details',
      { class: 'detalle' },
      h('summary', {}, 'Registrar extracto'),
      h(
        'div',
        { class: 'formulario' },
        campo('Fecha de corte', fechaCorte),
        campo('Fecha límite', limite),
        campo('Pago total', total),
        campo('Pago mínimo', minimo),
        campo('Intereses', interes),
        h('button', { class: 'btn-ghost', onclick: guardar }, 'Guardar extracto'),
      ),
    );
  }

  function tarjetaVisual(t) {
    const datos = ctx.datos();
    const saldo = saldoTarjeta(t, datos.transactions);
    const uso = utilizacion(t, saldo);
    const fechas = proximasFechas(t);
    const ciclo = cicloVigente(datos.ciclos, t.id);
    const alertas = alertasTarjeta(t, saldo, { cicloActual: ciclo });
    const costo = saldo > 0 ? costoPagoMinimo(saldo, t.tasaEA) : null;
    const diferidas = datos.comprasDiferidas.filter(
      (c) => c.tarjetaId === t.id && estadoDiferida(c).restantes > 0,
    );
    const etiquetaUso = { verde: 'uso sano', ambar: 'uso medio', rojo: 'uso alto' }[uso.color];
    return h(
      'article',
      { class: 'tarjeta-visual' },
      h(
        'div',
        { class: 'tv-cara' },
        h('div', { class: 'tv-alias' }, t.alias),
        h('div', { class: 'tv-deuda' }, h('small', {}, 'Debes hoy'), monto(saldo)),
        h('div', { class: 'tv-numero' }, `•••• ${t.ultimos4}`),
      ),
      h(
        'div',
        { class: 'tv-cifras' },
        h('div', {}, h('small', {}, 'Disponible'), monto(cupoDisponible(t, saldo))),
        h('div', {}, h('small', {}, 'Cupo total'), monto(t.cupoTotal)),
      ),
      h(
        'div',
        {
          class: 'barra-uso',
          role: 'progressbar',
          'aria-valuenow': String(Math.min(100, uso.porcentaje)),
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-label': `Utilización del cupo: ${uso.porcentaje} %, ${etiquetaUso}`,
        },
        h('div', {
          class: `barra-uso-relleno ${uso.color}`,
          style: { width: `${Math.min(100, uso.porcentaje)}%` },
        }),
      ),
      h(
        'p',
        { class: 'nota' },
        `${uso.porcentaje} % de uso (${etiquetaUso}). Corte el ${fechaLegible(fechas.corte)}. Paga antes del ${fechaLegible(fechas.limitePago)}.`,
      ),
      alertas.map((a) =>
        h('div', { class: `chip ${a.nivel === 'urgente' ? 'chip-urgente' : 'chip-aviso'}` }, a.mensaje),
      ),
      costo
        ? h(
            'p',
            { class: 'nota' },
            costo.liquidable
              ? `Pagando solo el mínimo: ${costo.meses} meses y ${formatear(costo.intereses)} en intereses, a ${(tasaMensual(t.tasaEA) * 100).toFixed(2)} % mensual.`
              : 'Con el pago mínimo estimado, esta deuda no se terminaría de pagar.',
          )
        : null,
      diferidas.length ? h('div', {}, h('h3', {}, 'Compras a cuotas'), diferidas.map(filaDiferida)) : null,
      h('details', { class: 'detalle' }, h('summary', {}, 'Registrar pago'), formPago(t, saldo)),
      formExtracto(t),
      h(
        'button',
        {
          class: 'btn-ghost peligro',
          onclick: accion(async () => {
            if (
              !(await ctx.preguntar(`¿Cerrar ${t.alias}? Deja de sumar al pasivo; su historial se conserva.`))
            )
              return;
            t.estado = 'cerrada';
            await ctx.guardar();
            ctx.renderAll();
          }),
        },
        'Cerrar tarjeta',
      ),
    );
  }

  function filaDiferida(c) {
    const e = estadoDiferida(c);
    const mov = ctx.datos().transactions.find((t) => t.id === c.movimientoId);
    const { valorCuota, totalIntereses } = amortizacion(c.montoOriginal, c.nCuotas, c.tasaEA);
    return h(
      'div',
      { class: 'fila-simple' },
      h(
        'div',
        {},
        h('b', {}, mov?.comercio || 'Compra'),
        h(
          'div',
          { class: 'nota' },
          `Cuota ${formatear(valorCuota)}, faltan ${e.restantes} de ${c.nCuotas}. Saldo ${formatear(e.saldoPendiente)}. Intereses totales ${formatear(totalIntereses)}.`,
        ),
      ),
      h(
        'button',
        {
          class: 'btn-ghost',
          onclick: accion(async () => {
            c.cuotasPagadas = (c.cuotasPagadas || 0) + 1;
            await ctx.guardar();
            ctx.renderAll();
          }),
        },
        '+1 cuota',
      ),
    );
  }

  /* ---------- Otras deudas ---------- */
  /**
   * Abono a un préstamo. De cada pago, una parte es interés (gasto del mes) y el resto baja la
   * deuda; por eso se guardan como dos movimientos. Se sugiere el interés de un mes.
   */
  function formAbonoDeuda(d, saldoHoy) {
    const datos = ctx.datos();
    if (!datos.accounts.length)
      return h('p', { class: 'nota' }, 'Crea una cuenta en Ahorro para registrar abonos.');
    const cuenta = selector(
      datos.accounts.map((a) => [a.id, a.name]),
      datos.accounts[0].id,
    );
    const valor = entradaMonto({ placeholder: formatear(d.pagoMinimo || 0) });
    const interes = entradaMonto({ value: String(Math.round(saldoHoy * tasaMensual(d.tasaEA || 0))) });
    const registrar = accion(async () => {
      const total = aEntero(valor.value);
      if (total <= 0) throw new Error('Escribe cuánto pagaste');
      const parteInteres = Math.min(Math.max(0, aEntero(interes.value)), total);
      const capital = total - parteInteres;
      if (capital > saldoHoy)
        throw new Error(
          `El abono a capital (${formatear(capital)}) supera lo que debes (${formatear(saldoHoy)})`,
        );
      const c = datos.accounts.find((a) => a.id === cuenta.value);
      const disponible = saldoCuenta(c, datos.transactions);
      if (
        total > disponible &&
        !(await ctx.preguntar(`La cuenta tiene ${formatear(disponible)}, menos que el pago. ¿Continuar?`))
      )
        return;
      const base = {
        date: diaBogota(),
        accountId: c.id,
        deudaId: d.id,
        tarjetaId: null,
        comercio: '',
        note: '',
        origen: 'manual',
        estado: 'confirmado',
        fuentes: [],
      };
      if (parteInteres > 0)
        datos.transactions.push({
          ...base,
          id: ctx.uid('t'),
          type: 'interes',
          amount: parteInteres,
          category: 'Deudas',
        });
      if (capital > 0)
        datos.transactions.push({
          ...base,
          id: ctx.uid('t'),
          type: 'pago_deuda',
          amount: capital,
          category: '',
        });
      await ctx.guardar();
      ctx.toast(
        `Abono registrado: ${formatear(capital)} a capital y ${formatear(parteInteres)} de intereses`,
      );
      ctx.renderAll();
    });
    return h(
      'div',
      { class: 'formulario' },
      campo('Desde', cuenta),
      campo('Valor total que pagaste', valor),
      campo('De ese valor, intereses', interes),
      h(
        'p',
        { class: 'nota' },
        'Solo los intereses cuentan como gasto; el resto baja la deuda. El valor sugerido es el interés de un mes: ajústalo con tu extracto si es distinto.',
      ),
      h('button', { class: 'btn-accent', onclick: registrar }, 'Registrar abono'),
    );
  }

  function vistaDeudas() {
    const datos = ctx.datos();
    const nombre = h('input', { type: 'text', placeholder: 'Préstamo de libranza' });
    const tipo = selector(
      [
        ['prestamo', 'Préstamo'],
        ['libranza', 'Libranza'],
        ['consumo', 'Consumo'],
        ['informal', 'Informal'],
      ],
      'prestamo',
    );
    const saldo = entradaMonto({ placeholder: 'Saldo' });
    const tasa = h('input', {
      type: 'number',
      inputmode: 'decimal',
      min: '0',
      step: '0.01',
      placeholder: 'Tasa EA %',
    });
    const pago = entradaMonto({ placeholder: 'Pago mensual mínimo' });
    const agregar = accion(async () => {
      if (!nombre.value.trim() || aEntero(saldo.value) <= 0 || tasa.value === '')
        throw new Error('Completa nombre, saldo y tasa');
      datos.deudas.push({
        id: ctx.uid('de'),
        nombre: nombre.value.trim(),
        tipo: tipo.value,
        saldo: aEntero(saldo.value),
        tasaEA: Number(tasa.value),
        pagoMinimo: aEntero(pago.value),
      });
      await ctx.guardar();
      ctx.renderAll();
    });
    return h(
      'div',
      {},
      encabezado('Otras deudas', 'pasivo'),
      h(
        'div',
        { class: 'card' },
        datos.deudas.length
          ? datos.deudas.map((d) => {
              const saldoHoy = saldoDeuda(d, datos.transactions);
              const pagado = aEntero(d.saldo) - saldoHoy;
              return h(
                'div',
                { class: 'presupuesto' },
                h(
                  'div',
                  { class: 'fila-simple' },
                  h(
                    'div',
                    {},
                    h('b', {}, d.nombre),
                    h(
                      'div',
                      { class: 'nota' },
                      `${d.tipo}, ${d.tasaEA} % EA, cuota ${formatear(d.pagoMinimo)}`,
                    ),
                  ),
                  monto(saldoHoy),
                  h(
                    'button',
                    {
                      class: 'quitar',
                      'aria-label': `Eliminar ${d.nombre}`,
                      onclick: accion(async () => {
                        if (!(await ctx.preguntar(`¿Eliminar la deuda ${d.nombre}?`))) return;
                        datos.deudas = datos.deudas.filter((x) => x.id !== d.id);
                        await ctx.guardar();
                        ctx.renderAll();
                      }),
                    },
                    '✕',
                  ),
                ),
                pagado > 0
                  ? h(
                      'p',
                      { class: 'nota' },
                      saldoHoy > 0
                        ? `Has abonado ${formatear(pagado)} a capital de ${formatear(d.saldo)}.`
                        : 'Deuda saldada. Puedes eliminarla cuando quieras.',
                    )
                  : null,
                saldoHoy > 0
                  ? h(
                      'details',
                      { class: 'detalle' },
                      h('summary', {}, `Registrar abono a ${d.nombre}`),
                      formAbonoDeuda(d, saldoHoy),
                    )
                  : null,
              );
            })
          : vacio('Sin otras deudas', 'Agrega préstamos o libranzas para verlos en tu pasivo.'),
        h(
          'details',
          { class: 'detalle' },
          h('summary', {}, 'Agregar deuda'),
          h(
            'div',
            { class: 'formulario' },
            campo('Nombre', nombre),
            campo('Tipo', tipo),
            campo('Saldo', saldo),
            campo('Tasa efectiva anual (%)', tasa),
            campo('Pago mínimo', pago),
            h('button', { class: 'btn-accent', onclick: agregar }, 'Guardar deuda'),
          ),
        ),
      ),
    );
  }

  /** Reúne tarjetas y deudas en el formato del simulador. */
  function deudasParaSimular() {
    const datos = ctx.datos();
    const tarjetas = datos.tarjetas
      .filter((t) => t.estado !== 'cerrada')
      .map((t) => {
        const saldo = saldoTarjeta(t, datos.transactions);
        return {
          id: t.id,
          nombre: t.alias,
          saldo: Math.max(0, saldo),
          tasaEA: t.tasaEA,
          pagoMinimo: pagoMinimoEstimado(saldo, t.tasaEA),
        };
      });
    return [
      ...tarjetas,
      ...datos.deudas.map((d) => ({
        id: d.id,
        nombre: d.nombre,
        saldo: saldoDeuda(d, datos.transactions),
        tasaEA: d.tasaEA,
        pagoMinimo: d.pagoMinimo || 0,
      })),
    ].filter((d) => d.saldo > 0);
  }

  function vistaSimulador() {
    const deudas = deudasParaSimular();
    if (!deudas.length) return null;
    const mes = diaBogota().slice(0, 7);
    const minimos = deudas.reduce((s, d) => s + d.pagoMinimo, 0);
    const entrada = entradaMonto({ placeholder: `Mínimos: ${formatear(minimos)}`, value: presupuestoSim });
    const resultado = h('div', {});
    const calcular = () => {
      presupuestoSim = entrada.value;
      const valor = aEntero(entrada.value) || minimos;
      const r = compararEstrategias(deudas, valor, mes);
      if (!r.avalancha.factible) {
        montar(resultado, h('div', { class: 'chip chip-aviso' }, r.avalancha.motivo));
        return;
      }
      const fila = (nombre, x) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, nombre),
          h('td', {}, x.fechaLibertad),
          h('td', {}, String(x.meses)),
          h('td', { class: 'monto' }, formatear(x.intereses)),
          h('td', { class: 'monto' }, x.interesesAhorrados == null ? 'n/d' : formatear(x.interesesAhorrados)),
        );
      montar(
        resultado,
        graficoLineas(
          [
            { nombre: 'Avalancha', valores: r.avalancha.serie, color: COLORES.avalancha },
            {
              nombre: 'Bola de nieve',
              valores: r.bola_de_nieve.serie,
              color: COLORES.bola_de_nieve,
              punteada: true,
            },
          ],
          `Deuda total, ${r.avalancha.meses} meses`,
        ),
        h(
          'div',
          { class: 'tabla-scroll' },
          h(
            'table',
            { class: 'tabla' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                ['Estrategia', 'Libre en', 'Meses', 'Intereses', 'Ahorro vs. mínimos'].map((t) =>
                  h('th', { scope: 'col' }, t),
                ),
              ),
            ),
            h('tbody', {}, fila('Avalancha', r.avalancha), fila('Bola de nieve', r.bola_de_nieve)),
          ),
        ),
        r.soloMinimos.factible
          ? null
          : h('p', { class: 'nota' }, 'Pagando solo los mínimos, la deuda no se liquidaría.'),
      );
    };
    const vista = h(
      'div',
      {},
      encabezado('Simulador de deuda', 'estrategias'),
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'formulario' },
          campo('Presupuesto mensual para deudas', entrada),
          h('button', { class: 'btn-accent', onclick: calcular }, 'Simular'),
        ),
        resultado,
      ),
    );
    calcular();
    return vista;
  }

  function vistaFlujo() {
    const datos = ctx.datos();
    const hoy = diaBogota().slice(0, 7);
    const ingresos = [1, 2, 3].map((k) => estadisticasMes(datos.transactions, sumarMeses(hoy, -k)).income);
    const conDatos = ingresos.filter((x) => x > 0);
    const ingresoMensual = conDatos.length
      ? Math.round(conDatos.reduce((a, b) => a + b, 0) / conDatos.length)
      : 0;
    const recurrentes = detectarRecurrentes(datos.transactions, hoy);
    if (!ingresoMensual && !recurrentes.length && !datos.comprasDiferidas.length) return null;
    // Los mínimos de otras deudas son salidas fijas; los de tarjeta no se suman porque ya están en sus cuotas.
    const fijos = [
      ...recurrentes,
      ...datos.deudas
        .filter((d) => saldoDeuda(d, datos.transactions) > 0)
        .map((d) => ({ monto: d.pagoMinimo || 0 })),
    ];
    const filas = flujoCaja({
      mesInicio: hoy,
      meses: 6,
      ingresoMensual,
      recurrentes: fijos,
      diferidas: datos.comprasDiferidas,
    });
    return h(
      'div',
      {},
      encabezado('Flujo de caja', '6 meses'),
      h(
        'div',
        { class: 'card' },
        h(
          'p',
          { class: 'nota' },
          'Ingreso: promedio de los últimos 3 meses con datos. La columna de fijos suma recurrentes y mínimos de otras deudas. No incluye gastos variables ni pagos de tarjeta distintos a sus cuotas.',
        ),
        h(
          'div',
          { class: 'tabla-scroll' },
          h(
            'table',
            { class: 'tabla' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                ['Mes', 'Ingresos', 'Cuotas', 'Fijos', 'Neto'].map((t) => h('th', { scope: 'col' }, t)),
              ),
            ),
            h(
              'tbody',
              {},
              filas.map((f) =>
                h(
                  'tr',
                  {},
                  h('th', { scope: 'row' }, f.mes),
                  [f.ingresos, f.cuotas, f.recurrentes, f.neto].map((v) =>
                    h('td', { class: 'monto' }, formatear(v)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function vistaComparador() {
    const datos = ctx.datos();
    const cdts = datos.investments;
    const montoEl = entradaMonto({ placeholder: '1000000', value: '1000000' });
    const tasaT = h('input', {
      type: 'number',
      inputmode: 'decimal',
      step: '0.01',
      value: String(datos.tarjetas.find((t) => t.estado !== 'cerrada')?.tasaEA ?? 26.82),
    });
    const tasaC = h('input', {
      type: 'number',
      inputmode: 'decimal',
      step: '0.01',
      value: String(cdts[0]?.rate ?? 10),
    });
    const meses = h('input', { type: 'number', inputmode: 'numeric', min: '1', value: '12' });
    const salida = h('div', { role: 'status' });
    const calcular = () => {
      const r = pagarVsCdt({
        monto: aEntero(montoEl.value),
        tasaTarjetaEA: Number(tasaT.value),
        tasaCdtEA: Number(tasaC.value),
        meses: Number(meses.value) || 12,
      });
      montar(
        salida,
        h(
          'div',
          { class: 'panel-kpis' },
          h(
            'div',
            { class: 'kpi' },
            h('div', { class: 'kpi-valor monto' }, formatear(r.interesEvitado)),
            h('div', { class: 'kpi-etiqueta' }, 'Intereses que evitas pagando la tarjeta'),
          ),
          h(
            'div',
            { class: 'kpi' },
            h('div', { class: 'kpi-valor monto' }, formatear(r.rendimientoCdt)),
            h('div', { class: 'kpi-etiqueta' }, 'Rendimiento del CDT tras retención del 4 %'),
          ),
        ),
        h(
          'p',
          { class: 'nota' },
          `Diferencia: ${formatear(r.diferencia)}. Es un cálculo aproximado, sin otros factores como liquidez o emergencias.`,
        ),
      );
    };
    calcular();
    return h(
      'div',
      {},
      encabezado('Pagar tarjeta o invertir en CDT', 'comparador'),
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'formulario' },
          campo('Monto', montoEl),
          campo('Tasa de la tarjeta (% EA)', tasaT),
          campo('Tasa del CDT (% EA)', tasaC),
          campo('Plazo (meses)', meses),
          h('button', { class: 'btn-ghost', onclick: calcular }, 'Comparar'),
        ),
        salida,
      ),
    );
  }

  function render() {
    const tarjetas = ctx.datos().tarjetas.filter((t) => t.estado !== 'cerrada');
    montar(
      'vistaTarjetas',
      encabezado('Tarjetas de crédito', 'pasivo'),
      h(
        'div',
        { class: 'card' },
        tarjetas.length
          ? tarjetas.map(tarjetaVisual)
          : vacio('Sin tarjetas', 'Agrégalas para ver tu deuda, las fechas de pago y las compras a cuotas.'),
        h(
          'details',
          {
            class: 'detalle',
            open: formularioAbierto,
            ontoggle: (e) => {
              formularioAbierto = e.target.open;
            },
          },
          h('summary', {}, 'Agregar tarjeta'),
          nuevaTarjeta(),
        ),
      ),
      vistaDeudas(),
      vistaSimulador(),
      vistaFlujo(),
      vistaComparador(),
    );
  }

  return { render };
}
