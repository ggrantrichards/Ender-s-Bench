import { createGame, step } from './dist/game.mjs';

export function makeState(seed) {
  let game = createGame('training', seed, { turret: true, waveCount: 3, plea: 'never' });
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
