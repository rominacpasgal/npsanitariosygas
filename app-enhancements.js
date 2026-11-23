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
      const items = [['Realizado',j.description],['Repuestos y materiales',j.materials],['Partes reparadas',j.repairs],
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
      <div class="row-desc" style="white-space:normal">${[['Descripción',j.description],['Repuestos/materiales',j.materials],['Partes reparadas',j.repairs],['Insumos',j.consumables],['Garantía',j.warrantyMonths?`${j.warrantyMonths} meses`:'' ],['Observaciones',j.notes]].filter(x=>x[1]).map(x=>`<b>${esc(x[0])}:</b> ${esc(x[1])}`).join('<br>')}</div>
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
      const message = `Hola, ${firstName}. ¡Buen día!\nDesde NP Sanitarios y Gas te compartimos el presupuesto solicitado:\n\nDetalle del trabajo: ${title}.\n\nMateriales y mano de obra:\n${q.detail || ''}${extra}\n\nTOTAL: ${money(q.amount)}\n\nValidez del presupuesto: ${q.valid ? dateFmt(q.valid) : 'sin fecha definida'}.\n\nSi estás de acuerdo con el presupuesto, podés responder a este mensaje para coordinar la realización del trabajo.\n\n¡Muchas gracias por tu consulta y por confiar en nosotros!\n\nNicolás Pérez\nNP Sanitarios y Gas`;
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
