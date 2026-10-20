/** 클래스 이름을 이어 붙인다. 거짓 값은 버린다. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
