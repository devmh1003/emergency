// 가족 상태 목록, 전체 위치 지도, 가족 상세(관리자)
import { h, toast, busy, card, pageHeader, empty } from '../dom.js';
import { errorMessage } from '../firebase.js';
import {
  getProfile, getChecklist, watchCheckins, updateMember, deleteMember, setMemberPassword, deleteCheckin,
} from '../store.js';
import { mapView } from '../map.js';
import {
  memberStatus, statusRank, formatAgo, formatDateTime, cleanPhone, hasLocation, locationUrl,
  CHECKIN_LABEL, ageFromBirth, checklistProgress,
} from '../logic.js';

// 비활성화된 가족은 관리자에게만 보인다 (다시 활성화할 수 있도록).
function sortedByStatus(state, includeInactive = false) {
  return state.members
    .filter((m) => m.active || includeInactive)
    .map((m) => ({ m, s: m.active ? memberStatus(m, state.emergency) : { key: 'idle', label: '비활성' } }))
    .sort((a, b) => statusRank(a.s.key) - statusRank(b.s.key));
}

export function statusSummary(state) {
  if (!state.emergency?.active) return null;
  const counts = { safe: 0, help: 0, unknown: 0 };
  for (const { s } of sortedByStatus(state)) counts[s.key] = (counts[s.key] || 0) + 1;
  return h('div', { class: 'summary' },
    h('span', { class: 'chip status-safe' }, `무사 ${counts.safe}`),
    h('span', { class: 'chip status-help' }, `도움 필요 ${counts.help}`),
    h('span', { class: 'chip status-unknown' }, `확인 안 됨 ${counts.unknown}`));
}

/** 가족 목록. 이름·상태·마지막 신고·전화·위치 */
export function familyStatusList(state, { compact = false } = {}) {
  const rows = sortedByStatus(state, state.isAdmin && !compact);
  if (!rows.length) return empty('등록된 가족이 없습니다.');
  return h('ul', { class: 'list' }, rows.map(({ m, s }) => {
    const last = m.last;
    const canOpen = state.isAdmin || m.id === state.me.id;
    const phone = cleanPhone(m.phone);
    return h('li', { class: 'list-item member-row' },
      h('div', { class: 'member-main' },
        h('div', null,
          canOpen
            ? h('a', { href: m.id === state.me.id && !state.isAdmin ? '#/records' : `#/member/${encodeURIComponent(m.id)}`, class: 'member-name' }, m.name)
            : h('span', { class: 'member-name' }, m.name),
          m.role === 'admin' ? h('span', { class: 'badge' }, '관리자') : null,
          m.id === state.me.id ? h('span', { class: 'badge badge-me' }, '나') : null),
        h('span', { class: `chip status-${s.key}` }, s.label)),
      h('div', { class: 'muted small' },
        last ? `${CHECKIN_LABEL[last.type] || ''} · ${formatAgo(last.clientAt || last.at)}` : '신고 기록 없음',
        !compact && last?.note ? ` · "${last.note}"` : ''),
      h('div', { class: 'row-actions' },
        phone ? h('a', { class: 'btn btn-sm', href: `tel:${phone}` }, '📞 전화') : null,
        phone ? h('a', { class: 'btn btn-sm', href: `sms:${phone}` }, '✉️ 문자') : null,
        hasLocation(last) ? h('a', { class: 'btn btn-sm', href: locationUrl(last), target: '_blank', rel: 'noopener' }, '🗺️ 마지막 위치') : null));
  }));
}

function latestPoints(state) {
  return state.members.filter((m) => m.active && hasLocation(m.last)).map((m) => {
    const s = memberStatus(m, state.emergency);
    return {
      lat: m.last.lat,
      lng: m.last.lng,
      label: m.name.slice(0, 2),
      color: s.key,
      popup: `${m.name} · ${s.label} · ${formatDateTime(m.last.clientAt || m.last.at)}`,
    };
  });
}

