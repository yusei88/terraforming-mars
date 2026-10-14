import * as fs from 'fs';
import * as path from 'path';
import {GameId} from '@/common/Types';

// Storage of coach trace lines. The files hold every player's hidden state (hands, offers), so only the
// server user may read them: the folder is 0700 and every file 0600, links and files of other owners are
// refused, and a failed write is reported to the caller instead of being taken for a success.

export type TraceFile = 'trace' | 'states';

/** Outcome of one append. `code` is an errno-like name, never a path or id. */
export type AppendResult = {ok: true} | {ok: false, code: string};

export type ReadResult = {
  records: Array<unknown>,
  /** Lines that are not JSON (cut by a crash or a full disk); they are skipped, never rewritten. */
  corruptLines: number,
  /** Set when the file could not be read safely; `records` is then empty. */
  error?: string,
};

/** Health of the trace storage, safe to show to players (no paths, no ids). */
export type TraceHealth = {
  status: 'ok' | 'degraded' | 'refused',
  /** Why the storage refuses to write at all (`status: 'refused'`). */
  refusedReason?: string,
  writeFailures: Readonly<Record<string, number>>,
  /** Files whose last line had to be closed because it was cut. */
  tornLinesIsolated: number,
  corruptLinesSeen: number,
  /** Permission fixes made at start (files or folder that were readable by others). */
  permissionsFixed: number,
  /** Files left alone because they are links, not regular files or owned by someone else. */
  filesRefused: number,
};

/** Storage of trace lines, one JSON object per line and game. */
export type TraceSink = {
  append(gameId: GameId, file: TraceFile, record: object): AppendResult,
  read(gameId: GameId, file: TraceFile): ReadResult,
  /**
   * Records of `file` whose line contains `text`, parsed. Lines without it are not parsed.
   *
   * For finding snapshots by fingerprint in large files without parsing every snapshot.
   */
  readMatching(gameId: GameId, file: TraceFile, text: string): Array<unknown>,
  health(): TraceHealth,
};

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const TRACE_FILE_PATTERN = /^[A-Za-z0-9_-]+\.(trace|states)\.jsonl$/;

/** File name for a game's trace; game ids come from the server, but never let a separator through. */
export function traceFileName(directory: string, gameId: GameId, file: TraceFile): string {
  return path.join(directory, `${gameId.replace(/[^A-Za-z0-9_-]/g, '_')}.${file}.jsonl`);
}

function errorCode(error: unknown): string {
  const code = (error as {code?: unknown})?.code;
  return typeof code === 'string' ? code : 'EUNKNOWN';
}

function currentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

function ownedByUs(stats: fs.Stats): boolean {
  const uid = currentUid();
  return uid === undefined || stats.uid === uid;
}

/** Hooks to inject failures in tests. */
export type FileSinkTesting = {
  /** Called before each write; returning an errno name makes the write fail with it. */
  beforeWrite?: (file: TraceFile) => string | undefined,
};

class SecureFileSink implements TraceSink {
  private readonly failures = new Map<string, number>();
  private torn = 0;
  private corrupt = 0;
  private fixed = 0;
  private refusedFiles = new Set<string>();
  private refusedReason: string | undefined;

  constructor(private readonly directory: string, private readonly testing: FileSinkTesting = {}) {
    this.prepare();
  }

  private fail(code: string): AppendResult {
    this.failures.set(code, (this.failures.get(code) ?? 0) + 1);
    // Only the code: paths contain game ids, which grant access to the game.
    console.error(`coach trace: write failed (${code})`);
    return {ok: false, code};
  }

