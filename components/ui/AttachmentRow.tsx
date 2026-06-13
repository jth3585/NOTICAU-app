import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';
import { PaperclipIcon } from './icons';

// 원문 공지 페이지(sourceUrl)를 InApp 브라우저로 열어 사용자가 직접 다운로드.
// 학교 PHP 첨부 URL은 CMS 세션 없이는 작동 안 하므로 원문 페이지로 우회.
async function openSource(sourceUrl: string | null | undefined, fallbackUrl: string) {
  const target = sourceUrl ?? fallbackUrl;
  try {
    await WebBrowser.openBrowserAsync(target);
  } catch {
    // 열기 실패 시 무시
  }
}

// file_down.php?uploadFileOrgName=... 형태면 원본 파일명 추출, 아니면 URL 꼬리
function fileNameOf(url: string, label?: string): string {
  if (label) return label;
  try {
    const u = new URL(url);
    const org = u.searchParams.get('uploadFileOrgName');
    if (org) return org;
  } catch {
    // URL 파싱 실패 → 폴백
  }
  const tail = (url.split('/').pop() || '').split('?')[0];
  try {
    return decodeURIComponent(tail) || '첨부파일';
  } catch {
    return tail || '첨부파일';
  }
}

function extOf(name: string): string {
  const m = name.match(/\.([a-zA-Z0-9]{1,5})$/);
  return m ? m[1].toUpperCase() : '';
}

export function AttachmentRow({ url, label, sourceUrl }: { url: string; label?: string; sourceUrl?: string | null }) {
  const name = fileNameOf(url, label);
  const ext = extOf(name);
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => openSource(sourceUrl, url)}
      activeOpacity={0.6}
    >
      <View style={styles.icon}>
        <PaperclipIcon size={16} color={COLORS.textSecondary} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {ext ? <Text style={styles.ext}>{ext}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  icon: { width: 16, alignItems: 'center' },
  name: { flex: 1, fontSize: FONT.body, color: COLORS.text },
  ext: {
    fontSize: FONT.micro,
    fontWeight: WEIGHT.semibold,
    color: COLORS.textSecondary,
    backgroundColor: COLORS.surface2,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.badge,
  },
});
