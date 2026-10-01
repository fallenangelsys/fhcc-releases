from pathlib import Path
import os
import subprocess
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "ui-visual-audit"
BASE = os.environ.get("FHCC_PREVIEW_BASE", "http://127.0.0.1:3137/")
VIEWS = ["login", "center", "community", "modules", "studio", "skin", "system"]
THEMES = ["dark", "light"]
VIEWPORTS = [
    ("desktop", 1365, 768),
    ("wide", 1600, 900),
    ("mobile", 390, 844),
]


def browser_executable():
    candidates = [
        Path(os.environ.get("PROGRAMFILES", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def wait_for_preview_server():
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            with urlopen(BASE, timeout=1) as response:
                if response.status < 500:
                    return True
        except URLError:
            time.sleep(0.25)
    return False


def start_preview_server():
    if wait_for_preview_server():
        return None
    env = os.environ.copy()
    env["PORT"] = BASE.rstrip("/").rsplit(":", 1)[-1]
    process = subprocess.Popen(
        ["node", "scripts/preview-server.cjs"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if not wait_for_preview_server():
        output = ""
        try:
            output = process.stdout.read() if process.stdout else ""
        except Exception:
            output = ""
        process.terminate()
        raise RuntimeError(f"Preview-Server konnte nicht gestartet werden. {output}")
    return process


def visible_text(node):
    text = node.inner_text(timeout=250).strip()
    return " ".join(text.split())[:120]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.glob("*.png"):
        stale.unlink()
    failures = []
    server = start_preview_server()
    with sync_playwright() as p:
        executable = browser_executable()
        browser = p.chromium.launch(headless=True, executable_path=executable) if executable else p.chromium.launch(headless=True)
        for view in VIEWS:
            for theme in THEMES:
              for name, width, height in VIEWPORTS:
                page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
                console_errors = []
                page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" and "failed to load resource" not in msg.text.lower() else None)
                page.goto(f"{BASE}?{urlencode({'preview': view})}", wait_until="networkidle")
                page.evaluate("theme => { document.body.dataset.theme = theme; }", theme)
                if view == "modules":
                    page.evaluate(
                        """
                        () => {
                          const grid = document.getElementById('module-grid');
                          const config = document.getElementById('module-config');
                          if (!grid || !config) return;
                          const cards = [
                            ['RPC', 'Custom Rich Presence', 'Eigener Live-RPC wie CustomRP', true],
                            ['BAN', 'Instant Wort-Ban', 'Sofort-Bann bei verbotenen Begriffen', true],
                            ['CFG', 'Allgemein', 'Basiseinstellungen und Verhalten', true],
                            ['123', 'Zähl-Kanal', 'Fortlaufende Zahlen mit Prüfregeln', false]
                          ];
                          grid.innerHTML = cards.map(([icon, title, copy, enabled], index) =>
                            `<article class="module-card${enabled ? ' enabled' : ''}${index === 0 ? ' selected' : ''}" data-module="preview-${index}">` +
                            `<div class="module-top"><span></span><b>${icon}</b></div><h3>${title}</h3><p>${copy}</p>` +
                            `<button type="button" class="module-toggle${enabled ? ' is-active' : ''}" aria-pressed="${enabled}"><i></i><span>${enabled ? 'Aktiv' : 'Inaktiv'}</span></button></article>`
                          ).join('');
                          document.getElementById('module-page-enabled').textContent = '22';
                          document.getElementById('module-page-total').textContent = '24';
                          document.getElementById('module-result-count').textContent = '24 Module';
                          const enableAll = document.getElementById('enable-all');
                          enableAll.disabled = false;
                          enableAll.textContent = 'Alle aktivieren';
                          config.innerHTML = '<div class="module-config-head"><div><span class="module-state enabled"><i></i>AKTIV</span><h3>Custom Rich Presence</h3><p>Konfiguration der ausgewählten Funktion.</p></div></div>' +
                            '<div class="module-config-grid"><label class="module-field module-field-toggle" data-field-type="checkbox"><span class="module-field-copy"><strong class="module-field-label">Status anzeigen</strong><span>Zeigt den aktuellen Serverstatus im Profil.</span></span><span class="module-toggle"><input type="checkbox" role="switch" checked><i></i></span></label>' +
                            '<label class="module-field module-field-toggle" data-field-type="checkbox"><span class="module-field-copy"><strong class="module-field-label">Details veröffentlichen</strong><span>Zusätzliche Informationen bleiben ausgeschaltet.</span></span><span class="module-toggle"><input type="checkbox" role="switch"><i></i></span></label></div>';
                        }
                        """
                    )
                page.wait_for_timeout(300)
                screenshot = OUT / f"{view}-{theme}-{name}.png"
                page.screenshot(path=str(screenshot), full_page=True)

                metrics = page.evaluate(
                    """
                    () => {
                      const doc = document.documentElement;
                      const active = document.querySelector('.view.active');
                      const candidates = [...document.querySelectorAll('button, a, label, input, select, textarea, h1, h2, h3, h4, p, small, b, strong, span, em')];
                      const textOverflow = [];
                      for (const el of candidates) {
                        const style = getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') continue;
                        if (!active || !active.contains(el)) continue;
                        if (el.classList.contains('sr-only') || el.classList.contains('studio-native-file')) continue;
                        const clipped = el.scrollWidth > el.clientWidth + 4 || el.scrollHeight > el.clientHeight + 8;
                        if (!clipped) continue;
                        textOverflow.push({
                          tag: el.tagName.toLowerCase(),
                          cls: el.className || '',
                          id: el.id || '',
                          text: (el.innerText || el.value || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
                          clientWidth: el.clientWidth,
                          scrollWidth: el.scrollWidth,
                          clientHeight: el.clientHeight,
                          scrollHeight: el.scrollHeight
                        });
                      }
                      return {
                        scrollWidth: doc.scrollWidth,
                        innerWidth: window.innerWidth,
                        bodyWidth: document.body.scrollWidth,
                        activeView: active ? active.id : '',
                        textOverflow
                      };
                    }
                    """
                )
                if metrics["scrollWidth"] > width + 2 or metrics["bodyWidth"] > width + 2:
                    failures.append(f"{view}/{theme}/{name}: horizontales Seiten-Overflow {metrics['scrollWidth']}px bei {width}px")
                filtered = [
                    item for item in metrics["textOverflow"]
                    if item["text"] and (item["tag"] not in {"span", "em"} or item["clientWidth"] < item["scrollWidth"] - 12)
                ][:20]
                if filtered:
                    details = "; ".join(
                        f"{item['tag']}#{item['id']}.{str(item['cls'])[:40]} '{item['text']}' {item['clientWidth']}->{item['scrollWidth']}"
                        for item in filtered[:8]
                    )
                    failures.append(f"{view}/{theme}/{name}: Text/Control overflow: {details}")
                if console_errors:
                    failures.append(f"{view}/{theme}/{name}: Console errors: {' | '.join(console_errors[:3])}")
                page.close()
        browser.close()
    if server:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()

    if failures:
        print("UI-Visual-Audit fehlgeschlagen:")
        for failure in failures:
            print(f"- {failure}")
        print(f"Screenshots: {OUT}")
        raise SystemExit(1)
    print(f"UI-Visual-Audit: {len(VIEWS) * len(THEMES) * len(VIEWPORTS)} Screenshots geprüft. Keine harten Layoutfehler.")
    print(f"Screenshots: {OUT}")


if __name__ == "__main__":
    main()
