// The list is a panel over the always-full-size map: the right side on
// desktop, a bottom sheet on phones. These helpers report how much of the map
// it covers so fitting / centring keeps markers in the visible part.

/** Pixels of map covered by the list panel: { right, bottom }. */
export function listCover(hidden) {
  const side = document.querySelector(".side");
  if (hidden || !side) return { right: 0, bottom: 0 };
  const rect = side.getBoundingClientRect();
  return matchMedia("(max-width:760px)").matches ? { right: 0, bottom: rect.height } : { right: rect.width, bottom: 0 };
}

/** fitBounds padding that leaves room for the map buttons and the list. */
export function mapPadding(cover) {
  return { top: 48, left: 64, right: 48 + cover.right, bottom: 48 + cover.bottom };
}
