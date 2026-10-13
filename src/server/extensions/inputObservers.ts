// Observers of player answers, registered by optional extensions (ServerExtension.inputObserver).
// They only watch: they cannot change or block an answer, and an observer that throws is logged and
// ignored, so a broken extension never stops a game.
import {IPlayer} from '../IPlayer';
import {InputResponse} from '../../common/inputs/InputResponse';

/** Result of one answer, reported after the game processed it. */
export type InputOutcome = {accepted: true} | {accepted: false, error: string};

/** Kind of rollback that replaced the game state. */
export type RevertKind = 'undo' | 'cancel-action';

/** Extension hook that watches answers and rollbacks of human players. */
export type PlayerInputObserver = {
  name: string,
  /**
   * Called before `response` is processed, while the question is still open.
   *
   * Returns a callback for the outcome, or undefined to skip this answer.
   */
  beforeInput(player: IPlayer, response: InputResponse, thinkingMilliseconds: number | undefined): ((outcome: InputOutcome) => void) | undefined;
  /**
   * Called before an undo or cancelled action replaces the game.
   *
   * Returns a callback that gets the player of the restored game (undefined when the rollback failed).
   */
  beforeRevert?(player: IPlayer, kind: RevertKind): ((restored: IPlayer | undefined) => void) | undefined;
};

const observers: Array<PlayerInputObserver> = [];

export function addInputObserver(observer: PlayerInputObserver): void {
  if (!observers.includes(observer)) {
    observers.push(observer);
  }
}

/** for testing */
export function removeInputObserver(observer: PlayerInputObserver): void {
  const index = observers.indexOf(observer);
  if (index >= 0) {
    observers.splice(index, 1);
  }
}

function guarded<T>(observer: PlayerInputObserver, run: () => T): T | undefined {
  try {
    return run();
  } catch (error) {
    console.error(`Input observer ${observer.name} failed`, error);
    return undefined;
  }
}

/** Notifies every observer of an answer about to be processed; the result reports its outcome. */
export function observeInput(player: IPlayer, response: InputResponse, thinkingMilliseconds: number | undefined): (outcome: InputOutcome) => void {
  const pending = observers.flatMap((observer) => {
    const callback = guarded(observer, () => observer.beforeInput(player, response, thinkingMilliseconds));
    return callback === undefined ? [] : [{observer, callback}];
  });
  return (outcome) => {
    for (const {observer, callback} of pending) {
      guarded(observer, () => callback(outcome));
    }
  };
}

/** Notifies every observer of a rollback about to happen; the result reports the restored player. */
export function observeRevert(player: IPlayer, kind: RevertKind): (restored: IPlayer | undefined) => void {
  const pending = observers.flatMap((observer) => {
    const callback = guarded(observer, () => observer.beforeRevert?.(player, kind));
    return callback === undefined ? [] : [{observer, callback}];
  });
  return (restored) => {
    for (const {observer, callback} of pending) {
      guarded(observer, () => callback(restored));
    }
  };
}
