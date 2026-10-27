// 관리자 화면: 가족 추가·수정, 집합장소 설정, 대처법 편집
import { h, field, select, formData, toast, busy, card, pageHeader, empty } from '../dom.js';
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

const MAX_MEMBERS = 20;

// ---------- 가족 추가·수정 ----------

export function memberEditView({ state, params, navigate }) {
  const isNew = params.uid === 'new';
  const m = isNew ? null : state.members.find((x) => x.id === params.uid);
  if (!isNew && !m) return h('div', { class: 'page' }, pageHeader('가족 수정'), empty('없는 가족입니다.'));
  if (isNew && state.members.length >= MAX_MEMBERS) {
    return h('div', { class: 'page' }, pageHeader('가족 추가'), empty(`가족은 최대 ${MAX_MEMBERS}명까지 등록할 수 있습니다.`));
  }
  const isSelf = m?.id === state.me.id;

  const profileFields = h('div', { class: 'stack' }, h('p', { class: 'muted' }, '불러오는 중…'));
  const fillProfile = (p = {}) => profileFields.replaceChildren(
    field('성별', select('gender', ['', ...GENDERS].map((g) => ({ value: g, label: g || '선택 안 함' })), p.gender || '')),
    field('생년월일', h('input', { name: 'birthDate', type: 'date', value: p.birthDate || '' }), '나이는 자동으로 계산됩니다'),
    field('혈액형', select('bloodType', ['', ...BLOOD_TYPES].map((b) => ({ value: b, label: b || '선택 안 함' })), p.bloodType || '')),
    isNew ? null : field('이메일 (연락용)', h('input', { name: 'email', type: 'email', maxlength: 120, value: p.email || '' }), '로그인 이메일은 바뀌지 않습니다'),
    field('집주소', h('input', { name: 'address', maxlength: 200, value: p.address || '', autocomplete: 'off' })),
    field('비상연락처 (가족 외)', h('input', { name: 'emergencyContact', maxlength: 100, value: p.emergencyContact || '', placeholder: '예: 이모 010-0000-0000' })),
    field('의료 메모', h('textarea', { name: 'medical', rows: 3, maxlength: 500, value: p.medical || '', placeholder: '지병, 복용약, 알레르기' })));
  if (isNew) fillProfile();
  else getProfile(m.id).then(fillProfile).catch((err) => profileFields.replaceChildren(h('p', { class: 'text-danger' }, errorMessage(err))));

  const form = h('form', { class: 'stack' },
    card(h('h2', null, '기본 정보 (가족 모두에게 보임)'),
      field('이름', h('input', { name: 'name', required: true, maxlength: 40, value: m?.name || '' })),
      field('전화번호', h('input', { name: 'phone', type: 'tel', maxlength: 30, value: m?.phone || '', inputmode: 'tel' })),
      field('권한', select('role', [{ value: 'member', label: '가족' }, { value: 'admin', label: '관리자' }], m?.role || 'member'),
        isSelf ? '본인의 관리자 권한은 다른 관리자가 바꿔야 합니다' : '관리자는 여러 명 둘 수 있습니다'),
      field('표시 순서', h('input', { name: 'order', type: 'number', min: 0, max: 99, value: String(m?.order ?? state.members.length + 1) }))),
    isNew ? card(h('h2', null, '로그인 계정'),
      field('이메일 (로그인 아이디)', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
      field('첫 비밀번호', h('input', { name: 'password', type: 'text', required: true, minlength: 8, autocomplete: 'new-password' }), '8자 이상. 본인에게 알려 주고 로그인 후 바꾸게 하세요.')) : null,
    card(h('h2', null, '개인정보 (본인과 관리자만 보임)'), profileFields),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onClick: () => history.back() }, '취소'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, isNew ? '가족 추가' : '저장')));

  if (isSelf) form.elements.role.disabled = true;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    const data = {
      name: d.name,
      phone: d.phone,
      role: isSelf ? m.role : d.role,
      order: Number(d.order) || 0,
      gender: d.gender,
      birthDate: d.birthDate,
      bloodType: d.bloodType,
      email: d.email,
      address: d.address,
      emergencyContact: d.emergencyContact,
      medical: d.medical,
    };
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        if (isNew) {
          const uid = await createMember({ ...data, password: d.password, active: true, declareCredits: 1 });
          toast(`${data.name}님을 추가했습니다. 이메일과 첫 비밀번호를 알려 주세요.`);
          navigate(`/member/${encodeURIComponent(uid)}`);
        } else {
          await updateMember(m.id, data);
          toast('저장했습니다.');
          navigate(`/member/${encodeURIComponent(m.id)}`);
        }
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'page' }, pageHeader(isNew ? '가족 추가' : `${m.name} 수정`), form);
}

