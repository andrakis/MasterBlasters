// DOM-overlay HUD (sibling of the Canvas): health %, jetpack energy, stocks,
// weapon/ammo, quad timer, kill feed, round banner, scoreboard, debug row.
// Everything here renders from throttled human-rate store state.

import { useEffect, useState } from 'react';
import { TUNING as T, WEAPONS } from '../config.ts';
import { useStore } from '../store.ts';
import { Scoreboard } from './Scoreboard.tsx';
import { RoundOverlay } from './RoundOverlay.tsx';

export function Hud() {
  const hud = useStore((s) => s.hud);
  const feed = useStore((s) => s.feed);
  const round = useStore((s) => s.round);
  const pointerLocked = useStore((s) => s.pointerLocked);
  const lastHurtAt = useStore((s) => s.lastHurtAt);
  const lastHitConfirmAt = useStore((s) => s.lastHitConfirmAt);
  const tick = useStore((s) => s.tick);
  const simTps = useStore((s) => s.simTps);
  const fps = useStore((s) => s.fps);
  const [showScores, setShowScores] = useState(false);
  const [, force] = useState(0);

  // Tab holds the scoreboard; re-render every 100ms while transient flashes decay
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setShowScores(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Tab') setShowScores(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  const now = performance.now();
  const hurt = Math.max(0, 1 - (now - lastHurtAt) / 500);
  const hitConfirm = now - lastHitConfirmAt < 180;

  const hp = hud?.hp ?? T.PLAYER_HP;
  const hpFrac = hp / T.PLAYER_HP;
  const energyFrac = (hud?.energy ?? 100) / T.JET_ENERGY_MAX;
  const hpColor = `rgb(${Math.round(220 - hpFrac * 90)}, ${Math.round(60 + hpFrac * 150)}, 70)`;
  const danger = 1 - hpFrac; // how far a hit will send you

  return (
    <div className="hud">
      {/* hurt vignette */}
      {hurt > 0 && <div className="vignette" style={{ opacity: hurt * 0.55 }} />}

      {/* crosshair */}
      {pointerLocked && hud?.alive && (
        <div className={`crosshair${hitConfirm ? ' confirm' : ''}`}>
          <span />
          <span />
          <span />
          <span />
        </div>
      )}

      {/* bottom left: health = your knockback vulnerability */}
      {hud && (
        <div className="panel hp">
          <div className="hp-big" style={{ color: hpColor }}>
            {Math.round(hp)}
            <span className="hp-unit">hp</span>
          </div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${hpFrac * 100}%`, background: hpColor }} />
          </div>
          <div className="hp-note">{danger > 0.6 ? 'CRITICAL — one hit flies' : danger > 0.3 ? 'hurting' : ''}</div>
          <div className="stocks">
            {Array.from({ length: Math.max(0, hud.lives) }, (_, i) => (
              <span key={i} className="stock">◆</span>
            ))}
          </div>
        </div>
      )}

      {/* bottom right: jetpack + weapon */}
      {hud && (
        <div className="panel jet">
          <div className="row">
            <span className="label">JET</span>
            <div className="bar wide">
              <div
                className="bar-fill"
                style={{
                  width: `${energyFrac * 100}%`,
                  background: energyFrac < 0.2 ? '#e5484d' : '#2ec2e0',
                }}
              />
            </div>
          </div>
          <div className="weapon">
            {WEAPONS[hud.weapon]?.name}
            {hud.ammo[hud.weapon] >= 0 && <span className="ammo"> × {hud.ammo[hud.weapon]}</span>}
          </div>
          <div className="slots">
            {WEAPONS.map((w, i) => (
              <span
                key={w.name}
                className={`slot${i === hud.weapon ? ' active' : ''}${hud.ammo[i] === 0 ? ' empty' : ''}`}
              >
                {i + 1}
              </span>
            ))}
          </div>
          {hud.quadS > 0 && <div className="quad">QUAD {hud.quadS.toFixed(0)}s</div>}
        </div>
      )}

      {/* top right: feed */}
      <div className="feed">
        {feed.map((f) => (
          <div key={f.id} className={`feed-item${f.good ? ' good' : ''}`}>
            {f.text}
          </div>
        ))}
      </div>

      {/* top center: timer / round info */}
      {round && round.timeLeftS >= 0 && (
        <div className="timer">
          {Math.floor(round.timeLeftS / 60)}:{String(Math.floor(round.timeLeftS % 60)).padStart(2, '0')}
          {round.suddenDeath && <span className="sudden"> SUDDEN DEATH</span>}
        </div>
      )}

      {/* respawn note */}
      {hud && !hud.alive && hud.lives > 0 && round?.phase === 'active' && (
        <div className="respawn">respawning in {hud.respawnS.toFixed(1)}s</div>
      )}
      {hud && !hud.alive && hud.lives <= 0 && round?.phase === 'active' && (
        <div className="respawn">out of lives — spectating</div>
      )}

      {/* click to lock hint */}
      {!pointerLocked && useStore.getState().matchLive && (
        <div className="lock-hint">click to take control · WASD move · Space jump/jet · C camera · Tab scores</div>
      )}

      <RoundOverlay />
      {showScores && <Scoreboard />}

      <div className="debug">
        tick {tick} · sim {simTps}tps · {fps}fps
        {useStore.getState().net.role !== 'local' &&
          ` · ${useStore.getState().net.role} · ${useStore.getState().netKbps.toFixed(1)} kB/s`}
      </div>
    </div>
  );
}
