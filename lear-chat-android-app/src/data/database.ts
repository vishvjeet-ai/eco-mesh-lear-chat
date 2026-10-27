import * as SQLite from 'expo-sqlite';

export type Contact = { id: number; name: string };
export type ChatMessage = { rowid: number; peer: number; dir: 'in' | 'out'; text: string; state: 'SENDING' | 'QUEUED' | 'DELIVERED' | 'FAILED'; msg_id: number | null; ts: number; unread?: number };
let database: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  database = await SQLite.openDatabaseAsync('lear-chat.db');
  await database.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(rowid INTEGER PRIMARY KEY AUTOINCREMENT, peer INTEGER NOT NULL, dir TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, msg_id INTEGER NULL, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_reads(peer INTEGER PRIMARY KEY, last_read_rowid INTEGER NOT NULL DEFAULT 0);`);
  return database;
}

export async function getContacts(): Promise<Contact[]> { return (await getDatabase()).getAllAsync<Contact>('SELECT id, name FROM contacts ORDER BY name COLLATE NOCASE'); }
export async function getMessages(): Promise<ChatMessage[]> { return (await getDatabase()).getAllAsync<ChatMessage>(`SELECT m.rowid, m.peer, m.dir, m.text, m.state, m.msg_id, m.ts,
  CASE WHEN m.dir='in' AND m.rowid > COALESCE(r.last_read_rowid, 0) THEN 1 ELSE 0 END AS unread
  FROM messages m LEFT JOIN chat_reads r ON r.peer=m.peer ORDER BY m.ts, m.rowid`); }
export async function saveContact(contact: Contact): Promise<void> { await (await getDatabase()).runAsync('INSERT INTO contacts(id, name) VALUES (?, ?)', contact.id, contact.name); }
export async function addMessage(message: Omit<ChatMessage, 'rowid'>): Promise<number> {
  const result = await (await getDatabase()).runAsync('INSERT INTO messages(peer, dir, text, state, msg_id, ts) VALUES (?, ?, ?, ?, ?, ?)', message.peer, message.dir, message.text, message.state, message.msg_id, message.ts);
  return Number(result.lastInsertRowId);
}
export async function updateMessage(rowid: number, state: ChatMessage['state'], msgId?: number | null): Promise<void> {
  if (msgId === undefined) await (await getDatabase()).runAsync('UPDATE messages SET state=? WHERE rowid=?', state, rowid);
  else await (await getDatabase()).runAsync('UPDATE messages SET state=?, msg_id=? WHERE rowid=?', state, msgId, rowid);
}
export async function clearChats(): Promise<void> { await (await getDatabase()).runAsync('DELETE FROM messages'); }
export async function markChatRead(peer: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`INSERT INTO chat_reads(peer, last_read_rowid) SELECT ?, COALESCE(MAX(rowid), 0) FROM messages WHERE peer=?
    ON CONFLICT(peer) DO UPDATE SET last_read_rowid=excluded.last_read_rowid`, peer, peer);
}
