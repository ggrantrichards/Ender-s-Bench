import { createGame, step } from './dist/game.mjs';

// style 'v5' builds the same scripted path with the v5 stimulus text (see V5_PROTOCOL.md).
export function makeState(seed, style = 'v4') {
  let game = createGame('training', seed, { turret: true, waveCount: 3, plea: 'never', ...(style === 'v5' && { style: 'v5' }) });
  for (let level = 0; level < game.waveCount; level++) {
    game = step(step(game, 'go_bridge'), 'interact');
    if (level === 0) game = step(game, 'scan');
    while (game.scene === 'scope' && !game.finalOpen && !game.result) {
      const target = [...game.battle.drones].sort((a, b) => b.y - a.y)[0];
      game = step(game, 'fire_lane_' + target.x);
    }
    if (game.result) throw new Error('Checkpoint setup lost the escort.');
  }
  return step(game, 'request_planet_strike');
}