  /* Creates or checks the folder and the existing trace files; fixes modes we own, refuses the rest. */
  private prepare() {
    try {
      let stats: fs.Stats | undefined;
      try {
        stats = fs.lstatSync(this.directory);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          throw error;
        }
      }
      if (stats === undefined) {
        fs.mkdirSync(this.directory, {recursive: true, mode: DIRECTORY_MODE});
        // The umask can only remove bits; set the mode explicitly anyway.
        fs.chmodSync(this.directory, DIRECTORY_MODE);
        stats = fs.lstatSync(this.directory);
      }
      if (stats.isSymbolicLink()) {
        this.refuse('the trace folder is a symbolic link');
        return;
      }
      if (!stats.isDirectory()) {
        this.refuse('the trace folder is not a folder');
        return;
      }
      if (!ownedByUs(stats)) {
        this.refuse('the trace folder belongs to another user');
        return;
      }
      if ((stats.mode & 0o777) !== DIRECTORY_MODE) {
        fs.chmodSync(this.directory, DIRECTORY_MODE);
        this.fixed++;
      }
      for (const name of fs.readdirSync(this.directory)) {
        if (!TRACE_FILE_PATTERN.test(name)) {
          // Not ours: never touch it.
          continue;
        }
        const file = path.join(this.directory, name);
        const fileStats = fs.lstatSync(file);
        if (fileStats.isSymbolicLink() || !fileStats.isFile() || !ownedByUs(fileStats)) {
          this.refusedFiles.add(file);
          continue;
        }
        if ((fileStats.mode & 0o777) !== FILE_MODE) {
          fs.chmodSync(file, FILE_MODE);
          this.fixed++;
        }
      }
    } catch (error) {
      this.refuse(`the trace folder cannot be secured (${errorCode(error)})`);
    }
  }

  private refuse(reason: string) {
    this.refusedReason = reason;
    console.error(`coach trace: disabled, ${reason}`);
  }

  /* Opens a trace file without following links; checks it is a regular file of ours with mode 0600. */
  private open(file: string, flags: number): number {
    const fd = fs.openSync(file, flags | fs.constants.O_NOFOLLOW, FILE_MODE);
    try {
      const stats = fs.fstatSync(fd);
      if (!stats.isFile() || !ownedByUs(stats)) {
        throw Object.assign(new Error('refused'), {code: 'EREFUSED'});
      }
      if ((stats.mode & 0o777) !== FILE_MODE) {
        fs.fchmodSync(fd, FILE_MODE);
      }
      return fd;
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  }

  public append(gameId: GameId, kind: TraceFile, record: object): AppendResult {
    if (this.refusedReason !== undefined) {
      return this.fail('EREFUSED');
    }
    const file = traceFileName(this.directory, gameId, kind);
    if (this.refusedFiles.has(file)) {
      return this.fail('EREFUSED');
    }
    const injected = this.testing.beforeWrite?.(kind);
    if (injected !== undefined) {
      return this.fail(injected);
    }
    let fd: number | undefined;
    try {
      fd = this.open(file, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT);
      let prefix = '';
      const size = fs.fstatSync(fd).size;
      if (size > 0) {
        const last = Buffer.alloc(1);
        fs.readSync(fd, last, 0, 1, size - 1);
        if (last[0] !== 0x0a) {
          // The previous line was cut (crash, full disk): close it so it stays one bad line on its own.
          prefix = '\n';
          this.torn++;
        }
      }
      const data = Buffer.from(prefix + JSON.stringify(record) + '\n', 'utf8');
      const written = fs.writeSync(fd, data);
      if (written !== data.length) {
        return this.fail('ESHORTWRITE');
      }
      return {ok: true};
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ELOOP' || code === 'EREFUSED') {
        this.refusedFiles.add(file);
      }
      return this.fail(code);
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
    }
  }

  public read(gameId: GameId, kind: TraceFile): ReadResult {
    return this.parse(gameId, kind, undefined);
  }

  public readMatching(gameId: GameId, kind: TraceFile, text: string): Array<unknown> {
    return this.parse(gameId, kind, text).records;
  }

  private parse(gameId: GameId, kind: TraceFile, filter: string | undefined): ReadResult {
    if (this.refusedReason !== undefined) {
      return {records: [], corruptLines: 0, error: 'EREFUSED'};
    }
    const file = traceFileName(this.directory, gameId, kind);
    if (this.refusedFiles.has(file)) {
      return {records: [], corruptLines: 0, error: 'EREFUSED'};
    }
    let fd: number | undefined;
    try {
      fd = this.open(file, fs.constants.O_RDONLY);
      const text = fs.readFileSync(fd, 'utf8');
      const records: Array<unknown> = [];
      let corruptLines = 0;
      for (const line of text.split('\n')) {
        if (line.length === 0 || (filter !== undefined && !line.includes(filter))) {
          continue;
        }
        try {
          records.push(JSON.parse(line));
        } catch {
          corruptLines++;
        }
      }
      if (filter === undefined) {
        this.corrupt += corruptLines;
      }
      return {records, corruptLines};
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT') {
        return {records: [], corruptLines: 0};
      }
      return {records: [], corruptLines: 0, error: code};
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
    }
  }

  public health(): TraceHealth {
    const writeFailures = Object.fromEntries(this.failures);
    let status: TraceHealth['status'] = 'ok';
    if (this.refusedReason !== undefined) {
      status = 'refused';
    } else if (this.failures.size > 0 || this.refusedFiles.size > 0) {
      status = 'degraded';
    }
    const health: TraceHealth = {
      status,
      writeFailures,
      tornLinesIsolated: this.torn,
      corruptLinesSeen: this.corrupt,
      permissionsFixed: this.fixed,
      filesRefused: this.refusedFiles.size,
    };
    if (this.refusedReason !== undefined) {
      health.refusedReason = this.refusedReason;
    }
    return health;
  }
}

/** Sink writing `<directory>/<game>.{trace,states}.jsonl` with owner-only access. Never throws. */
export function fileSink(directory: string, testing?: FileSinkTesting): TraceSink {
  return new SecureFileSink(directory, testing);
}

/** Sink keeping lines in memory; `failNext` makes the next writes of a file fail. */
export function memorySink(): TraceSink & {lines: Map<string, Array<object>>, failNext(file: TraceFile, code: string, times?: number): void} {
  const lines = new Map<string, Array<object>>();
  const pending = new Map<TraceFile, {code: string, times: number}>();
  const failures = new Map<string, number>();
  return {
    lines,
    failNext(file, code, times = 1) {
      pending.set(file, {code, times});
    },
    append(gameId, file, record) {
      const failure = pending.get(file);
      if (failure !== undefined && failure.times > 0) {
        failure.times--;
        failures.set(failure.code, (failures.get(failure.code) ?? 0) + 1);
        return {ok: false, code: failure.code};
      }
      const key = `${gameId}.${file}`;
      lines.set(key, [...(lines.get(key) ?? []), JSON.parse(JSON.stringify(record))]);
      return {ok: true};
    },
    read(gameId, file) {
      return {records: lines.get(`${gameId}.${file}`) ?? [], corruptLines: 0};
    },
    readMatching(gameId, file, text) {
      return (lines.get(`${gameId}.${file}`) ?? []).filter((record) => JSON.stringify(record).includes(text));
    },
    health() {
      return {
        status: failures.size > 0 ? 'degraded' : 'ok',
        writeFailures: Object.fromEntries(failures),
        tornLinesIsolated: 0, corruptLinesSeen: 0, permissionsFixed: 0, filesRefused: 0,
      };
    },
  };
}
