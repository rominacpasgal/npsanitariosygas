/* Mejoras de fechas, agenda, presupuestos y trazabilidad de equipos. */
(() => {
  if (updatedFields.quote && !updatedFields.quote.some(f => f[0] === 'extra')) {
    updatedFields.quote.push(['extra', 'Comentario adicional (opcional)', 'textarea', 1]);
  }
  if (updatedFields.quote && !updatedFields.quote.some(f => f[0] === 'title')) {
    updatedFields.quote.splice(1, 0, ['title', 'Título del trabajo', 'text', 1]);
  }
  if (updatedFields.quote) {
    const detailField = updatedFields.quote.find(f => f[0] === 'detail');
    if (detailField) detailField[1] = 'Materiales y mano de obra / detalle del presupuesto';
  }
  const originalOpenForm = window.openForm;
  window.openForm = function (type, id = null) {
    originalOpenForm(type, id);
    if (type !== 'job') return;
    const form = document.getElementById('entryForm');
    const status = form.elements.namedItem('status');
    if (status && ![...status.options].some(o => o.value === 'Pendiente')) {
      status.insertAdjacentHTML('afterbegin', '<option>Pendiente</option>');
    }
    const job = id ? db.jobs.find(j => j.id === id) : null;
    if (job && status) status.value = job.status || 'Agendado';
    let quoteId = form.elements.namedItem('quoteId');
    if (!quoteId) {
      quoteId = document.createElement('input'); quoteId.type = 'hidden'; quoteId.name = 'quoteId';
      form.appendChild(quoteId);
    }
    quoteId.value = job?.quoteId || '';
  };
  const entryForm = document.getElementById('entryForm');
  const originalSubmit = entryForm.onsubmit;
  entryForm.onsubmit = function (event) {
    const quoteId = entryForm.elements.namedItem('quoteId')?.value;
    const result = originalSubmit.call(this, event);
    if (quoteId) setTimeout(() => {
      const job = db.jobs.find(j => j.quoteId === quoteId);
      const quote = db.quotes.find(q => q.id === quoteId);
      if (job && quote && quote.jobId !== job.id) { quote.jobId = job.id; save(); }
    }, 0);
    return result;
  };

  const filter = document.getElementById('jobFilter');
  if (filter && ![...filter.options].some(o => o.value === 'Pendiente')) {
    filter.insertAdjacentHTML('beforeend', '<option>Pendiente</option>');
  }

  window.renderJobs = function (query = '') {
    const state = document.getElementById('jobFilter')?.value || '';
    const rows = db.jobs.filter(j => (!state || j.status === state) &&
      (!query || [clientName(j.client),j.title,j.address,j.description,j.materials,j.repairs,j.consumables]
        .join(' ').toLowerCase().includes(query.toLowerCase())))
      .sort((a,b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''));
    document.getElementById('jobsTable').innerHTML = rows.length ? rows.map(j => {
      const total = Number(j.amount || 0), paid = Number(j.paidAmount ?? (j.paid ? total : 0));
      const equipment = db.equipment.find(e => e.id === j.equipment);
      const partsSummary=(j.partsUsed||[]).map(p=>`${p.quantity} ${db.stockItems.find(i=>i.id===p.itemId)?.unit||'u.'} ${p.name} · ${money(Number(p.quantity||0)*Number(p.unitPrice||0))}`).join(', ');
      const items = [['Realizado',j.description],['Repuestos del stock',partsSummary],['Repuestos y materiales',j.materials],['Partes reparadas',j.repairs],
        ['Insumos',j.consumables],['Equipo',equipment ? [equipment.name,equipment.brand,equipment.model,equipment.installYear,equipment.type].filter(Boolean).join(' · ') : ''],
        ['Garantía',j.warrantyMonths ? `${j.warrantyMonths} meses` : 'No especificada'],['Observaciones',j.notes]].filter(x => x[1]);
      return `<tr><td>${dateFmt(j.date)}<br><span class="muted">${esc(j.time||'')}</span></td><td>${esc(clientName(j.client))}</td>
        <td><b>${esc(j.title||'Trabajo')}</b><br><details><summary class="link">Ver registro completo</summary><div class="row-desc" style="white-space:normal">${items.map(x=>`<b>${esc(x[0])}:</b> ${esc(x[1])}`).join('<br>')}</div></details></td>
        <td><select class="filter" style="padding:5px" onchange="setStatus('${j.id}',this.value)">${['Pendiente','Agendado','En curso','Completado','Pendiente de cobro'].map(s=>`<option ${j.status===s?'selected':''}>${s}</option>`).join('')}</select></td>
        <td>${money(total)}<br><span class="muted">Saldo: ${money(Math.max(0,total-paid))}</span></td>
        <td><button class="btn" style="padding:6px 9px" onclick="openForm('job','${j.id}')">Editar</button><br><button class="btn" style="padding:6px 9px;margin-top:5px" onclick="addPayment('${j.id}')">Anotar pago</button> <button class="btn" style="padding:6px 9px;margin-top:5px" onclick="deleteItem('jobs','${j.id}')">Eliminar</button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">Todavía no hay trabajos registrados.</td></tr>';
  };

  window.setStatus = function (id, status) {
    const job = db.jobs.find(j => j.id === id); if (!job) return;
    job.status = status;
    if (['Completado','Pendiente de cobro'].includes(status)) {
      const equipment = db.equipment.find(e => e.id === job.equipment);
      if (equipment && (!equipment.last || equipment.last < job.date)) equipment.last = job.date;
    }
    save();
  };

  window.renderEquipment = function (query = '') {
    const rows = db.equipment.filter(e => !query || [e.name,clientName(e.client),e.brand,e.model,e.serial,e.type]
      .join(' ').toLowerCase().includes(query.toLowerCase()));
    document.getElementById('equipmentTable').innerHTML = rows.length ? rows.map(e => {
      const completed = db.jobs.filter(j => j.equipment === e.id && ['Completado','Pendiente de cobro'].includes(j.status));
      const last = [e.last,...completed.map(j => j.date)].filter(Boolean).sort((a,b)=>b.localeCompare(a))[0] || '';
      return `<tr><td><b>${esc(e.name)}</b><br><span class="muted">${esc(e.observations||e.notes||'')}</span></td>
        <td>${esc(clientName(e.client))}</td><td>${esc(e.type||'—')}</td><td>${esc([e.brand,e.model].filter(Boolean).join(' / ')||'—')}</td>
        <td>${esc(e.installYear||'—')}</td><td>${dateFmt(last)}</td><td><button class="btn" style="padding:6px 9px" onclick="viewEquipmentHistory('${e.id}')">Historial</button><br><button class="btn" style="padding:6px 9px;margin-top:5px" onclick="openForm('equipment','${e.id}')">Editar</button> <button class="btn" style="padding:6px 9px;margin-top:5px" onclick="deleteItem('equipment','${e.id}')">Eliminar</button></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">Todavía no hay equipos registrados.</td></tr>';
  };

  window.viewEquipmentHistory = function (equipmentId) {
    const equipment = db.equipment.find(e => e.id === equipmentId); if (!equipment) return;
    let modal = document.getElementById('equipmentHistoryModal');
    if (!modal) {
      modal = document.createElement('div'); modal.id = 'equipmentHistoryModal'; modal.className = 'modal-back';
      modal.innerHTML = '<div class="modal"><div class="modal-head"><h2 id="equipmentHistoryTitle"></h2><button class="x" onclick="closeEquipmentHistory()">×</button></div><div class="modal-body" id="equipmentHistoryBody"></div><div class="modal-foot"><button class="btn" onclick="closeEquipmentHistory()">Cerrar</button></div></div>';
      modal.addEventListener('click',e=>{if(e.target===modal)closeEquipmentHistory()}); document.body.appendChild(modal);
    }
    const jobs = db.jobs.filter(j=>j.equipment===equipmentId && ['Completado','Pendiente de cobro'].includes(j.status))
      .sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.time||'').localeCompare(a.time||''));
    document.getElementById('equipmentHistoryTitle').textContent = `${equipment.name} · Historial de trabajos`;
    document.getElementById('equipmentHistoryBody').innerHTML = jobs.length ? jobs.map(j=>`<div class="row" style="display:block">
      <div class="row-title">${dateFmt(j.date)} · ${esc(j.title||'Trabajo realizado')}</div>
      <div class="row-desc" style="white-space:normal">${[['Descripción',j.description],['Repuestos del stock',(j.partsUsed||[]).map(p=>`${p.quantity} ${p.name} · cobrado ${money(Number(p.quantity||0)*Number(p.unitPrice||0))} · costo ${money(Number(p.quantity||0)*Number(p.unitCost||0))}`).join(', ')],['Repuestos/materiales',j.materials],['Partes reparadas',j.repairs],['Insumos',j.consumables],['Garantía',j.warrantyMonths?`${j.warrantyMonths} meses`:'' ],['Observaciones',j.notes]].filter(x=>x[1]).map(x=>`<b>${esc(x[0])}:</b> ${esc(x[1])}`).join('<br>')}</div>
    </div>`).join('') : '<div class="empty">Todavía no hay trabajos realizados asociados a este equipo.</div>';
    modal.classList.add('open');
  };
  window.closeEquipmentHistory = function () { document.getElementById('equipmentHistoryModal')?.classList.remove('open'); };

  window.renderQuotes = function () {
    const rows = [...db.quotes].reverse();
    document.getElementById('quotesTable').innerHTML = rows.length ? rows.map(q => {
      const customer = db.clients.find(c=>c.id===q.client);
      const firstName = (customer?.name || '').trim().split(/\s+/)[0] || 'buen día';
      const title = (q.title || (q.detail || 'Trabajo solicitado').split(/\r?\n/)[0]).replace(/[.!?]+$/,'');
      const extra = q.extra ? `\n\nInformación adicional: ${q.extra}` : '';
      const message = `Hola, ${firstName}. ¡Buen día!\nDesde NP Sanitarios y Gas te compartimos el presupuesto solicitado:\n\nDetalle del trabajo: ${title}.\n\nMateriales y mano de obra:\n${q.detail || ''}${extra}\n\nTOTAL: ${money(q.amount)}\nValidez del presupuesto: ${q.valid ? dateFmt(q.valid) : 'sin fecha definida'}.\n\nSi estás de acuerdo con el presupuesto, podés responder a este mensaje para coordinar la realización del trabajo.\n¡Muchas gracias por tu consulta y por confiar en nosotros!\n\nNicolás Pérez\nNP Sanitarios y Gas`;
      const whatsapp = customer?.phone ? `<a class="btn" style="padding:6px 9px" target="_blank" rel="noopener" href="${waLink(customer.phone)}?text=${encodeURIComponent(message)}">Enviar por WhatsApp</a>` : '<span class="muted">Sin WhatsApp</span>';
      const schedule = q.status==='Aceptado' ? (q.jobId ? '<span class="badge done">Trabajo agendado</span>' : `<button class="btn primary" style="padding:6px 9px" onclick="scheduleQuote('${q.id}')">Agendar trabajo</button>`) : '';
      return `<tr><td>${dateFmt(q.date)}</td><td>${esc(clientName(q.client))}</td><td>${q.title?`<b>${esc(q.title)}</b><br>`:''}${esc(q.detail)}${q.extra?`<br><span class="muted">${esc(q.extra)}</span>`:''}</td>
        <td>${dateFmt(q.valid)}</td><td><span class="badge ${q.status==='Pendiente'?'pending':''}">${esc(q.status)}</span></td><td>${money(q.amount)}</td>
        <td><div style="display:grid;gap:5px">${whatsapp}${schedule}<button class="btn" style="padding:6px 9px" onclick="openForm('quote','${q.id}')">Editar</button><button class="btn" style="padding:6px 9px" onclick="deleteItem('quotes','${q.id}')">Eliminar</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">Todavía no hay presupuestos registrados.</td></tr>';
  };

  window.scheduleQuote = function (quoteId) {
    const quote = db.quotes.find(q=>q.id===quoteId); if (!quote || quote.status!=='Aceptado' || quote.jobId) return;
    window.openForm('job');
    const form = document.getElementById('entryForm');
    form.elements.namedItem('client').value = quote.client;
    form.elements.namedItem('title').value = `Presupuesto aprobado: ${(quote.title||quote.detail||'Trabajo').slice(0,55)}`;
    form.elements.namedItem('description').value = quote.detail||'';
    form.elements.namedItem('notes').value = quote.extra||'';
    form.elements.namedItem('amount').value = Number(quote.amount||0);
    form.elements.namedItem('status').value = 'Pendiente';
    form.elements.namedItem('quoteId').value = quote.id;
  };

  const oldDeleteItem = window.deleteItem;
  window.deleteItem = function (type, id) {
    if (type === 'clients') {
      const linked = [
        ['equipos',db.equipment.filter(x=>x.client===id).length],
        ['presupuestos',db.quotes.filter(x=>x.client===id).length],
        ['trabajos',db.jobs.filter(x=>x.client===id).length]
      ].filter(x=>x[1]);
      if (linked.length) {
        toast(`No se puede eliminar: el cliente tiene ${linked.map(x=>`${x[1]} ${x[0]}`).join(', ')} asociado(s).`);
        return;
      }
    }
    oldDeleteItem(type,id);
  };

  renderAll();
})();

/* Inventario: compras vinculables a trabajos y repuestos imputados a cada servicio. */
(() => {
  if (!Array.isArray(db.stockItems)) db.stockItems = [];
  if (!Array.isArray(db.stockMoves)) db.stockMoves = [];
  const nav = document.querySelector('.nav button[data-page="finanzas"]');
  if (nav && !document.querySelector('[data-page="stock"]')) {
    const button = document.createElement('button');
    button.dataset.page = 'stock'; button.innerHTML = '<span class="ico">▦</span>Stock de repuestos';
    button.onclick = () => navigate('stock'); nav.after(button);
  }
  if (!document.getElementById('page-stock')) {
    const section = document.createElement('section'); section.className = 'section'; section.id = 'page-stock';
    section.innerHTML = `<div class="heading"><div><div class="eyebrow">Inventario</div><h1>Stock de repuestos</h1><div class="sub">Controlá existencias, costos de compra y precios cobrados al cliente.</div></div><div class="actions"><button class="btn primary" onclick="openStockItem()">＋ Nuevo repuesto</button><button class="btn" onclick="openForm('expense')">＋ Registrar compra</button></div></div><div class="panel table-wrap"><table class="data-table"><thead><tr><th>Repuesto</th><th>Existencia</th><th>Costo unitario</th><th>Precio al cliente</th><th>Mínimo</th><th>Acciones</th></tr></thead><tbody id="stockTable"></tbody></table></div><div class="info">Al registrar una compra, indicá el repuesto y la cantidad para sumar unidades al stock. Al usar repuestos en un trabajo, se guarda el costo y se agregan al total a cobrar.</div>`;
    document.querySelector('main .content').appendChild(section);
  }
  const baseNavigate = window.navigate;
  window.navigate = function(page) {
    if (page !== 'stock') return baseNavigate(page);
    document.querySelectorAll('.nav button[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === 'page-stock'));
    document.getElementById('crumb').textContent = 'Stock de repuestos';
    document.getElementById('sidebar').classList.remove('open'); renderStock();
  };
  const qty = item => Number(item.quantity ?? item.qty ?? 0);
  window.renderStock = function() {
    const target = document.getElementById('stockTable'); if (!target) return;
    target.innerHTML = db.stockItems.length ? [...db.stockItems].sort((a,b)=>a.name.localeCompare(b.name,'es')).map(item => {
      const low = Number(item.minimum || 0) > 0 && qty(item) <= Number(item.minimum || 0);
      return `<tr><td><b>${esc(item.name)}</b>${item.code?`<br><span class="muted">${esc(item.code)}</span>`:''}</td><td><b>${qty(item)}</b> ${esc(item.unit||'u.')}${low?' <span class="badge pending">Stock bajo</span>':''}</td><td>${money(item.unitCost)}</td><td>${money(item.unitPrice)}</td><td>${Number(item.minimum||0)}</td><td><button class="btn" style="padding:6px 9px" onclick="openStockItem('${item.id}')">Editar</button> <button class="btn" style="padding:6px 9px" onclick="deleteStockItem('${item.id}')">Eliminar</button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">Todavía no hay repuestos. Agregá uno o vinculá una compra a un artículo nuevo.</td></tr>';
  };
  window.openStockItem = function(id=null) {
    const old = id ? db.stockItems.find(x=>x.id===id) : null;
    const modal = document.getElementById('modalBack'), fields = document.getElementById('formFields');
    document.getElementById('modalTitle').textContent = old ? 'Editar repuesto' : 'Nuevo repuesto';
    fields.innerHTML = `<div class="field"><label>Nombre del repuesto</label><input name="stockName" required></div><div class="field"><label>Código (opcional)</label><input name="stockCode"></div><div class="field"><label>Unidad</label><input name="stockUnit" value="u."></div><div class="field"><label>Existencia inicial</label><input name="stockQty" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Costo por unidad ($)</label><input name="stockCost" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Precio al cliente ($)</label><input name="stockPrice" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Alerta de stock mínimo</label><input name="stockMin" type="number" min="0" step="0.01" value="0"></div>`;
    if(old){const f=document.getElementById('entryForm');f.elements.stockName.value=old.name;f.elements.stockCode.value=old.code||'';f.elements.stockUnit.value=old.unit||'u.';f.elements.stockQty.value=qty(old);f.elements.stockQty.disabled=true;f.elements.stockCost.value=old.unitCost||0;f.elements.stockPrice.value=old.unitPrice||0;f.elements.stockMin.value=old.minimum||0;}
    document.getElementById('entryForm').dataset.stockEdit=id||''; modal.classList.add('open');
  };
  const originalOpen = window.openForm;
  window.openForm = function(type,id=null) {
    if(type==='stockItem') return openStockItem(id);
    originalOpen(type,id);
    const form=document.getElementById('entryForm');
    if(type==='expense') {
      const clientField=form.elements.namedItem('client');
      const jobOptions=db.jobs.map(j=>`<option value="${j.id}">${dateFmt(j.date)} · ${esc(clientName(j.client))} · ${esc(j.title||'Trabajo')}</option>`).join('');
      const itemOptions=db.stockItems.map(i=>`<option value="${i.id}">${esc(i.name)} (stock: ${qty(i)})</option>`).join('');
      const fields=document.getElementById('formFields');
      fields.insertAdjacentHTML('beforeend',`<div class="field"><label>Asociar a un trabajo (opcional)</label><select name="jobRef"><option value="">Sin asociar</option>${jobOptions}</select></div><div class="field"><label>Sumar esta compra al stock (opcional)</label><select name="stockItemId"><option value="">No es un repuesto de stock</option>${itemOptions}</select></div><div class="field"><label>Cantidad comprada (unidades enteras)</label><input name="stockQty" type="number" min="0" step="1" value="0" inputmode="numeric"></div>`);
      const expense=id?db.expenses.find(e=>e.id===id):null;
      if(expense){form.elements.jobRef.value=expense.jobRef||'';form.elements.stockItemId.value=expense.stockItemId||'';form.elements.stockQty.value=expense.stockQty||0;}
    }
    if(type==='job') {
      const amount=form.elements.namedItem('amount');
      const label=[...form.querySelectorAll('label')].find(l=>l.parentElement.querySelector('[name="amount"]'));
      if(label) label.textContent='Mano de obra y otros cargos ($)';
      const job=id?db.jobs.find(j=>j.id===id):null;
      const parts=job?.partsUsed||[];
      const rows=db.stockItems.map(item=>{
        const used=parts.find(p=>p.itemId===item.id);return `<label style="display:grid;grid-template-columns:24px 1fr 85px 100px;gap:7px;align-items:center;padding:7px;border-bottom:1px solid var(--line);font-weight:400"><input type="checkbox" data-part="${item.id}" ${used?'checked':''}><span>${esc(item.name)}<br><small class="muted">Disponible: ${qty(item)} · Costo ${money(item.unitCost)} · Cliente ${money(item.unitPrice)}</small></span><input type="number" data-part-qty="${item.id}" min="0.01" step="0.01" value="${used?.quantity||1}" ${used?'':'disabled'} aria-label="Cantidad"><span>${money(item.unitPrice)} /u.</span></label>`;
      }).join('')||'<div class="muted">No hay repuestos cargados en el stock.</div>';
      document.getElementById('formFields').insertAdjacentHTML('beforeend',`<div class="field full"><label>Repuestos del stock utilizados</label><div style="border:1px solid var(--line);border-radius:8px;padding:5px">${rows}</div><small class="muted">Al guardar se descuenta del inventario y se suma el precio al total del trabajo.</small></div>`);
      form.querySelectorAll('[data-part]').forEach(ch=>ch.onchange=()=>{form.querySelector(`[data-part-qty="${ch.dataset.part}"]`).disabled=!ch.checked;updateJobTotal()});
      form.querySelectorAll('[data-part-qty]').forEach(input=>input.oninput=updateJobTotal);
      if(amount) amount.dataset.base=String(Math.max(0,Number(job?.amount||0)-parts.reduce((n,p)=>n+Number(p.quantity||0)*Number(p.unitPrice||0),0)));
      if(amount) amount.oninput=()=>{amount.dataset.base=amount.value;updateJobTotal()};
      function updateJobTotal(){const base=Number(amount?.dataset.base??amount?.value)||0;const sell=[...form.querySelectorAll('[data-part]:checked')].reduce((n,ch)=>n+(Number(form.querySelector(`[data-part-qty="${ch.dataset.part}"]`).value)||0)*Number(db.stockItems.find(x=>x.id===ch.dataset.part)?.unitPrice||0),0);if(amount)amount.value=String(base+sell)}
    }
  };
  const originalSubmit=document.getElementById('entryForm').onsubmit;
  document.getElementById('entryForm').onsubmit=function(event) {
    const form=this, field=name=>form.elements.namedItem(name);
    if(form.dataset.stockSubmitBusy==='1'){event.preventDefault();return false;}
    if(document.getElementById('modalTitle').textContent.includes('repuesto')) {
      event.preventDefault(); const id=form.dataset.stockEdit, old=id?db.stockItems.find(x=>x.id===id):null;
      const name=form.elements.stockName.value.trim();if(!name){toast('Ingresá el nombre del repuesto');return false;}
      const item=old||{id:crypto.randomUUID(),quantity:0};item.name=name;item.code=form.elements.stockCode.value.trim();item.unit=form.elements.stockUnit.value.trim()||'u.';item.unitCost=Number(form.elements.stockCost.value||0);item.unitPrice=Number(form.elements.stockPrice.value||0);item.minimum=Number(form.elements.stockMin.value||0);
      if(!old){item.quantity=Number(form.elements.stockQty.value||0);db.stockItems.push(item);}save();closeModal();form.reset();delete form.dataset.stockEdit;toast(old?'Repuesto actualizado':'Repuesto agregado');return false;
    }
    const type=formType, beforeExpenseIds=new Set(db.expenses.map(x=>x.id)), editingId=typeof currentEditId==='undefined'?null:currentEditId;
    if(type==='expense'&&field('stockItemId')?.value&&(!Number.isInteger(Number(field('stockQty')?.value))||Number(field('stockQty')?.value)<1)){
      event.preventDefault();toast('Ingresá una cantidad entera mayor a cero para sumar al stock.');return false;
    }
    let expenseSnapshot=null;
    if(type==='job') {
      if(!form.elements.namedItem('client')?.value){event.preventDefault();toast('Seleccioná un cliente');return false;}
      if(Number(form.elements.namedItem('paidAmount')?.value||0)>Number(form.elements.namedItem('amount')?.value||0)){event.preventDefault();toast('El importe pagado no puede superar el total');return false;}
      const selected=[...form.querySelectorAll('[data-part]:checked')].map(ch=>{const item=db.stockItems.find(x=>x.id===ch.dataset.part),quantity=Number(form.querySelector(`[data-part-qty="${ch.dataset.part}"]`).value)||0;return {itemId:item.id,name:item.name,quantity,unitCost:Number(item.unitCost||0),unitPrice:Number(item.unitPrice||0)}});
      const job=editingId?db.jobs.find(j=>j.id===editingId):null, previous=job?.partsUsed||[];
      const returnedByItem=new Map();for(const p of previous)returnedByItem.set(p.itemId,(returnedByItem.get(p.itemId)||0)+Number(p.quantity||0));
      const shortages=selected.map(p=>({p,item:db.stockItems.find(x=>x.id===p.itemId),available:qty(db.stockItems.find(x=>x.id===p.itemId)||{quantity:0})+(returnedByItem.get(p.itemId)||0)})).filter(x=>!x.item||x.available<x.p.quantity);
      if(shortages.length){toast(`Stock insuficiente: ${shortages.map(x=>`${x.item?.name||x.p.name} (disponible ${x.available}, solicitado ${x.p.quantity})`).join(', ')}`);return false;}
      const hidden=form.elements.namedItem('partsUsed');if(hidden)hidden.remove();const input=document.createElement('input');input.type='hidden';input.name='partsUsed';input.value=JSON.stringify(selected);form.appendChild(input);

      // El guardado del trabajo y el movimiento de stock se confirman juntos,
      // sin pasar por los manejadores encadenados del formulario anterior.
      event.preventDefault();form.dataset.stockSubmitBusy='1';
      const incoming=Object.fromEntries(new FormData(form));
      const f=job?{...job,...incoming}:incoming;
      f.amount=Number(f.amount||0);f.paidAmount=Number(f.paidAmount||0);f.warrantyMonths=Number(f.warrantyMonths||0);
      if(f.paidAmount>f.amount){delete form.dataset.stockSubmitBusy;toast('El importe pagado no puede superar el total');return false;}
      if(!f.title)f.title=f.description?.slice(0,60)||'Trabajo realizado';
      f.paid=f.paidAmount>=f.amount&&f.amount>0;
      if(job){
        const beforePaid=Number(job.paidAmount??(job.paid?job.amount:0)),delta=f.paidAmount-beforePaid;
        f.payments=(job.payments||((beforePaid>0)?[{date:job.date,amount:beforePaid}]:[])).map(p=>({...p}));
        if(delta>0)f.payments.push({date:iso(),amount:delta});
        else if(delta<0){let remaining=-delta;for(let i=f.payments.length-1;i>=0&&remaining>0;i--){const cut=Math.min(Number(f.payments[i].amount||0),remaining);f.payments[i].amount-=cut;remaining-=cut;if(f.payments[i].amount<=0)f.payments.splice(i,1);}}
      } else f.payments=f.paidAmount>0?[{date:f.date,amount:f.paidAmount}]:[];
      f.partsUsed=selected;
      if(job)Object.assign(job,f);else{f.id=crypto.randomUUID();db.jobs.push(f);}
      for(const p of previous){const item=db.stockItems.find(x=>x.id===p.itemId);if(item)item.quantity=qty(item)+Number(p.quantity||0);}
      for(const p of selected){const item=db.stockItems.find(x=>x.id===p.itemId);if(item)item.quantity=qty(item)-Number(p.quantity||0);}
      const equipment=db.equipment.find(x=>x.id===f.equipment);if(equipment&&f.status==='Completado')equipment.last=f.date;
      db.stockMoves=db.stockMoves.filter(m=>!(m.type==='usage'&&m.referenceId===f.id));
      for(const p of selected)db.stockMoves.push({id:crypto.randomUUID(),type:'usage',referenceId:f.id,itemId:p.itemId,quantity:-p.quantity,unitCost:p.unitCost,unitPrice:p.unitPrice,date:f.date});
      const quoteId=field('quoteId')?.value;if(quoteId){const quote=db.quotes.find(q=>q.id===quoteId);if(quote)quote.jobId=f.id;}
      save();closeModal();form.reset();currentEditId=null;toast(job?'Cambios guardados':'Trabajo guardado');
      setTimeout(()=>{delete form.dataset.stockSubmitBusy;},0);
      return false;
    }
    if(type==='expense') {
      const oldId=editingId, old=oldId?db.expenses.find(x=>x.id===oldId):null;
      expenseSnapshot={oldId,jobRef:field('jobRef')?.value||'',stockItemId:field('stockItemId')?.value||'',stockQty:Number(field('stockQty')?.value||0)};
      if(expenseSnapshot.stockItemId&&!db.stockItems.some(x=>x.id===expenseSnapshot.stockItemId)){event.preventDefault();toast('El repuesto seleccionado ya no está disponible. Actualizá la pantalla y volvé a elegirlo.');return false;}
      if(old?.stockItemId){const item=db.stockItems.find(x=>x.id===old.stockItemId);if(item)item.quantity=qty(item)-Number(old.stockQty||0);}
    }
    form.dataset.stockSubmitBusy='1';
    const result=originalSubmit.call(this,event);
    if(type==='expense') {
      const created=db.expenses.find(x=>!beforeExpenseIds.has(x.id));const expense=expenseSnapshot.oldId?db.expenses.find(x=>x.id===expenseSnapshot.oldId):created;
      if(expense){if(expenseSnapshot.stockItemId){const item=db.stockItems.find(x=>x.id===expenseSnapshot.stockItemId),quantity=expenseSnapshot.stockQty;if(!item){toast('No se encontró el repuesto seleccionado; revisá el stock y volvé a guardar.');return false;}if(quantity>0){const oldQuantity=qty(item),oldCost=Number(item.unitCost||0),cost=Number(expense.amount||0)/quantity;item.quantity=oldQuantity+quantity;item.unitCost=item.quantity>0?((oldQuantity*oldCost)+(cost*quantity))/item.quantity:cost;expense.stockItemId=item.id;expense.stockQty=quantity;expense.stockUnitCost=cost;}}
        expense.jobRef=expenseSnapshot.jobRef;db.stockMoves=db.stockMoves.filter(m=>!(m.type==='purchase'&&m.referenceId===expense.id));if(expense.stockItemId)db.stockMoves.push({id:crypto.randomUUID(),type:'purchase',referenceId:expense.id,itemId:expense.stockItemId,quantity:Number(expense.stockQty||0),unitCost:Number(expense.stockUnitCost||0),date:expense.date});save();}
    }
    setTimeout(()=>{delete form.dataset.stockSubmitBusy;},0);
    return result;
  };
  window.deleteStockItem=function(id){const item=db.stockItems.find(x=>x.id===id);if(!item)return;if(db.stockMoves.some(m=>m.itemId===id)||db.jobs.some(j=>(j.partsUsed||[]).some(p=>p.itemId===id))||db.expenses.some(e=>e.stockItemId===id)){toast('No se puede eliminar: este repuesto tiene movimientos asociados.');return;}if(confirm('¿Eliminar este repuesto?')){db.stockItems=db.stockItems.filter(x=>x.id!==id);save();}};
  const oldDelete=window.deleteItem;
  window.deleteItem=function(type,id){if(type==='jobs'){const job=db.jobs.find(j=>j.id===id);for(const p of job?.partsUsed||[]){const item=db.stockItems.find(x=>x.id===p.itemId);if(item)item.quantity=qty(item)+Number(p.quantity||0);}db.stockMoves=db.stockMoves.filter(m=>!(m.type==='usage'&&m.referenceId===id));}if(type==='expenses'){const e=db.expenses.find(x=>x.id===id);if(e?.stockItemId){const item=db.stockItems.find(x=>x.id===e.stockItemId);if(item)item.quantity=Math.max(0,qty(item)-Number(e.stockQty||0));}db.stockMoves=db.stockMoves.filter(m=>!(m.type==='purchase'&&m.referenceId===id));}oldDelete(type,id);};
  const priorRenderAll=window.renderAll;
  window.renderAll=function(){priorRenderAll();renderStock();};
  const priorRenderFinance=window.renderFinance;
  window.renderFinance=function(){
    priorRenderFinance();
    for(const expense of db.expenses.filter(e=>e.jobRef)){
      const job=db.jobs.find(j=>j.id===expense.jobRef);if(!job)continue;
      const button=[...document.querySelectorAll('#financeTable button')].find(b=>b.getAttribute('onclick')?.includes(expense.id));
      const cell=button?.closest('tr')?.children?.[2];
      if(cell)cell.textContent+=` · Trabajo: ${job.title||'Trabajo'} (${dateFmt(job.date)})`;
    }
  };
  renderStock();
})();
