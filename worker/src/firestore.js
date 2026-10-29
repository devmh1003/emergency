// Firestore REST API 최소 구현 (서비스 계정 권한으로 동작하므로 보안 규칙을 거치지 않는다).

export function fromValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}

export function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromValue(v);
  return out;
}

export function fromDocument(doc) {
  if (!doc?.name) return null;
  return { id: doc.name.split('/').pop(), updateTime: doc.updateTime, ...fromFields(doc.fields) };
}

/** JS 값 → Firestore 값. 문자열, 숫자, 참/거짓, Date(타임스탬프), 목록, 객체(맵), null. */
export function toValue(v) {
  if (v == null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString().replace('.000Z', 'Z') };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}

export function toFields(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) fields[k] = toValue(v);
  return fields;
}

/** 자동 문서 id (Firestore 와 같은 20자 영숫자) */
export function autoId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export class Firestore {
  constructor(projectId, getToken) {
    this.root = `projects/${projectId}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
    this.getToken = getToken;
  }

  /** 여러 문서를 요청 한 번에 읽는다. 없는 문서는 null. 순서는 paths 와 같다. */
  async batchGet(paths) {
    const res = await this.request(':batchGet', {
      method: 'POST',
      body: JSON.stringify({ documents: paths.map((p) => `${this.root}/${p}`) }),
    });
    if (!res.ok) throw new Error(`Firestore 읽기 실패 (${res.status})`);
    const byName = new Map();
    for (const r of await res.json()) if (r.found) byName.set(r.found.name, fromDocument(r.found));
    return paths.map((p) => byName.get(`${this.root}/${p}`) || null);
  }

  /**
   * 여러 문서를 한 번에(모두 되거나 모두 안 되게) 쓴다.
   * writes: [{ path, data, mask?: 필드 목록(목록에 있는데 data 에 없으면 지운다), updateTime?, exists? }]
   *         또는 문서를 지우려면 { path, delete: true }
   */
  async commit(writes) {
    const res = await this.request(':commit', {
      method: 'POST',
      body: JSON.stringify({
        writes: writes.map((w) => ({
          ...(w.delete ? { delete: `${this.root}/${w.path}` } : { update: { name: `${this.root}/${w.path}`, fields: toFields(w.data) } }),
          ...(w.mask ? { updateMask: { fieldPaths: w.mask } } : {}),
          ...(w.updateTime ? { currentDocument: { updateTime: w.updateTime } }
            : w.exists === false ? { currentDocument: { exists: false } } : {}),
        })),
      }),
    });
    return res.ok;
  }

  async request(path, init = {}) {
    // ":batchGet", ":commit" 은 documents 바로 뒤에 붙는다 (…/documents:commit)
    const res = await fetch(path.startsWith(':') ? `${this.base}${path}` : `${this.base}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    return res;
  }

  async get(path) {
    const res = await this.request(path);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore 읽기 실패 (${res.status})`);
    return fromDocument(await res.json());
  }

  async list(collection, pageSize = 300) {
    const out = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ pageSize: String(pageSize) });
      if (pageToken) q.set('pageToken', pageToken);
      const res = await this.request(`${collection}?${q}`);
      if (!res.ok) throw new Error(`Firestore 목록 읽기 실패 (${res.status})`);
      const data = await res.json();
      for (const d of data.documents || []) out.push(fromDocument(d));
      pageToken = data.nextPageToken || '';
    } while (pageToken && out.length < 2000);
    return out;
  }

  /** 문자열 필드 하나만 갱신. updateTime을 주면 그 사이 문서가 바뀐 경우 실패한다(중복 발송 방지). */
  async setString(path, field, value, updateTime) {
    const q = new URLSearchParams({ 'updateMask.fieldPaths': field });
    if (updateTime) q.set('currentDocument.updateTime', updateTime);
    const res = await this.request(`${path}?${q}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { [field]: { stringValue: value } } }),
    });
    return res.ok;
  }

  /** 자동 id로 문서 하나를 만든다. 값: 문자열, 정수, Date(타임스탬프)만 쓴다. */
  async create(collection, data) {
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof Date) fields[k] = { timestampValue: v.toISOString() };
      else if (Number.isInteger(v)) fields[k] = { integerValue: String(v) };
      else fields[k] = { stringValue: String(v ?? '') };
    }
    const res = await this.request(collection, { method: 'POST', body: JSON.stringify({ fields }) });
    return res.ok;
  }

  async delete(path) {
    const res = await this.request(path, { method: 'DELETE' });
    return res.ok || res.status === 404;
  }
}
