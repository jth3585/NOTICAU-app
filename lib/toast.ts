// 전역 토스트 — 어디서든 toast('메시지') 로 호출. ToastHost(루트에 1개)가 실제 렌더.
export type ToastType = 'default' | 'success' | 'error' | 'sort';
type ToastFn = (message: string, type?: ToastType) => void;

let handler: ToastFn | null = null;

export function setToastHandler(fn: ToastFn | null) {
  handler = fn;
}

export function toast(message: string, type: ToastType = 'default') {
  handler?.(message, type);
}