// ---------- 집합장소 ----------

export function meetEditListView({ state, live }) {
  return h('div', { class: 'page' },
    pageHeader('집합장소 설정'),
    card(h('p', null, '1순위부터 차례로 정하세요. 시간은 "비상 발생 후 몇 시간"으로 정하고, 비상이 선언되면 실제 시각으로 계산됩니다.'),
      h('p', { class: 'muted small' }, '각 장소에서 "대기 시간"이 지나도 모두 모이지 못하면 다음 순위로 이동합니다.')),
    live(() => {
      const warnings = scheduleWarnings(state.meetingPoints);
      return warnings.length ? card(h('ul', { class: 'warnings' }, warnings.map((w) => h('li', null, `⚠️ ${w}`)))) : null;
    }),
    live(() => h('ol', { class: 'list' }, Array.from({ length: 10 }, (_, i) => i + 1).map((rank) => {
      const p = state.meetingPoints.find((x) => x.rank === rank);
      return h('li', null, h('a', { class: 'list-item list-link', href: `#/admin/meet/${rank}` },
        h('strong', null, `${rank}순위 `, p ? p.name : h('span', { class: 'muted' }, '비어 있음')),
        p ? h('div', { class: 'muted small' },
          `${formatOffset(p.offsetHours)} · ${p.waitMinutes}분 대기`,
          p.overrideAt ? ' · 시각 직접 지정됨' : '',
          hasLocation(p) ? '' : ' · 위치 미지정') : null));
    }))));
}

export function meetEditView({ state, params, navigate }) {
  const rank = Number(params.rank);
  if (!(rank >= 1 && rank <= 10)) return h('div', { class: 'page' }, empty('잘못된 순위입니다.'));
  const p = state.meetingPoints.find((x) => x.rank === rank) || {};
  let picked = hasLocation(p) ? { lat: p.lat, lng: p.lng } : null;

  const coords = h('p', { class: 'small muted' });
  const showCoords = () => {
    coords.textContent = picked ? `위도 ${picked.lat}, 경도 ${picked.lng}` : '위치가 없습니다. 지도를 누르거나 현재 위치를 쓰세요.';
  };
  const map = mapView({
    points: picked ? [{ ...picked, label: String(rank), color: 'meet' }] : [],
    height: 260,
    onPick: (pos) => { picked = pos; map.setPicked(pos); showCoords(); },
  });
  showCoords();

  const form = h('form', { class: 'stack' },
    field('장소 이름', h('input', { name: 'name', required: true, maxlength: 60, value: p.name || '', placeholder: '예: 우리 집, ○○초등학교 정문' })),
    field('주소', h('input', { name: 'address', maxlength: 200, value: p.address || '' })),
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, '위치 (지도를 눌러 선택)'),
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
        }, '📍 현재 위치로'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: () => { picked = null; map.setPicked(null); showCoords(); } }, '위치 지우기'))),
    h('div', { class: 'row' },
      field('비상 발생 후 (시간)', h('input', { name: 'offsetHours', type: 'number', min: 0, max: 1440, step: 0.5, required: true, value: String(p.offsetHours ?? (rank - 1) * 6) })),
      field('대기 시간 (분)', h('input', { name: 'waitMinutes', type: 'number', min: 0, max: 1440, step: 10, required: true, value: String(p.waitMinutes ?? 60) }))),
    field('도착 시각 직접 지정 (선택)', h('input', { name: 'overrideAt', type: 'datetime-local', value: toLocalInput(p.overrideAt) }),
      '비상 중에 시간을 바꿔야 할 때 씁니다. 비워 두면 "비상 발생 후 시간"으로 계산합니다.'),
    field('안내 메모', h('textarea', { name: 'note', rows: 3, maxlength: 500, value: p.note || '', placeholder: '예: 정문 앞 시계탑 아래. 못 들어가면 길 건너 편의점.' })),
    h('div', { class: 'row' },
      p.name ? h('button', {
        class: 'btn btn-danger', type: 'button',
        onClick: (e) => {
          if (!confirm(`${rank}순위 집합장소를 지울까요?`)) return;
          busy(e.currentTarget, async () => {
            try { await deleteMeetingPoint(rank); toast('지웠습니다.'); navigate('/admin/meet'); } catch (err) { toast(errorMessage(err), 'error'); }
          });
        },
      }, '삭제') : null,
      h('button', { class: 'btn btn-primary', type: 'submit' }, '저장')));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    const overrideAt = d.overrideAt ? toDate(new Date(d.overrideAt)) : null;
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await saveMeetingPoint(rank, {
          ...d,
          lat: picked?.lat ?? null,
          lng: picked?.lng ?? null,
          overrideAt,
        });
        toast(`${rank}순위를 저장했습니다.`);
        navigate('/admin/meet');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'page' }, pageHeader(`${rank}순위 집합장소`), card(form));
}

