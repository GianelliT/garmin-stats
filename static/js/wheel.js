/* Sélecteur à roues crantées (façon iOS) : une feuille en bas d'écran avec une roue par colonne.
   wheelPicker({ title, cols: [{ n, label }], value: [..], onDone(values) })  — n = nombre de valeurs (0 … n-1). */
const ITEM = 44;

export function wheelPicker({ title, cols, value, onDone }) {
  const opener = document.activeElement, root = document.documentElement, prevOverflow = root.style.overflow;
  const ov = document.createElement("div");
  ov.className = "wh-ov";
  ov.innerHTML = `<div class="wh-sheet" role="dialog" aria-modal="true" aria-label="${title}">
    <header><button type="button" class="btn sm" data-a="x">Annuler</button><strong>${title}</strong><button type="button" class="btn sm pri" data-a="ok">OK</button></header>
    <div class="wh-cols"><div class="wh-band"></div>${cols.map((c, i) => `${i ? '<span class="wh-sep">:</span>' : ""}
      <div class="wh-wrap"><small>${c.label}</small><div class="wh-col" tabindex="0" role="spinbutton" aria-label="${c.label}" aria-valuemin="0" aria-valuemax="${c.n - 1}">
        ${Array.from({ length: c.n }, (_, k) => `<div class="wh-it" data-k="${k}">${String(k).padStart(2, "0")}</div>`).join("")}</div></div>`).join("")}</div></div>`;
  document.body.appendChild(ov);
  root.style.overflow = "hidden";

  const colEls = [...ov.querySelectorAll(".wh-col")];
  const idx = (col, n) => Math.max(0, Math.min(n - 1, Math.round(col.scrollTop / ITEM)));
  const mark = (col, n) => {
    const k = idx(col, n);
    col.querySelectorAll(".wh-it.on").forEach(e => e.classList.remove("on"));
    col.children[k]?.classList.add("on");
    col.setAttribute("aria-valuenow", k);
  };
  colEls.forEach((col, i) => {
    const n = cols[i].n;
    col.scrollTop = Math.min(n - 1, Math.max(0, value[i] || 0)) * ITEM;
    mark(col, n);
    let raf = 0;
    col.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => mark(col, n)); }, { passive: true });
    col.addEventListener("click", e => { const it = e.target.closest(".wh-it"); if (it) col.scrollTo({ top: +it.dataset.k * ITEM, behavior: "smooth" }); });
    col.addEventListener("keydown", e => {
      const d = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
      if (d) { e.preventDefault(); col.scrollTo({ top: Math.max(0, Math.min(n - 1, idx(col, n) + d)) * ITEM, behavior: "smooth" }); }
    });
  });

  const close = () => { ov.remove(); root.style.overflow = prevOverflow; removeEventListener("keydown", onKey, true); opener?.focus?.({ preventScroll: true }); };
  const done = () => { const v = colEls.map((c, i) => idx(c, cols[i].n)); close(); onDone(v); };
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } else if (e.key === "Enter" && !e.target.closest(".wh-col")) { e.preventDefault(); done(); } }
  addEventListener("keydown", onKey, true);
  ov.addEventListener("click", e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "ok") done(); else if (a === "x" || e.target === ov) close();
  });
  colEls[0]?.focus({ preventScroll: true });
}
