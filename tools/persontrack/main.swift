// 영상에서 사람(몸·얼굴)의 위치를 일정 간격으로 찾아 JSON 한 줄로 출력한다. macOS 기본 프레임워크(Vision)만 쓴다.
//   persontrack <영상> <초당 샘플 수>
// 좌표는 화면 좌상단 원점, 0..1 로 정규화한다. 회전 메타데이터가 있으면 화면에 보이는 방향 기준.
// 실패하면 stderr 에 사유를 쓰고 종료 코드 1.
import Foundation
import AVFoundation
import Vision

func fail(_ m: String) -> Never {
  FileHandle.standardError.write((m + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
guard args.count >= 3, let fps = Double(args[2]), fps > 0 else { fail("사용법: persontrack <영상> <초당 샘플 수>") }
guard FileManager.default.fileExists(atPath: args[1]) else { fail("파일이 없어요: \(args[1])") }

let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
guard let track = asset.tracks(withMediaType: .video).first else { fail("영상 트랙을 찾을 수 없어요") }
let displaySize = track.naturalSize.applying(track.preferredTransform)
let width = Int(abs(displaySize.width).rounded())
let height = Int(abs(displaySize.height).rounded())
let duration = CMTimeGetSeconds(asset.duration)
guard duration.isFinite, duration > 0 else { fail("영상 길이를 읽을 수 없어요") }

let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = CMTime(seconds: 0.1, preferredTimescale: 600)
generator.requestedTimeToleranceAfter = CMTime(seconds: 0.1, preferredTimescale: 600)
generator.maximumSize = CGSize(width: 960, height: 960)

func clamp(_ v: CGFloat) -> Double { Double(min(1, max(0, v))) }

/// Vision 은 좌하단 원점이라 y 를 뒤집어 좌상단 원점으로 바꾼다
func toBox(_ r: CGRect, _ confidence: Float, _ kind: String) -> [String: Any] {
  let x = clamp(r.minX)
  let y = clamp(1 - r.maxY)
  return ["x": x, "y": y, "w": min(clamp(r.width), 1 - x), "h": min(clamp(r.height), 1 - y), "confidence": Double(confidence), "kind": kind]
}

let count = max(1, Int(floor(duration * fps)))
var samples: [[String: Any]] = []
var failedFrames = 0

for i in 0..<count {
  let t = Double(i) / fps
  var boxes: [[String: Any]] = []
  let at = CMTime(seconds: min(t, max(0, duration - 0.05)), preferredTimescale: 600)
  if let image = try? generator.copyCGImage(at: at, actualTime: nil) {
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    let human = VNDetectHumanRectanglesRequest()
    human.upperBodyOnly = false
    let face = VNDetectFaceRectanglesRequest()
    try? handler.perform([human, face])
    for o in human.results ?? [] { boxes.append(toBox(o.boundingBox, o.confidence, "human")) }
    for o in face.results ?? [] { boxes.append(toBox(o.boundingBox, o.confidence, "face")) }
  } else {
    failedFrames += 1
  }
  samples.append(["t": t, "boxes": boxes])
}

if failedFrames == count { fail("프레임을 읽지 못했어요") }

let result: [String: Any] = ["width": width, "height": height, "samples": samples]
guard let data = try? JSONSerialization.data(withJSONObject: result), let text = String(data: data, encoding: .utf8) else { fail("결과를 JSON 으로 만들지 못했어요") }
print(text)