// ---------- 대처법 ----------

export function protocolAdminView({ state, live }) {
  return h('div', { class: 'page' },
    pageHeader('대처법 관리', h('a', { class: 'btn btn-primary btn-sm', href: '#/admin/protocols/new' }, '+ 새 상황')),
    live(() => card(
      state.serverProtocols.length
        ? h('p', null, `서버에 ${state.serverProtocols.length}개의 프로토콜이 있습니다.`)
        : h('p', null, '아직 서버에 프로토콜이 없어 앱에 내장된 기본 내용이 보이고 있습니다. 수정하려면 먼저 기본 내용을 불러오세요.'),
      h('button', {
        class: 'btn',
        onClick: (e) => busy(e.currentTarget, async () => {
          try {
            const n = await seedProtocols();
            toast(n ? `기본 프로토콜 ${n}개를 불러왔습니다.` : '이미 모두 있습니다.');
          } catch (err) { toast(errorMessage(err), 'error'); }
        }),
      }, '기본 프로토콜 불러오기 (없는 것만)'))),
    live(() => h('ul', { class: 'list' }, state.serverProtocols
      .slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map((p) => h('li', null, h('a', { class: 'list-item list-link', href: `#/admin/protocols/${encodeURIComponent(p.id)}` },
        `${p.icon || '📄'} ${p.title}`,
        h('span', { class: 'muted small' }, ` · 체크리스트 ${p.checklist?.length || 0}개`)))))));
}

export function protocolEditView({ state, params, navigate }) {
  const isNew = params.id === 'new';
  const p = isNew ? { steps: [], checklist: [] } : state.serverProtocols.find((x) => x.id === params.id);
  if (!p) return h('div', { class: 'page' }, pageHeader('대처법 편집'), empty('서버에 없는 프로토콜입니다. 먼저 기본 프로토콜을 불러오세요.'));

  const form = h('form', { class: 'stack' },
    isNew ? field('영문 id', h('input', { name: 'id', required: true, pattern: '[a-z0-9-]{2,30}', placeholder: '예: tsunami' }), '소문자·숫자·하이픈. 나중에 바꿀 수 없습니다.') : null,
    h('div', { class: 'row' },
      field('아이콘', h('input', { name: 'icon', maxlength: 4, value: p.icon || '📄' })),
      field('순서', h('input', { name: 'order', type: 'number', min: 0, max: 99, value: String(p.order ?? 50) }))),
    field('제목', h('input', { name: 'title', required: true, maxlength: 60, value: p.title || '' })),
    field('요약', h('input', { name: 'summary', maxlength: 300, value: p.summary || '' })),
    field('대처법', h('textarea', { name: 'steps', rows: 14, value: stepsToText(p.steps) }),
      '"## 단계 이름" 줄로 단계를 나누고, 그 아래 한 줄에 하나씩 할 일을 적습니다.'),
    field('체크리스트', h('textarea', { name: 'checklist', rows: 10, value: (p.checklist || []).map((i) => `- ${i.text}`).join('\n') }),
      '한 줄에 하나씩. 문구를 그대로 두면 가족들의 체크 상태가 유지됩니다.'),
    h('div', { class: 'row' },
      !isNew ? h('button', {
        class: 'btn btn-danger', type: 'button',
        onClick: (e) => {
          if (!confirm(`"${p.title}"을(를) 지울까요?`)) return;
          busy(e.currentTarget, async () => {
            try { await deleteProtocol(p.id); toast('지웠습니다.'); navigate('/admin/protocols'); } catch (err) { toast(errorMessage(err), 'error'); }
          });
        },
      }, '삭제') : null,
      h('button', { class: 'btn btn-primary', type: 'submit' }, '저장')));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    const id = isNew ? d.id : p.id;
    if (isNew && state.serverProtocols.some((x) => x.id === id)) { toast('이미 있는 id입니다.', 'error'); return; }
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await saveProtocol(id, {
          title: d.title,
          icon: d.icon,
          order: d.order,
          summary: d.summary,
          steps: parseSteps(d.steps),
          checklist: parseChecklist(d.checklist, p.checklist || []),
        });
        toast('저장했습니다.');
        navigate(`/protocols/${encodeURIComponent(id)}`);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'page' }, pageHeader(isNew ? '새 상황 추가' : `${p.title} 편집`), card(form));
}
