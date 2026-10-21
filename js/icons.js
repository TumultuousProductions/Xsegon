import { el } from "./util.js";

/* ---------- the icon set ----------
   Drawn here, one line each: 24x24, thin strokes, currentColor, so every
   icon takes the accent and the size of wherever it stands. A name that does
   not exist draws a dot, so a typo is visible. */
var ICONS = {
  play:    '<path d="M8.5 5.5v13l10.5-6.5z"/>',
  info:    '<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5M12 7.4v.7"/>',
  star:    '<path d="M12 4.2l2.3 4.9 5.3.7-3.9 3.7 1 5.3-4.7-2.6-4.7 2.6 1-5.3-3.9-3.7 5.3-.7z"/>',
  starFill:'<path fill="currentColor" d="M12 4.2l2.3 4.9 5.3.7-3.9 3.7 1 5.3-4.7-2.6-4.7 2.6 1-5.3-3.9-3.7 5.3-.7z"/>',
  // a cog: eight teeth round a hole (a ring of rays reads as a sun)
  gear:    '<path d="M10.2 5.1L10.5 2.7L13.5 2.7L13.8 5.1L15.6 5.9L17.5 4.4L19.6 6.5L18.1 8.5L18.9 10.2L21.3 10.5L21.3 13.5L18.9 13.8L18.1 15.5L19.6 17.5L17.5 19.6L15.6 18.1L13.8 18.9L13.5 21.3L10.5 21.3L10.2 18.9L8.5 18.1L6.5 19.6L4.4 17.5L5.9 15.5L5.1 13.8L2.7 13.5L2.7 10.5L5.1 10.2L5.9 8.4L4.4 6.5L6.5 4.4L8.4 5.9z"/><circle cx="12" cy="12" r="3"/>',
  disc:    '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="2.7"/>',
  pencil:  '<path d="M4.5 19.5l1-3.8L16.6 4.6a2 2 0 0 1 2.8 2.8L8.3 18.5z"/><path d="M14.6 6.6l2.8 2.8"/>',
  image:   '<rect x="4" y="5" width="16" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M4.5 16.5l4.5-4.5 3.6 3.6 2.9-2.9 4 4"/>',
  film:    '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M8.2 5v14M15.8 5v14M4 9.5h4.2M4 14.5h4.2M15.8 9.5H20M15.8 14.5H20"/>',
  x:       '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  eyeOff:  '<path d="M4 12s3-5.3 8-5.3S20 12 20 12s-3 5.3-8 5.3S4 12 4 12z"/><path d="M5.5 18.5l13-13"/>',
  external:'<path d="M10 6H6a1.5 1.5 0 0 0-1.5 1.5V18A1.5 1.5 0 0 0 6 19.5h10.5A1.5 1.5 0 0 0 18 18v-4"/><path d="M13.5 4.5H19.5V10.5M19 5l-8.5 8.5"/>',
  check:   '<path d="M5.5 12.5l4.2 4.2 8.8-9.4"/>',
  // Cheats. A wand with three sparks: the one drawing in this set that is
  // allowed to look like it is getting away with something.
  wand:    '<path d="M5 19l9.5-9.5"/><path d="M13.4 5.2l1.1 2.3 2.3 1.1-2.3 1.1-1.1 2.3-1.1-2.3-2.3-1.1 2.3-1.1z"/><path d="M18.6 13.2l.6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6 1.2-.6z"/>',
  shield:  '<path d="M12 3.6l6.4 2.4v5.2c0 4-2.7 6.9-6.4 8.2-3.7-1.3-6.4-4.2-6.4-8.2V6z"/><path d="M9.2 12l2 2 3.6-3.8"/>',
  save:    '<path d="M5 6A1.5 1.5 0 0 1 6.5 4.5h9L19 8v10A1.5 1.5 0 0 1 17.5 19.5h-11A1.5 1.5 0 0 1 5 18z"/><path d="M8.5 4.5V9h6V4.7M8 19.5v-6h8v6"/>',
  dice:    '<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/><circle fill="currentColor" stroke="none" cx="9" cy="9" r="1.1"/><circle fill="currentColor" stroke="none" cx="15" cy="9" r="1.1"/><circle fill="currentColor" stroke="none" cx="12" cy="12" r="1.1"/><circle fill="currentColor" stroke="none" cx="9" cy="15" r="1.1"/><circle fill="currentColor" stroke="none" cx="15" cy="15" r="1.1"/>',
  back:    '<path d="M14.5 6l-6 6 6 6"/>',
  // a jump through a list, back and forward: the shoulder buttons' jobs
  jumpBack:'<path d="M12 6l-6 6 6 6M18 6l-6 6 6 6"/>',
  jumpOn:  '<path d="M12 6l6 6-6 6M6 6l6 6-6 6"/>',
  trash:   '<path d="M5.5 7h13"/><path d="M9.5 7V5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/><path d="M7 7l.8 11.3a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7"/><path d="M10.6 10.5v6M13.4 10.5v6"/>',
  minus:   '<path d="M6 12h12"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19.2 3.8v4.4h-4.4"/>',
  grid:    '<rect x="4.5" y="4.5" width="6" height="6"/><rect x="13.5" y="4.5" width="6" height="6"/><rect x="4.5" y="13.5" width="6" height="6"/><rect x="13.5" y="13.5" width="6" height="6"/>',
  download:'<path d="M12 4.5v10.5M7.5 11l4.5 4.5L16.5 11M5.5 19.5h13"/>',
  plus:    '<path d="M12 5.5v13M5.5 12h13"/>',
  lines:   '<path d="M5 7h14M5 12h14M5 17h9"/>',
  folder:  '<path d="M4 7a1.5 1.5 0 0 1 1.5-1.5H10l2 2.5h6.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/>',
  library: '<rect x="4.5" y="4.5" width="4" height="15"/><rect x="10" y="4.5" width="4" height="15"/><path d="M15.5 5.2l4.3 1-3 13.3-4.3-1z"/>',
  // an open book: a game's manual, maps and guides
  book:    '<path d="M12 6.8C10.4 5.4 7.8 5 4.5 5.4v12.2c3.3-.4 5.9 0 7.5 1.4 1.6-1.4 4.2-1.8 7.5-1.4V5.4C16.2 5 13.6 5.4 12 6.8z"/><path d="M12 6.8V19"/>',
  sparkle: '<path d="M12 4.5l1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5z"/>',
  note:    '<path d="M9.3 17V6l9-1.8v10.6"/><circle cx="7" cy="17.2" r="2.3"/><circle cx="16" cy="14.9" r="2.3"/>',
  gamepad: '<path d="M7.2 8h9.6a4.4 4.4 0 0 1 4.3 5.3l-.7 3.1a2.5 2.5 0 0 1-4.4 1L14.5 16h-5l-1.5 1.4a2.5 2.5 0 0 1-4.4-1l-.7-3.1A4.4 4.4 0 0 1 7.2 8z"/><path d="M8.6 10.8v3.2M7 12.4h3.2"/><circle fill="currentColor" stroke="none" cx="15.4" cy="11.5" r=".95"/><circle fill="currentColor" stroke="none" cx="17.4" cy="13.3" r=".95"/>',
  pointer: '<path d="M6.5 4.5l11 6.6-4.9 1.3 2.7 5.2-2.2 1.1-2.7-5.2-3.9 3.2z"/>',
  phone:   '<rect x="7.5" y="3.5" width="9" height="17" rx="1.8"/><path d="M10.8 17.4h2.4"/>',
  window:  '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 9h16"/>',
  moon:    '<path d="M19 14.7A7.6 7.6 0 0 1 9.3 5 7.6 7.6 0 1 0 19 14.7z"/>',
  bug:     '<circle cx="12" cy="13.2" r="4.4"/><path d="M12 8.8V6.6M8.9 9.6L7.4 7.4M15.1 9.6l1.5-2.2M7.6 13.2H5.2M18.8 13.2h-2.4M8.9 16.6l-1.5 2.2M15.1 16.6l1.5 2.2"/>',
  toggle:  '<rect x="4" y="8" width="16" height="8" rx="4"/><circle cx="15.4" cy="12" r="2.1"/>',
  chevrons:'<path d="M8.6 9.8L12 6.4l3.4 3.4M8.6 14.2L12 17.6l3.4-3.4"/>',
  slider:  '<path d="M4 12h16"/><circle cx="14" cy="12" r="2.5"/>',
  // the volume corner: sound coming out, and the same speaker crossed out
  speaker: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.2 9.2a4 4 0 0 1 0 5.6M17.8 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  speakerOff:'<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
  hash:    '<path d="M9.6 5l-2 14M16.4 5l-2 14M5 9.5h14M5 14.5h14"/>',
  bolt:    '<path d="M13 4L6.5 13.5h4.6L10.8 20l6.7-9.5h-4.6z"/>',
  search:  '<circle cx="11" cy="11" r="5.4"/><path d="M15.1 15.1L20 20"/>',
  filter:  '<path d="M4.5 5.5h15l-5.8 6.9v5.5l-3.4 1.8v-7.3z"/>',
  tag:     '<path d="M4.5 11.8V5.5a1 1 0 0 1 1-1h6.3l7.4 7.4a1 1 0 0 1 0 1.4l-5.9 5.9a1 1 0 0 1-1.4 0z"/><circle cx="8.7" cy="8.7" r="1.4"/>',
  tabs:    '<rect x="4" y="7" width="16" height="12" rx="1.5"/><path d="M4 11h16M9.5 7v4"/>',
  // a settings section's fold: points down while open, turned to point right when folded (css)
  caret:   '<path d="M6.5 9.2L12 14.8l5.5-5.6"/>',
  // the caret turned over: a place moved up in the Media tab's Look in
  up:      '<path d="M6.5 14.8L12 9.2l5.5 5.6"/>',
  dot:     '<circle fill="currentColor" stroke="none" cx="12" cy="12" r="2"/>'
};
export function iconEl(cls, name) {
  var s = el("span", cls + " xico");
  s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.dot) + "</svg>";
  return s;
}
