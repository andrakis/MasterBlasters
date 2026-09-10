// The rules scenarios every parity test drives: frames in, replies compared across hosts
// (bare c4bb vs native c4m32 in rulesParity, bare vs C4KE in kernelParity).
import { FRAME } from '../src/rules/frames.ts';

export type F = { type: number; payload: number[] };
export const SCENARIOS: Record<string, F[]> = {
  'team mode, KO credit, elimination, a second round': [
    { type: FRAME.MATCH_START, payload: [12345, 1, 2, 3, 300, 8, 4, 0, 1, 0, 1] },
    { type: FRAME.ROUND_START, payload: [1] },
    { type: FRAME.FALL, payload: [100, 1, 0, 90] }, { type: FRAME.TICK_END, payload: [100] },
    { type: FRAME.SPAWN, payload: [220, 1] },
    { type: FRAME.FALL, payload: [300, 3, 0, 299] }, { type: FRAME.FALL, payload: [300, 1, -1, 0] }, { type: FRAME.TICK_END, payload: [300] },
    { type: FRAME.FALL, payload: [400, 3, 2, 50] }, { type: FRAME.TICK_END, payload: [400] },
    { type: FRAME.FALL, payload: [450, 1, 0, 449] }, { type: FRAME.TICK_END, payload: [450] },
    { type: FRAME.ROUND_START, payload: [2] },
  ],
  'timed mode: timer tie -> sudden death -> a respawn decides': [
    { type: FRAME.MATCH_START, payload: [31337, 2, 1, 3, 300, 4, 2, 0, 1] },
    { type: FRAME.ROUND_START, payload: [1] },
    { type: FRAME.FALL, payload: [10, 0, 1, 5] }, { type: FRAME.TICK_END, payload: [10] },
    { type: FRAME.TIMER, payload: [18000] },
    { type: FRAME.SPAWN, payload: [18010, 0] }, { type: FRAME.TICK_END, payload: [18010] },
  ],
  'two falls on one tick both cost a stock, then a draw': [
    { type: FRAME.MATCH_START, payload: [1, 0, 1, 3, 300, 8, 2, 0, 1] },
    { type: FRAME.ROUND_START, payload: [1] },
    { type: FRAME.FALL, payload: [50, 0, 1, 49] }, { type: FRAME.FALL, payload: [50, 1, 0, 49] }, { type: FRAME.TICK_END, payload: [50] },
  ],
  'three round wins end the match': [
    { type: FRAME.MATCH_START, payload: [555, 0, 1, 3, 300, 8, 2, 0, 1] },
    { type: FRAME.ROUND_START, payload: [1] }, { type: FRAME.FALL, payload: [10, 1, 0, 9] }, { type: FRAME.TICK_END, payload: [10] },
    { type: FRAME.ROUND_START, payload: [2] }, { type: FRAME.FALL, payload: [20, 1, 0, 19] }, { type: FRAME.TICK_END, payload: [20] },
    { type: FRAME.ROUND_START, payload: [3] }, { type: FRAME.FALL, payload: [30, 1, 0, 29] }, { type: FRAME.TICK_END, payload: [30] },
  ],
};
