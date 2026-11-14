// CLOVA General OCR 로 이미지의 글자를 읽는다. (llm_classify 의 OCR 부분과 같은 방식 — 그쪽은 아직 자체 사본을 쓴다.)
//
// 원본 URL 을 그대로 넘기므로 base64 인코딩이 필요 없고 대용량·여러 장도 처리된다(건당 3원, 월 100건 무료).
// 환경변수 CLOVA_OCR_INVOKE_URL / CLOVA_OCR_SECRET 이 없으면 빈 문자열을 돌려준다.

const CLOVA_URL = Deno.env.get("CLOVA_OCR_INVOKE_URL");
const CLOVA_SECRET = Deno.env.get("CLOVA_OCR_SECRET");
const CLOVA_FORMATS = ["jpg", "jpeg", "png", "pdf", "tif", "tiff"];
const MIN_IMAGE_BYTES = 20 * 1024;        // 이보다 작으면 아이콘·구분선 — 본문 이미지가 아니다
const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // CLOVA 요청 상한
const CLOVA_TPS_DELAY_MS = 1200;          // 서비스 계정당 1 TPS 권장 → 순차 호출

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ocrConfigured(): boolean {
  return !!CLOVA_URL && !!CLOVA_SECRET;
}

// CLOVA 는 URL 을 자체 정규식으로 검증하며 ( ) ! ' * ; $ [ ] 를 허용하지 않는다.
// encodeURI 가 이 문자들을 남겨두므로 직접 이스케이프한다.
function clovaSafeUrl(raw: string): string {
  const needsEncoding = /[^\x21-\x7e]/.test(raw) || raw.includes(" ");
  const encoded = needsEncoding ? encodeURI(raw) : raw;
  return encoded.replace(/[!'()*;$\[\]]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function formatFromUrl(url: string): string | null {
  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase();
    if (ext && CLOVA_FORMATS.includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  } catch { /* 잘못된 URL */ }
  return null;
}

function formatFromBytes(b: Uint8Array): string | null {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))) return "tif";
  return null; // gif/webp 는 CLOVA 미지원
}

// 크기와 포맷을 확인한다. URL 확장자로 포맷을 못 정하는 경우가 많아 앞부분 바이트로 판별한다.
async function inspectImage(url: string): Promise<{ format: string; bytes: number } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NOTICAU/0.1)", Range: "bytes=0-2047" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const cr = res.headers.get("content-range"); // "bytes 0-2047/123456"
    const total = cr?.includes("/") ? Number(cr.split("/")[1]) : Number(res.headers.get("content-length") ?? 0);
    // Range 를 무시하고 전체를 보내는 서버가 많다. 확장자로 포맷을 알면 바디를 읽지 않고 끊는다.
    const extFormat = formatFromUrl(url);
    if (extFormat && Number.isFinite(total) && total > 0) {
      await res.body?.cancel();
      return { format: extFormat, bytes: total };
    }
    const head = new Uint8Array(await res.arrayBuffer());
    const bytes = Number.isFinite(total) && total > 0 ? total : head.byteLength;
    const format = extFormat ?? formatFromBytes(head);
    return format ? { format, bytes } : null;
  } catch {
    return null;
  }
}

// CLOVA General OCR 은 요청당 이미지 1장만 받는다(2장 이상이면 400).
async function ocrOne(url: string, format: string): Promise<string> {
  const res = await fetch(CLOVA_URL!, {
    method: "POST",
    headers: { "X-OCR-SECRET": CLOVA_SECRET!, "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "V2",
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      images: [{ format, name: "img", url: clovaSafeUrl(url) }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`CLOVA ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const fields = body?.images?.[0]?.fields ?? [];
  let text = "";
  for (const f of fields) text += (f.inferText ?? "") + (f.lineBreak ? "\n" : " ");
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * 이미지들을 차례로 OCR 해 하나의 글로 합친다. 아이콘 크기·미지원 포맷·실패한 장은 건너뛴다.
 * maxImages 는 실제로 OCR 을 호출하는 장수의 상한(아이콘은 세지 않는다).
 */
export async function ocrImages(urls: string[], maxImages = 3): Promise<string> {
  if (!ocrConfigured()) return "";
  const chunks: string[] = [];
  let done = 0;
  for (const url of urls) {
    if (done >= maxImages) break;
    const info = await inspectImage(url);
    if (!info || info.bytes < MIN_IMAGE_BYTES || info.bytes > MAX_IMAGE_BYTES) continue;
    try {
      await sleep(CLOVA_TPS_DELAY_MS);
      const t = await ocrOne(url, info.format);
      if (t) chunks.push(t);
      done++;
    } catch (e) {
      console.error(`ocr failed ${url}: ${(e as Error).message}`);
    }
  }
  return chunks.join("\n\n").trim();
}
