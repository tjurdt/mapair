// The one modal primitive: a full-screen ".modal-bg" backdrop holding a
// ".modal" card. Backdrop clicks dismiss the top modal; modals stack (the
// friends manager opens over the settings sheet), so closeModal() pops the
// last one and closeAllModals() clears the stack (used on auth changes).
//
// `html` is the card's inner HTML; callers wire the controls inside it after
// this returns. Kept as a plain string template — no framework.

export function modal(html) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-bg";
  backdrop.innerHTML = `<div class="modal">${html}</div>`;
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
  document.querySelectorAll(".modal-bg").forEach((backdrop) => backdrop.remove());
}