export function familyView({ state, live, onChange, navigate }) {
  const map = mapView({ points: latestPoints(state), height: 280 });
  let lastSig = '';
  onChange(() => {
    // 위치가 실제로 바뀌었을 때만 지도를 다시 맞춘다 (보고 있던 확대 상태 유지).
    const pts = latestPoints(state);
    const sig = JSON.stringify(pts);
    if (sig !== lastSig) {
      lastSig = sig;
      map.setPoints(pts);
    }
  });

  return h('div', { class: 'page' },
    pageHeader('가족',
      state.isAdmin ? h('button', { class: 'btn btn-primary btn-sm', onClick: () => navigate('/admin/member/new') }, '+ 가족 추가') : null),
    card(h('h2', null, '마지막 위치'), map.el,
      h('p', { class: 'muted small' }, '가족이 생존신고나 체크포인트를 남긴 위치입니다. 실시간 추적이 아닙니다.')),
    card(live(() => statusSummary(state)), live(() => familyStatusList(state))),
    state.isAdmin
      ? card(h('h2', null, '관리자 메뉴'), h('div', { class: 'stack' },
        h('a', { class: 'btn', href: '#/admin/meet' }, '📍 집합장소 설정'),
        h('a', { class: 'btn', href: '#/admin/protocols' }, '📘 대처법·체크리스트 관리'),
        h('a', { class: 'btn', href: '#/emergency' }, '🚨 비상선언·해제')))
      : null);
}

// ---------- 가족 상세 ----------

function infoRow(label, value) {
  return h('div', { class: 'info-row' }, h('span', { class: 'muted' }, label), h('span', null, value || '-'));
}

export function memberDetailView({ state, params, live, navigate }) {
  const uid = params.uid;
  if (!state.isAdmin && uid !== state.me.id) {
    setTimeout(() => navigate('/'), 0);
    return h('div');
  }
  const member = () => state.members.find((m) => m.id === uid);
  if (!member()) return h('div', { class: 'page' }, pageHeader('가족'), empty('삭제됐거나 없는 가족입니다.'));

  // 민감 정보 (본인·관리자만 읽을 수 있다)
  const profileBox = h('div', null, h('p', { class: 'muted' }, '불러오는 중…'));
  const progressBox = h('div');
  getProfile(uid).then((p) => {
    const age = ageFromBirth(p.birthDate);
    profileBox.replaceChildren(
      infoRow('성별', p.gender),
      infoRow('나이', age != null ? `${age}세 (${p.birthDate})` : p.birthDate),
      infoRow('혈액형', p.bloodType),
      infoRow('이메일', p.email),
      infoRow('집주소', p.address),
      infoRow('비상연락처', p.emergencyContact),
      infoRow('의료 메모', p.medical));
  }).catch((err) => profileBox.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));
  getChecklist(uid).then((done) => {
    const r = checklistProgress(state.protocols, done);
    progressBox.replaceChildren(
      h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: `${r.percent}%` } })),
      h('p', { class: 'small muted' }, `대비 체크리스트 ${r.checked}/${r.total} (${r.percent}%)`));
  }).catch(() => {});

  // 위치 기록
  const trail = mapView({ height: 260, line: true });
  const historyBox = h('div', null, h('p', { class: 'muted' }, '불러오는 중…'));
  const unsub = watchCheckins(uid, (list) => {
    trail.setPoints([...list].reverse().filter(hasLocation).map((c, i, arr) => ({
      lat: c.lat,
      lng: c.lng,
      label: i === arr.length - 1 ? '최근' : String(i + 1),
      color: c.type === 'help' ? 'help' : i === arr.length - 1 ? 'me' : 'default',
      popup: `${CHECKIN_LABEL[c.type]} · ${formatDateTime(c.clientAt)}${c.note ? ` · ${c.note}` : ''}`,
    })));
    historyBox.replaceChildren(list.length ? h('ul', { class: 'list' }, list.map((c) => h('li', { class: 'list-item' },
      h('div', { class: 'member-main' },
        h('strong', null, CHECKIN_LABEL[c.type] || c.type),
        h('span', { class: 'muted small' }, formatDateTime(c.clientAt))),
      c.note ? h('div', { class: 'small' }, c.note) : null,
      h('div', { class: 'row-actions' },
        hasLocation(c) ? h('a', { class: 'btn btn-sm', href: locationUrl(c), target: '_blank', rel: 'noopener' }, `🗺️ 위치 (±${c.accuracy ?? '?'}m)`) : h('span', { class: 'muted small' }, '위치 없음'),
        state.isAdmin ? h('button', {
          class: 'btn btn-sm btn-ghost',
          onClick: async () => {
            if (!confirm('이 기록을 지울까요?')) return;
            try { await deleteCheckin(c.id); } catch (err) { toast(errorMessage(err), 'error'); }
          },
        }, '삭제') : null))))
      : empty('신고 기록이 없습니다.'));
  }, (err) => historyBox.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))), 200);
  window.addEventListener('hashchange', unsub, { once: true });

  return h('div', { class: 'page' },
    live(() => {
      const m = member();
      if (!m) return pageHeader('삭제된 가족');
      return pageHeader(m.name,
        state.isAdmin ? h('button', { class: 'btn btn-sm', onClick: () => navigate(`/admin/member/${encodeURIComponent(uid)}`) }, '수정') : null);
    }),
    live(() => {
      const m = member();
      if (!m) return null;
      const s = memberStatus(m, state.emergency);
      return card(
        h('div', { class: 'member-main' }, h('span', { class: `chip status-${s.key}` }, s.label),
          h('span', { class: 'muted small' }, m.last ? formatAgo(m.last.clientAt || m.last.at) : '')),
        infoRow('전화번호', m.phone),
        infoRow('권한', m.role === 'admin' ? '관리자' : '가족'),
        infoRow('비상선언권', m.role === 'admin' ? '제한 없음' : `${m.declareCredits}회`));
    }),
    card(h('h2', null, '개인정보'), profileBox, progressBox),
    card(h('h2', null, '이동 경로'), trail.el),
    card(h('h2', null, '신고 기록'), historyBox),
    state.isAdmin ? live(() => (member() ? adminActions(state, member(), navigate) : null)) : null);
}

