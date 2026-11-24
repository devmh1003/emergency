// 더보기: 하단 메뉴에 없는 화면을 쓰임새별로 모은 전체 메뉴
import { h, panel, pageHeader, menuList } from '../dom.js';
import { t } from '../i18n.js';

export function moreView({ state }) {
  return h('div', { class: 'page' },
    pageHeader(t('더보기')),
    panel(t('비상시에 쓰는 것'), null, menuList([
      ['#/emergency', '🚨', t('비상 경보'), state.isAdmin ? t('1급·2급 발령, 해제, 테스트')
        : state.me.declareCredits >= 1 ? t('선언권 1회 남음 · 경보음 시험') : t('선언권 없음 · 경보음 시험')],
      ['#/sos', '🆘', t('구조 신호'), t('손전등·SOS 불빛·호루라기 소리')],
      ['#/contacts', '☎️', t('비상 연락처'), t('119·112와 가족 지정 연락처')],
      ['#/records', '🗂', t('내 신고 기록'), t('내가 남긴 위치와 시간')],
    ])),
    panel(t('평소에 준비할 것'), null, menuList([
      ['#/protocols', '📘', t('상황별 대처법'), t('물 확보·대피 판단·붕괴 등 22가지')],
      ['#/supplies', '📦', t('비상 물품'), t('물·식량·약 유통기한 관리')],
      ['#/print', '🖨', t('인쇄용 비상카드'), t('지갑·배낭에 넣을 종이 카드')],
      ['#/guide', '📖', t('사용 안내'), t('처음 설정과 비상시 행동 순서')],
    ])),
    state.isAdmin ? panel(t('관리자'), null, menuList([
      ['#/admin', '🛠', t('관리자 설정'), t('비상 선언·해제, 소리 테스트, 가족 등록')],
      ['#/admin/meet', '📍', t('집합장소 설정'), t('1~10순위')],
      ['#/admin/protocols', '📘', t('대처법 관리'), t('내용·체크리스트 편집')],
      ['#/admin/directory', '🗃', t('가족 정보 한눈에'), t('개인정보·연결 상태 표')],
      ['#/admin/logs', '📋', t('관리자 기록'), t('알림·신고·관리 작업')],
    ])) : null,
    panel(t('내 휴대폰'), null, menuList([
      ['#/settings', '⚙️', t('설정'), t('알림, 앱 설치, 글자 크기, 내 정보를 관리합니다.')],
    ])),
    h('p', { class: 'small muted center' }, t('버전 {build}', { build: document.documentElement.dataset.build || 'dev' })));
}
