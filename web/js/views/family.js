// 가족 현황, 마지막 위치 지도, 가족 상세
// 관리자는 가족 전체를, 일반 가족은 본인과 관리자가 지정한 최대 3명만 본다 (서버 규칙이 강제한다).
import { h, toast, busy, panel, pageHeader, empty, alertBox, table, ask } from '../dom.js';
import { errorMessage } from '../firebase.js';
import {
  getProfile, getChecklist, watchCheckins, updateMember, deleteMember, deleteCheckin,
} from '../store.js';
import { mapView } from '../map.js';
import {
  memberStatus, statusRank, formatAgo, formatDateTime, cleanPhone, hasLocation, locationUrl,
  CHECKIN_LABEL, checkinLabel, ageFromBirth, checklistProgress,
} from '../logic.js';
import { t } from '../i18n.js';

// 비활성화된 가족은 관리자에게만 보인다 (다시 활성화할 수 있도록).
function sortedByStatus(state, includeInactive = false) {
  return state.members
    .filter((m) => m.active || includeInactive)
    .map((m) => ({ m, s: m.active ? memberStatus(m, state.emergency) : { key: 'idle', label: t('비활성') } }))
    .sort((a, b) => statusRank(a.s.key) - statusRank(b.s.key));
}

export function statusSummary(state) {
  if (!state.emergency?.active) return null;
  const counts = { safe: 0, help: 0, unknown: 0 };
  for (const { s } of sortedByStatus(state)) counts[s.key] = (counts[s.key] || 0) + 1;
  return h('div', { class: 'row', style: { marginBottom: '0.75rem' } },
    h('span', { class: 'tag tag-big status-safe' }, t('무사 {n}', { n: counts.safe })),
    h('span', { class: 'tag tag-big status-help' }, t('도움 필요 {n}', { n: counts.help })),
    h('span', { class: 'tag tag-big status-unknown' }, t('확인 안 됨 {n}', { n: counts.unknown })));
}

function canOpen(state, m) {
  return state.isAdmin || m.id === state.me.id || state.members.some((x) => x.id === m.id);
}

function contactButtons(m) {
  const phone = cleanPhone(m.phone);
  const last = m.last;
  return h('div', { class: 'row-actions' },
    phone ? h('a', { class: 'btn btn-sm', href: `tel:${phone}` }, t('📞 전화')) : null,
    phone ? h('a', { class: 'btn btn-sm btn-outline', href: `sms:${phone}` }, t('✉️ 문자')) : null,
    hasLocation(last) ? h('a', { class: 'btn btn-sm btn-outline', href: locationUrl(last), target: '_blank', rel: 'noopener' }, t('🗺 마지막 위치')) : null);
}

function nameCell(state, m) {
  const href = m.id === state.me.id && !state.isAdmin ? '#/records' : `#/member/${encodeURIComponent(m.id)}`;
  return h('span', null,
    canOpen(state, m) ? h('a', { href, class: 'item-title' }, m.name) : h('span', { class: 'item-title' }, m.name),
    m.role === 'admin' ? h('span', { class: 'tag tag-light', style: { marginLeft: '0.375rem' } }, t('관리자')) : null,
    m.id === state.me.id ? h('span', { class: 'tag tag-me', style: { marginLeft: '0.375rem' } }, t('나')) : null);
}

/** 가족 목록. compact: 홈 화면용 짧은 목록 */
export function familyStatusList(state, { compact = false } = {}) {
  const rows = sortedByStatus(state, state.isAdmin && !compact);
  if (!rows.length) return empty(t('보이는 가족이 없습니다.'));
  if (compact) {
    return h('ul', { class: 'list' }, rows.map(({ m, s }) => h('li', { class: 'list-item' },
      h('div', { class: 'item-main' }, nameCell(state, m), h('span', { class: `tag status-${s.key}` }, s.label)),
      h('div', { class: 'small muted' }, m.last ? `${checkinLabel(m.last.type)} · ${formatAgo(m.last.clientAt || m.last.at)}` : t('신고 기록 없음')))));
  }
  return table([t('이름'), t('상태'), t('마지막 신고'), t('메모'), t('연락')], rows.map(({ m, s }) => [
    nameCell(state, m),
    h('span', { class: `tag status-${s.key}` }, s.label),
    m.last ? h('span', null, `${checkinLabel(m.last.type)} · ${formatAgo(m.last.clientAt || m.last.at)}`) : h('span', { class: 'muted' }, t('기록 없음')),
    m.last?.note || '-',
    contactButtons(m),
  ]));
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
  const map = mapView({ points: latestPoints(state), height: 300 });
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
    pageHeader(t('가족 현황'),
      { lead: state.isAdmin ? t('가족 전체의 생존신고 상태와 마지막 위치입니다.') : t('나와, 관리자가 지정한 가족(최대 3명)의 상태입니다.') },
      state.isAdmin ? h('button', { class: 'btn', onClick: () => navigate('/admin/member/new') }, t('+ 가족 추가')) : null),
    state.isAdmin ? null : alertBox('info', null, h('p', null, t('개인정보 보호를 위해 관리자가 지정한 가족만 보입니다. 다른 가족의 정보가 필요하면 관리자에게 요청하세요.'))),
    panel(t('상태'), null, live(() => statusSummary(state)), live(() => familyStatusList(state))),
    panel(t('마지막 위치'), null, map.el,
      h('p', { class: 'muted small' }, t('가족이 생존신고나 체크포인트를 남긴 위치입니다. 실시간 추적이 아닙니다.'))),
    state.isAdmin
      ? panel(t('관리자 메뉴'), null, h('div', { class: 'tiles' },
        [['#/admin', '🛠', t('관리자 설정'), t('비상 선언·해제, 소리 테스트, 가족 등록')],
          ['#/admin/directory', '🗃', t('가족 정보 한눈에'), t('개인정보·연결 상태 표')],
          ['#/admin/logs', '📋', t('관리자 기록'), t('알림·신고·관리 작업')],
          ['#/admin/meet', '📍', t('집합장소 설정'), t('1~10순위')],
          ['#/admin/protocols', '📘', t('대처법 관리'), t('내용·체크리스트 편집')],
          ['#/contacts', '☎️', t('연락처 관리'), t('가족 지정 연락처')],
          ['#/emergency', '🚨', t('비상 경보'), t('1급·2급 발령, 해제, 테스트')]].map(([href, icon, title, desc]) => h('a', { class: 'tile tile-admin', href },
          h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon), h('strong', null, title), h('span', null, desc)))))
      : null);
}

