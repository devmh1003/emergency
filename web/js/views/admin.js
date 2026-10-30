// 관리자 화면: 가족 추가·수정, 집합장소 설정, 대처법 편집
import { h, field, select, formData, toast, savedToast, busy, card, panel, pageHeader, empty, alertBox, ask } from '../dom.js';
import { errorMessage } from '../firebase.js';
import {
  createMember, updateMember, getProfile, saveMeetingPoint, deleteMeetingPoint,
  saveProtocol, deleteProtocol, seedProtocols,
} from '../store.js';
import { getBestPosition } from '../geo.js';
import { mapView } from '../map.js';
import {
  BLOOD_TYPES, GENDERS, formatOffset, scheduleWarnings, toLocalInput, toDate, parseSteps, stepsToText,
  parseChecklist, hasLocation,
} from '../logic.js';
import { t } from '../i18n.js';

const MAX_MEMBERS = 20;
const MAX_LINKS = 3;

// ---------- 가족 추가·수정 ----------

export function memberEditView({ state, params, navigate }) {
  const isNew = params.uid === 'new';
  const m = isNew ? null : state.members.find((x) => x.id === params.uid);
  const crumbs = [{ label: t('가족 현황'), href: '#/family' }];
  if (!isNew && !m) return h('div', { class: 'page' }, pageHeader(t('가족 수정'), { crumbs }), empty(t('없는 가족입니다.')));
  if (isNew && state.members.length >= MAX_MEMBERS) {
    return h('div', { class: 'page' }, pageHeader(t('가족 추가'), { crumbs }), empty(t('가족은 최대 {max}명까지 등록할 수 있습니다.', { max: MAX_MEMBERS })));
  }
  const isSelf = m?.id === state.me.id;

  const profileFields = h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('불러오는 중…')));
  const fillProfile = (p = {}) => {
    profileFields.replaceChildren(
      h('div', { class: 'field-row' },
        field(t('성별'), select('gender', ['', ...GENDERS].map((g) => ({ value: g, label: g ? t(g) : t('선택 안 함') })), p.gender || '')),
        field(t('생년월일'), h('input', { name: 'birthDate', type: 'date', value: p.birthDate || '' }), t('나이는 자동으로 계산됩니다'))),
      h('div', { class: 'field-row' },
        field(t('혈액형'), select('bloodType', ['', ...BLOOD_TYPES].map((b) => ({ value: b, label: b ? t(b) : t('선택 안 함') })), p.bloodType || '')),
        field(t('이메일 (연락용)'), h('input', { name: 'email', type: 'email', maxlength: 120, value: p.email || '' }))),
      field(t('집주소'), h('input', { name: 'address', maxlength: 200, value: p.address || '', autocomplete: 'off' })),
      field(t('비상연락처 (가족 외)'), h('input', { name: 'emergencyContact', maxlength: 100, value: p.emergencyContact || '', placeholder: t('예: 이모 010-0000-0000') })),
      field(t('의료 메모'), h('textarea', { name: 'medical', rows: 3, maxlength: 500, value: p.medical || '', placeholder: t('지병, 복용약, 알레르기') })));
  };
  if (isNew) fillProfile();
  else getProfile(m.id).then(fillProfile).catch((err) => profileFields.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));

  // 볼 수 있는 가족 (최대 3명)
  const others = state.members.filter((x) => x.id !== m?.id);
  const current = new Set(m?.links || []);
  const linkBoxes = others.map((x) => h('input', { type: 'checkbox', value: x.id, checked: current.has(x.id) }));
  const linkHint = h('p', { class: 'small muted' });
  const updateLinkHint = () => {
    const n = linkBoxes.filter((b) => b.checked).length;
    linkHint.textContent = t('{n}/{max}명 선택', { n, max: MAX_LINKS });
    for (const b of linkBoxes) b.disabled = !b.checked && n >= MAX_LINKS;
  };
  linkBoxes.forEach((b) => b.addEventListener('change', updateLinkHint));
  updateLinkHint();

  const form = h('form', { class: 'stack', style: { gap: '1.25rem' } },
    panel(t('기본 정보'), null,
      h('div', { class: 'stack' },
        h('div', { class: 'field-row' },
          field(t('이름'), h('input', { name: 'name', required: true, maxlength: 40, value: m?.name || '' })),
          field(t('전화번호'), h('input', { name: 'phone', type: 'tel', maxlength: 30, value: m?.phone || '', inputmode: 'tel' }))),
        h('div', { class: 'field-row' },
          field(t('권한'), select('role', [{ value: 'member', label: t('가족') }, { value: 'admin', label: t('관리자') }], m?.role || 'member'),
            isSelf ? t('본인의 관리자 권한은 다른 관리자가 바꿔야 합니다') : t('관리자는 여러 명 둘 수 있고, 가족 전체를 봅니다')),
          field(t('표시 순서'), h('input', { name: 'order', type: 'number', min: 0, max: 99, value: String(m?.order ?? state.members.length + 1) }))))),
    panel(t('로그인'), null,
      h('p', { class: 'small muted' }, t('가족은 가족 코드, 관리자는 관리자 코드를 넣은 뒤 목록에서 이 이름을 고릅니다. 같은 이름이 둘이면 헷갈리니 구분되게 적으세요.'))),
    panel(t('볼 수 있는 가족 (최대 {max}명)', { max: MAX_LINKS }), null,
      h('p', { class: 'small muted' }, t('이 사람이 상태·위치·전화번호·비상 정보를 볼 수 있는 가족입니다. 관리자 권한이면 지정과 상관없이 모두 봅니다.')),
      others.length
        ? h('div', { class: 'grid grid-3', style: { gap: '0.25rem 1rem' } }, others.map((x, i) => h('label', { class: 'check' }, linkBoxes[i], h('span', null, x.name, x.role === 'admin' ? ` (${t('관리자')})` : ''))))
        : empty(t('다른 가족이 없습니다.')),
      linkHint),
    panel(t('개인정보'), null,
      h('p', { class: 'small muted' }, t('본인, 관리자, 이 사람을 "볼 수 있는 가족"으로 지정받은 사람만 봅니다.')),
      profileFields),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-outline', type: 'button', onClick: () => history.back() }, t('취소')),
      h('button', { class: 'btn', type: 'submit' }, isNew ? t('가족 추가') : t('저장'))));

  if (isSelf) form.elements.role.disabled = true;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    const data = {
      name: d.name,
      phone: d.phone,
      role: isSelf ? m.role : d.role,
      order: Number(d.order) || 0,
      links: linkBoxes.filter((b) => b.checked).map((b) => b.value).slice(0, MAX_LINKS),
      gender: d.gender,
      birthDate: d.birthDate,
      bloodType: d.bloodType,
      email: d.email,
      address: d.address,
      emergencyContact: d.emergencyContact,
      medical: d.medical,
    };
    const taken = state.members.some((x) => x.id !== m?.id && x.name === data.name);
    if (taken) { toast(t('같은 이름의 가족이 이미 있습니다. 로그인 목록에서 구분되도록 다르게 적어 주세요.'), 'error'); return; }
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        if (isNew) {
          const uid = await createMember({ ...data, active: true, declareCredits: 1 }, state.gates.gen);
          toast(t('{name}님을 추가했습니다. {code}를 알려 주면 목록에서 이름을 골라 들어올 수 있습니다.', { name: data.name, code: data.role === 'admin' ? t('관리자 코드') : t('가족 코드') }));
          navigate(`/member/${encodeURIComponent(uid)}`);
        } else {
          savedToast(await updateMember(m.id, data, data.name, m), t('저장했습니다.'));
          navigate(`/member/${encodeURIComponent(m.id)}`);
        }
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'page' },
    pageHeader(isNew ? t('가족 추가') : t('{name} 정보 수정', { name: m.name }), { crumbs }),
    isNew ? alertBox('info', null, h('p', null, t('저장하면 바로 로그인 목록에 이름이 올라갑니다. 따로 정할 아이디나 비밀번호는 없습니다.'))) : null,
    form);
}

