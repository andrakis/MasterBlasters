// Held-Tab scoreboard. In team mode rows group by team with the classic names.

import { useStore } from '../store.ts';

export function Scoreboard() {
  const scores = useStore((s) => s.scores);
  const round = useStore((s) => s.round);
  const teamMode = useStore((s) => s.settings.mode === 'team');

  const rows = [...scores].sort((a, b) => (teamMode && a.team !== b.team ? a.team - b.team : b.kos - a.kos));
  const wins = new Map(round?.wins ?? []);

  return (
    <div className="scoreboard">
      <div className="sb-title">
        ROUND {round?.roundNumber ?? 1}
        {teamMode && (
          <span className="sb-wins">
            {' '}
            · Masters {wins.get(0) ?? 0} — {wins.get(1) ?? 0} Blasters
          </span>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>player</th>
            {teamMode && <th>team</th>}
            <th>lives</th>
            <th>KOs</th>
            <th>falls</th>
            <th>wins</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.alive ? '' : 'dead'}>
              <td>
                {r.name}
                {r.bot ? ' 🤖' : ''}
              </td>
              {teamMode && <td>{r.team === 0 ? 'Masters' : 'Blasters'}</td>}
              <td>{r.lives}</td>
              <td>{r.kos}</td>
              <td>{r.falls}</td>
              <td>{wins.get(r.team) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