// ---------- 가족 상세 ----------

function infoRow(label, value) {
  return h('div', { class: 'info-row' }, h('span', null, label), h('span', null, value || '-'));
}

export function memberDetailView({ state, params, live, navigate }) {
  const uid = params.uid;
  const member = () => state.members.find((m) => m.id === uid);
  if (!member() || !canOpen(state, member())) {
    return h('div', { class: 'page' }, pageHeader(t('가족'), { crumbs: [{ label: t('가족 현황'), href: '#/family' }] }), empty(t('볼 수 없는 가족입니다.')));
  }
  const fullAccess = state.isAdmin || uid === state.me.id;

  // 민감 정보 (본인·관리자·지정된 가족만 읽을 수 있다)
  const profileBox = h('div', null, h('p', { class: 'muted' }, t('불러오는 중…')));
  const progressBox = h('div');
  getProfile(uid).then((p) => {
    const age = ageFromBirth(p.birthDate);
    // replaceChildren 은 null 을 "null" 글자로 넣으므로 빈 칸은 뺀다.
    profileBox.replaceChildren(...[
      fullAccess && p.loginId ? infoRow(t('로그인 아이디'), p.loginId) : null,
      infoRow(t('성별'), p.gender ? t(p.gender) : p.gender),
      infoRow(t('나이'), age != null ? t('{age}세 ({birth})', { age, birth: p.birthDate }) : p.birthDate),
      infoRow(t('혈액형'), p.bloodType ? t(p.bloodType) : p.bloodType),
      infoRow(t('의료 메모'), p.medical),
      infoRow(t('비상연락처'), p.emergencyContact),
      infoRow(t('집주소'), p.address),
      infoRow(t('이메일'), p.email)].filter(Boolean));
  }).catch((err) => profileBox.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));

  let historySection = null;
  if (fullAccess) {
    getChecklist(uid).then((done) => {
      const r = checklistProgress(state.protocols, done);
      progressBox.replaceChildren(
        h('h3', null, t('대비 체크리스트')),
        h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: `${r.percent}%` } })),
        h('p', { class: 'small muted' }, `${r.checked}/${r.total} (${r.percent}%)`));
    }).catch(() => {});

    // 위치 기록 (본인·관리자만)
    const trail = mapView({ height: 280, line: true });
    const historyBox = h('div', null, h('p', { class: 'muted' }, t('불러오는 중…')));
    const unsub = watchCheckins(uid, (list) => {
      trail.setPoints([...list].reverse().filter(hasLocation).map((c, i, arr) => ({
        lat: c.lat,
        lng: c.lng,
        label: i === arr.length - 1 ? t('최근') : String(i + 1),
        color: c.type === 'help' ? 'help' : i === arr.length - 1 ? 'me' : 'default',
        popup: `${checkinLabel(c.type)} · ${formatDateTime(c.clientAt)}${c.note ? ` · ${c.note}` : ''}`,
      })));
      historyBox.replaceChildren(list.length ? table([t('시각'), t('종류'), t('메모'), t('위치'), ''], list.map((c) => [
        h('span', { class: 'num' }, formatDateTime(c.clientAt)),
        h('span', { class: `tag kind-${c.type}` }, checkinLabel(c.type)),
        c.note || '-',
        hasLocation(c) ? h('a', { href: locationUrl(c), target: '_blank', rel: 'noopener' }, t('지도 (±{acc}m)', { acc: c.accuracy ?? '?' })) : h('span', { class: 'muted' }, t('위치 없음')),
        state.isAdmin ? h('button', {
          class: 'btn btn-sm btn-outline-secondary',
          onClick: async () => {
            if (!(await ask(t('이 기록을 지울까요? (관리 기록에 남습니다)')))) return;
            try { await deleteCheckin(c); } catch (err) { toast(errorMessage(err), 'error'); }
          },
        }, t('삭제')) : '',
      ])) : empty(t('신고 기록이 없습니다.')));
    }, (err) => historyBox.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))), 200);
    window.addEventListener('hashchange', unsub, { once: true });
    historySection = [panel(t('이동 경로'), null, trail.el), panel(t('신고 기록'), null, historyBox)];
  }

  return h('div', { class: 'page' },
    live(() => {
      const m = member();
      if (!m) return pageHeader(t('삭제된 가족'), { crumbs: [{ label: t('가족 현황'), href: '#/family' }] });
      return pageHeader(m.name, { crumbs: [{ label: t('가족 현황'), href: '#/family' }] },
        state.isAdmin ? h('button', { class: 'btn btn-outline', onClick: () => navigate(`/admin/member/${encodeURIComponent(uid)}`) }, t('정보 수정')) : null);
    }),
    h('div', { class: 'grid grid-2' },
      live(() => {
        const m = member();
        if (!m) return null;
        const s = memberStatus(m, state.emergency);
        return panel(t('현재 상태'), null,
          h('div', { class: 'item-main', style: { marginBottom: '0.5rem' } },
            h('span', { class: `tag tag-big status-${s.key}` }, s.label),
            h('span', { class: 'muted small' }, m.last ? formatAgo(m.last.clientAt || m.last.at) : '')),
          infoRow(t('전화번호'), m.phone),
          infoRow(t('권한'), m.role === 'admin' ? t('관리자') : t('가족')),
          state.isAdmin ? infoRow(t('비상선언권'), m.role === 'admin' ? t('제한 없음') : t('{n}회', { n: m.declareCredits })) : null,
          state.isAdmin ? infoRow(t('볼 수 있는 가족'), (m.links || []).map((id) => state.members.find((x) => x.id === id)?.name || t('(삭제됨)')).join(', ') || t('지정 안 됨')) : null,
          contactButtons(m));
      }),
      panel(t('개인정보'), null, profileBox, progressBox)),
    historySection,
    state.isAdmin ? live(() => (member() ? adminActions(state, member(), navigate) : null)) : null);
}

