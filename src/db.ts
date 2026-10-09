import Dexie, { type Table } from "dexie";

export interface OutboxItem {
  op_id: string;
  entity: string;
  payload: unknown;
  client_ts: string;
}

class TalentIQClientDb extends Dexie {
  outbox!: Table<OutboxItem, string>;
  cache!: Table<{ key: string; value: unknown; updated_at: string }, string>;
  constructor() {
    super("talentiq-client");
    this.version(1).stores({ outbox: "op_id,entity,client_ts", cache: "key,updated_at" });
  }
}

export const clientDb = new TalentIQClientDb();

export async function enqueue(entity: string, payload: unknown) {
  await clientDb.outbox.put({ op_id: crypto.randomUUID(), entity, payload, client_ts: new Date().toISOString() });
}

export async function flushOutbox() {
  const operations = await clientDb.outbox.toArray();
  if (!operations.length || !navigator.onLine) return 0;
  const response = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operations }) });
  if (!response.ok) return operations.length;
  const result = await response.json();
  await clientDb.outbox.bulkDelete(result.applied);
  return await clientDb.outbox.count();
}