// ---------- 집합장소 ----------

export function meetEditListView({ state, live }) {
  return h('div', { class: 'page' },
    pageHeader(t('집합장소 설정'), { crumbs: [{ label: t('집합장소'), href: '#/meet' }] }),
    card(h('p', null, t('1순위부터 차례로 정하세요. 시간은 "1급 비상 발생 후 몇 시간"으로 정하고, 1급 비상이 선언되면 실제 시각으로 계산됩니다 (2급 단계에서는 시작하지 않음).')),
      h('p', { class: 'muted small' }, t('각 장소에서 "대기 시간"이 지나도 모두 모이지 못하면 다음 순위로 이동합니다.'))),
    live(() => {
      const warnings = scheduleWarnings(state.meetingPoints);
      return warnings.length ? card(h('ul', { class: 'warnings' }, warnings.map((w) => h('li', null, `⚠️ ${w}`)))) : null;
    }),
    live(() => h('ol', { class: 'list' }, Array.from({ length: 10 }, (_, i) => i + 1).map((rank) => {
      const p = state.meetingPoints.find((x) => x.rank === rank);
      return h('li', null, h('a', { class: 'list-item list-link', href: `#/admin/meet/${rank}` },
        h('strong', null, `${t('{rank}순위', { rank })} `, p ? p.name : h('span', { class: 'muted' }, t('비어 있음'))),
        p ? h('div', { class: 'muted small' },
          `${formatOffset(p.offsetHours)} · ${t('{min}분 대기', { min: p.waitMinutes })}`,
          p.overrideAt ? ` · ${t('시각 직접 지정됨')}` : '',
          hasLocation(p) ? '' : ` · ${t('위치 미지정')}`) : null));
    }))));
}

