/**
 * Pantallas originales de la app: cuentas, bolsillos, metas, CDT, historial y reportes.
 * Las reglas de dinero viven en js/domain; las pantallas nuevas, en js/ui.
 */
import { aEntero, formatear } from './domain/money.js';
import { CATEGORIAS_GASTO, CATEGORIAS_INGRESO } from './domain/categorias.js';
import { saldoCuenta, estadisticasMes, cuenta as esVigente, textoTasaAhorro } from './domain/movimientos.js';
import { patrimonio } from './domain/presupuesto.js';
import { proyeccionCdt } from './domain/deudas.js';
import { diaBogota } from './domain/fechas.js';
import { sincronizarCiclos } from './domain/tarjetas.js';
import { cargar, guardar as guardarDb } from './db.js';
import { migrar } from './services/migraciones.js';
import { exportable, validarCopia, cifrar, descifrar, estaCifrado } from './services/backup.js';
import { agregados, promptReporte } from './services/reportes.js';
import { aprender } from './services/categorizacion.js';
import { registrarDiferida } from './services/ingesta.js';
import { proyeccionCierre, comparativoCategorias } from './domain/analisis.js';
import { metaAhorro } from './domain/salud.js';
import { iniciarInterfaz } from './ui/principal.js';
import { activarCombobox } from './ui/combobox.js';
import { iconoHtml } from './ui/iconos.js';


  const EXPENSE_CATEGORIES = CATEGORIAS_GASTO;
  const INCOME_CATEGORIES = CATEGORIAS_INGRESO;

  let data = {
    accounts: [],
    pockets: [],
    transactions: [],
    goals: [],
    investments: [],
    reports: [],
    settings: { reminderOn:false, reminderHour:20, lastNotified:null, lastReportMonth:null }
  };
  const interfaz = { render(){}, alEliminar(){} };
  const TIPO_CUENTA = { Ahorros:'ahorros', Corriente:'corriente', Efectivo:'efectivo', Digital:'billetera' };
  const HISTORY_PAGE = 60;
  let historyLimit = HISTORY_PAGE;
  let currentTxType = 'income';
  let historyMonthKey = hoyKey().slice(0,7);
  let extraShown = false, goalFormShown = false, invFormShown = false, accFormShown = false, pocketFormShown = false;

  function pad(n){ return String(n).padStart(2,'0'); }
  function toKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function fromKey(k){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d); }
  // "Hoy" siempre en hora de Bogotá, como los mensajes del banco y el panel: un celular en otra zona
  // (de viaje o mal configurado) no debe ver un mes en una pantalla y otro en la de al lado.
  function hoyKey(){ return diaBogota(); }
  function monthOf(key){ return key.slice(0,7); }
  const formatCOP = formatear;
  function addMonths(monthKey, n){
    const [y,m] = monthKey.split('-').map(Number);
    const d = new Date(y, m-1+n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  }
  function monthLabel(monthKey){
    const [y,m] = monthKey.split('-').map(Number);
    return new Date(y, m-1, 1).toLocaleDateString('es-CO', {month:'long', year:'numeric'});
  }
  function uid(prefix){ return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  // Paleta categórica distinguible con daltonismo y legible en claro y oscuro. Sin verde ni rojo:
  // el verde es la marca y los ingresos; el rojo, las alertas.
  const CATEGORIA_COLORES = ['#3987E5', '#C98500', '#8A63D2', '#D95926', '#1396A8', '#B8578F'];
  const ICONO_CUENTA = { ahorros:'banco', corriente:'banco', efectivo:'efectivo', billetera:'billetera' };
  const HISTORY_FILTROS = {
    todos: ()=>true,
    ingresos: t=>t.type==='income' || t.type==='withdraw_out',
    gastos: t=>['expense','interes','cuota_manejo'].includes(t.type),
    traslados: t=>['transferencia','pago_tarjeta','pago_deuda','avance','transfer_in'].includes(t.type),
  };
  let historyFiltro = 'todos';
  let historyBusqueda = '';

  // Si los datos no se pudieron leer, no se guarda nada encima (ver init).
  let bloqueoGuardado = null;
  async function saveData(){
    if(bloqueoGuardado) throw new Error(bloqueoGuardado);
    // Un pago puede llegar por el banco, por revisión o a mano: el estado de los ciclos se recalcula siempre.
    sincronizarCiclos(data);
    await guardarDb(data);
  }

  function descargar(nombre, contenido, tipo){
    const url = URL.createObjectURL(new Blob([contenido], {type:tipo}));
    const a = document.createElement('a'); a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function showToast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'), 1800);
  }

  // ---- Confirmación genérica (saldo insuficiente, etc.) ----
  let confirmResolver = null;
  function askConfirm(text){
    document.getElementById('confirmText').textContent = text;
    document.getElementById('confirmOverlay').classList.add('show');
    return new Promise(resolve=>{ confirmResolver = resolve; });
  }
  document.getElementById('confirmCancelBtn').addEventListener('click', ()=>{
    document.getElementById('confirmOverlay').classList.remove('show');
    if(confirmResolver) confirmResolver(false); confirmResolver = null;
  });
  document.getElementById('confirmOkBtn').addEventListener('click', ()=>{
    document.getElementById('confirmOverlay').classList.remove('show');
    if(confirmResolver) confirmResolver(true); confirmResolver = null;
  });

  // ---- Transferencias vinculadas (abonos y retiros con doble contabilidad) ----
  // Un abono/retiro se guarda como DOS movimientos enlazados por transferencia_id:
  // uno que afecta la cuenta de origen/destino y otro que afecta el recurso
  // (bolsillo, meta o CDT). Así el saldo de cada lado siempre se puede recalcular
  // sumando/restando estos movimientos — no hay campos de saldo "sueltos".
  async function createTransfer({direction, amount, date, accountId, targetType, targetId, note}){
    const transferencia_id = uid('tr');
    if(direction==='in'){ // abono: cuenta -> recurso
      data.transactions.push({id:uid('t'), type:'transfer_out', date, amount, accountId, transferencia_id, targetType, targetId, note});
      data.transactions.push({id:uid('t'), type:'transfer_in', date, amount, targetType, targetId, transferencia_id, note});
    } else { // retiro: recurso -> cuenta
      data.transactions.push({id:uid('t'), type:'withdraw_out', date, amount, targetType, targetId, transferencia_id, note});
      data.transactions.push({id:uid('t'), type:'withdraw_in', date, amount, accountId, transferencia_id, note});
    }
    await saveData();
  }

  function targetLabel(type,id){
    if(type==='pocket'){ const p=data.pockets.find(x=>x.id===id); return p ? `bolsillo "${p.name}"` : 'bolsillo eliminado'; }
    if(type==='goal'){ const g=data.goals.find(x=>x.id===id); return g ? `meta "${g.name}"` : 'meta eliminada'; }
    if(type==='investment'){ const i=data.investments.find(x=>x.id===id); return i ? `CDT ${i.entity}` : 'CDT eliminado'; }
    return '';
  }

  async function handleAbono(accountId, amount, targetType, targetId){
    const acc = data.accounts.find(a=>a.id===accountId);
    if(!acc){ showToast('Selecciona una cuenta de origen'); return false; }
    if(!amount || amount<=0) return false;
    const bal = accountBalance(acc);
    if(amount > bal){
      const ok = await askConfirm(`La cuenta "${acc.name}" tiene un saldo disponible de ${formatCOP(bal)}, menor al abono de ${formatCOP(amount)}. ¿Deseas continuar de todas formas?`);
      if(!ok) return false;
    }
    await createTransfer({direction:'in', amount, date: hoyKey(), accountId, targetType, targetId, note:''});
    return true;
  }

  async function handleRetiro(accountId, amount, targetType, targetId){
    if(!amount || amount<=0) return false;
    let targetBal = 0;
    if(targetType==='pocket'){ const p=data.pockets.find(x=>x.id===targetId); targetBal = p ? pocketBalance(p) : 0; }
    else if(targetType==='goal'){ const g=data.goals.find(x=>x.id===targetId); targetBal = g ? goalOwnFunds(g) : 0; }
    else if(targetType==='investment'){ const i=data.investments.find(x=>x.id===targetId); targetBal = i ? investmentExtra(i) : 0; }
    if(amount > targetBal){
      const ok = await askConfirm(`El saldo disponible en ${targetLabel(targetType,targetId)} es de ${formatCOP(targetBal)}, menor al retiro de ${formatCOP(amount)}. ¿Deseas continuar de todas formas?`);
      if(!ok) return false;
    }
    await createTransfer({direction:'out', amount, date: hoyKey(), accountId: accountId||null, targetType, targetId, note:''});
    return true;
  }

  function targetBalanceRaw(targetType, targetId){
    return data.transactions.filter(t=>t.targetType===targetType && t.targetId===targetId).reduce((s,t)=>{
      if(t.type==='transfer_in') return s + t.amount;
      if(t.type==='withdraw_out') return s - t.amount;
      return s;
    }, 0);
  }
  function goalOwnFunds(g){
    const legacy = (g.contributions||[]).reduce((s,c)=>s+c.amount,0);
    return legacy + targetBalanceRaw('goal', g.id);
  }
  function investmentExtra(inv){ return targetBalanceRaw('investment', inv.id); }
  function investmentTotal(inv){ return (Number(inv.amount)||0) + investmentExtra(inv); }

  function accountTransferOptions(){
    return data.accounts.map(a=>`<option value="${escapeAttr(a.id)}">${escapeAttr(a.name)}</option>`).join('');
  }

  function deleteTransaction(t){
    if(t.transferencia_id){
      data.transactions = data.transactions.filter(x=>x.transferencia_id!==t.transferencia_id);
    } else {
      data.transactions = data.transactions.filter(x=>x.id!==t.id);
    }
  }
  // Una copia es un registro manual nuevo: no hereda la fuente del banco ni sus datos. Si heredara
  // `fuentes`, el mensaje real de ese nuevo gasto no se conciliaría con ella y se contaría dos veces.
  function copiaManual(t, extra){
    const { fuentes, origen, hora, referenciaBanco, conciliarCon, divididoDe, montoIngerido, tipoMensaje, confianza, ultimos4, estado, ...resto } = t;
    return { ...resto, ...extra, id: uid('t'), date: hoyKey(), origen: 'manual', fuentes: [], estado: 'confirmado' };
  }
  function duplicateTransaction(t){
    if(t.transferencia_id){
      const pair = data.transactions.find(x=>x.transferencia_id===t.transferencia_id && x.id!==t.id);
      const newTid = uid('tr');
      data.transactions.push(copiaManual(t, { transferencia_id:newTid }));
      if(pair) data.transactions.push(copiaManual(pair, { transferencia_id:newTid }));
    } else {
      data.transactions.push(copiaManual(t, {}));
    }
  }

  function populateCategoryDatalist(){
    const usedIncome = data.transactions.filter(t=>t.type==='income').map(t=>t.category).filter(Boolean);
    const usedExpense = data.transactions.filter(t=>t.type==='expense').map(t=>t.category).filter(Boolean);
    const incomeCats = [...new Set([...INCOME_CATEGORIES, ...usedIncome])];
    const expenseCats = [...new Set([...EXPENSE_CATEGORIES, ...usedExpense])];
    document.getElementById('incomeCategoryList').innerHTML = incomeCats.map(c=>`<option value="${escapeAttr(c)}">`).join('');
    document.getElementById('expenseCategoryList').innerHTML = expenseCats.map(c=>`<option value="${escapeAttr(c)}">`).join('');
    const txCat = document.getElementById('txCategory');
    if(txCat) txCat.setAttribute('list', currentTxType==='income' ? 'incomeCategoryList' : 'expenseCategoryList');
  }
  function populatePocketAccountSelect(){
    const sel = document.getElementById('pocketAccount');
    if(!sel) return;
    if(data.accounts.length===0){
      sel.innerHTML = '<option value="">Sin cuenta</option>';
      return;
    }
    sel.innerHTML = data.accounts.map(a=>`<option value="${escapeAttr(a.id)}">${escapeAttr(a.name)}</option>`).join('');
  }

  function populateAccountSelect(){
    const sel = document.getElementById('txAccount');
    const valor = sel.value;
    const tarjetas = data.tarjetas.filter(t=>t.estado!=='cerrada').map(t=>`<option value="tarjeta:${escapeAttr(t.id)}">Tarjeta ${escapeAttr(t.alias)}</option>`).join('');
    const cuentas = data.accounts.map(a=>`<option value="${escapeAttr(a.id)}">${escapeAttr(a.name)}</option>`).join('');
    // Un traslado sale de una cuenta propia; un gasto también puede ir a una tarjeta.
    sel.innerHTML = currentTxType==='transfer'
      ? '<option value="">Cuenta de origen</option>' + cuentas
      : '<option value="">Sin cuenta</option>' + cuentas + tarjetas;
    if([...sel.options].some(o=>o.value===valor)) sel.value = valor;
    const destino = document.getElementById('txDestino');
    const valorDestino = destino.value;
    destino.innerHTML = '<option value="">Cuenta de destino</option>' + cuentas;
    if([...destino.options].some(o=>o.value===valorDestino)) destino.value = valorDestino;
  }

  function ajustarFormularioRegistro(){
    const esTraslado = currentTxType==='transfer';
    document.querySelectorAll('#typeToggle .type-pill').forEach(p=>{
      p.classList.toggle('active', p.dataset.type===currentTxType);
      p.setAttribute('aria-pressed', String(p.dataset.type===currentTxType));
    });
    // Mover dinero entre cuentas propias no es ingreso ni gasto: no lleva categoría, comercio ni cuotas.
    document.getElementById('txCategory').hidden = esTraslado;
    document.getElementById('txDetalleFila').hidden = esTraslado;
    document.getElementById('txDestinoFila').hidden = !esTraslado;
    document.getElementById('txMethod').hidden = esTraslado;
    populateCategoryDatalist();
    populateAccountSelect();
  }
  document.getElementById('typeToggle').addEventListener('click', (e)=>{
    const pill = e.target.closest('.type-pill'); if(!pill) return;
    currentTxType = pill.dataset.type;
    ajustarFormularioRegistro();
  });

  document.getElementById('txExtraToggle').addEventListener('click', ()=>{
    extraShown = !extraShown;
    document.getElementById('txExtraFields').classList.toggle('show', extraShown);
    document.getElementById('txExtraToggle').textContent = extraShown ? '– ocultar detalle' : '+ agregar método o nota';
  });
  document.getElementById('goalFormToggle').addEventListener('click', ()=>{
    goalFormShown = !goalFormShown;
    document.getElementById('goalFormFields').classList.toggle('show', goalFormShown);
    document.getElementById('goalFormToggle').textContent = goalFormShown ? '– cancelar' : '+ nueva meta';
  });
  document.getElementById('invFormToggle').addEventListener('click', ()=>{
    invFormShown = !invFormShown;
    document.getElementById('invFormFields').classList.toggle('show', invFormShown);
    document.getElementById('invFormToggle').textContent = invFormShown ? '– cancelar' : '+ nuevo CDT';
  });
  document.getElementById('accFormToggle').addEventListener('click', ()=>{
    accFormShown = !accFormShown;
    document.getElementById('accFormFields').classList.toggle('show', accFormShown);
    document.getElementById('accFormToggle').textContent = accFormShown ? '– cancelar' : '+ agregar cuenta';
  });
  document.getElementById('pocketFormToggle').addEventListener('click', ()=>{
    pocketFormShown = !pocketFormShown;
    document.getElementById('pocketFormFields').classList.toggle('show', pocketFormShown);
    document.getElementById('pocketFormToggle').textContent = pocketFormShown ? '– cancelar' : '+ agregar bolsillo';
    if(pocketFormShown) populatePocketAccountSelect();
  });

  // ---- Edición genérica (cuentas, bolsillos, metas, CDT) ----
  function escapeAttr(str){
    return String(str==null?'':str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  let editModalState = null;

  function closeEditModal(){
    editModalState = null;
    document.getElementById('editModalOverlay').classList.remove('show');
  }
  document.getElementById('editModalCloseBtn').addEventListener('click', closeEditModal);
  document.getElementById('editModalCancelBtn').addEventListener('click', closeEditModal);
  document.getElementById('editModalOverlay').addEventListener('click', (e)=>{
    if(e.target.id==='editModalOverlay') closeEditModal();
  });

  function openEditModal(type, id){
    editModalState = { type, id };
    const titleEl = document.getElementById('editModalTitle');
    const fieldsEl = document.getElementById('editModalFields');

    if(type==='account'){
      const acc = data.accounts.find(a=>a.id===id); if(!acc) return;
      titleEl.textContent = 'Editar cuenta';
      const opts = ['Ahorros','Corriente','Efectivo','Digital'];
      fieldsEl.innerHTML = `
        <div class="modal-field"><label>Nombre</label><input type="text" id="editAccName" value="${escapeAttr(acc.name)}"></div>
        <div class="modal-field"><label>Tipo</label><select id="editAccType">
          ${opts.map(o=>`<option value="${o}" ${acc.type===o?'selected':''}>${o==='Digital'?'Billetera digital':o}</option>`).join('')}
        </select></div>
        <div class="modal-field"><label>Saldo inicial (COP)</label><input type="number" id="editAccBalance" value="${acc.startBalance||0}" min="0" step="1000"></div>
        <div class="modal-field"><label>Últimos 4 dígitos de la cuenta</label><input type="text" inputmode="numeric" maxlength="4" id="editAccUltimos4" value="${escapeAttr(acc.ultimos4||'')}"></div>
        <div class="modal-field"><label>Últimos 4 de la tarjeta débito (T.Deb, para compras y retiros)</label><input type="text" inputmode="numeric" maxlength="4" id="editAccUltimos4Debito" value="${escapeAttr(acc.ultimos4Debito||'')}"></div>`;

    } else if(type==='pocket'){
      const p = data.pockets.find(x=>x.id===id); if(!p) return;
      titleEl.textContent = 'Editar bolsillo';
      const accOptions = data.accounts.map(a=>`<option value="${escapeAttr(a.id)}" ${p.accountId===a.id?'selected':''}>${escapeAttr(a.name)}</option>`).join('');
      fieldsEl.innerHTML = `
        <div class="modal-field"><label>Nombre</label><input type="text" id="editPocketName" value="${escapeAttr(p.name)}"></div>
        <div class="modal-field"><label>Cuenta asociada</label><select id="editPocketAccount"><option value="">Sin asociar</option>${accOptions}</select></div>
        <div class="modal-field"><label>Saldo inicial (COP) — antes de abonos/retiros registrados</label><input type="number" id="editPocketBalance" value="${p.startBalance||0}" min="0" step="1000"></div>`;

    } else if(type==='goal'){
      const g = data.goals.find(x=>x.id===id); if(!g) return;
      titleEl.textContent = 'Editar meta';
      const pocketOpts = data.pockets.map(p=>`<label><input type="checkbox" class="edit-goal-pocket-check" value="${escapeAttr(p.id)}" ${(g.pocketIds||[]).includes(p.id)?'checked':''}> ${escapeAttr(p.name)} — ${formatCOP(pocketBalance(p))}</label>`).join('') || '<div class="empty vacio-compacto">No hay bolsillos creados.</div>';
      const invOpts = data.investments.map(i=>`<label><input type="checkbox" class="edit-goal-investment-check" value="${escapeAttr(i.id)}" ${(g.investmentIds||[]).includes(i.id)?'checked':''}> ${escapeAttr(i.entity)} — ${formatCOP(investmentTotal(i))}</label>`).join('') || '<div class="empty vacio-compacto">No hay CDT registrados.</div>';
      fieldsEl.innerHTML = `
        <div class="modal-field"><label>Nombre</label><input type="text" id="editGoalName" value="${escapeAttr(g.name)}"></div>
        <div class="modal-field"><label>Monto objetivo (COP)</label><input type="number" id="editGoalTarget" value="${g.target}" min="0" step="10000"></div>
        <div class="modal-field"><label>Fecha objetivo</label><input type="date" id="editGoalDate" value="${g.targetDate||''}"></div>
        <div class="modal-field goal-source-box">
          <div class="goal-source-title">¿Qué dinero cuenta para esta meta?</div>
          <label><input type="checkbox" id="editGoalIncludeContributions" ${g.includeContributions!==false?'checked':''}> Abonos manuales</label>
          <div class="goal-source-subtitle">Bolsillos</div>
          <div>${pocketOpts}</div>
          <div class="goal-source-subtitle">CDT</div>
          <div>${invOpts}</div>
        </div>`;

    } else if(type==='investment'){
      const inv = data.investments.find(x=>x.id===id); if(!inv) return;
      titleEl.textContent = 'Editar CDT';
      fieldsEl.innerHTML = `
        <div class="modal-field"><label>Entidad</label><input type="text" id="editInvEntity" value="${escapeAttr(inv.entity)}"></div>
        <div class="modal-field"><label>Monto invertido (COP)</label><input type="number" id="editInvAmount" value="${inv.amount}" min="0" step="10000"></div>
        <div class="modal-field"><label>Tasa EA (%)</label><input type="number" id="editInvRate" value="${inv.rate}" min="0" step="0.01"></div>
        <div class="modal-field"><label>Plazo (meses)</label><input type="number" id="editInvTerm" value="${inv.termMonths}" min="1" step="1"></div>
        <div class="modal-field"><label>Fecha de apertura</label><input type="date" id="editInvStart" value="${inv.startDate}"></div>`;

    } else if(type==='transaction'){
      const t = data.transactions.find(x=>x.id===id); if(!t) return;
      if(t.type==='income' || t.type==='expense'){
        titleEl.textContent = t.type==='income' ? 'Editar ingreso' : 'Editar gasto';
        const listId = t.type==='income' ? 'incomeCategoryList' : 'expenseCategoryList';
        const accOptions = '<option value="">Sin cuenta asociada</option>' + data.accounts.map(a=>`<option value="${escapeAttr(a.id)}" ${t.accountId===a.id?'selected':''}>${escapeAttr(a.name)}</option>`).join('');
        fieldsEl.innerHTML = `
          <div class="modal-field"><label>Monto (COP)</label><input type="number" id="editTxAmount" value="${t.amount}" min="0" step="1000"></div>
          <div class="modal-field"><label>Categoría</label><input type="text" id="editTxCategory" list="${listId}" value="${escapeAttr(t.category||'')}"></div>
          <div class="modal-field"><label>Comercio</label><input type="text" id="editTxComercio" value="${escapeAttr(t.comercio||'')}" autocomplete="off"></div>
          <div class="modal-field"><label>Cuenta</label><select id="editTxAccount">${accOptions}</select></div>
          <div class="modal-field"><label>Fecha</label><input type="date" id="editTxDate" value="${t.date}"></div>
          <div class="modal-field"><label>Nota</label><textarea id="editTxNote">${escapeAttr(t.note||'')}</textarea></div>`;
      } else {
        const isAbono = t.type==='transfer_in';
        const esRecurso = t.type==='transfer_in' || t.type==='withdraw_out';
        titleEl.textContent = esRecurso ? (isAbono ? 'Editar abono' : 'Editar retiro') : 'Editar movimiento';
        fieldsEl.innerHTML = `
          <div class="modal-field" ${esRecurso?'':'hidden'}><label>${isAbono?'Destino':'Origen del retiro'}</label><div class="texto-no-editable">${escapeAttr(targetLabel(t.targetType, t.targetId))} (no editable)</div></div>
          <div class="modal-field"><label>Monto (COP)</label><input type="number" id="editTxAmount" value="${t.amount}" min="0" step="1000"></div>
          <div class="modal-field"><label>Fecha</label><input type="date" id="editTxDate" value="${t.date}"></div>
          <div class="modal-field"><label>Nota</label><textarea id="editTxNote">${escapeAttr(t.note||'')}</textarea></div>`;
      }
    }

    document.getElementById('editModalOverlay').classList.add('show');
  }

  async function saveEditModal(){
    if(!editModalState) return;
    const { type, id } = editModalState;

    if(type==='account'){
      const acc = data.accounts.find(a=>a.id===id); if(!acc) return;
      const name = document.getElementById('editAccName').value.trim();
      if(!name) return;
      const ultimos4 = document.getElementById('editAccUltimos4').value.trim();
      const ultimos4Debito = document.getElementById('editAccUltimos4Debito').value.trim();
      if((ultimos4 && !/^\d{4}$/.test(ultimos4)) || (ultimos4Debito && !/^\d{4}$/.test(ultimos4Debito))){ showToast('Escribe solo los últimos 4 dígitos'); return; }
      acc.ultimos4 = ultimos4 || null;
      acc.ultimos4Debito = ultimos4Debito || null;
      acc.name = name;
      acc.type = document.getElementById('editAccType').value;
      acc.tipo = TIPO_CUENTA[acc.type] ?? acc.tipo;
      acc.startBalance = aEntero(parseFloat(document.getElementById('editAccBalance').value)) || 0;

    } else if(type==='pocket'){
      const p = data.pockets.find(x=>x.id===id); if(!p) return;
      const name = document.getElementById('editPocketName').value.trim();
      if(!name) return;
      p.name = name;
      p.accountId = document.getElementById('editPocketAccount').value || null;
      p.startBalance = aEntero(parseFloat(document.getElementById('editPocketBalance').value)) || 0;

    } else if(type==='goal'){
      const g = data.goals.find(x=>x.id===id); if(!g) return;
      const name = document.getElementById('editGoalName').value.trim();
      const target = aEntero(parseFloat(document.getElementById('editGoalTarget').value));
      if(!name || !target || target<=0) return;
      g.name = name;
      g.target = target;
      g.targetDate = document.getElementById('editGoalDate').value;
      g.includeContributions = document.getElementById('editGoalIncludeContributions').checked;
      g.pocketIds = Array.from(document.querySelectorAll('.edit-goal-pocket-check:checked')).map(el=>el.value);
      g.investmentIds = Array.from(document.querySelectorAll('.edit-goal-investment-check:checked')).map(el=>el.value);

    } else if(type==='investment'){
      const inv = data.investments.find(x=>x.id===id); if(!inv) return;
      const entity = document.getElementById('editInvEntity').value.trim();
      const amount = aEntero(parseFloat(document.getElementById('editInvAmount').value));
      const rate = parseFloat(document.getElementById('editInvRate').value);
      const termMonths = parseInt(document.getElementById('editInvTerm').value);
      const startDate = document.getElementById('editInvStart').value;
      if(!entity || !amount || amount<=0 || !rate || rate<0 || !termMonths || termMonths<=0 || !startDate) return;
      inv.entity = entity; inv.amount = amount; inv.rate = rate; inv.termMonths = termMonths; inv.startDate = startDate;

    } else if(type==='transaction'){
      const t = data.transactions.find(x=>x.id===id); if(!t) return;
      const amount = aEntero(parseFloat(document.getElementById('editTxAmount').value));
      const date = document.getElementById('editTxDate').value;
      const note = document.getElementById('editTxNote').value.trim();
      if(!amount || amount<=0 || !date) return;
      t.amount = amount; t.date = date; t.note = note;
      if(t.type==='income' || t.type==='expense'){
        t.comercio = document.getElementById('editTxComercio').value.trim();
        const categoriaNueva = document.getElementById('editTxCategory').value.trim() || t.category;
        // Corregir la categoría de un comercio enseña la regla para los siguientes.
        if(categoriaNueva!==t.category && t.comercio) data.reglas = aprender(data.reglas, t.comercio, categoriaNueva);
        t.category = categoriaNueva;
        t.accountId = document.getElementById('editTxAccount').value || null;
      } else if(t.transferencia_id){
        // los movimientos de transferencia están enlazados: al editar uno,
        // el otro lado se sincroniza para que ambos saldos recalculen bien
        const pair = data.transactions.find(x=>x.transferencia_id===t.transferencia_id && x.id!==t.id);
        if(pair){ pair.amount = amount; pair.date = date; pair.note = note; }
      }
    }

    await saveData();
    closeEditModal();
    showToast('Cambios guardados');
    renderAll();
  }
  document.getElementById('editModalSaveBtn').addEventListener('click', saveEditModal);

  // ---- Cuentas ----
  function accountBalance(acc){ return saldoCuenta(acc, data.transactions); }
  function renderAccounts(){
    const listEl = document.getElementById('accountsList');
    if(data.accounts.length===0){
      listEl.innerHTML = '<div class="empty">Agrega tus cuentas para ver tu saldo total consolidado.</div>';
    } else {
      listEl.innerHTML = data.accounts.map(a=>{
        const bal = accountBalance(a);
        const digitos = [a.ultimos4 && `cuenta *${a.ultimos4}`, a.ultimos4Debito && `débito *${a.ultimos4Debito}`].filter(Boolean).join(' · ');
        return `<details class="fila acc-row" data-acc="${escapeAttr(a.id)}">
          <summary>
            <span class="avatar">${iconoHtml(ICONO_CUENTA[a.tipo] ?? 'banco')}</span>
            <span class="info"><span class="name">${escapeAttr(a.name)}</span><span class="meta">${escapeAttr(a.type==='Digital' ? 'Billetera digital' : a.type)}</span></span>
            <span class="bal monto">${formatCOP(bal)}</span>
          </summary>
          <div class="fila-cuerpo">
            <div class="fila-detalle">${digitos ? escapeAttr(digitos) : 'Sin dígitos registrados: agrégalos para que los correos del banco se asocien solos.'}</div>
            <div class="fila-acciones">
              <button class="btn-mini acc-edit-btn">${iconoHtml('editar')}Editar</button>
              <button class="btn-mini peligro acc-del-btn">${iconoHtml('eliminar')}Eliminar</button>
            </div>
          </div>
        </details>`;
      }).join('');
      listEl.querySelectorAll('.acc-edit-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          openEditModal('account', btn.closest('.acc-row').dataset.acc);
        });
      });
      listEl.querySelectorAll('.acc-del-btn').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const id = btn.closest('.acc-row').dataset.acc;
          if(!await askConfirm('¿Eliminar esta cuenta? Sus movimientos se conservan, pero dejarán de sumar a un saldo.')) return;
          data.accounts = data.accounts.filter(a=>a.id!==id);
          await saveData(); renderAll();
        });
      });
    }
    const total = data.accounts.reduce((s,a)=>s+accountBalance(a),0);
    document.getElementById('accountsTotal').textContent = formatCOP(total);
    document.getElementById('headerTotalBalance').textContent = formatCOP(total);
  }
  document.getElementById('addAccBtn').addEventListener('click', async ()=>{
    const name = document.getElementById('accName').value.trim();
    const type = document.getElementById('accType').value;
    const startBalance = aEntero(parseFloat(document.getElementById('accBalance').value)) || 0;
    if(!name) return;
    const ultimos4 = document.getElementById('accUltimos4').value.trim();
    const ultimos4Debito = document.getElementById('accUltimos4Debito').value.trim();
    if((ultimos4 && !/^\d{4}$/.test(ultimos4)) || (ultimos4Debito && !/^\d{4}$/.test(ultimos4Debito))){ showToast('Escribe solo los últimos 4 dígitos'); return; }
    data.accounts.push({id:'a'+Date.now(), name, type, startBalance, tipo: TIPO_CUENTA[type] ?? 'ahorros', alias: name, ultimos4: ultimos4 || null, ultimos4Debito: ultimos4Debito || null});
    await saveData();
    document.getElementById('accName').value=''; document.getElementById('accBalance').value=''; document.getElementById('accUltimos4').value=''; document.getElementById('accUltimos4Debito').value='';
    accFormShown = false;
    document.getElementById('accFormFields').classList.remove('show');
    document.getElementById('accFormToggle').textContent = '+ agregar cuenta';
    showToast('Cuenta guardada');
    renderAll();
  });

  let guardandoMovimiento = false;
  async function addTransaction(){
    // Un doble toque no debe registrar dos veces el mismo movimiento.
    if(guardandoMovimiento) return;
    guardandoMovimiento = true;
    try{ await registrarMovimiento(); }
    catch(err){ showToast(err.message || 'No se pudo guardar'); }
    finally{ guardandoMovimiento = false; }
  }
  async function registrarMovimiento(){
    const amountInput = document.getElementById('txAmount');
    const amount = aEntero(parseFloat(amountInput.value));
    if(!amount || amount<=0) return;
    const category = document.getElementById('txCategory').value.trim() || 'Otros';
    const date = document.getElementById('txDate').value || hoyKey();
    const medio = document.getElementById('txAccount').value;
    if(currentTxType==='transfer'){
      const destino = document.getElementById('txDestino').value;
      if(!medio || !destino){ showToast('Elige la cuenta de origen y la de destino'); return; }
      if(medio===destino){ showToast('El origen y el destino deben ser distintos'); return; }
      const origen = data.accounts.find(a=>a.id===medio);
      const disponible = origen ? accountBalance(origen) : 0;
      if(amount>disponible && !await askConfirm(`"${origen?.name ?? 'La cuenta'}" tiene ${formatCOP(disponible)}, menos que el traslado de ${formatCOP(amount)}. ¿Continuar?`)) return;
      data.transactions.push({
        id: uid('t'), date, type:'transferencia', amount, category:'', accountId: medio, cuentaDestinoId: destino,
        tarjetaId:null, method:'', note: document.getElementById('txNote').value.trim(), comercio:'',
        origen:'manual', estado:'confirmado', fuentes:[], esCuota:false, cuotaInfo:null
      });
      await saveData();
      amountInput.value = ''; document.getElementById('txNote').value = '';
      showToast('Traslado guardado. No cuenta como gasto.');
      renderAll();
      return;
    }
    const tarjetaId = medio.startsWith('tarjeta:') ? medio.slice(8) : null;
    if(tarjetaId && currentTxType!=='expense'){ showToast('Una tarjeta solo registra gastos'); return; }
    const accountId = tarjetaId ? null : (medio || null);
    const method = document.getElementById('txMethod').value || (tarjetaId ? 'Crédito' : '');
    const note = document.getElementById('txNote').value.trim();
    const comercio = document.getElementById('txComercio').value.trim();
    const nCuotas = tarjetaId ? Math.max(1, parseInt(document.getElementById('txCuotas').value,10)||1) : 1;
    const mov = {
      id: uid('t'), date, type: currentTxType, amount, category, accountId, tarjetaId, method, note, comercio,
      origen:'manual', estado:'confirmado', fuentes:[], esCuota: nCuotas>1, cuotaInfo: nCuotas>1 ? {nCuotas} : null
    };
    data.transactions.push(mov);
    if(nCuotas>1) registrarDiferida(data, mov, ()=>uid('d'));
    await saveData();
    document.getElementById('txComercio').value=''; document.getElementById('txCuotas').value='';
    amountInput.value = ''; document.getElementById('txCategory').value = '';
    document.getElementById('txMethod').value = ''; document.getElementById('txNote').value = '';
    showToast('Movimiento guardado');
    renderAll();
  }
  document.getElementById('addTxBtn').addEventListener('click', addTransaction);

  function monthTransactions(monthKey){
    return data.transactions.filter(t=>monthOf(t.date)===monthKey && esVigente(t));
  }
  function monthStats(monthKey){ return estadisticasMes(data.transactions, monthKey); }

  // average monthly net savings over completed months with data (excludes current month)
  function avgMonthlyCapacity(){
    const thisMonthKey = hoyKey().slice(0,7);
    const seen = new Set(data.transactions.map(t=>monthOf(t.date)));
    const completed = [...seen].filter(m=>m<thisMonthKey).sort().slice(-6);
    if(completed.length===0) return null;
    const total = completed.reduce((s,m)=>s+monthStats(m).balance,0);
    return total/completed.length;
  }

  function renderWheelAndHeader(){
    const now = new Date();
    const thisMonthKey = hoyKey().slice(0,7);
    const { income, expense, balance, savingsRate } = monthStats(thisMonthKey);

    const wheelPct = document.getElementById('wheelPct');
    wheelPct.textContent = textoTasaAhorro({ income, expense, savingsRate });
    wheelPct.classList.toggle('texto', !/%$/.test(wheelPct.textContent));
    const monthName = monthLabel(thisMonthKey);
    const meta = metaAhorro(data);
    // El titular dice cómo va el mes frente a la meta de ahorro, no solo si es positivo.
    document.getElementById('monthHeadline').textContent =
      income<=0 && expense<=0 ? `Empieza ${monthName}: aún sin movimientos`
      : balance<0 ? `Vas en rojo en ${monthName}`
      : savingsRate>=meta ? `Vas cumpliendo tu meta de ahorro en ${monthName}`
      : `Vas positivo en ${monthName}, bajo tu meta del ${meta} %`;
    document.getElementById('monthSub').textContent = `Entraron ${formatCOP(income)} · Salieron ${formatCOP(expense)}`;
    document.getElementById('heroFecha').textContent = fromKey(hoyKey()).toLocaleDateString('es-CO', {weekday:'short', day:'numeric', month:'short'});
    document.getElementById('activeGoals').parentElement.lastChild.textContent = data.goals.length===1 ? ' meta' : ' metas';
    // El anillo se llena al alcanzar la meta de ahorro del mes.
    const svg = document.getElementById('wheelSvg');
    const r = 50, cx = 60, cy = 60, circ = 2*Math.PI*r;
    const frac = Math.max(0,Math.min(1, savingsRate/meta));
    svg.innerHTML = `
      <circle class="wheel-pista" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="12"/>
      <circle class="wheel-avance" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="12"
        stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ*(1-frac)).toFixed(1)}"
        transform="rotate(-90 ${cx} ${cy})"/>`;

    let streak = 0; let cursor = fromKey(hoyKey());
    while(true){
      const key = toKey(cursor);
      const has = data.transactions.some(t=>t.date===key);
      if(has){ streak++; cursor.setDate(cursor.getDate()-1); } else break;
      if(streak>365) break;
    }
    document.getElementById('currentStreak').textContent = streak;
    document.getElementById('currentStreak').parentElement.lastChild.textContent = streak===1 ? ' día' : ' días';
    document.getElementById('activeGoals').textContent = data.goals.length;

    const banner = document.getElementById('reminderBanner');
    const bannerTime = document.getElementById('bannerTime');
    const todayKey = hoyKey();
    const hasToday = data.transactions.some(t=>t.date===todayKey);
    const hour = now.getHours();
    if(data.settings.reminderOn && !hasToday && hour >= Number(data.settings.reminderHour)){
      banner.classList.add('show');
      bannerTime.textContent = `Son las ${pad(hour)}:${pad(now.getMinutes())}.`;
      if('Notification' in window && Notification.permission==='granted' && data.settings.lastNotified!==todayKey){
        try{ new Notification('Sin movimientos hoy', {body:'Aún no registras ingresos o gastos de hoy.'}); data.settings.lastNotified = todayKey; saveData(); }catch(e){}
      }
    } else banner.classList.remove('show');

    // investment maturity banner — alertas escalonadas en 30, 15 y 5 días
    const invBanner = document.getElementById('invBanner');
    const invTextEl = document.getElementById('invBannerText');
    invBanner.classList.remove('warn','amber');
    const items = data.investments.map(inv=>({inv, m:investmentMaturity(inv)})).filter(x=>x.m.daysLeft>=0 && x.m.daysLeft<=30);
    const t5 = items.filter(x=>x.m.daysLeft<=5).sort((a,b)=>a.m.daysLeft-b.m.daysLeft);
    const t15 = items.filter(x=>x.m.daysLeft>5 && x.m.daysLeft<=15).sort((a,b)=>a.m.daysLeft-b.m.daysLeft);
    const t30 = items.filter(x=>x.m.daysLeft>15 && x.m.daysLeft<=30).sort((a,b)=>a.m.daysLeft-b.m.daysLeft);
    if(t5.length){
      invBanner.classList.add('show','warn');
      invTextEl.textContent = t5.length===1
        ? `¡Urgente! Tu CDT en ${t5[0].inv.entity} vence en ${t5[0].m.daysLeft} día(s). Decide si renuevas o retiras.`
        : `${t5.length} CDT vencen en 5 días o menos — revisa la sección de inversiones.`;
    } else if(t15.length){
      invBanner.classList.add('show','amber');
      invTextEl.textContent = t15.length===1
        ? `Tu CDT en ${t15[0].inv.entity} vence en ${t15[0].m.daysLeft} días. Empieza a decidir qué harás.`
        : `${t15.length} CDT vencen en los próximos 15 días.`;
    } else if(t30.length){
      invBanner.classList.add('show','amber');
      invTextEl.textContent = t30.length===1
        ? `Tu CDT en ${t30[0].inv.entity} vence en ${t30[0].m.daysLeft} días.`
        : `${t30.length} CDT vencen en los próximos 30 días.`;
    } else invBanner.classList.remove('show');

    // month-end report banner / auto-generation
    checkAutoReport();
  }

  function pocketBalance(pocket){ return (Number(pocket.startBalance)||0) + targetBalanceRaw('pocket', pocket.id); }

  function renderPockets(){
    const listEl = document.getElementById('pocketsList');
    const totalEl = document.getElementById('pocketsTotal');
    if(!listEl || !totalEl) return;
    if(data.pockets.length===0){
      listEl.innerHTML = '<div class="empty">Aún no tienes bolsillos. Crea uno para separar dinero por objetivo.</div>';
    } else {
      const noAccounts = data.accounts.length===0;
      listEl.innerHTML = data.pockets.map(p=>{
        const acc = data.accounts.find(a=>a.id===p.accountId);
        return `<details class="fila pocket-row" data-pocket="${escapeAttr(p.id)}">
          <summary>
            <span class="avatar">${iconoHtml('bolsillo')}</span>
            <span class="info"><span class="name">${escapeAttr(p.name)}</span><span class="meta">${acc ? escapeAttr(acc.name) : 'Cuenta no asociada'}</span></span>
            <span class="bal monto">${formatCOP(pocketBalance(p))}</span>
          </summary>
          <div class="fila-cuerpo">
            ${noAccounts ? '<div class="mini-hint">Crea una cuenta para poder abonar o retirar de este bolsillo.</div>' : `
            <div class="mini-transfer-row" data-pocket-transfer="${escapeAttr(p.id)}">
              <select class="mini-acc-select" aria-label="Cuenta de origen o destino">${accountTransferOptions()}</select>
              <input type="number" class="mini-amt-input" placeholder="Monto" aria-label="Monto a abonar o retirar" min="0" step="1000">
              <button class="btn-accent mini-abono-btn">Abonar</button>
              <button class="btn-ghost mini-retiro-btn">Retirar</button>
            </div>`}
            <div class="fila-acciones">
              <button class="btn-mini pocket-edit-btn">${iconoHtml('editar')}Editar</button>
              <button class="btn-mini peligro pocket-del-btn">${iconoHtml('eliminar')}Eliminar</button>
            </div>
          </div>
        </details>`;
      }).join('');
      listEl.querySelectorAll('.pocket-edit-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          openEditModal('pocket', btn.closest('.pocket-row').dataset.pocket);
        });
      });
      listEl.querySelectorAll('.pocket-del-btn').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const id = btn.closest('.pocket-row').dataset.pocket;
          if(!await askConfirm('¿Eliminar este bolsillo?')) return;
          data.pockets = data.pockets.filter(p=>p.id!==id);
          data.goals.forEach(g=>{ if(g.pocketIds) g.pocketIds=g.pocketIds.filter(x=>x!==id); });
          await saveData(); renderAll();
        });
      });
      listEl.querySelectorAll('[data-pocket-transfer]').forEach(row=>{
        const id = row.dataset.pocketTransfer;
        row.querySelector('.mini-abono-btn').addEventListener('click', async ()=>{
          const accId = row.querySelector('.mini-acc-select').value;
          const input = row.querySelector('.mini-amt-input');
          const amt = aEntero(parseFloat(input.value));
          if(!amt || amt<=0) return;
          const ok = await handleAbono(accId, amt, 'pocket', id);
          if(ok){ showToast('Abono registrado'); renderAll(); }
        });
        row.querySelector('.mini-retiro-btn').addEventListener('click', async ()=>{
          const accId = row.querySelector('.mini-acc-select').value;
          const input = row.querySelector('.mini-amt-input');
          const amt = aEntero(parseFloat(input.value));
          if(!amt || amt<=0) return;
          const ok = await handleRetiro(accId, amt, 'pocket', id);
          if(ok){ showToast('Retiro registrado'); renderAll(); }
        });
      });
    }
    totalEl.textContent = formatCOP(data.pockets.reduce((s,p)=>s+pocketBalance(p),0));
  }

  function renderGoalSourceOptions(){
    const pocketEl=document.getElementById('goalPocketOptions');
    const invEl=document.getElementById('goalInvestmentOptions');
    if(!pocketEl || !invEl) return;
    pocketEl.innerHTML=data.pockets.length
      ? data.pockets.map(p=>`<label><input type="checkbox" class="goal-pocket-check" value="${escapeAttr(p.id)}"> ${escapeAttr(p.name)} — ${formatCOP(pocketBalance(p))}</label>`).join('')
      : '<div class="empty vacio-compacto">No hay bolsillos creados.</div>';
    invEl.innerHTML=data.investments.length
      ? data.investments.map(i=>`<label><input type="checkbox" class="goal-investment-check" value="${escapeAttr(i.id)}"> ${escapeAttr(i.entity)} — ${formatCOP(investmentTotal(i))}</label>`).join('')
      : '<div class="empty vacio-compacto">No hay CDT registrados.</div>';
  }

  function selectedGoalSources(goal){
    const parts=[];
    if(goal.includeContributions!==false) parts.push('abonos manuales');
    const pn=(goal.pocketIds||[]).map(id=>data.pockets.find(p=>p.id===id)?.name).filter(Boolean);
    const inames=(goal.investmentIds||[]).map(id=>data.investments.find(i=>i.id===id)?.entity).filter(Boolean);
    if(pn.length) parts.push('bolsillos: '+pn.join(', '));
    if(inames.length) parts.push('CDT: '+inames.join(', '));
    return parts.length ? parts.join(' · ') : 'sin fuentes seleccionadas';
  }

  function renderPocketsAndGoalSources(){
    populatePocketAccountSelect();
    renderPockets();
    renderGoalSourceOptions();
  }

  function renderSummary(){
    const thisMonthKey = hoyKey().slice(0,7);
    document.getElementById('summaryMonthLabel').textContent = monthLabel(thisMonthKey);
    const { income, expense, balance } = monthStats(thisMonthKey);
    document.getElementById('sumIncome').textContent = formatCOP(income);
    document.getElementById('sumExpense').textContent = formatCOP(expense);
    const balEl = document.getElementById('sumBalance');
    balEl.textContent = formatCOP(balance);
    balEl.classList.toggle('up', balance>=0);
    balEl.classList.toggle('down', balance<0);

    renderProyeccion();

    // Categorías del mes, cada una frente a su promedio de los últimos meses.
    const categorias = comparativoCategorias(data.transactions, thisMonthKey).slice(0,6);
    const barsEl = document.getElementById('categoryBars');
    if(categorias.length===0){
      barsEl.innerHTML = '<div class="empty">Sin gastos registrados este mes.</div>';
    } else {
      const max = categorias[0].actual || 1;
      barsEl.innerHTML = categorias.map((c,i)=>{
        const color = CATEGORIA_COLORES[i % CATEGORIA_COLORES.length];
        // Solo se comenta una diferencia que valga la pena: más de 10 % y de $10.000.
        const notable = c.promedio!=null && Math.abs(c.delta) >= Math.max(10000, c.promedio*0.1);
        const sub = c.promedio==null ? ''
          : !notable ? `<div class="bar-sub">Como tu promedio (${formatCOP(c.promedio)})</div>`
          : c.delta>0 ? `<div class="bar-sub sube">▲ ${formatCOP(c.delta)} más que tu promedio (${formatCOP(c.promedio)})</div>`
          : `<div class="bar-sub baja">▼ ${formatCOP(-c.delta)} menos que tu promedio (${formatCOP(c.promedio)})</div>`;
        return `
        <div class="bar-row">
          <div class="bar-top"><span class="cat"><span class="cat-dot" data-color="${color}"></span>${escapeAttr(c.categoria)}<small>${c.parte} %</small></span><span class="amt monto">${formatCOP(c.actual)}</span></div>
          <div class="bar-track"><div class="bar-fill" data-pct="${Math.max(2, Math.round((c.actual/max)*100))}" data-color="${color}"></div></div>
          ${sub}
        </div>`;
      }).join('');
      // Color y ancho dinámicos vía CSSOM (no atributo style): compatible con CSP sin 'unsafe-inline'.
      barsEl.querySelectorAll('[data-color]').forEach(el=>{ el.style.setProperty('background', el.dataset.color); });
      barsEl.querySelectorAll('.bar-fill[data-pct]').forEach(el=>{ el.style.setProperty('width', el.dataset.pct+'%'); });
    }

    // Últimos 6 meses: ingresos y gastos lado a lado, sobre una misma escala desde cero.
    const months = [];
    for(let i=5;i>=0;i--) months.push(addMonths(thisMonthKey, -i));
    const serie = months.map(m=>({ m, ...monthStats(m) }));
    const svg = document.getElementById('trendSvg');
    const tope = Math.max(1, ...serie.flatMap(s=>[s.income, s.expense]));
    const W = 320, BASE = 108, ALTO = 96, paso = W/serie.length, anchoBarra = Math.min(16, paso/2 - 5);
    const alto = v => v>0 ? Math.max(2, (v/tope)*ALTO) : 0;
    svg.innerHTML = `<line class="eje" x1="0" y1="${BASE}" x2="${W}" y2="${BASE}"/>` + serie.map((s,i)=>{
      const cx = paso*i + paso/2;
      const hi = alto(s.income), hg = alto(s.expense);
      const etiqueta = new Date(Number(s.m.slice(0,4)), Number(s.m.slice(5,7))-1, 1).toLocaleDateString('es-CO', {month:'short'}).replace('.','');
      return `<rect class="barra-ingreso" x="${(cx-anchoBarra-1.5).toFixed(1)}" y="${(BASE-hi).toFixed(1)}" width="${anchoBarra.toFixed(1)}" height="${hi.toFixed(1)}" rx="3"/>
        <rect class="barra-gasto" x="${(cx+1.5).toFixed(1)}" y="${(BASE-hg).toFixed(1)}" width="${anchoBarra.toFixed(1)}" height="${hg.toFixed(1)}" rx="3"/>
        <text x="${cx.toFixed(1)}" y="${BASE+16}" text-anchor="middle">${escapeAttr(etiqueta)}</text>`;
    }).join('');
    const descripcion = serie.map(s=>`${monthLabel(s.m)}: ingresos ${formatCOP(s.income)}, gastos ${formatCOP(s.expense)}`).join('; ');
    svg.setAttribute('aria-label', document.body.classList.contains('discreto') ? 'Ingresos y gastos de los últimos 6 meses' : `Ingresos y gastos de los últimos 6 meses. ${descripcion}`);
  }

  /** Cómo va a cerrar el mes si sigues gastando al ritmo actual, frente a tu promedio. */
  function renderProyeccion(){
    const el = document.getElementById('proyeccionMes');
    const p = proyeccionCierre(data, hoyKey());
    if(!p.hayBase){ el.innerHTML = ''; return; }
    const referencia = Math.max(p.proyectado, p.promedio, 1);
    const excede = p.promedio>0 && p.proyectado > p.promedio*1.05;
    const meta = metaAhorro(data);
    let lectura;
    if(p.ingresoEsperado<=0) lectura = 'Sin ingresos registrados aún para estimar cuánto ahorrarás.';
    else if(p.ahorroProyectado<0) lectura = `A este ritmo gastarías ${formatCOP(-p.ahorroProyectado)} más de lo que entra.`;
    else lectura = `A este ritmo ahorrarías ${formatCOP(p.ahorroProyectado)} (${p.tasaProyectada} % del ingreso; tu meta es ${meta} %).`;
    const fijos = p.fijosPendientes>0 ? ` Incluye ${formatCOP(p.fijosPendientes)} de cobros fijos que aún no llegan.` : '';
    el.innerHTML = `<div class="proyeccion ${excede ? 'excede' : ''}">
      <div class="proyeccion-titulo"><span>Cierre estimado del gasto</span><b class="monto">${formatCOP(p.proyectado)}</b></div>
      <div class="proyeccion-pista" role="img" aria-label="Gastado hasta hoy frente al cierre estimado y a tu promedio">
        <span class="proyeccion-resto" data-ancho="${Math.round((p.proyectado/referencia)*100)}"></span>
        <span class="proyeccion-hecho" data-ancho="${Math.round((p.gastado/referencia)*100)}"></span>
        ${p.promedio>0 ? `<span class="proyeccion-marca" data-izq="${Math.round((p.promedio/referencia)*100)}"></span>` : ''}
      </div>
      <p class="nota">${p.promedio>0 ? `La línea verde es tu promedio mensual (${formatCOP(p.promedio)}). ` : ''}${lectura}${fijos}</p>
    </div>`;
    el.querySelectorAll('[data-ancho]').forEach(x=>{ x.style.setProperty('width', x.dataset.ancho+'%'); });
    el.querySelectorAll('[data-izq]').forEach(x=>{ x.style.setProperty('left', `calc(${x.dataset.izq}% - 1px)`); });
  }

  function historyRows(monthKey){
    const txs = monthTransactions(monthKey);
    const rows = [];
    txs.forEach(t=>{
      // los lados "salida" de una transferencia se muestran a través de su
      // contraparte ("entrada"), para que cada abono/retiro aparezca una sola vez
      if(t.type==='transfer_out' || t.type==='withdraw_in') return;
      rows.push(t);
    });
    return rows.sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }

  function txRowLabel(t){
    const tarjeta = t.tarjetaId ? data.tarjetas.find(x=>x.id===t.tarjetaId) : null;
    if(t.type==='pago_tarjeta') return `Pago de tarjeta ${tarjeta ? tarjeta.alias : ''}`.trim();
    if(t.type==='avance') return `Avance de tarjeta ${tarjeta ? tarjeta.alias : ''}`.trim();
    if(t.type==='transferencia') return t.comercio || 'Traslado entre cuentas';
    if(t.type==='pago_deuda') return `Abono a ${data.deudas.find(d=>d.id===t.deudaId)?.nombre ?? 'deuda'}`;
    if(t.type==='income' || t.type==='expense' || t.type==='interes' || t.type==='cuota_manejo'){
      const acc = data.accounts.find(a=>a.id===t.accountId);
      const parts = [t.category || 'Sin categoría'];
      if(t.comercio) parts.push(t.comercio);
      if(t.deudaId) parts.push(`Intereses de ${data.deudas.find(d=>d.id===t.deudaId)?.nombre ?? 'deuda'}`);
      if(tarjeta) parts.push(`Tarjeta ${tarjeta.alias}`);
      if(acc) parts.push(acc.name);
      if(t.method) parts.push(t.method);
      return parts.join(' · ') + (t.note ? ' — ' + t.note : '');
    }
    if(t.type==='transfer_in'){
      const pair = data.transactions.find(x=>x.transferencia_id===t.transferencia_id && x.type==='transfer_out');
      const acc = pair ? data.accounts.find(a=>a.id===pair.accountId) : null;
      return `Abono a ${targetLabel(t.targetType, t.targetId)}${acc ? ' desde '+acc.name : ''}` + (t.note ? ' — '+t.note : '');
    }
    if(t.type==='withdraw_out'){
      const pair = data.transactions.find(x=>x.transferencia_id===t.transferencia_id && x.type==='withdraw_in');
      const acc = pair ? data.accounts.find(a=>a.id===pair.accountId) : null;
      return `Retiro de ${targetLabel(t.targetType, t.targetId)}${acc ? ' hacia '+acc.name : ''}` + (t.note ? ' — '+t.note : '');
    }
    return '';
  }

  const sinTildes = s=>String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();

  /** Título, segunda línea e icono de un movimiento para la lista del historial. */
  function txResumen(t){
    const cuenta = id=>data.accounts.find(a=>a.id===id)?.name;
    const tarjeta = t.tarjetaId ? data.tarjetas.find(x=>x.id===t.tarjetaId) : null;
    const medio = tarjeta ? `Tarjeta ${tarjeta.alias}` : cuenta(t.accountId);
    const unir = (...partes)=>partes.filter(Boolean).join(' · ');
    if(t.type==='pago_tarjeta') return { titulo:`Pago de tarjeta ${tarjeta?.alias ?? ''}`.trim(), sub: unir(cuenta(t.accountId), 'no es gasto'), icono:'tarjeta' };
    if(t.type==='avance') return { titulo:`Avance de tarjeta ${tarjeta?.alias ?? ''}`.trim(), sub: unir(cuenta(t.accountId)), icono:'tarjeta' };
    if(t.type==='pago_deuda') return { titulo: txRowLabel(t), sub: unir(cuenta(t.accountId), 'a capital'), icono:'traslado' };
    if(t.type==='transferencia') return { titulo: t.comercio || 'Traslado entre cuentas', sub: unir([cuenta(t.accountId), cuenta(t.cuentaDestinoId)].filter(Boolean).join(' → '), t.note), icono:'traslado' };
    if(t.type==='transfer_in' || t.type==='withdraw_out'){
      const par = data.transactions.find(x=>x.transferencia_id===t.transferencia_id && x.id!==t.id);
      const esAbono = t.type==='transfer_in';
      return { titulo:`${esAbono ? 'Abono a' : 'Retiro de'} ${targetLabel(t.targetType, t.targetId)}`, sub: unir(par && cuenta(par.accountId) ? `${esAbono ? 'desde' : 'hacia'} ${cuenta(par.accountId)}` : '', t.note), icono:'bolsillo' };
    }
    const deuda = t.deudaId ? data.deudas.find(d=>d.id===t.deudaId)?.nombre : null;
    const titulo = t.comercio || (deuda ? `Intereses de ${deuda}` : null) || t.category || 'Sin categoría';
    return { titulo, sub: unir(t.comercio || deuda ? t.category : null, medio, t.method && !tarjeta ? t.method : null, t.note), icono:null };
  }

  function renderHistory(){
    const monthInput = document.getElementById('historyMonth');
    if(!monthInput.value) monthInput.value = historyMonthKey;
    const listEl = document.getElementById('historyList');
    const resumenEl = document.getElementById('historySummary');
    const delMes = historyRows(historyMonthKey);
    const q = sinTildes(historyBusqueda);
    const todas = delMes
      .filter(HISTORY_FILTROS[historyFiltro] ?? HISTORY_FILTROS.todos)
      .filter(t=>!q || sinTildes(`${txRowLabel(t)} ${t.amount} ${formatCOP(t.amount)}`).includes(q));
    const rows = todas.slice(0, historyLimit);
    if(rows.length===0){
      resumenEl.textContent = '';
      listEl.innerHTML = `<div class="empty">${delMes.length ? 'Nada coincide con lo que buscas.' : 'Sin movimientos este mes.'}</div>`;
      return;
    }
    const esGasto = t=>t.type==='expense' || t.type==='interes' || t.type==='cuota_manejo';
    const entro = todas.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
    const salio = todas.filter(esGasto).reduce((s,t)=>s+t.amount,0);
    resumenEl.textContent = `${todas.length} movimiento${todas.length===1?'':'s'}` + (entro ? ` · entraron ${formatCOP(entro)}` : '') + (salio ? ` · salieron ${formatCOP(salio)}` : '');

    const hoy = hoyKey();
    const ayer = toKey(new Date(fromKey(hoy).getTime() - 86400000));
    const nombreDia = key=>key===hoy ? 'Hoy' : key===ayer ? 'Ayer' : fromKey(key).toLocaleDateString('es-CO', {weekday:'long', day:'numeric', month:'short'});
    let diaActual = null;
    listEl.innerHTML = rows.map(t=>{
      let cabecera = '';
      if(t.date!==diaActual){
        diaActual = t.date;
        const delDia = rows.filter(x=>x.date===t.date);
        const neto = delDia.reduce((s,x)=>s + (x.type==='income' ? x.amount : esGasto(x) ? -x.amount : 0), 0);
        cabecera = `<div class="dia-cabecera"><span>${escapeAttr(nombreDia(t.date))}</span>${neto ? `<span class="monto">${neto>0?'+':'−'}${formatCOP(Math.abs(neto))}</span>` : ''}</div>`;
      }
      const { titulo, sub, icono } = txResumen(t);
      const sign = t.type==='income' ? '+' : esGasto(t) ? '−' : '';
      const colorCls = t.type==='income' ? 'income' : esGasto(t) ? 'expense' : 'neutral';
      const inicial = (titulo.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/) ?? ['·'])[0].toUpperCase();
      const id = escapeAttr(t.id);
      return `${cabecera}<details class="fila list-row">
        <summary>
          <span class="avatar ${t.type==='income' ? 'ingreso' : ''}">${icono ? iconoHtml(icono) : escapeAttr(inicial)}</span>
          <span class="info"><span class="cat-name">${escapeAttr(titulo)}</span><span class="meta">${escapeAttr(sub)}</span></span>
          <span class="amt monto ${colorCls}">${sign}${formatCOP(t.amount)}</span>
        </summary>
        <div class="fila-cuerpo">
          <div class="fila-detalle">${escapeAttr(txRowLabel(t))}${t.hora ? ` · ${escapeAttr(t.hora)}` : ''}${t.origen==='gmail' ? ' · llegó por correo' : ''}</div>
          <div class="fila-acciones">
            <button class="btn-mini" data-act="edit" data-id="${id}">${iconoHtml('editar')}Editar</button>
            <button class="btn-mini" data-act="dup" data-id="${id}">${iconoHtml('duplicar')}Duplicar</button>
            <button class="btn-mini peligro" data-act="del" data-id="${id}">${iconoHtml('eliminar')}Eliminar</button>
          </div>
        </div>
      </details>`;
    }).join('') + (todas.length>rows.length ? `<button class="btn-ghost boton-ancho margen-arriba-chico" id="historyMore">Ver más (${todas.length-rows.length})</button>` : '');
    document.getElementById('historyMore')?.addEventListener('click', ()=>{ historyLimit += HISTORY_PAGE; renderHistory(); });
    listEl.querySelectorAll('button[data-act]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const t = data.transactions.find(x=>x.id===btn.dataset.id);
        if(!t) return;
        if(btn.dataset.act==='edit'){
          openEditModal('transaction', t.id);
        } else if(btn.dataset.act==='del'){
          const copia = data.transactions.slice();
          const copiaDiferidas = data.comprasDiferidas.slice();
          deleteTransaction(t);
          data.comprasDiferidas = data.comprasDiferidas.filter(c=>c.movimientoId!==t.id);
          await saveData(); renderAll();
          interfaz.alEliminar('Movimiento eliminado', async ()=>{ data.transactions = copia; data.comprasDiferidas = copiaDiferidas; await saveData(); renderAll(); });
        } else if(btn.dataset.act==='dup'){
          duplicateTransaction(t);
          await saveData(); showToast('Movimiento duplicado'); renderAll();
        }
      });
    });
  }
  document.getElementById('historyMonth').addEventListener('change', (e)=>{
    historyMonthKey = e.target.value || historyMonthKey;
    historyLimit = HISTORY_PAGE;
    renderHistory();
  });
  document.getElementById('historySearch').addEventListener('input', (e)=>{
    historyBusqueda = e.target.value;
    historyLimit = HISTORY_PAGE;
    renderHistory();
  });
  document.getElementById('historyFilters').addEventListener('click', (e)=>{
    const boton = e.target.closest('.filtro'); if(!boton) return;
    historyFiltro = boton.dataset.filtro;
    historyLimit = HISTORY_PAGE;
    document.querySelectorAll('#historyFilters .filtro').forEach(b=>b.setAttribute('aria-pressed', String(b===boton)));
    renderHistory();
  });

  document.getElementById('addPocketBtn').addEventListener('click', async ()=>{
    const name=document.getElementById('pocketName').value.trim();
    const accountId=document.getElementById('pocketAccount').value;
    const startBalance=aEntero(parseFloat(document.getElementById('pocketBalance').value))||0;
    if(!name || startBalance<0) return;
    data.pockets.push({id:'p'+Date.now(),name,accountId,startBalance});
    await saveData();
    document.getElementById('pocketName').value='';
    document.getElementById('pocketBalance').value='';
    pocketFormShown=false;
    document.getElementById('pocketFormFields').classList.remove('show');
    document.getElementById('pocketFormToggle').textContent='+ agregar bolsillo';
    renderAll();
  });

  function goalCurrent(goal){
    let total = goal.includeContributions===false ? 0 : goalOwnFunds(goal);
    total += (goal.pocketIds||[]).reduce((s,id)=>{ const p=data.pockets.find(x=>x.id===id); return s+(p?pocketBalance(p):0); },0);
    total += (goal.investmentIds||[]).reduce((s,id)=>{ const i=data.investments.find(x=>x.id===id); return s+(i?investmentTotal(i):0); },0);
    return total;
  }

  function renderGoals(){
    const listEl = document.getElementById('goalsList');
    if(data.goals.length===0){
      listEl.innerHTML = '<div class="empty">Aún no tienes metas de ahorro.</div>';
      return;
    }
    const capacity = avgMonthlyCapacity();
    listEl.innerHTML = data.goals.map(g=>{
      const current = goalCurrent(g);
      const pct = g.target>0 ? Math.min(100, Math.round((current/g.target)*100)) : 0;
      const remaining = Math.max(0, g.target - current);
      let dueStr = '', planHtml = '';
      if(g.targetDate){
        const days = Math.ceil((fromKey(g.targetDate) - new Date(hoyKey()+'T00:00:00'))/86400000);
        dueStr = days>=0 ? `${days} días restantes` : 'vencida';
        const monthsLeft = Math.max(1, days/30.44);
        const monthlyNeeded = remaining>0 ? remaining/monthsLeft : 0;
        if(remaining<=0){
          planHtml = `<div class="goal-plan ontrack">✓ Meta alcanzada</div>`;
        } else if(capacity===null){
          planHtml = `<div class="goal-plan unknown">Necesitas ahorrar <b>${formatCOP(monthlyNeeded)}</b>/mes. Aún no hay suficiente historial para evaluar tu capacidad.</div>`;
        } else if(capacity <= 0){
          planHtml = `<div class="goal-plan risk">Necesitas ahorrar <b>${formatCOP(monthlyNeeded)}</b>/mes, pero en promedio no estás generando excedente. Revisa tus gastos.</div>`;
        } else if(monthlyNeeded <= capacity*0.9){
          planHtml = `<div class="goal-plan ontrack">Vas bien: necesitas ${formatCOP(monthlyNeeded)}/mes y tu capacidad promedio es ${formatCOP(capacity)}/mes.</div>`;
        } else if(monthlyNeeded <= capacity*1.2){
          planHtml = `<div class="goal-plan tight">Ajustado: necesitas ${formatCOP(monthlyNeeded)}/mes, cerca de tu capacidad promedio (${formatCOP(capacity)}/mes).</div>`;
        } else {
          planHtml = `<div class="goal-plan risk">En riesgo: necesitas ${formatCOP(monthlyNeeded)}/mes pero tu capacidad promedio es ${formatCOP(capacity)}/mes.</div>`;
        }
      } else {
        planHtml = `<div class="goal-plan unknown">Agrega una fecha objetivo para calcular cuánto ahorrar al mes.</div>`;
      }
      return `<div class="goal-card" data-goal="${escapeAttr(g.id)}">
        <div class="goal-top"><span class="name">${escapeAttr(g.name)}</span><span class="due">${dueStr}</span></div>
        <div class="goal-progress-track"><div class="goal-progress-fill" data-pct="${pct}"></div></div>
        <div class="goal-nums"><span><b>${formatCOP(current)}</b> de ${formatCOP(g.target)}</span><span>${pct}%</span></div>
        ${planHtml}
        <div class="goal-sources-summary">Fuentes: ${escapeAttr(selectedGoalSources(g))}</div>
        ${data.accounts.length===0 ? '<div class="mini-hint">Crea una cuenta para poder abonar a esta meta.</div>' : `
        <details class="detalle"><summary>Abonar o retirar</summary>
        <div class="mini-transfer-row" data-goal-transfer="${escapeAttr(g.id)}">
          <select class="mini-acc-select" aria-label="Cuenta de origen o destino">${accountTransferOptions()}</select>
          <input type="number" class="mini-amt-input" placeholder="Monto" aria-label="Monto a abonar o retirar" min="0" step="10000">
          <button class="btn-accent mini-abono-btn">Abonar</button>
          <button class="btn-ghost mini-retiro-btn">Retirar</button>
        </div></details>`}
        <div class="fila-acciones margen-arriba-chico"><button class="btn-mini goal-edit-btn">${iconoHtml('editar')}Editar</button><button class="btn-mini peligro goal-del-btn">${iconoHtml('eliminar')}Eliminar</button></div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.goal-progress-fill[data-pct]').forEach(el=>{ el.style.setProperty('width', el.dataset.pct+'%'); });
    listEl.querySelectorAll('.goal-card').forEach(card=>{
      const id = card.dataset.goal;
      card.querySelector('.goal-edit-btn').addEventListener('click', ()=>{
        openEditModal('goal', id);
      });
      const row = card.querySelector('[data-goal-transfer]');
      if(row){
        row.querySelector('.mini-abono-btn').addEventListener('click', async ()=>{
          const accId = row.querySelector('.mini-acc-select').value;
          const amt = aEntero(parseFloat(row.querySelector('.mini-amt-input').value));
          if(!amt || amt<=0) return;
          const ok = await handleAbono(accId, amt, 'goal', id);
          if(ok){ showToast('Abono registrado'); renderAll(); }
        });
        row.querySelector('.mini-retiro-btn').addEventListener('click', async ()=>{
          const accId = row.querySelector('.mini-acc-select').value;
          const amt = aEntero(parseFloat(row.querySelector('.mini-amt-input').value));
          if(!amt || amt<=0) return;
          const ok = await handleRetiro(accId, amt, 'goal', id);
          if(ok){ showToast('Retiro registrado'); renderAll(); }
        });
      }
      card.querySelector('.goal-del-btn').addEventListener('click', async ()=>{
        if(!await askConfirm('¿Eliminar esta meta? Los abonos que le hiciste quedan en el historial.')) return;
        data.goals = data.goals.filter(g=>g.id!==id);
        await saveData(); renderAll();
      });
    });
  }
  document.getElementById('addGoalBtn').addEventListener('click', async ()=>{
    const name = document.getElementById('goalName').value.trim();
    const target = aEntero(parseFloat(document.getElementById('goalTarget').value));
    const targetDate = document.getElementById('goalDate').value;
    if(!name || !target || target<=0) return;
    const includeContributions=document.getElementById('goalIncludeContributions').checked;
    const pocketIds=Array.from(document.querySelectorAll('.goal-pocket-check:checked')).map(el=>el.value);
    const investmentIds=Array.from(document.querySelectorAll('.goal-investment-check:checked')).map(el=>el.value);
    data.goals.push({id:'g'+Date.now(),name,target,targetDate,includeContributions,pocketIds,investmentIds,contributions:[]});
    await saveData();
    document.getElementById('goalName').value = ''; document.getElementById('goalTarget').value = '';
    document.getElementById('goalDate').value = '';
    goalFormShown = false;
    document.getElementById('goalFormFields').classList.remove('show');
    document.getElementById('goalFormToggle').textContent = '+ nueva meta';
    showToast('Meta creada');
    renderAll();
  });

  function addMonthsToDate(date, months){
    const d = new Date(date);
    const day = d.getDate();
    d.setDate(1); // evita que el mes se desborde al sumar
    d.setMonth(d.getMonth() + Number(months));
    const daysInMonth = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    d.setDate(Math.min(day, daysInMonth)); // ajusta si el mes destino es más corto (ej. 31 ene + 1 mes -> 28/29 feb)
    return d;
  }
  function investmentMaturity(inv){
    const start = fromKey(inv.startDate);
    const maturity = addMonthsToDate(start, inv.termMonths);
    const totalDays = Math.round((maturity - start)/86400000);
    // El principal invertido inicialmente sí se proyecta con la tasa EA.
    // Los aportes adicionales posteriores (abonos vinculados) se suman a
    // valor nominal, sin capitalizar por separado — simplificación razonable
    // para un seguimiento personal.
    // Lo que llega a la cuenta es el neto: el banco retiene el 4 % del rendimiento.
    const cdt = proyeccionCdt({ monto: inv.amount, tasaEA: inv.rate, dias: totalDays });
    const projected = cdt.neto + investmentExtra(inv);
    const daysLeft = Math.ceil((maturity - new Date(hoyKey()+'T00:00:00'))/86400000);
    return { maturityKey: toKey(maturity), projected, daysLeft, rendimiento: cdt.rendimiento, retencion: cdt.retencion };
  }

  function renderInvestments(){
    const listEl = document.getElementById('investList');
    if(data.investments.length===0){
      listEl.innerHTML = '<div class="empty">Aún no registras CDT u otras inversiones.</div>';
      return;
    }
    listEl.innerHTML = data.investments.slice().sort((a,b)=>investmentMaturity(a).daysLeft-investmentMaturity(b).daysLeft).map(inv=>{
      const { maturityKey, projected, daysLeft, rendimiento, retencion } = investmentMaturity(inv);
      const matured = daysLeft <= 0;
      const soon = !matured && daysLeft<=7;
      const statusCls = matured ? 'matured' : (soon ? 'soon' : 'active');
      const statusTxt = matured ? 'Vencido' : (soon ? 'Vence pronto' : 'Activo');
      const maturityFmt = fromKey(maturityKey).toLocaleDateString('es-CO', {day:'numeric', month:'short', year:'numeric'});
      const extra = investmentExtra(inv);
      return `<div class="inv-card" data-inv="${escapeAttr(inv.id)}">
        <div class="inv-top"><span class="name">${escapeAttr(inv.entity)}</span><span class="inv-status ${statusCls}">${statusTxt}</span></div>
        <div class="inv-grid">
          <div>Monto invertido<b>${formatCOP(inv.amount)}</b></div>
          <div>Tasa EA<b>${inv.rate}%</b></div>
          <div>Vence<b>${maturityFmt}</b></div>
          <div>${matured?'Venció hace':'Días restantes'}<b>${Math.abs(daysLeft)}</b></div>
          ${extra ? `<div class="celda-ancha">Aportes adicionales<b>${formatCOP(extra)}</b></div>` : ''}
          <div>Rendimiento bruto<b>${formatCOP(rendimiento)}</b></div>
          <div>Retención (4 %)<b>−${formatCOP(retencion)}</b></div>
          <div class="celda-ancha destacado">Recibirás al vencimiento (neto)<b>${formatCOP(projected)}</b></div>
        </div>
        ${data.accounts.length===0 ? '<div class="mini-hint">Crea una cuenta para poder aportar o retirar de este CDT.</div>' : `
        <details class="detalle"><summary>Aportar o retirar</summary>
        <div class="mini-transfer-row" data-inv-transfer="${escapeAttr(inv.id)}">
          <select class="mini-acc-select" aria-label="Cuenta de origen o destino">${accountTransferOptions()}</select>
          <input type="number" class="mini-amt-input" placeholder="Monto" aria-label="Monto a abonar o retirar" min="0" step="10000">
          <button class="btn-accent mini-abono-btn">Aportar</button>
          <button class="btn-ghost mini-retiro-btn">Retirar</button>
        </div></details>`}
        <div class="fila-acciones margen-arriba-chico"><button class="btn-mini inv-edit-btn">${iconoHtml('editar')}Editar</button><button class="btn-mini peligro inv-del-btn">${iconoHtml('eliminar')}Eliminar</button></div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.inv-card').forEach(card=>{
      const id = card.dataset.inv;
      card.querySelector('.inv-edit-btn').addEventListener('click', ()=>{
        openEditModal('investment', id);
      });
      const row = card.querySelector('[data-inv-transfer]');
      if(row){
        row.querySelector('.mini-abono-btn').addEventListener('click', async ()=>{
          const accId = row.querySelector('.mini-acc-select').value;
          const amt = aEntero(parseFloat(row.querySelector('.mini-amt-input').value));
          if(!amt || amt<=0) return;
          const ok = await handleAbono(accId, amt, 'investment', id);
          if(ok){ showToast('Aporte registrado'); renderAll(); }
        });
        row.querySelector('.mini-retiro-btn').addEventListener('click', async ()=>{
          const accId = row.querySelector('.mini-acc-select').value;
          const amt = aEntero(parseFloat(row.querySelector('.mini-amt-input').value));
          if(!amt || amt<=0) return;
          const ok = await handleRetiro(accId, amt, 'investment', id);
          if(ok){ showToast('Retiro registrado'); renderAll(); }
        });
      }
      card.querySelector('.inv-del-btn').addEventListener('click', async ()=>{
        if(!await askConfirm('¿Eliminar este CDT? Deja de sumar a tu patrimonio.')) return;
        data.investments = data.investments.filter(i=>i.id!==id);
        data.goals.forEach(g=>{ if(g.investmentIds) g.investmentIds = g.investmentIds.filter(x=>x!==id); });
        await saveData(); renderAll();
      });
    });
  }
  document.getElementById('addInvBtn').addEventListener('click', async ()=>{
    const entity = document.getElementById('invEntity').value.trim();
    const amount = aEntero(parseFloat(document.getElementById('invAmount').value));
    const rate = parseFloat(document.getElementById('invRate').value);
    const termMonths = parseInt(document.getElementById('invTerm').value);
    const startDate = document.getElementById('invStart').value || hoyKey();
    if(!entity || !amount || amount<=0 || !rate || rate<0 || !termMonths || termMonths<=0) return;
    data.investments.push({id:'i'+Date.now(), entity, amount, rate, termMonths, startDate});
    await saveData();
    document.getElementById('invEntity').value=''; document.getElementById('invAmount').value='';
    document.getElementById('invRate').value=''; document.getElementById('invTerm').value='';
    document.getElementById('invStart').value='';
    invFormShown = false;
    document.getElementById('invFormFields').classList.remove('show');
    document.getElementById('invFormToggle').textContent = '+ nuevo CDT';
    showToast('CDT registrado');
    renderAll();
  });

  // ---- Reportes IA ----
  function simpleMarkdown(text){
    // El texto pegado no es confiable: se escapa antes de aplicar el formato.
    const lines = escapeAttr(text).split('\n');
    let html = ''; let inList = false;
    lines.forEach(raw=>{
      let line = raw.trim();
      if(line.startsWith('## ')){
        if(inList){ html += '</ul>'; inList=false; }
        html += `<h3>${line.slice(3)}</h3>`;
      } else if(line.startsWith('- ')){
        if(!inList){ html += '<ul>'; inList=true; }
        html += `<li>${line.slice(2).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')}</li>`;
      } else if(line===''){
        if(inList){ html += '</ul>'; inList=false; }
      } else {
        if(inList){ html += '</ul>'; inList=false; }
        html += `<p>${line.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')}</p>`;
      }
    });
    if(inList) html += '</ul>';
    return html;
  }

  // Genera un análisis local (sin IA) cuando no hay una API key configurada
  // o la llamada a Anthropic falla (p. ej. en GitHub Pages sin backend propio).
  function buildLocalFallbackReport(monthKey, stats){
    const capacity = avgMonthlyCapacity();
    const totalBalance = data.accounts.reduce((s,a)=>s+accountBalance(a),0);
    const topCat = Object.entries(stats.byCategory).sort((a,b)=>b[1]-a[1])[0];
    let html = '<h3>Diagnóstico del mes</h3>';
    html += `<p>En ${monthLabel(monthKey)} tuviste ingresos de <b>${formatCOP(stats.income)}</b> y gastos de <b>${formatCOP(stats.expense)}</b>, con un balance de <b>${formatCOP(stats.balance)}</b> (tasa de ahorro del ${stats.savingsRate}%).</p>`;
    if(topCat) html += `<p>Tu categoría de mayor gasto fue <b>${escapeAttr(topCat[0])}</b> con ${formatCOP(topCat[1])}.</p>`;
    html += '<h3>Recomendaciones</h3><ul>';
    if(stats.savingsRate < 10) html += '<li>Tu tasa de ahorro está baja; intenta apartar al menos un 10-20% de tus ingresos apenas los recibas.</li>';
    else html += '<li>Buena tasa de ahorro este mes — mantenla si puedes.</li>';
    if(topCat) html += `<li>Revisa si hay margen para recortar gasto en <b>${escapeAttr(topCat[0])}</b>.</li>`;
    if(capacity!==null) html += `<li>Con tu capacidad de ahorro promedio (${formatCOP(capacity)}/mes) puedes ajustar el aporte mensual a tus metas.</li>`;
    const deuda = patrimonio(data).pasivos;
    if(deuda>0) html += `<li>Tienes deudas por <b>${formatCOP(deuda)}</b>. Compara en Tarjetas el costo de pagar solo el mínimo.</li>`;
    if(totalBalance<=0) html += '<li>Tu saldo consolidado está en cero o negativo; prioriza cubrir gastos esenciales antes de nuevos compromisos.</li>';
    html += '</ul><p class="nota-pequena">Análisis generado localmente en tu dispositivo (sin IA) — no reemplaza asesoría financiera profesional.</p>';
    return html;
  }

  async function requestAiAnalysis(report){
    const stats = { income: report.income, expense: report.expense, balance: report.balance, savingsRate: report.savingsRate, byCategory: report.byCategory };
    // Esta app corre sola (GitHub Pages), sin backend ni API key configurada,
    // así que no intentamos llamar a la API de Anthropic directamente — eso
    // solo funcionaría dentro del entorno de Claude.ai. En su lugar generamos
    // de inmediato un análisis local (reglas simples) y dejamos disponible la
    // opción de copiar un prompt para pedirle un análisis más completo a Claude.
    report.aiHtml = buildLocalFallbackReport(report.monthKey, stats);
    report.aiDate = hoyKey();
    await saveData();
  }

  function buildFullReportPrompt(report){ return promptReporte(agregados(data, report.monthKey)); }

  async function copyReportPrompt(monthKey){
    const report = data.reports.find(r=>r.monthKey===monthKey);
    if(!report) return;
    const prompt = buildFullReportPrompt(report);
    try{
      await navigator.clipboard.writeText(prompt);
      showToast('Prompt copiado — pégalo en la app de Claude');
    }catch(e){
      const box = document.querySelector(`.report-paste-box[data-month="${monthKey}"]`);
      if(box){ box.value = prompt; box.focus(); box.select(); }
      showToast('No se pudo copiar automático — quedó seleccionado abajo');
    }
  }

  async function saveReportAiFromPaste(monthKey){
    const box = document.querySelector(`.report-paste-box[data-month="${monthKey}"]`);
    if(!box) return;
    const text = box.value.trim();
    if(!text){ showToast('Pega primero la respuesta de Claude'); return; }
    const report = data.reports.find(r=>r.monthKey===monthKey);
    if(!report) return;
    report.aiText = text;
    report.aiDate = hoyKey();
    await saveData();
    box.value = '';
    showToast('Análisis de Claude guardado');
    renderAll();
  }

  async function generateReport(monthKey, withAi){
    const stats = monthStats(monthKey);
    let report = data.reports.find(r=>r.monthKey===monthKey);
    if(!report){
      report = { id:'r'+Date.now(), monthKey, generatedAt: hoyKey() };
      data.reports.unshift(report);
    }
    Object.assign(report, stats);
    await saveData();
    renderAll();
    if(withAi){
      await requestAiAnalysis(report);
      renderAll();
    }
    return report;
  }

  function checkAutoReport(){
    const thisMonthKey = hoyKey().slice(0,7);
    const prevMonthKey = addMonths(thisMonthKey, -1);
    const reportBanner = document.getElementById('reportBanner');
    const hasPrevData = data.transactions.some(t=>monthOf(t.date)===prevMonthKey);
    const alreadyDone = data.settings.lastReportMonth===prevMonthKey;
    if(hasPrevData && !alreadyDone){
      data.settings.lastReportMonth = prevMonthKey;
      saveData();
      generateReport(prevMonthKey, true).then(()=>{
        showToast(`Reporte de ${monthLabel(prevMonthKey)} generado`);
      });
      reportBanner.classList.add('show');
      document.getElementById('reportBannerText').textContent = `Se generó tu reporte de ${monthLabel(prevMonthKey)} con recomendaciones.`;
    } else {
      reportBanner.classList.remove('show');
    }
  }

  document.getElementById('genReportBtn').addEventListener('click', async (e)=>{
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'Generando...';
    await generateReport(hoyKey().slice(0,7), true);
    btn.disabled = false; btn.textContent = 'Generar reporte de este mes';
  });

  function renderReports(){
    const listEl = document.getElementById('reportsList');
    if(data.reports.length===0){
      listEl.innerHTML = '<div class="empty">Aún no hay reportes generados.</div>';
      return;
    }
    const sorted = data.reports.slice().sort((a,b)=>b.monthKey.localeCompare(a.monthKey));
    listEl.innerHTML = sorted.map(r=>{
      const hasAi = !!r.aiText;
      const analysisHtml = hasAi
        ? `<div class="ai-box"><div class="ai-meta">Análisis de Claude · ${r.aiDate||''}</div>${simpleMarkdown(r.aiText)}</div>`
        : (r.aiHtml
          ? `<div class="ai-box"><div class="ai-meta">Análisis local (sin IA) · ${r.aiDate||''}</div>${r.aiHtml}</div>`
          : `<button class="btn-ghost report-gen-btn boton-ancho-mt" data-month="${r.monthKey}">Generar análisis</button>`);
      return `<div class="report-card">
        <div class="report-top"><span class="name">${monthLabel(r.monthKey)}</span><span class="rate">${r.savingsRate}% ahorro</span></div>
        <div class="report-stats">
          <div class="stat"><div class="v color-ingreso">${formatCOP(r.income)}</div><div class="l">Ingresos</div></div>
          <div class="stat"><div class="v color-gasto">${formatCOP(r.expense)}</div><div class="l">Gastos</div></div>
          <div class="stat"><div class="v">${formatCOP(r.balance)}</div><div class="l">Balance</div></div>
        </div>
        ${analysisHtml}
        <div class="extra-toggle-row espacio-arriba"><span class="report-copy-toggle" data-month="${r.monthKey}">${hasAi ? '↻ pedir un análisis nuevo con Claude' : '✨ pedir análisis más completo con Claude'}</span></div>
        <div class="extra-fields" id="reportExtra-${r.monthKey}">
          <button class="btn-ghost report-copy-btn alineado-inicio" data-month="${r.monthKey}">Copiar prompt para Claude</button>
          <textarea class="report-paste-box" data-month="${r.monthKey}" rows="4" placeholder="Pega aquí la respuesta de Claude…"></textarea>
          <button class="btn-ghost report-save-btn alineado-inicio" data-month="${r.monthKey}">Guardar respuesta</button>
        </div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.report-gen-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        btn.disabled = true; btn.textContent = 'Generando...';
        const report = data.reports.find(r=>r.monthKey===btn.dataset.month);
        await requestAiAnalysis(report);
        renderAll();
      });
    });
    listEl.querySelectorAll('.report-copy-toggle').forEach(el=>{
      el.addEventListener('click', ()=>{
        const box = document.getElementById(`reportExtra-${el.dataset.month}`);
        box.classList.toggle('show');
      });
    });
    listEl.querySelectorAll('.report-copy-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> copyReportPrompt(btn.dataset.month));
    });
    listEl.querySelectorAll('.report-save-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> saveReportAiFromPaste(btn.dataset.month));
    });
  }

  function renderSettings(){
    document.getElementById('reminderToggle').classList.toggle('on', !!data.settings.reminderOn);
    document.getElementById('reminderToggle').setAttribute('aria-checked', String(!!data.settings.reminderOn));
    document.getElementById('reminderHour').value = data.settings.reminderHour;
    const notifDesc = document.getElementById('notifDesc');
    const notifBtn = document.getElementById('notifBtn');
    if(!('Notification' in window)){
      notifDesc.textContent = 'Tu navegador no soporta notificaciones — usa el aviso dentro de la app.';
      notifBtn.style.display = 'none';
    } else if(Notification.permission==='granted'){
      notifDesc.textContent = 'Notificaciones activadas mientras la pestaña esté abierta.';
      notifBtn.textContent = 'Activado'; notifBtn.disabled = true;
    } else {
      notifDesc.textContent = 'Notificaciones del navegador (solo con la pestaña abierta).';
    }
  }
  document.getElementById('reminderToggle').addEventListener('click', async ()=>{
    data.settings.reminderOn = !data.settings.reminderOn; await saveData(); renderAll();
  });
  document.getElementById('reminderHour').addEventListener('change', async (e)=>{
    let h = parseInt(e.target.value); if(isNaN(h)) h = 20; h = Math.max(0, Math.min(23, h));
    data.settings.reminderHour = h; await saveData(); renderAll();
  });
  document.getElementById('notifBtn').addEventListener('click', async ()=>{
    if('Notification' in window){ await Notification.requestPermission(); renderSettings(); }
  });

  document.getElementById('exportBtn').addEventListener('click', async ()=>{
    try{
      const clave = document.getElementById('exportClave').value;
      const contenido = clave ? await cifrar(exportable(data), clave) : exportable(data);
      descargar(`finanzas-backup-${hoyKey()}${clave ? '.cifrado' : ''}.json`, JSON.stringify(contenido, null, 2), 'application/json');
      document.getElementById('exportClave').value='';
      showToast('Copia descargada');
    }catch(err){ showToast(err.message); }
  });
  document.getElementById('importBtn').addEventListener('click', ()=>{ document.getElementById('importFile').click(); });
  document.getElementById('importFile').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    e.target.value = '';
    try{
      let parsed = JSON.parse(await file.text());
      if(estaCifrado(parsed)) parsed = await descifrar(parsed, document.getElementById('exportClave').value);
      validarCopia(parsed);
      if(!await askConfirm('Esto reemplazará tus datos actuales en esta app. ¿Continuar?')) return;
      // Se conserva la conexión local, que nunca viaja en las copias.
      const conexion = data.settings?.ingesta;
      const nuevos = migrar(parsed).datos;
      // El HTML guardado de un archivo externo no es confiable; el análisis se puede regenerar.
      nuevos.reports.forEach(r=>{ delete r.aiHtml; });
      if(conexion){ nuevos.settings.ingesta = { ...nuevos.settings.ingesta, url: conexion.url, token: conexion.token }; }
      data = nuevos;
      await saveData(); renderAll();
      showToast('Datos restaurados');
    }catch(err){ showToast(err.message || 'Archivo inválido'); }
  });

  // ---- Instalar como app ----
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredInstallPrompt = e;
    renderInstallBanner();
  });
  function isStandalone(){
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  async function renderInstallBanner(){
    const banner=document.getElementById('installBanner');
    if(isStandalone()){ banner.classList.remove('show'); return; }
    const ua=navigator.userAgent;
    const isIOS=/iPad|iPhone|iPod/.test(ua)&&!window.MSStream;
    const isAndroid=/Android/i.test(ua);
    const textEl=document.getElementById('installBannerText');
    const btn=document.getElementById('installDismissBtn');
    let installBtn=document.getElementById('installNowBtn');

    if(!installBtn){
      installBtn=document.createElement('button');
      installBtn.id='installNowBtn';
      installBtn.className='btn-accent boton-pequeno boton-pequeno--separado';
      btn.parentElement.insertBefore(installBtn,btn);
    }

    if(deferredInstallPrompt){
      textEl.innerHTML='La app está lista para instalarse. Pulsa <b>Instalar app</b>.';
      installBtn.style.display='inline-block';
      installBtn.textContent='Instalar app';
      installBtn.onclick=async()=>{
        deferredInstallPrompt.prompt();
        try{ await deferredInstallPrompt.userChoice; }catch(e){}
        deferredInstallPrompt=null;
        renderInstallBanner();
      };
    }else if(isIOS){
      textEl.innerHTML='En iPhone/iPad: toca <b>Compartir</b> ↑ y luego <b>“Añadir a pantalla de inicio”</b>.';
      installBtn.style.display='none';
    }else if(isAndroid){
      textEl.innerHTML='En Android: abre el menú ⋮ y busca <b>“Instalar app”</b> o <b>“Añadir a pantalla de inicio”</b>.';
      installBtn.style.display='none';
    }else{
      // En un computador sin opción de instalar no hay nada útil que decir.
      banner.classList.remove('show');
      return;
    }
    banner.classList.add('show');
  }

  document.getElementById('installDismissBtn').addEventListener('click', ()=>{
    document.getElementById('installBanner').classList.remove('show');
  });

  function renderAll(){
    populateCategoryDatalist();
    populateAccountSelect();
    renderAccounts();
    renderPocketsAndGoalSources();
    renderWheelAndHeader();
    renderSummary();
    renderHistory();
    renderGoals();
    renderInvestments();
    renderReports();
    renderSettings();
    renderInstallBanner();
    interfaz.render();
  }

  (async function init(){
    document.getElementById('txDate').value = hoyKey();
    const carga = await cargar();
    if(carga.error){
      // Los datos siguen intactos en el dispositivo: se bloquea la escritura y se avisa.
      bloqueoGuardado = 'Guardado bloqueado para proteger tus datos';
      const aviso = document.getElementById('errorDatos');
      aviso.textContent = `No se pudieron abrir tus datos (${carga.error}). No se ha modificado nada.`;
      aviso.classList.add('show');
      data = migrar({}).datos;
    } else {
      data = carga.datos;
    }
    data.investments.forEach(inv=>{
      if(inv.termMonths==null && inv.termDays!=null) inv.termMonths = Math.max(1, Math.round(inv.termDays/30));
    });
    populateCategoryDatalist();
    await iniciarInterfaz(interfaz, {
      datos: ()=>data,
      guardar: saveData,
      renderAll,
      toast: showToast,
      preguntar: askConfirm,
      uid,
      descargar,
    });
    renderAll();
    activarCombobox();
    setInterval(renderWheelAndHeader, 60000);
  })();
