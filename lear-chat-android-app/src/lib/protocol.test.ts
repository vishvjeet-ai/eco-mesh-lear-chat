import { describe, expect, it } from '@jest/globals';
import { base64ToBytes, bytesToBase64, decodeRx, decodeStatus, encodeTx, utf8ByteLength, utf8Bytes } from './protocol';
import { MessageMachine } from './messageMachine';

describe('LEARMesh packets', () => {
  it('encodes destination as big endian and text as UTF-8', () => {
    expect(Array.from(encodeTx(0x12ab, 'Hi'))).toEqual([0x12, 0xab, 72, 105]);
  });
  it('decodes incoming message and delivery packets', () => {
    expect(decodeRx(new Uint8Array([1, 0x12, 0xab, 72, 105]))).toEqual({ type: 'message', src: 0x12ab, text: 'Hi' });
    expect(decodeRx(new Uint8Array([2, 0, 9, 2]))).toEqual({ type: 'delivery', msgId: 9, state: 'DELIVERED' });
  });
  it('decodes STATUS', () => expect(decodeStatus(new Uint8Array([0, 1, 87, 3, 2]))).toEqual({ nodeId: 1, battery: 87, queueLength: 3, linkState: 2 }));
});

describe('base64 helpers', () => {
  it.each(['', 'LEAR', '✓ hello', 'a'.repeat(101)])('round trips %j', value => {
    const bytes = utf8Bytes(value);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe('message state machine', () => {
  it('matches queued IDs FIFO then applies delivered and failed updates', () => {
    const machine = new MessageMachine(); machine.begin(1); machine.begin(2);
    machine.writeSucceeded(1); machine.writeSucceeded(2);
    expect(machine.delivery(44, 'QUEUED')).toBe(1); expect(machine.delivery(45, 'QUEUED')).toBe(2);
    machine.delivery(44, 'DELIVERED'); machine.delivery(45, 'FAILED');
    expect(machine.get(1)?.state).toBe('DELIVERED'); expect(machine.get(2)?.state).toBe('FAILED');
  });
  it('does not overwrite an early QUEUED notification when the write resolves', () => {
    const machine = new MessageMachine(); machine.begin(7);
    machine.delivery(99, 'QUEUED'); machine.writeSucceeded(7);
    expect(machine.get(7)).toEqual({ localId: 7, state: 'QUEUED', msgId: 99 });
  });
  it('marks write failures and clears pending IDs on disconnect', () => {
    const machine = new MessageMachine(); machine.begin(3); machine.begin(4); machine.writeFailed(3); machine.clearPendingIds();
    expect(machine.get(3)?.state).toBe('FAILED'); expect(machine.delivery(4, 'QUEUED')).toBeNull();
  });
});

describe('UTF-8 byte limit', () => {
  it('counts multibyte characters and enforces exactly 144 bytes', () => {
    expect(utf8ByteLength('a')).toBe(1); expect(utf8ByteLength('✓')).toBe(3);
    expect(utf8ByteLength('✓'.repeat(48))).toBe(144); expect(() => encodeTx(1, '✓'.repeat(49))).toThrow(/144-byte/);
  });
});
