// The C4KE console: a Quake-style panel that drops over the game on the tilde
// key (debug builds only: the rules VM runs under C4KE there, with `top -d 5000 &`
// at the shell). What the kernel prints comes up from the sim worker; a typed
// line is echoed here (the UART does not) and goes down to c4sh. While it is open the game's keys and pointer lock
// stand aside (PlayerRig checks consoleOpen).
import { useEffect, useRef, useState } from 'react';
import { sendConsole } from '../simClient.ts';
import { useStore } from '../store.ts';

export function Console() {
  const open = useStore((s) => s.consoleOpen);
  const text = useStore((s) => s.consoleText);
  const setOpen = useStore((s) => s.setConsoleOpen);
  const [line, setLine] = useState('');
  const pre = useRef<HTMLPreElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // tilde toggles from anywhere (capture phase, so a locked pointer or a focused input cannot eat it)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') { e.preventDefault(); e.stopPropagation(); setOpen(!useStore.getState().consoleOpen); }
      else if (e.code === 'Escape' && useStore.getState().consoleOpen) setOpen(false);
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
      <pre ref={pre}>{text || '(the kernel has not printed yet)'}</pre>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <span className="prompt">c4sh&gt;</span>
        <input ref={input} value={line} spellCheck={false} autoComplete="off" onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
      </form>
    </div>
  );
}