export function meetEditView({ state, params, navigate }) {
  const rank = Number(params.rank);
  if (!(rank >= 1 && rank <= 10)) return h('div', { class: 'page' }, empty(t('잘못된 순위입니다.')));
  const p = state.meetingPoints.find((x) => x.rank === rank) || {};
  let picked = hasLocation(p) ? { lat: p.lat, lng: p.lng } : null;

  const coords = h('p', { class: 'small muted' });
  const showCoords = () => {
    coords.textContent = picked ? t('위도 {lat}, 경도 {lng}', { lat: picked.lat, lng: picked.lng }) : t('위치가 없습니다. 지도를 누르거나 현재 위치를 쓰세요.');
  };
  const map = mapView({
    points: picked ? [{ ...picked, label: String(rank), color: 'meet' }] : [],
    height: 260,
    onPick: (pos) => { picked = pos; map.setPicked(pos); showCoords(); },
  });
  showCoords();

  const form = h('form', { class: 'stack' },
    field(t('장소 이름'), h('input', { name: 'name', required: true, maxlength: 60, value: p.name || '', placeholder: t('예: 우리 집, ○○초등학교 정문') })),
    field(t('주소'), h('input', { name: 'address', maxlength: 200, value: p.address || '' })),
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, t('위치 (지도를 눌러 선택)')),
      map.el, coords,
      h('div', { class: 'row' },
        h('button', {
          class: 'btn btn-sm', type: 'button',
          onClick: (e) => busy(e.currentTarget, async () => {
            try {
              const pos = await getBestPosition();
              picked = { lat: pos.lat, lng: pos.lng };
              map.setPicked(picked);
              showCoords();
            } catch (err) { toast(err.message, 'error'); }
          }),
        }, t('📍 현재 위치로')),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => { picked = null; map.setPicked(null); showCoords(); } }, t('위치 지우기')))),
    h('div', { class: 'row' },
      field(t('1급 비상 발생 후 (시간)'), h('input', { name: 'offsetHours', type: 'number', min: 0, max: 1440, step: 0.5, required: true, value: String(p.offsetHours ?? (rank - 1) * 6) })),
      field(t('대기 시간 (분)'), h('input', { name: 'waitMinutes', type: 'number', min: 0, max: 1440, step: 10, required: true, value: String(p.waitMinutes ?? 60) }))),
    field(t('도착 시각 직접 지정 (선택)'), h('input', { name: 'overrideAt', type: 'datetime-local', value: toLocalInput(p.overrideAt) }),
      t('1급 비상 중에 시간을 바꿔야 할 때 씁니다. 비워 두면 "1급 비상 발생 후 시간"으로 계산합니다.')),
    field(t('안내 메모'), h('textarea', { name: 'note', rows: 3, maxlength: 500, value: p.note || '', placeholder: t('예: 정문 앞 시계탑 아래. 못 들어가면 길 건너 편의점.') })),
    h('div', { class: 'row' },
      p.name ? h('button', {
        class: 'btn btn-secondary', type: 'button',
        onClick: async (e) => {
          const target = e.currentTarget;
          if (!(await ask(t('{rank}순위 집합장소를 지울까요?', { rank })))) return;
          busy(target, async () => {
            try { savedToast(await deleteMeetingPoint(rank, p.name), t('지웠습니다.')); navigate('/admin/meet'); } catch (err) { toast(errorMessage(err), 'error'); }
          });
        },
      }, t('삭제')) : null,
      h('button', { class: 'btn', type: 'submit' }, t('저장'))));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    const overrideAt = d.overrideAt ? toDate(new Date(d.overrideAt)) : null;
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        const r = await saveMeetingPoint(rank, {
          ...d,
          lat: picked?.lat ?? null,
          lng: picked?.lng ?? null,
          overrideAt,
        });
        savedToast(r, t('{rank}순위를 저장했습니다.', { rank }));
        navigate('/admin/meet');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'page' }, pageHeader(t('{rank}순위 집합장소', { rank }), { crumbs: [{ label: t('집합장소'), href: '#/meet' }, { label: t('설정'), href: '#/admin/meet' }] }), card(form));
}

// ---------- 대처법 ----------

