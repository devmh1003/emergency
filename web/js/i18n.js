// 한국어 / 영어 전환.
// 화면 문자열은 한국어 원문을 그대로 키로 쓴다: t('설정') → 영어일 때 'Settings'.
// 값이 들어가는 문장은 {이름} 자리표시를 쓴다: t('{name}님이 해제했습니다', { name }).
// 영어 번역은 i18n/en-*.js 에 있고, 번역이 없으면 한국어 원문이 그대로 보인다.
import { EN as EN_CORE } from './i18n/en-core.js';
import { EN as EN_HOME } from './i18n/en-home.js';
import { EN as EN_ALARM } from './i18n/en-alarm.js';
import { EN as EN_ADMIN } from './i18n/en-admin.js';
import { EN as EN_APP } from './i18n/en-app.js';

const EN = { ...EN_CORE, ...EN_HOME, ...EN_ALARM, ...EN_ADMIN, ...EN_APP };
const LANG_KEY = 'family.lang';

function readLang() {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko'; // 저장소를 못 쓰거나 테스트(node) 환경
  }
}

/** 지금 언어: 'ko' | 'en'. 바꾸면 새로고침해서 화면 전체에 적용한다. */
export const lang = readLang();

export function t(ko, vars) {
  let s = lang === 'en' ? (EN[ko] ?? ko) : ko;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

export function setLang(next) {
  try { localStorage.setItem(LANG_KEY, next === 'en' ? 'en' : 'ko'); } catch { /* 무시 */ }
  location.reload();
}

/** 번역이 빠진 문자열 찾기용 (테스트) */
export function hasTranslation(ko) {
  return Object.hasOwn(EN, ko);
}
