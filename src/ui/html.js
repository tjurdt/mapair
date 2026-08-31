// HTML-escape a value interpolated into a template string. Matches the
// long-standing behaviour: a falsy input (0, false, null, undefined, "")
// becomes an empty string.
export function esc(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
