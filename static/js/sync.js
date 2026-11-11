import { api } from "./api.js";

let timer = null, wasRunning = false, flash = "", flashTimer = null;
export function stopSync() { clearInterval(timer); timer = null; }

const ICON = '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2"/><path d="M18.5 2v4h-4M5.5 22v-4h4"/></svg>';

/** « il y a 5 min », « il y a 2 h », « hier »… */
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  if (m < 60 * 24) return `il y a ${Math.round(m / 60)} h`;
  const d = Math.round(m / 1440);
  return d === 1 ? "hier" : `il y a ${d} jours`;
}

/** Bouton « Synchroniser » : lance la synchro côté serveur, affiche l'avancement, puis recharge les données. */
export async function syncButton(el) {
  el.innerHTML = `<div class="sync"><span class="sync-msg" id="sm" role="status" aria-live="polite"></span>
    <button class="btn" id="sb" type="button">${ICON}<span>Synchroniser</span></button></div>`;
  const btn = el.querySelector("#sb"), msg = el.querySelector("#sm"), label = btn.querySelector("span");

  const render = s => {
    const running = s.state === "running";
    btn.disabled = running; btn.setAttribute("aria-busy", running);
    btn.querySelector("svg").classList.toggle("spin", running);
    label.textContent = running ? "Synchronisation…" : s.state === "error" ? "Réessayer" : "Synchroniser";
    msg.className = "sync-msg" + (s.state === "error" ? " err" : "");
    msg.title = (flash && s.notice ? s.notice + "\n\n" : "") + (s.log || []).join("\n");
    msg.textContent = running ? `${s.step} (${s.i}/${s.n})${s.line ? " · " + s.line : ""}`
      : s.state === "error" ? `Échec : ${s.error}`
      : flash || (s.last ? `Dernière synchro ${ago(s.last)}` : "Jamais synchronisé");
  };

  const poll = async () => {
    let s;
    try { s = await api.sync.status(); } catch (e) { stopSync(); msg.className = "sync-msg err"; msg.textContent = "Serveur injoignable"; return; }
    if (s.state === "running") { wasRunning = true; render(s); return; }
    stopSync();
    if (wasRunning) {   // la synchro vient de se terminer : on recharge les données de la page
      wasRunning = false;
      if (s.state === "done") {
        flash = (s.new ? `${s.new} nouvelle${s.new > 1 ? "s" : ""} activité${s.new > 1 ? "s" : ""}` : "Déjà à jour") + (s.notice ? ` · ${s.notice}` : "");
        clearTimeout(flashTimer); flashTimer = setTimeout(() => { flash = ""; }, s.notice ? 30000 : 10000);
        api.refresh();
        dispatchEvent(new Event("datachange"));
        return;
      }
    }
    render(s);
  };
  const watch = () => { if (!timer) timer = setInterval(poll, 1500); };

  btn.onclick = async () => {
    flash = "";
    try {
      const s = await api.sync.start();
      wasRunning = true; render(s); watch();
    } catch (e) { msg.className = "sync-msg err"; msg.textContent = e.message.includes("404") ? "Le serveur est une ancienne version : arrêtez-le (Ctrl+C) et relancez python app.py" : `Impossible de lancer la synchro : ${e.message}`; }
  };

  // on arrive peut-être pendant une synchro déjà en cours (page rechargée) : on reprend le suivi
  try { const s = await api.sync.status(); render(s); if (s.state === "running") { wasRunning = true; watch(); } }
  catch { msg.textContent = ""; }
}
