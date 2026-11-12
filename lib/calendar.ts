import { Platform } from 'react-native';
// SDK 56+ 객체지향 API(ExpoCalendar / ExpoCalendarEvent). 기존 함수형 API(*Async)는 기본 경로에서
// 호출 시 런타임 throw. 저장해 둔 eventId 는 기기 캘린더의 이벤트 ID라 API 전환과 무관하게 그대로 유효.
import * as Calendar from 'expo-calendar';
import { ExpoCalendarEvent, type ExpoCalendar } from 'expo-calendar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Notice } from './types';
import { logEvent } from './events';

// 공지 마감일을 기기 캘린더에 "수동" 추가하는 헬퍼.
// - 타임 이벤트(마감 시각 ~ +1h)로만 생성, 알람은 걸지 않음(리마인더는 사용자 몫).
// - 추가한 공지의 eventId 를 로컬(AsyncStorage)에 매핑해 중복 추가 방지 + 해제 지원.
//   (서버에 저장하지 않음 — 기기 캘린더는 기기에 종속이라 로컬 매핑이 맞음.)

const KEY_PREFIX = '@noticau/cal/';
const EVENT_DURATION_MS = 60 * 60 * 1000; // 마감 시각부터 1시간짜리 블록

function key(noticeId: string) {
  return `${KEY_PREFIX}${noticeId}`;
}

export async function getSavedEventId(noticeId: string): Promise<string | null> {
  return AsyncStorage.getItem(key(noticeId));
}

async function ensurePermission(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissions();
  return status === 'granted';
}

// 쓰기 가능한 캘린더. iOS는 기본 캘린더(동기 API), Android는 수정 가능한 기본/첫 캘린더
// (Android엔 시스템 기본 캘린더 개념이 없어 getDefaultCalendarSync 미지원).
async function getWritableCalendar(): Promise<ExpoCalendar | null> {
  if (Platform.OS === 'ios') {
    try {
      const def = Calendar.getDefaultCalendarSync();
      if (def?.id) return def;
    } catch {
      // 기본 캘린더 조회 실패 시 아래 폴백
    }
  }
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const writable = calendars.filter((c) => c.allowsModifications);
  if (writable.length === 0) return null;
  return writable.find((c) => c.isPrimary) ?? writable[0];
}

export type AddResult =
  | { ok: true; eventId: string }
  | { ok: false; reason: 'permission' | 'no-calendar' | 'error' };

export async function addNoticeToCalendar(notice: Notice, deadlineAt: string): Promise<AddResult> {
  try {
    if (!(await ensurePermission())) return { ok: false, reason: 'permission' };

    const calendar = await getWritableCalendar();
    if (!calendar) return { ok: false, reason: 'no-calendar' };

    const start = new Date(deadlineAt);
    const end = new Date(start.getTime() + EVENT_DURATION_MS);
    const notesLines = [notice.source_url ?? '', '', '— NOTICAU'].filter((l, i) => l !== '' || i === 1);

    const event = await calendar.createEvent({
      title: notice.title,
      startDate: start,
      endDate: end,
      notes: notesLines.join('\n'),
      url: notice.source_url ?? undefined, // iOS만 반영(Android는 notes의 링크로 대체)
      timeZone: 'Asia/Seoul',
      alarms: [], // 알람 없음 — 사용자가 직접 설정
    });
    const eventId = event.id;

    await AsyncStorage.setItem(key(notice.id), eventId);
    logEvent('calendar_add', { noticeId: notice.id }); // 사용량 기록(fire-and-forget)
    return { ok: true, eventId };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// 캘린더에서 제거 + 로컬 매핑 삭제. (이벤트가 이미 사라졌어도 매핑은 정리)
export async function removeNoticeFromCalendar(noticeId: string): Promise<boolean> {
  try {
    const eventId = await getSavedEventId(noticeId);
    if (eventId) {
      try {
        const event = await ExpoCalendarEvent.get(eventId); // 없으면 throw
        await event.delete();
      } catch {
        // 사용자가 캘린더 앱에서 이미 지운 경우 — 무시하고 매핑만 정리
      }
    }
    await AsyncStorage.removeItem(key(noticeId));
    return true;
  } catch {
    return false;
  }
}
