import { describe, expect, it } from 'vitest'
import { checkLink, initialReference } from '../src/ui/reference.ts'

describe('checkLink', () => {
  it('비었거나 공백뿐이면 empty (레퍼런스 없음)', () => {
    expect(checkLink('')).toEqual({ kind: 'empty' })
    expect(checkLink('   \t ')).toEqual({ kind: 'empty' })
  })
  it('http(s) 링크는 앞뒤 공백을 다듬어 ok', () => {
    expect(checkLink('  https://youtu.be/abc?t=3  ')).toEqual({ kind: 'ok', url: 'https://youtu.be/abc?t=3' })
    expect(checkLink('HTTP://example.com/x')).toEqual({ kind: 'ok', url: 'HTTP://example.com/x' })
  })
  it('다른 형식·중간에 공백이 있는 값은 bad', () => {
    for (const v of ['abc', 'ftp://x.com/a', 'www.youtube.com/watch?v=1', 'https://', 'https://a b.com', 'javascript:alert(1)']) expect(checkLink(v), v).toEqual({ kind: 'bad' })
  })
})

describe('initialReference — 다시 열었을 때 이미 고른 레퍼런스를 미리 채운다', () => {
  const recs = [{ url: 'https://www.youtube.com/watch?v=a', id: 'a' }, { url: 'https://www.youtube.com/watch?v=b', id: 'b' }]
  it('추천 목록에 있는 링크는 그 카드를 고른 것으로', () => {
    expect(initialReference('https://www.youtube.com/watch?v=b', false, recs)).toEqual({ recId: 'b', link: '', fileName: null })
  })
  it('그 밖의 링크는 직접 입력한 것으로', () => {
    expect(initialReference('https://youtu.be/zzz', false, recs)).toEqual({ recId: null, link: 'https://youtu.be/zzz', fileName: null })
  })
  it('올린 파일("파일: 이름")은 첨부한 것으로 — 올려 둔 파일이 있을 때만', () => {
    expect(initialReference('파일: 레퍼런스.mp4', true, recs)).toEqual({ recId: null, link: '', fileName: '레퍼런스.mp4' })
    expect(initialReference('파일: 레퍼런스.mp4', false, recs)).toEqual({ recId: null, link: '', fileName: null })
  })
  it('없으면 모두 비어 있다', () => {
    expect(initialReference(null, false, recs)).toEqual({ recId: null, link: '', fileName: null })
  })
})
