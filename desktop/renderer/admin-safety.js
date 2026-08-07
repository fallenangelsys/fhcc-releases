(() => {
  const approved = new WeakSet();
  const auditKey = 'fh-local-admin-audit-v1';
  const dangerous = /(?:ban|kick|timeout|purge|mass|bulk|delete|remove|löschen|entfernen|sperren|rauswerfen)/i;

  function actionDescriptor(element) {
    return [
      element.dataset.action,
      element.dataset.memberAction,
      element.dataset.roleAction,
      element.dataset.channelAction,
      element.id,
      element.getAttribute('aria-label'),
      element.textContent
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function appendAudit(action, approvedAction) {
    let entries = [];
    try { entries = JSON.parse(localStorage.getItem(auditKey) || '[]'); } catch {}
    entries.unshift({ action, approved: approvedAction, at: new Date().toISOString() });
    localStorage.setItem(auditKey, JSON.stringify(entries.slice(0, 250)));
    window.dispatchEvent(new CustomEvent('fallen-heaven:admin-audit', { detail: entries[0] }));
  }

  const overlay = document.createElement('div');
  overlay.className = 'fh-admin-confirm';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="fh-admin-confirm__backdrop"></div>
    <section class="fh-admin-confirm__dialog" role="alertdialog" aria-modal="true" aria-labelledby="fh-admin-confirm-title">
      <span class="fh-admin-confirm__eyebrow">SICHERHEITSPRÜFUNG</span>
      <h2 id="fh-admin-confirm-title">Adminaktion bestätigen</h2>
      <p>Diese Aktion kann Mitglieder, Rollen oder Inhalte dauerhaft verändern.</p>
      <code class="fh-admin-confirm__action"></code>
      <div class="fh-admin-confirm__buttons">
        <button type="button" data-confirm="cancel">Abbrechen</button>
        <button type="button" data-confirm="accept">Sicher ausführen</button>
      </div>
    </section>`;
  document.body.appendChild(overlay);

  const style = document.createElement('style');
  style.textContent = `
    .fh-admin-confirm[hidden]{display:none}.fh-admin-confirm{position:fixed;inset:0;z-index:120000;display:grid;place-items:center;padding:24px}.fh-admin-confirm__backdrop{position:absolute;inset:0;background:rgba(4,5,14,.72);backdrop-filter:blur(14px)}.fh-admin-confirm__dialog{position:relative;width:min(520px,100%);padding:30px;border:1px solid rgba(255,255,255,.16);border-radius:26px;background:linear-gradient(145deg,#17182a,#0d0e18);color:#fff;box-shadow:0 30px 100px rgba(0,0,0,.55)}.fh-admin-confirm__eyebrow{color:#ffadbd;font-size:11px;font-weight:900;letter-spacing:.18em}.fh-admin-confirm h2{margin:10px 0 8px;font-size:27px}.fh-admin-confirm p{color:#b9bdd0;line-height:1.55}.fh-admin-confirm code{display:block;margin:18px 0;padding:13px;border-radius:13px;background:#090a12;color:#e7e9f5;white-space:normal}.fh-admin-confirm__buttons{display:flex;justify-content:flex-end;gap:10px}.fh-admin-confirm button{border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:11px 16px;background:#242638;color:#fff;font-weight:800;cursor:pointer}.fh-admin-confirm button[data-confirm="accept"]{background:#d83f5b;border-color:#ef617a}
  `;
  document.head.appendChild(style);

  let pending = null;
  function close(accepted) {
    const target = pending;
    pending = null;
    overlay.hidden = true;
    if (!target) return;
    const action = actionDescriptor(target);
    appendAudit(action, accepted);
    if (accepted) {
      approved.add(target);
      target.click();
    } else target.focus();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target.closest('[data-confirm="accept"]')) close(true);
    else if (event.target.closest('[data-confirm="cancel"],.fh-admin-confirm__backdrop')) close(false);
  });
  window.addEventListener('keydown', (event) => {
    if (!overlay.hidden && event.key === 'Escape') close(false);
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button,[role="button"]');
    if (!button || overlay.contains(button)) return;
    if (approved.has(button)) {
      approved.delete(button);
      return;
    }
    const action = actionDescriptor(button);
    if (!dangerous.test(action) || /(?:logout|abmelden|remove filter|filter entfernen)/i.test(action)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pending = button;
    overlay.querySelector('.fh-admin-confirm__action').textContent = action || 'Geschützte Adminaktion';
    overlay.hidden = false;
    overlay.querySelector('[data-confirm="cancel"]').focus();
  }, true);
})();
