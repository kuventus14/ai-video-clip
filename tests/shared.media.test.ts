import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { allowedExt, UNSUPPORTED_FORMAT_MESSAGE as SERVER_MESSAGE } from '../src/web/http.ts'
import { UNSUPPORTED_FORMAT_MESSAGE, VIDEO_EXTS, videoExtOf } from '../src/shared/media.ts'

describe('videoExtOf', () => {
  it('허용된 확장자는 소문자로 돌려준다 (한글·공백·괄호 이름 포함)', () => {
    expect(videoExtOf('내 영상 (1).MOV')).toBe('.mov')
    expect(videoExtOf('롱아이언_릴스_편집본.mp4')).toBe('.mp4')
    expect(videoExtOf('a.b.c.webm')).toBe('.webm')
  })
  it('허용되지 않거나 확장자가 없으면 null', () => {
    expect(videoExtOf('메모.txt')).toBeNull()
    expect(videoExtOf('영상')).toBeNull()
    expect(videoExtOf('.mp4')).toBeNull()
    expect(videoExtOf('영상.')).toBeNull()
    expect(videoExtOf('')).toBeNull()
    expect(videoExtOf(null)).toBeNull()
  })
  it('경로 구분자 뒤의 이름만 본다', () => {
    expect(videoExtOf('C:\\영상\\a.avi')).toBe('.avi')
    expect(videoExtOf('폴더.mp4/메모')).toBeNull()
  })
  it('서버의 allowedExt 와 같은 판단을 한다 (화면이 통과시킨 파일을 서버가 거절하지 않도록)', () => {
    const names = ['a.mp4', 'a.MKV', 'a.txt', 'a', '.mov', 'a.', '내 영상 (1).m4v', 'x.avi', 'x.webm', 'x.mpg', 'x.exe']
    for (const n of names) expect(videoExtOf(n), n).toBe(allowedExt(n))
    expect(path.extname('a.mp4')).toBe('.mp4')
  })
  it('안내 문구는 허용 목록에서 만들고 서버와 같다', () => {
    expect(UNSUPPORTED_FORMAT_MESSAGE).toBe(SERVER_MESSAGE)
    for (const e of VIDEO_EXTS) expect(UNSUPPORTED_FORMAT_MESSAGE).toContain(e.slice(1))
  })
})
