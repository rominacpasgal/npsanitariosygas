/* Acceso de administrador y espacio de datos compartido de NP Sanitarios y Gas. */
(() => {
  const WORKSPACE_ID = 'np-sanitariosygas';
  const gate = document.getElementById('cloudGate');
  const message = document.getElementById('cloudMessage');
  const errorBox = document.getElementById('authError');
  const authFields = document.getElementById('authFields');
  const firstPasswordFields = document.getElementById('firstPasswordFields');
  const migrationActions = document.getElementById('migrationActions');
  const passwordModal = document.getElementById('passwordModal');
  let client = null, user = null, membership = null, loaded = false, loading = false;
  let lastUpdatedAt = null, saveTimer = null, saving = false, dirtyAgain = false, hasPendingSave = false;
  let passwordMode = 'change';

  function showGate(text, mode = 'login') {
    gate.style.display = 'flex';
    message.textContent = text;
    authFields.style.display = mode === 'login' ? 'block' : 'none';
    firstPasswordFields.style.display = mode === 'first-password' ? 'block' : 'none';
    migrationActions.style.display = mode === 'migration' ? 'flex' : 'none';
    errorBox.textContent = '';
  }
  function showPasswordModal(mode = 'change') {
    passwordMode = mode;
    document.getElementById('currentPasswordWrap').style.display = mode === 'change' ? 'grid' : 'none';
    document.getElementById('passwordError').textContent = '';
    passwordModal.style.display = 'flex';
  }
  function showApp() {
    gate.style.display = 'none';
    document.querySelector('.app').style.visibility = 'visible';
    const host = document.querySelector('.topright');
    let status = document.getElementById('cloudAccount');
    if (!status) {
      status = document.createElement('div');
      status.id = 'cloudAccount';
      status.style.cssText = 'display:flex;align-items:center;gap:7px;font-size:11px;color:#60757c;flex-wrap:wrap';
      host.prepend(status);
    }
    status.innerHTML = `<span>Administrador</span><button class="btn" id="changePasswordBtn" style="padding:7px 9px">Cambiar contraseña</button><button class="btn" id="cloudSignOut" style="padding:7px 9px">Salir</button>`;
    document.getElementById('changePasswordBtn').onclick = () => showPasswordModal('change');
    document.getElementById('cloudSignOut').onclick = async () => { await client.auth.signOut(); };
  }
  function showError(err) { errorBox.textContent = err?.message || String(err || 'Ocurrió un error.'); }
  function emptyData() { return { clients: [], jobs: [], equipment: [], quotes: [], expenses: [], stockItems: [], stockMoves: [] }; }
  function normalizeData(data) {
    const normalized = { ...emptyData(), ...(data || {}) };
    for (const key of Object.keys(emptyData())) if (!Array.isArray(normalized[key])) normalized[key] = [];
    return normalized;
  }

  async function readMembership() {
    const { data, error } = await client.from('np_admin_members').select('user_id,password_initialized')
      .eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function ensureMembership() {
    let row = await readMembership();
    if (!row) {
      const { data, error } = await client.from('np_admin_members').insert({ user_id: user.id })
        .select('user_id,password_initialized').single();
      if (error) throw error;
      row = data;
    }
    return row;
  }
  async function readWorkspace() {
    const { data, error } = await client.from('np_shared_workspace').select('id,data,updated_at,migration_completed')
      .eq('id', WORKSPACE_ID).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function ensureWorkspace() {
    let row = await readWorkspace();
    if (!row) {
      const { data, error } = await client.from('np_shared_workspace').insert({ id: WORKSPACE_ID, data: emptyData() })
        .select('id,data,updated_at,migration_completed').single();
      if (error) throw error;
      row = data;
    }
    return row;
  }
  async function loadForUser() {
    if (!user || loaded || loading) return;
    loading = true;
    try {
      membership = await ensureMembership();
      if (!membership.password_initialized) {
        showGate('Primer ingreso de administrador: asigná ahora una contraseña segura.', 'first-password');
        return;
      }
      const workspace = await ensureWorkspace();
      lastUpdatedAt = workspace.updated_at;
      if (!workspace.migration_completed) {
        showGate('Elegí importar un respaldo JSON o empezar con el espacio compartido vacío.', 'migration');
      } else {
        db = normalizeData(workspace.data);
        loaded = true;
        renderAll();
        showApp();
      }
    } catch (err) { showError(err); }
    finally { loading = false; }
  }
  async function initializeWorkspace(data) {
    errorBox.textContent = '';
    try {
      const updatedAt = new Date().toISOString();
      const { error } = await client.from('np_shared_workspace').update({
        data, migration_completed: true, updated_at: updatedAt
      }).eq('id', WORKSPACE_ID);
      if (error) throw error;
      const workspace = await readWorkspace();
      db = normalizeData(workspace.data);
      lastUpdatedAt = workspace.updated_at;
      loaded = true;
      renderAll();
      showApp();
    } catch (err) { showError(err); }
  }
  async function writeWorkspace(payload) {
    const latest = await readWorkspace();
    if (!latest || latest.updated_at !== lastUpdatedAt) {
      throw new Error('Los datos compartidos cambiaron desde otro dispositivo. Recargá la aplicación antes de guardar de nuevo.');
    }
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(lastUpdatedAt || 0) + 1)).toISOString();
    const { data, error } = await client.from('np_shared_workspace').update({ data: payload, updated_at: updatedAt })
      .eq('id', WORKSPACE_ID).eq('updated_at', lastUpdatedAt).select('updated_at').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Los datos compartidos cambiaron desde otro dispositivo. Recargá la aplicación antes de guardar de nuevo.');
    lastUpdatedAt = data.updated_at;
  }
  window.queueCloudSave = () => {
    if (!user || !loaded) return;
    hasPendingSave = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      if (saving) { dirtyAgain = true; return; }
      saving = true;
      try {
        await writeWorkspace(db);
        hasPendingSave = false;
        const t = document.getElementById('toast');
        t.textContent = 'Cambios guardados en la nube'; t.style.display = 'block';
        setTimeout(() => t.style.display = 'none', 1600);
      } catch (err) {
        hasPendingSave = true;
        alert(`No se pudieron guardar los cambios en la nube. Descargá un respaldo antes de recargar.\n\n${err.message || err}`);
      } finally {
        saving = false;
        if (dirtyAgain) { dirtyAgain = false; window.queueCloudSave(); }
      }
    }, 500);
  };
  window.addEventListener('beforeunload', event => {
    if (user && loaded && hasPendingSave) { event.preventDefault(); event.returnValue = ''; }
  });

  document.getElementById('signInBtn').onclick = async () => {
    errorBox.textContent = '';
    const { error } = await client.auth.signInWithPassword({
      email: document.getElementById('authEmail').value.trim(),
      password: document.getElementById('authPassword').value
    });
    if (error) showError('No se pudo iniciar sesión. Verificá el correo y la contraseña.');
  };
  document.getElementById('forgotPasswordBtn').onclick = async () => {
    errorBox.textContent = '';
    const email = document.getElementById('authEmail').value.trim();
    if (!email) { showError('Ingresá el correo del administrador para recibir el enlace de recuperación.'); return; }
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) showError(error); else message.textContent = 'Si la cuenta existe, recibirás un enlace para restablecer la contraseña.';
  };
  document.getElementById('setFirstPasswordBtn').onclick = async () => {
    const password = document.getElementById('firstPassword').value;
    const confirmation = document.getElementById('firstPasswordConfirm').value;
    if (password.length < 12) { showError('Usá al menos 12 caracteres.'); return; }
    if (password !== confirmation) { showError('Las contraseñas no coinciden.'); return; }
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      const { error: membershipError } = await client.from('np_admin_members').update({ password_initialized: true })
        .eq('user_id', user.id);
      if (membershipError) throw membershipError;
      membership.password_initialized = true;
      const workspace = await ensureWorkspace();
      lastUpdatedAt = workspace.updated_at;
      if (!workspace.migration_completed) {
        showGate('Tu contraseña está lista. Elegí importar un respaldo JSON o empezar con el espacio compartido vacío.', 'migration');
      } else {
        db = normalizeData(workspace.data); loaded = true; renderAll(); showApp();
      }
    } catch (err) { showError(err); }
  };
  document.getElementById('startEmptyBtn').onclick = () => initializeWorkspace(emptyData());
  document.getElementById('uploadBackupBtn').onclick = async () => {
    const file = document.getElementById('initialBackupFile').files[0];
    if (!file) { errorBox.textContent = 'Elegí primero el archivo JSON de respaldo.'; return; }
    try {
      const backup = JSON.parse(await file.text());
      if (!['clients','jobs','equipment','quotes','expenses'].every(k => Array.isArray(backup[k]))) {
        throw new Error('El archivo no tiene el formato de respaldo de NP Sanitarios y Gas.');
      }
      await initializeWorkspace(normalizeData(backup));
    } catch (err) { errorBox.textContent = err.message || String(err); }
  };
  document.getElementById('cancelPasswordBtn').onclick = () => { passwordModal.style.display = 'none'; };
  document.getElementById('savePasswordBtn').onclick = async () => {
    const error = document.getElementById('passwordError'); error.textContent = '';
    const current = document.getElementById('currentPassword').value;
    const password = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('newPasswordConfirm').value;
    if (password.length < 12) { error.textContent = 'Usá al menos 12 caracteres.'; return; }
    if (password !== confirmation) { error.textContent = 'Las nuevas contraseñas no coinciden.'; return; }
    try {
      if (passwordMode === 'change') {
        const check = await client.auth.signInWithPassword({ email: user.email, password: current });
        if (check.error) throw new Error('La contraseña actual no es correcta.');
      }
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) throw updateError;
      passwordModal.style.display = 'none';
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('newPasswordConfirm').value = '';
      alert('Contraseña actualizada.');
    } catch (err) { error.textContent = err.message || String(err); }
  };

  db = emptyData();
  localStorage.removeItem(DBKEY);
  document.querySelector('.app').style.visibility = 'hidden';
  renderAll();
  const config = window.NP_CLOUD_CONFIG || {};
  if (!window.supabase || !config.url || config.url.includes('PEGAR_') || !config.publishableKey || config.publishableKey.includes('PEGAR_')) {
    showGate('Falta vincular esta aplicación con el proyecto de base de datos.'); return;
  }
  client = window.supabase.createClient(config.url, config.publishableKey);
  client.auth.onAuthStateChange((event, session) => {
    user = session?.user || null;
    if (event === 'SIGNED_OUT' || !user) {
      loaded = false; loading = false; membership = null; lastUpdatedAt = null;
      db = emptyData(); localStorage.removeItem(DBKEY);
      document.querySelector('.app').style.visibility = 'hidden';
      showGate('Iniciá sesión como administrador. No se permiten altas de usuario desde esta pantalla.');
      return;
    }
    if (event === 'PASSWORD_RECOVERY') {
      setTimeout(async () => { await loadForUser(); if (loaded) showPasswordModal('recovery'); }, 0);
    } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(loadForUser, 0);
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) showError(error);
    user = data.session?.user || null;
    if (user) loadForUser();
    else showGate('Iniciá sesión como administrador. El primer acceso se realiza mediante una invitación segura.');
  });

  async function refreshWorkspaceIfChanged() {
    if (!user || !loaded || saving || saveTimer) return;
    try {
      const workspace = await readWorkspace();
      if (workspace && workspace.updated_at !== lastUpdatedAt) {
        db = normalizeData(workspace.data); lastUpdatedAt = workspace.updated_at; renderAll();
      }
    } catch (err) { console.warn('No se pudo actualizar desde la nube:', err.message || err); }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshWorkspaceIfChanged(); });
  window.addEventListener('focus', refreshWorkspaceIfChanged);
  setInterval(() => { if (document.visibilityState === 'visible') refreshWorkspaceIfChanged(); }, 30000);
})();
