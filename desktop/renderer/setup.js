(() => {
  'use strict';
  const api = window.fallenHeavenSetup;
  const byId = (id) => document.getElementById(id);

  const token = byId('bot-token');
  const clientId = byId('discord-client-id');
  const clientSecret = byId('discord-client-secret');
  const result = byId('result');
  const save = byId('save-token');
  const remove = byId('delete-token');
  const state = byId('credential-state');
  const identity = byId('bot-identity');
  const openMain = byId('open-main');
  const minimize = byId('minimize');
  const closeWindow = byId('close');
  const toggleToken = byId('toggle-token');
  const toggleClientSecret = byId('toggle-client-secret');
  const botName = byId('bot-name');
  const botId = byId('bot-id');
  const botAvatar = byId('bot-avatar');
  const portableImport = byId('setup-portable-import');
  const portableSection = byId('setup-portable-password-section');
  const portablePassword = byId('setup-portable-password');
  const portableImportConfirm = byId('setup-portable-import-confirm');
  const portableImportCancel = byId('setup-portable-import-cancel');
  const portableResult = byId('setup-portable-result');

  if (!token || !clientId || !clientSecret || !result || !save || !remove || !state || !identity) {
    console.warn('[FH Setup] Setup-UI unvollständig geladen. Initialisierung sicher beendet.');
    return;
  }

  let currentStatus = { configured: false, oauthConfigured: false };

  const setResult = (message, tone = '') => {
    result.textContent = message;
    result.className = `result ${tone}`.trim();
  };

  const clearSecretFields = () => {
    if (!token || !clientSecret || !toggleToken || !toggleClientSecret) return;
    token.value = '';
    clientSecret.value = '';
    token.type = 'password';
    clientSecret.type = 'password';
    toggleToken.textContent = 'Anzeigen';
    toggleClientSecret.textContent = 'Anzeigen';
  };

  const loadStatus = async () => {
    currentStatus = await api.status();
    const complete = currentStatus.configured && currentStatus.oauthConfigured;
    state.textContent = complete
      ? 'Vollständig eingerichtet'
      : currentStatus.configured
        ? 'OAuth2 fehlt'
        : currentStatus.oauthConfigured
          ? 'Bot-Token fehlt'
          : 'Nicht eingerichtet';
    state.classList.toggle('ready', complete);
    remove.disabled = !currentStatus.configured && !currentStatus.oauthConfigured;
    const redirect = byId('oauth-redirect-uri');
    if (redirect && currentStatus.redirectUri) redirect.textContent = currentStatus.redirectUri;
    if (complete) {
      setResult(`Bot und OAuth2 sind mit ${currentStatus.provider} geschützt.`, 'success');
    } else if (currentStatus.configured) {
      setResult('Bot-Token ist gespeichert. Für die Anmeldung fehlen noch Application-ID und Client-Secret.', 'error');
    } else if (currentStatus.oauthConfigured) {
      setResult('OAuth2 ist gespeichert. Für den Bot fehlt noch der Bot-Token.', 'error');
    }
  };

  const bindVisibilityToggle = (button, input) => {
    if (!button || !input) return;
    button.addEventListener('click', (event) => {
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      event.currentTarget.textContent = visible ? 'Anzeigen' : 'Verbergen';
    });
  };
  bindVisibilityToggle(toggleToken, token);
  bindVisibilityToggle(toggleClientSecret, clientSecret);

  save.addEventListener('click', async () => {
    if (!currentStatus.configured && !token.value.trim()) return setResult('Bitte zuerst den Bot-Token eingeben.', 'error');
    if (!currentStatus.oauthConfigured && (!clientId.value.trim() || !clientSecret.value.trim())) {
      return setResult('Bitte Application-ID und Client-Secret eingeben.', 'error');
    }
    save.disabled = true;
    remove.disabled = true;
    setResult('Discord-Daten werden geprüft, verschlüsselt und der lokale Dienst wird neu gestartet …');
    try {
      const response = await api.saveCredentials({
        botToken: token.value,
        clientId: clientId.value,
        clientSecret: clientSecret.value
      });
      if (!response?.ok) return setResult(response?.error || 'Einrichtung fehlgeschlagen.', 'error');
      clearSecretFields();
      if (response.bot) {
        identity.hidden = false;
        if (botName) botName.textContent = response.bot.username;
        if (botId) botId.textContent = response.bot.id;
        if (response.bot.avatar && botAvatar) botAvatar.src = response.bot.avatar;
      }
      setResult(
        response.runtime?.ok
          ? 'Bot und OAuth2 sicher gespeichert. Die Anmeldung ist bereit.'
          : `Zugangsdaten gespeichert. ${response.runtime?.message || 'Der Dienst kann in der Haupt-App gestartet werden.'}`,
        response.runtime?.ok ? 'success' : ''
      );
      await loadStatus();
    } catch (error) {
      setResult(`Einrichtung fehlgeschlagen: ${String(error?.message || error)}`, 'error');
    } finally {
      save.disabled = false;
      await loadStatus().catch(() => {});
    }
  });

  remove.addEventListener('click', async () => {
    remove.disabled = true;
    save.disabled = true;
    setResult('Bot wird gestoppt und alle verschlüsselten Discord-Zugangsdaten werden gelöscht …');
    try {
      await api.deleteBotToken();
      identity.hidden = true;
      clearSecretFields();
      clientId.value = '';
      setResult('Bot-Token, OAuth2-Daten und lokale Sitzung wurden gelöscht.', 'success');
    } finally {
      save.disabled = false;
      await loadStatus().catch(() => {});
    }
  });

  if (portableImport && portableSection) portableImport.addEventListener('click', () => {
    portableSection.hidden = false;
    portablePassword?.focus();
  });
  if (portableImportCancel && portableSection) portableImportCancel.addEventListener('click', () => {
    portableSection.hidden = true;
    if (portablePassword) portablePassword.value = '';
    if (portableResult) {
      portableResult.textContent = '';
      portableResult.className = 'result';
    }
  });
  if (portableImportConfirm) portableImportConfirm.addEventListener('click', async () => {
    const password = String(portablePassword?.value || '').normalize('NFC');
    if (password.length < 12) {
      if (portableResult) setResult('Das Backup-Passwort muss mindestens 12 Zeichen lang sein.', 'error');
      portablePassword?.focus();
      return;
    }
    portableImportConfirm.disabled = true;
    if (portableResult) setResult('Backup wird verschlüsselt geprüft. Bestehende Daten bleiben bis dahin unangetastet.');
    try {
      const response = await api.importPortableBackup({ password });
      if (response?.canceled) {
        if (portableResult) {
          portableResult.textContent = 'Import abgebrochen.';
          portableResult.className = 'result';
        }
        return;
      }
      if (!response?.ok) {
        if (portableResult) {
          portableResult.textContent = response?.error || 'Import fehlgeschlagen.';
          portableResult.className = 'result error';
        }
        return;
      }
      if (portableResult) {
        portableResult.textContent = 'Arbeitsstand importiert. Bitte mit Discord anmelden; der Bot bleibt gestoppt.';
        portableResult.className = 'result success';
      }
      if (portableSection) portableSection.hidden = true;
      setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      if (portableResult) setResult(`Import fehlgeschlagen: ${String(error?.message || error)}`, 'error');
    } finally {
      if (portablePassword) portablePassword.value = '';
      portableImportConfirm.disabled = false;
    }
  });

  if (openMain) openMain.addEventListener('click', () => api.openMain());
  if (minimize) minimize.addEventListener('click', () => api.minimize());
  if (closeWindow) closeWindow.addEventListener('click', () => api.close());

  loadStatus().catch(() => setResult('Sicherheitsstatus konnte nicht geladen werden.', 'error'));
})();
