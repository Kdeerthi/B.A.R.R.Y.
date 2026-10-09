import { enqueue } from "./db";

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed: ${response.status}`);
  return response.json();
}

export async function writeApi<T>(path: string, entity: string, payload: unknown): Promise<T | null> {
  try {
    return await api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch (error) {
    if (!navigator.onLine) {
      await enqueue(entity, { path, payload });
      return null;
    }
    throw error;
  }
}