export function protocolAdminView({ state, live }) {
  return h('div', { class: 'page' },
    pageHeader(t('대처법 관리'), { crumbs: [{ label: t('상황별 대처법'), href: '#/protocols' }] }, h('a', { class: 'btn', href: '#/admin/protocols/new' }, t('+ 새 상황'))),
    live(() => card(
      state.serverProtocols.length
        ? h('p', null, t('서버에 {n}개의 프로토콜이 있습니다.', { n: state.serverProtocols.length }))
        : h('p', null, t('아직 서버에 프로토콜이 없어 앱에 내장된 기본 내용이 보이고 있습니다. 수정하려면 먼저 기본 내용을 불러오세요.')),
      h('button', {
        class: 'btn',
        onClick: (e) => busy(e.currentTarget, async () => {
          try {
            const n = await seedProtocols();
            toast(n ? t('기본 프로토콜 {n}개를 불러왔습니다.', { n }) : t('이미 모두 있습니다.'));
          } catch (err) { toast(errorMessage(err), 'error'); }
        }),
      }, t('기본 프로토콜 불러오기 (없는 것만)')))),
    live(() => h('ul', { class: 'list' }, state.serverProtocols
      .slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map((p) => h('li', null, h('a', { class: 'list-item list-link', href: `#/admin/protocols/${encodeURIComponent(p.id)}` },
        `${p.icon || '📄'} ${p.title}`,
        h('span', { class: 'muted small' }, ` · ${t('체크리스트 {n}개', { n: p.checklist?.length || 0 })}`)))))));
}

export function protocolEditView({ state, params, navigate }) {
  const isNew = params.id === 'new';
  const p = isNew ? { steps: [], checklist: [] } : state.serverProtocols.find((x) => x.id === params.id);
  if (!p) return h('div', { class: 'page' }, pageHeader(t('대처법 편집')), empty(t('서버에 없는 프로토콜입니다. 먼저 기본 프로토콜을 불러오세요.')));

  const form = h('form', { class: 'stack' },
    isNew ? field(t('영문 id'), h('input', { name: 'id', required: true, pattern: '[a-z0-9-]{2,30}', placeholder: t('예: tsunami') }), t('소문자·숫자·하이픈. 나중에 바꿀 수 없습니다.')) : null,
    h('div', { class: 'row' },
      field(t('아이콘'), h('input', { name: 'icon', maxlength: 4, value: p.icon || '📄' })),
      field(t('순서'), h('input', { name: 'order', type: 'number', min: 0, max: 99, value: String(p.order ?? 50) }))),
    field(t('제목'), h('input', { name: 'title', required: true, maxlength: 60, value: p.title || '' })),
    field(t('요약'), h('input', { name: 'summary', maxlength: 300, value: p.summary || '' })),
    field(t('꼭 기억할 것'), h('textarea', { name: 'keyPoints', rows: 4, value: (p.keyPoints || []).map((k) => `- ${k}`).join('\n') }),
      t('한 줄에 하나씩, 최대 6개. 상세 화면 맨 위 요약 상자에 표시됩니다.')),
    field(t('대처법'), h('textarea', { name: 'steps', rows: 14, value: stepsToText(p.steps) }),
      t('"## 단계 이름" 줄로 단계를 나누고, 그 아래 한 줄에 하나씩 할 일을 적습니다.')),
    field(t('체크리스트'), h('textarea', { name: 'checklist', rows: 10, value: (p.checklist || []).map((i) => `- ${i.text}`).join('\n') }),
      t('한 줄에 하나씩. 문구를 그대로 두면 가족들의 체크 상태가 유지됩니다.')),
    h('div', { class: 'row' },
      !isNew ? h('button', {
        class: 'btn btn-secondary', type: 'button',
        onClick: async (e) => {
          const target = e.currentTarget;
          if (!(await ask(t('"{title}"을(를) 지울까요?', { title: p.title })))) return;
          busy(target, async () => {
            try { savedToast(await deleteProtocol(p.id, p.title), t('지웠습니다.')); navigate('/admin/protocols'); } catch (err) { toast(errorMessage(err), 'error'); }
          });
        },
      }, t('삭제')) : null,
      h('button', { class: 'btn', type: 'submit' }, t('저장'))));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    const id = isNew ? d.id : p.id;
    if (isNew && state.serverProtocols.some((x) => x.id === id)) { toast(t('이미 있는 id입니다.'), 'error'); return; }
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        const r = await saveProtocol(id, {
          title: d.title,
          icon: d.icon,
          order: d.order,
          summary: d.summary,
          keyPoints: d.keyPoints.split('\n').map((l) => l.trim().replace(/^[-*•]\s*/, '')).filter(Boolean).slice(0, 6).map((l) => l.slice(0, 200)),
          steps: parseSteps(d.steps),
          checklist: parseChecklist(d.checklist, p.checklist || []),
        });
        savedToast(r, t('저장했습니다.'));
        navigate(`/protocols/${encodeURIComponent(id)}`);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'page' }, pageHeader(isNew ? t('새 상황 추가') : t('{title} 편집', { title: p.title }), { crumbs: [{ label: t('상황별 대처법'), href: '#/protocols' }, { label: t('관리'), href: '#/admin/protocols' }] }), card(form));
}
