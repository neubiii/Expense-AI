export function saveSession(key: string, value: any) {
  sessionStorage.setItem(key, JSON.stringify(value));
}
export function loadSession<T>(key: string): T | null {
  const raw = sessionStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : null;
}
