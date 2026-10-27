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

export class Firestore {
  constructor(projectId, getToken) {
    this.base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    this.getToken = getToken;
  }

  async request(path, init = {}) {
    const res = await fetch(`${this.base}/${path}`, {
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

  async delete(path) {
    const res = await this.request(path, { method: 'DELETE' });
    return res.ok || res.status === 404;
  }
}
