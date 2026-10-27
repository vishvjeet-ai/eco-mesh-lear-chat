export type MessageState = 'SENDING' | 'QUEUED' | 'DELIVERED' | 'FAILED';
export type OutgoingRecord = { localId: number; state: MessageState; msgId: number | null };

/** Pure message status coordinator. QUEUED IDs are matched in write order. */
export class MessageMachine {
  private records = new Map<number, OutgoingRecord>();
  private waitingForId: number[] = [];

  begin(localId: number): void {
    this.records.set(localId, { localId, state: 'SENDING', msgId: null });
    this.waitingForId.push(localId);
  }
  writeSucceeded(localId: number): void {
    const record = this.records.get(localId);
    if (record?.state === 'SENDING') record.state = 'QUEUED';
  }
  writeFailed(localId: number): void {
    const record = this.records.get(localId);
    if (record) record.state = 'FAILED';
    this.waitingForId = this.waitingForId.filter(id => id !== localId);
  }
  delivery(msgId: number, state: 'QUEUED' | 'DELIVERED' | 'FAILED'): number | null {
    if (state === 'QUEUED') {
      const localId = this.waitingForId.shift();
      if (localId === undefined) return null;
      const record = this.records.get(localId);
      if (!record) return null;
      record.msgId = msgId;
      if (record.state !== 'FAILED') record.state = 'QUEUED';
      return localId;
    }
    const record = [...this.records.values()].find(item => item.msgId === msgId);
    if (!record) return null;
    record.state = state;
    return record.localId;
  }
  get(localId: number): OutgoingRecord | undefined { const value = this.records.get(localId); return value && { ...value }; }
  clearPendingIds(): void { this.waitingForId = []; }
}
