// Server part of an optional extension (see src/common/extensions/CommonExtension.ts).
import {IHandler} from '../routes/IHandler';
import {PlayerInputObserver} from './inputObservers';

export type ServerExtension = {
  name: string,
  /** Extra routes: path (as in paths.ts, without leading slash) → handler */
  routes?: ReadonlyArray<readonly [string, IHandler]>,
  /** Watches the answers and undos of human players (read-only). */
  inputObserver?: PlayerInputObserver,
};
