// Round-state theater: the countdown, GO!, round winner, sudden death, and the
// match-end panel with a route back to the menu.

import { useStore } from '../store.ts';
import { setPaused } from '../simClient.ts';
import { Scoreboard } from './Scoreboard.tsx';

export function RoundOverlay() {
  const round = useStore((s) => s.round);
  const banner = useStore((s) => s.banner);
  const setAppPhase = useStore((s) => s.setAppPhase);

  const now = performance.now();
  const bannerAge = banner ? now - banner.at : Infinity;
  const showBanner = banner && bannerAge < 2600 && round?.phase !== 'matchEnd';

  return (
    <>
      {round?.phase === 'countdown' && (
        <div className="countdown">{Math.ceil(round.countdownS)}</div>
      )}
      {showBanner && (
        <div className="banner" style={{ opacity: Math.min(1, 3 - bannerAge / 1000) }}>
          <div className="banner-title">{banner.title}</div>
          {banner.sub && <div className="banner-sub">{banner.sub}</div>}
        </div>
      )}
      {round?.phase === 'matchEnd' && (
        <div className="match-end">
          <div className="banner-title">{banner?.title ?? 'MATCH OVER'}</div>
          <Scoreboard />
          <button
            className="btn"
            onClick={() => {
              document.exitPointerLock?.();
              setPaused(true);
              setAppPhase('menu');
            }}
          >
            back to menu
          </button>
        </div>
      )}
    </>
  );
}
