// The list is a panel over the always-full-size map: the left side on
// desktop, a bottom sheet on phones. These helpers report how much of the map
// it covers so fitting / centring keeps markers in the visible part.

/** Pixels of map covered by the list panel: { left, bottom }. */
export function listCover(hidden) {
  const side = document.querySelector(".side");
  if (hidden || !side) return { left: 0, bottom: 0 };
  const rect = side.getBoundingClientRect();
  return matchMedia("(max-width:760px)").matches ? { left: 0, bottom: rect.height } : { left: rect.width, bottom: 0 };
}

/** fitBounds padding that leaves room for the list and the right-hand map buttons. */
export function mapPadding(cover) {
  return { top: 48, left: 48 + cover.left, right: 64, bottom: 48 + cover.bottom };
}
