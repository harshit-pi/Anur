// Draws build/dmg-background.tiff: the install window's backdrop, with a
// dashed arrow centred between the app (x 140) and Applications (x 400) at y 140.
// Run: swift scripts/dmg-background.swift
import AppKit

func draw(scale: CGFloat) -> NSBitmapImageRep {
  let w = 540, h = 380
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: w * Int(scale), pixelsHigh: h * Int(scale),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: w, height: h)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSColor(calibratedWhite: 0.925, alpha: 1).setFill()
  NSRect(x: 0, y: 0, width: w, height: h).fill()
  // In the window's terms, y down from the top: the icons' row is y 140.
  let cx: CGFloat = 270, cy: CGFloat = 140
  let pts: [(CGFloat, CGFloat)] = [
    (-27, -11), (-7, -11), (-7, -29), (22, 0), (-7, 29), (-7, 11), (-27, 11),
  ]
  let arrow = NSBezierPath()
  for (i, p) in pts.enumerated() {
    let at = NSPoint(x: cx + p.0, y: CGFloat(h) - (cy + p.1))
    if i == 0 { arrow.move(to: at) } else { arrow.line(to: at) }
  }
  arrow.close()
  arrow.lineWidth = 1.5
  arrow.setLineDash([4, 3], count: 2, phase: 0)
  NSColor(calibratedWhite: 0.38, alpha: 1).setStroke()
  arrow.stroke()
  NSGraphicsContext.restoreGraphicsState()
  return rep
}

let tiff = NSBitmapImageRep.tiffRepresentationOfImageReps(
  in: [draw(scale: 1), draw(scale: 2)], using: .lzw, factor: 0)!
try! tiff.write(to: URL(fileURLWithPath: "build/dmg-background.tiff"))
print("wrote build/dmg-background.tiff")