function adminActions(state, m, navigate) {
  const isSelf = m.id === state.me.id;
  const admins = state.members.filter((x) => x.role === 'admin' && x.active);
  return card(h('h2', null, '관리'), h('div', { class: 'stack' },
    m.role !== 'admin' ? h('button', {
      class: 'btn',
      disabled: m.declareCredits >= 1,
      onClick: (e) => busy(e.currentTarget, async () => {
        try {
          await updateMember(m.id, { declareCredits: 1 });
          toast('비상선언권 1회를 다시 줬습니다.');
        } catch (err) { toast(errorMessage(err), 'error'); }
      }),
    }, m.declareCredits >= 1 ? '비상선언권 있음' : '비상선언권 다시 주기') : null,
    h('button', {
      class: 'btn',
      onClick: (e) => {
        const pw = prompt(`${m.name}님의 새 비밀번호 (8자 이상)`);
        if (!pw) return;
        if (pw.length < 8) { toast('8자 이상이어야 합니다.', 'error'); return; }
        busy(e.currentTarget, async () => {
          try {
            await setMemberPassword(m.id, pw);
            toast('비밀번호를 바꿨습니다. 본인에게 알려 주세요.');
          } catch (err) { toast(errorMessage(err), 'error'); }
        });
      },
    }, '🔑 비밀번호 초기화'),
    !isSelf ? h('button', {
      class: 'btn',
      onClick: (e) => busy(e.currentTarget, async () => {
        if (m.role === 'admin' && m.active && admins.length <= 1) { toast('마지막 관리자는 비활성화할 수 없습니다.', 'error'); return; }
        try {
          await updateMember(m.id, { active: !m.active });
          toast(m.active ? '비활성화했습니다. 이제 아무 정보도 볼 수 없습니다.' : '다시 활성화했습니다.');
        } catch (err) { toast(errorMessage(err), 'error'); }
      }),
    }, m.active ? '⏸ 접근 차단 (비활성화)' : '▶ 다시 활성화') : null,
    !isSelf ? h('button', {
      class: 'btn btn-danger',
      onClick: (e) => {
        if (m.role === 'admin' && admins.length <= 1) { toast('마지막 관리자는 삭제할 수 없습니다.', 'error'); return; }
        if (!confirm(`${m.name}님을 삭제할까요? 개인정보와 로그인 계정이 지워집니다. (신고 기록은 남습니다)`)) return;
        busy(e.currentTarget, async () => {
          try {
            const r = await deleteMember(m.id);
            toast(r.accountDeleted ? '삭제했습니다.' : `삭제했습니다. 로그인 계정은 Firebase 콘솔에서 지워 주세요 (${r.error}).`, r.accountDeleted ? 'info' : 'warn');
            navigate('/family');
          } catch (err) { toast(errorMessage(err), 'error'); }
        });
      },
    }, '🗑 가족 삭제') : h('p', { class: 'muted small' }, '본인 계정은 삭제·비활성화할 수 없습니다.')));
}
