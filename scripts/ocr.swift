// Reads on-screen text from image files using the macOS Vision framework.
// Usage: ocr <image> [image...]  → one JSON array per file on stdout.
// No dependencies, no API key, runs locally.
import Foundation
import Vision
import AppKit

struct Line: Codable {
    let text: String
    let confidence: Double
    let box: [Double] // x, y, w, h normalised, origin bottom-left
}

func ocr(_ path: String) -> [Line] {
    guard let img = NSImage(contentsOfFile: path),
          let data = img.tiffRepresentation,
          let rep = NSBitmapImageRep(data: data),
          let cg = rep.cgImage else { return [] }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([request])
    let obs = request.results ?? []
    return obs.compactMap { o in
        guard let top = o.topCandidates(1).first else { return nil }
        let b = o.boundingBox
        return Line(
            text: top.string,
            confidence: Double(top.confidence),
            box: [Double(b.origin.x), Double(b.origin.y), Double(b.size.width), Double(b.size.height)]
        )
    }
}

let args = Array(CommandLine.arguments.dropFirst())
var out: [String: [Line]] = [:]
for a in args { out[a] = ocr(a) }
let enc = JSONEncoder()
enc.outputFormatting = [.withoutEscapingSlashes]
if let d = try? enc.encode(out), let s = String(data: d, encoding: .utf8) {
    print(s)
}
