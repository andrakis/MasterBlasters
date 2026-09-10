// A small ANSI renderer for the console: SGR colours (38;5;n / 48;5;n, 0, 39, 49) become
// spans; clear/home were folded into the log by the store (foldConsole); everything else
// in an ESC[...] sequence (cursor hide/show, unknown SGR) is dropped.

export interface Span { text: string; fg: string | null; bg: string | null }

/** xterm's 256-colour palette entry as CSS */
export function xterm256(n: number): string {
  const basic = ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5', '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff'];
  if (n < 16) return basic[n];
  if (n < 232) { const i = n - 16, r = Math.floor(i / 36), g = Math.floor(i / 6) % 6, b = i % 6; const v = (x: number) => (x ? 55 + x * 40 : 0); return `rgb(${v(r)},${v(g)},${v(b)})`; }
  const gray = 8 + (n - 232) * 10; return `rgb(${gray},${gray},${gray})`;
}

export function ansiSpans(text: string): Span[] {
  const out: Span[] = [];
  let fg: string | null = null, bg: string | null = null;
  const re = /\x1b\[([0-9;?]*)([A-Za-z])/g;
  let at = 0, m: RegExpExecArray | null;
  const push = (t: string) => { if (t) out.push({ text: t, fg, bg }); };
  while ((m = re.exec(text))) {
    push(text.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[2] !== 'm') continue;
    const p = m[1].split(';').map((x) => parseInt(x || '0', 10));
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === 0) { fg = null; bg = null; }
      else if (c === 39) fg = null;
      else if (c === 49) bg = null;
      else if ((c === 38 || c === 48) && p[i + 1] === 5) { const col = xterm256(p[i + 2] ?? 0); if (c === 38) fg = col; else bg = col; i += 2; }
      else if (c >= 30 && c <= 37) fg = xterm256(c - 30);
      else if (c >= 40 && c <= 47) bg = xterm256(c - 40);
      else if (c >= 90 && c <= 97) fg = xterm256(c - 90 + 8);
      else if (c >= 100 && c <= 107) bg = xterm256(c - 100 + 8);
    }
  }
  push(text.slice(at));
  return out;
}
