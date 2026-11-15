// 글에 주소 없이 직접 박힌 이미지(<img src="data:image/png;base64,…">)를 Storage 에 올려 공개 URL 로 바꾼다.
// 포스터를 편집기에 붙여 넣는 게시판(첨단소재공학과 등)은 이렇게 하지 않으면 이미지가 아예 수집되지 않아
// 요약·행사 일시·커버가 모두 비게 된다. 파일 이름은 내용 해시라 같은 이미지를 다시 올려도 한 개만 남는다.

// deno-lint-ignore no-explicit-any
type Client = any;

const BUCKET = "crawled-images";
const MAX_B64_CHARS = 7_000_000; // ≈ 5MB. 이보다 크면 건너뛴다.
const DATA_RE = /^data:(image\/(png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * srcs 중 data: URI 인 것을 앞에서부터 max 장까지 올리고 공개 URL 목록을 돌려준다.
 * 실패한 장은 건너뛴다(로그만 남긴다). prefix 는 보통 parser_key.
 */
export async function rehostInlineImages(supabase: Client, prefix: string, srcs: string[], max = 2): Promise<string[]> {
  const urls: string[] = [];
  for (const src of srcs) {
    if (urls.length >= max) break;
    const m = src.match(DATA_RE);
    if (!m) continue;
    const b64 = m[3].replace(/\s+/g, "");
    if (b64.length > MAX_B64_CHARS) { console.warn(`[${prefix}] inline image too large: ${b64.length} chars`); continue; }
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ext = m[2].toLowerCase().replace("jpeg", "jpg");
      const path = `${prefix}/${await sha256Hex(b64)}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: m[1].toLowerCase(), upsert: true });
      if (error) { console.error(`[${prefix}] inline image upload failed: ${error.message}`); continue; }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      if (data?.publicUrl) urls.push(data.publicUrl);
    } catch (e) {
      console.error(`[${prefix}] inline image failed: ${(e as Error).message}`);
    }
  }
  return urls;
}
