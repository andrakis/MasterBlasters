// The match setup screen + the multiplayer lobby. Choices persist in the store;
// PLAY rolls a fresh seed and sends the config to the worker (and, when hosting,
// to every connected peer).

import { useState } from 'react';
import { AI_TIERS } from '../config.ts';
import { MAP_LIST } from '../sim/maps/index.ts';
import { hostLobby, joinLobby, leaveLobby, setPaused, startMatch } from '../simClient.ts';
import { useStore } from '../store.ts';

export function Menu() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setAppPhase = useStore((s) => s.setAppPhase);
  const net = useStore((s) => s.net);
  const playerName = useStore((s) => s.playerName);
  const setPlayerName = useStore((s) => s.setPlayerName);
  const [joinCode, setJoinCode] = useState('');

  const isClient = net.role === 'client';
  const isHost = net.role === 'host';

  const play = () => {
    const seed = (Math.random() * 0x7fffffff) | 0;
    setPaused(false);
    startMatch({ ...settings, seed });
    setAppPhase('playing');
  };

  return (
    <div className="menu">
      <div className="menu-inner">
        <h1 className="title">
          MASTER<span>BLASTERS</span>
        </h1>
        <p className="tagline">rockets · ring-outs · jetpacks — a 2007 mod, reborn</p>

        <section className="lobby">
          <h2>multiplayer</h2>
          {net.role === 'local' && (
            <div className="lobby-row">
              <input
                className="text"
                value={playerName}
                maxLength={16}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="your name"
              />
              <button className="opt" onClick={() => hostLobby(playerName || 'Host')}>
                Host a room
              </button>
              <input
                className="text code"
                value={joinCode}
                maxLength={4}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="CODE"
              />
              <button
                className="opt"
                disabled={joinCode.length !== 4}
                onClick={() => joinLobby(joinCode, playerName || 'Blaster')}
              >
                Join
              </button>
            </div>
          )}
          {isHost && (
            <div className="lobby-row">
              <span className="room-code">
                room <b>{net.roomCode}</b>
              </span>
              <span className="roster">
                {net.roster.map((n, i) => (
                  <span key={i} className="roster-name">{n}</span>
                ))}
              </span>
              <button className="opt" onClick={() => leaveLobby()}>
                Close room
              </button>
            </div>
          )}
          {isClient && (
            <div className="lobby-row">
              <span className="room-code">
                {net.connected ? <>in room <b>{net.roomCode}</b> — waiting for the host to start</> : 'connecting…'}
              </span>
              <span className="roster">
                {net.roster.map((n, i) => (
                  <span key={i} className="roster-name">{n}</span>
                ))}
              </span>
              <button className="opt" onClick={() => leaveLobby()}>
                Leave
              </button>
            </div>
          )}
          {net.error && <div className="net-error">{net.error}</div>}
        </section>

        <div className="menu-grid" style={isClient ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
          <section>
            <h2>arena</h2>
            <div className="options">
              {MAP_LIST.map((m) => (
                <button
                  key={m.id}
                  className={`opt${settings.mapId === m.id ? ' sel' : ''}`}
                  onClick={() => setSettings({ mapId: m.id })}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>mode</h2>
            <div className="options">
              <button className={`opt${settings.mode === 'lms' ? ' sel' : ''}`} onClick={() => setSettings({ mode: 'lms' })}>
                Last Man Standing
              </button>
              <button className={`opt${settings.mode === 'team' ? ' sel' : ''}`} onClick={() => setSettings({ mode: 'team' })}>
                Masters vs Blasters
              </button>
              <button className={`opt${settings.mode === 'timed' ? ' sel' : ''}`} onClick={() => setSettings({ mode: 'timed' })}>
                Timed Game
              </button>
            </div>
          </section>

          <section>
            <h2>bots · {settings.botCount}</h2>
            <input
              type="range"
              min={1}
              max={7}
              value={settings.botCount}
              onChange={(e) => setSettings({ botCount: Number(e.target.value) })}
            />
            <div className="options">
              {AI_TIERS.map((t, i) => (
                <button
                  key={t.name}
                  className={`opt${settings.botTier === i ? ' sel' : ''}`}
                  onClick={() => setSettings({ botTier: i })}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>lives · {settings.lives}</h2>
            <input
              type="range"
              min={1}
              max={9}
              value={settings.lives}
              onChange={(e) => setSettings({ lives: Number(e.target.value) })}
            />
          </section>
        </div>

        {!isClient && (
          <button className="btn play" onClick={play}>
            {isHost ? `START · ${net.roster.length} player${net.roster.length === 1 ? '' : 's'} + ${settings.botCount} bots` : 'PLAY'}
          </button>
        )}

        <div className="help">
          <p>
            Knock everyone off the platforms. Damage never kills — it just makes the next hit send
            them further. The jetpack (hold <b>Space</b>) flies you home when they do it to you.
          </p>
          <p className="keys">
            WASD move · mouse aim · LMB fire · Space jump + jetpack · 1-4 / wheel weapons · C camera
            · Tab scores
          </p>
        </div>
      </div>
    </div>
  );
}
