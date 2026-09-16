// Width available inside an element's padding; clientWidth includes the padding and would make a canvas overflow.
export function contentWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return Math.max(0, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
}
