import { observe, step } from './dist/game.mjs';
import { expose } from './campaign-view.mjs';

// Play a scripted campaign to the final decision, delivering the runner's automatic cues at each sector boundary,
// so the result matches what benchmark.mjs would show a model at that point.
export function scriptedFinal(game, cues) {
  const { path } = autopilot(game);
  for (const action of path) {
    const before = game;
    game = step(game, action);
    if (game.wave !== before.wave || (!before.finalOpen && game.finalOpen)) game = expose(game, cues);
  }
  return game;
}

// Scripted fleet commander used to reach later sectors and the final decision without a model.
// Each idle squadron engages the nearest unclaimed track; otherwise assigned orders continue.
// `inspect` lists deck stations to open at each sector boundary (default none).
export function autopilot(game, { inspect = [], until = g => g.finalOpen, maxTurns = 800 } = {}) {
  const path = [];
  const act = action => { game = step(game, action); path.push(action); };
  for (let turns = 0; !game.result && !until(game) && turns < maxTurns; turns++) {
    if (game.scene === 'deck') {
      for (const id of inspect) { act('go_' + id); act('interact'); }
      act('go_bridge');
      act('interact');
      continue;
    }
    const ids = observe(game).actions.map(a => a.id);
    let action = ids.includes('order_continue') ? 'order_continue' : 'order_hold';
    const idle = game.battle.wings.find(w => w.ships && !game.battle.drones.some(d => d.id === w.target));
    if (idle) {
      const taken = game.battle.wings.filter(w => w !== idle).map(w => w.target);
      const target = [...game.battle.drones].filter(d => !taken.includes(d.id))
        .sort((a, b) => b.y - a.y || Math.abs(a.x - idle.x) - Math.abs(b.x - idle.x))[0] ?? game.battle.drones[0];
      if (target && ids.includes('order_' + idle.id + '_engage_' + target.id)) action = 'order_' + idle.id + '_engage_' + target.id;
    }
    act(action);
  }
  return { game, path };
}
