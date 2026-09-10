// The C4KE console: a Quake-style panel that drops over the game on the tilde
// key (debug builds only: the rules VM runs under C4KE there, with `top -d 5000 &`
// at the shell and the whole C4KE userland on the disk -- ls, mandel, raycast…).
// ANSI colours render (ansi.ts); clear/home are folded by the store so a program
// that redraws its screen (raycast) updates in place. Raw-keys mode (Ctrl+R) sends
// every keystroke straight through for programs that read keys. What the kernel prints comes up from the sim worker; a typed
// line is echoed here (the UART does not) and goes down to c4sh. While it is open the game's keys and pointer lock
// stand aside (PlayerRig checks consoleOpen).
import { useEffect, useMemo, useRef, useState } from 'react';
import { sendConsole } from '../simClient.ts';
import { useStore } from '../store.ts';
import { ansiSpans } from './ansi.ts';

/** a keydown as the bytes a terminal would send (raw mode) */
function rawBytes(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return e.key.length === 1 && e.ctrlKey ? String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64) : null;
  switch (e.key) {
    case 'Enter': return '\n';
    case 'Backspace': return '\b';
    case 'Tab': return '\t';
    case 'ArrowUp': return '\x1b[A';
    case 'ArrowDown': return '\x1b[B';
    case 'ArrowRight': return '\x1b[C';
    case 'ArrowLeft': return '\x1b[D';
    default: return e.key.length === 1 ? e.key : null;
  }
}

export function Console() {
  const open = useStore((s) => s.consoleOpen);
  const text = useStore((s) => s.consoleText);
  const setOpen = useStore((s) => s.setConsoleOpen);
  const raw = useStore((s) => s.consoleRaw);
  const setRaw = useStore((s) => s.setConsoleRaw);
  const [line, setLine] = useState('');
  const spans = useMemo(() => ansiSpans(text), [text]);
  const pre = useRef<HTMLPreElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // tilde toggles from anywhere (capture phase, so a locked pointer or a focused input cannot eat it)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') { e.preventDefault(); e.stopPropagation(); setOpen(!useStore.getState().consoleOpen); }
      else if (e.code === 'Escape' && useStore.getState().consoleOpen) setOpen(false);
      else if (e.code === 'KeyR' && e.ctrlKey && useStore.getState().consoleOpen) { e.preventDefault(); useStore.getState().setConsoleRaw(!useStore.getState().consoleRaw); }
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [setOpen]);
  useEffect(() => {
    if (open) { document.exitPointerLock?.(); setTimeout(() => input.current?.focus(), 0); }
    else input.current?.blur();
  }, [open]);
  useEffect(() => { pre.current?.scrollTo(0, 1e9); }, [text, open]);
  // Enter is handled here, not by the form's implicit submission: the game's key handlers
  // cancel default actions on the window, which would swallow it
  const submit = () => { useStore.getState().appendConsole(line + '\n'); sendConsole(line + '\n'); setLine(''); };

  return (
    <div className={`console${open ? ' open' : ''}`} aria-hidden={!open}>
      <pre ref={pre}>{text ? spans.map((sp, i) => (sp.fg || sp.bg ? <span key={i} style={{ color: sp.fg ?? undefined, background: sp.bg ?? undefined }}>{sp.text}</span> : sp.text)) : '(the kernel has not printed yet)'}</pre>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <span className="prompt">{raw ? 'raw' : 'c4sh>'}</span>
        <input ref={input} value={line} spellCheck={false} autoComplete="off" placeholder={raw ? 'every key goes straight to the program (q quits raycast)' : ''}
          onChange={(e) => { if (!raw) setLine(e.target.value); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (raw) { const b = rawBytes(e); if (b !== null) { e.preventDefault(); sendConsole(b); } return; }
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
          }} />
        <button type="button" className="raw-toggle" title="raw keys: send every keystroke at once (Ctrl+R)" onClick={() => { setRaw(!raw); input.current?.focus(); }}>{raw ? 'line mode' : 'raw keys'}</button>
      </form>
    </div>
  );
}
