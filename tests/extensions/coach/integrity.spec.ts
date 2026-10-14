import {expect} from 'chai';
import {annotateSeries, assessIntegrity} from '../../../src/extensions/coach/server/integrity';
import {CoachStateRef, CoachTraceEvent} from '../../../src/extensions/coach/common/CoachTrace';
import {Color} from '../../../src/common/Color';
import {Phase} from '../../../src/common/Phase';

function ref(fingerprint: string, gameStep: number, gameAge: number, branch = 0, generation = 1, undoCount = 0): CoachStateRef {
  return {fingerprint, stateKey: `${fingerprint}:s${gameStep}`, branch, version: {generation, phase: Phase.ACTION, gameAge, gameStep, undoCount}};
}

const base = {schemaVersion: 'coach-trace/1' as const, recordedAt: '2026-10-14T00:00:00.000Z', decidedAt: '2026-10-14T00:00:00.000Z', response: {type: 'option' as const}};

function decision(seq: number, color: Color, before: CoachStateRef, after: CoachStateRef): CoachTraceEvent {
  return {...base, type: 'decision', seq, player: {color, name: color}, before, after, offered: undefined};
}
function rejected(seq: number, color: Color, before: CoachStateRef): CoachTraceEvent {
  return {...base, type: 'rejected', seq, player: {color, name: color}, before, error: 'no'};
}

// P1.5-02: classification rules
describe('coach integrity', () => {
  const events = [
    decision(1, 'red', ref('a', 1, 10), ref('b', 2, 12)),
    decision(2, 'red', ref('b', 2, 12), ref('c', 3, 15)),
  ];

  it('is valid without history', () => {
    expect(assessIntegrity([], {color: 'red', fingerprint: 'x', version: ref('x', 1, 1).version}).status).eq('valid');
  });

  it('is valid when the game matches or is ahead (other players acted)', () => {
    expect(assessIntegrity(events, {color: 'red', fingerprint: 'c', version: ref('c', 3, 15).version}).status).eq('valid');
    expect(assessIntegrity(events, {color: 'red', fingerprint: 'z', version: ref('z', 4, 20).version}).status).eq('valid');
  });

  it('detects a rollback when counters went back', () => {
    const result = assessIntegrity(events, {color: 'red', fingerprint: 'b', version: ref('b', 2, 12).version});
    expect(result.status).eq('rollback-detected');
    expect(result.lastConfirmed?.seq).eq(2);
    expect(result.reason).contains('gameStep 3→2');
  });

  it('ignores rejected answers as progress', () => {
    const withRejected = [...events, rejected(3, 'red', ref('c', 3, 15))];
    expect(assessIntegrity(withRejected, {color: 'red', fingerprint: 'c', version: ref('c', 3, 15).version}).lastConfirmed?.seq).eq(2);
  });

  it('is uncertain with equal counters but other content for the same player', () => {
    const result = assessIntegrity(events, {color: 'red', fingerprint: 'other', version: ref('other', 3, 15).version});
    expect(result.status).eq('uncertain');
  });

  it('does not compare content after another player acted', () => {
    const twoPlayers = [...events, decision(3, 'blue', ref('q', 3, 15), ref('r', 3, 15))];
    expect(assessIntegrity(twoPlayers, {color: 'red', fingerprint: 'other', version: ref('other', 3, 15).version}).status).eq('valid');
  });

  it('is uncertain when counters move both ways', () => {
    expect(assessIntegrity(events, {color: 'red', fingerprint: 'm', version: ref('m', 2, 30).version}).status).eq('uncertain');
  });

  it('marks undone and rolled back events as superseded', () => {
    const undone: Array<CoachTraceEvent> = [
      ...events,
      {...base, type: 'revert', seq: 3, kind: 'undo', player: {color: 'red', name: 'red'}, from: ref('c', 3, 15), to: ref('b', 2, 12, 1)},
      decision(4, 'red', ref('b', 2, 12, 1), ref('c', 3, 15, 1)),
    ];
    const series = annotateSeries(undone);
    expect([...series.entries()]).deep.eq([[1, 'current'], [2, 'superseded'], [3, 'current'], [4, 'current']]);

    const rolledBack: Array<CoachTraceEvent> = [
      ...events,
      {...base, type: 'integrity', seq: 3, status: 'rollback-detected', reason: 'x', player: {color: 'red', name: 'red'},
        lastConfirmed: {seq: 2, ref: ref('c', 3, 15)}, observed: ref('a', 1, 10, 1)},
    ];
    expect([...annotateSeries(rolledBack).values()]).deep.eq(['superseded', 'superseded', 'current']);
  });

  it('marks the last confirmed event unverified when uncertain', () => {
    const uncertain: Array<CoachTraceEvent> = [
      ...events,
      {...base, type: 'integrity', seq: 3, status: 'uncertain', reason: 'x', player: {color: 'red', name: 'red'},
        lastConfirmed: {seq: 2, ref: ref('c', 3, 15)}, observed: ref('other', 3, 15)},
    ];
    expect([...annotateSeries(uncertain).values()]).deep.eq(['current', 'unverified', 'current']);
  });
});
