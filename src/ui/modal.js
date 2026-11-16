// The one modal primitive: a full-screen ".modal-bg" backdrop holding a
// ".modal" card. Backdrop clicks dismiss the top modal; modals stack (the
// friends manager opens over the settings sheet), so closeModal() pops the
// last one and closeAllModals() clears the stack (used on auth changes).
//
// `html` is the card's inner HTML; callers wire the controls inside it after
// this returns. Kept as a plain string template — no framework.
// `opts.className` adds classes to the card (e.g. "dialog" for the compact,
// vertically centred editor card).

export function modal(html, opts = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-bg" + (opts.className ? ` ${opts.className}-bg` : "");
  backdrop.innerHTML = `<div class="modal${opts.className ? ` ${opts.className}` : ""}">${html}</div>`;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeModal();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

export function closeModal() {
  const open = document.querySelectorAll(".modal-bg");
  if (open.length) open[open.length - 1].remove();
}

export function closeAllModals() {
  document.querySelectorAll(".modal-bg, .emoji-layer").forEach((layer) => layer.remove());
}