function adminActions(state, m, navigate) {
  const isSelf = m.id === state.me.id;
  const admins = state.members.filter((x) => x.role === 'admin' && x.active);
  return panel(t('관리'), null, h('div', { class: 'row' },
    m.role !== 'admin' ? h('button', {
      class: 'btn btn-outline',
      disabled: m.declareCredits >= 1,
      onClick: (e) => busy(e.currentTarget, async () => {
        try {
          await updateMember(m.id, { declareCredits: 1 }, m.name);
          toast(t('비상선언권 1회를 다시 줬습니다.'));
        } catch (err) { toast(errorMessage(err), 'error'); }
      }),
    }, m.declareCredits >= 1 ? t('비상선언권 있음') : t('비상선언권 다시 주기')) : null,
    !isSelf ? h('button', {
      class: 'btn btn-outline',
      onClick: (e) => busy(e.currentTarget, async () => {
        if (m.role === 'admin' && m.active && admins.length <= 1) { toast(t('마지막 관리자는 비활성화할 수 없습니다.'), 'error'); return; }
        try {
          await updateMember(m.id, { active: !m.active }, m.name);
          toast(m.active ? t('접근을 차단했습니다. 이제 아무 정보도 볼 수 없습니다.') : t('다시 활성화했습니다.'));
        } catch (err) { toast(errorMessage(err), 'error'); }
      }),
    }, m.active ? t('⏸ 접근 차단') : t('▶ 다시 활성화')) : null,
    !isSelf ? h('button', {
      class: 'btn btn-secondary',
      onClick: async (e) => {
        const target = e.currentTarget;
        if (m.role === 'admin' && admins.length <= 1) { toast(t('마지막 관리자는 삭제할 수 없습니다.'), 'error'); return; }
        if (!(await ask(t('{name}님을 삭제할까요? 개인정보와 로그인 계정이 지워집니다. (신고 기록은 남습니다)', { name: m.name })))) return;
        busy(target, async () => {
          try {
            const r = await deleteMember(m.id, m.name, m.role);
            toast(r.accountDeleted ? t('삭제했습니다.') : t('삭제했습니다. 로그인 계정은 Firebase 콘솔에서 지워 주세요 ({error}).', { error: r.error }), r.accountDeleted ? 'info' : 'warn');
            navigate('/family');
          } catch (err) { toast(errorMessage(err), 'error'); }
        });
      },
    }, t('🗑 가족 삭제')) : null),
    isSelf ? h('p', { class: 'muted small', style: { marginTop: '0.75rem' } }, t('본인 계정은 삭제·차단할 수 없습니다.')) : null);
}
