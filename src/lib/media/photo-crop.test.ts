import { test } from "node:test"
import assert from "node:assert/strict"
import { clampOffset, clampZoom, displayScale, outputSide, photoFileProblem, sourceSquare, zoomTo } from "./photo-crop"

const landscape = { width: 4000, height: 3000 }

test("at zoom 1 the short side fills the frame and the centre square is cropped", () => {
  assert.equal(displayScale(landscape, 300, 1), 0.1)
  assert.deepEqual(sourceSquare(landscape, 300, 1, { x: 0, y: 0 }), { sx: 500, sy: 0, size: 3000 })
})

test("dragging is clamped so the photo always covers the frame", () => {
  // Displayed 400×300 in a 300 frame: 50 px of slack left and right, none up and down.
  assert.deepEqual(clampOffset(landscape, 300, 1, { x: 999, y: -40 }), { x: 50, y: 0 })
  assert.deepEqual(clampOffset(landscape, 300, 1, { x: -999, y: 40 }), { x: -50, y: 0 })
  // Dragged fully right shows the left edge of the photo.
  assert.equal(sourceSquare(landscape, 300, 1, { x: 50, y: 0 }).sx, 0)
  assert.equal(sourceSquare(landscape, 300, 1, { x: -50, y: 0 }).sx, 1000)
})

test("zoom crops a smaller square and stays within 1–4", () => {
  assert.equal(clampZoom(0.2), 1)
  assert.equal(clampZoom(9), 4)
  assert.equal(clampZoom(Number.NaN), 1)
  const z2 = sourceSquare(landscape, 300, 2, { x: 0, y: 0 })
  assert.equal(z2.size, 1500)
  assert.equal(z2.sx, 1250)
  assert.equal(z2.sy, 750)
})

test("zooming out pulls the offset back inside the new bounds", () => {
  const next = zoomTo(landscape, 300, { zoom: 3, offset: { x: 400, y: 300 } }, 1)
  assert.equal(next.zoom, 1)
  assert.deepEqual(next.offset, { x: 50, y: 0 })
})

test("the uploaded square is never upscaled and at most 1024 px", () => {
  assert.equal(outputSide(3000), 1024)
  assert.equal(outputSide(480.4), 480)
  assert.equal(outputSide(0), 1)
})

test("file checks: JPEG, PNG, WebP and HEIC (tried) up to 10 MB", () => {
  assert.equal(photoFileProblem({ type: "image/jpeg", size: 1000 }), null)
  assert.equal(photoFileProblem({ type: "", name: "IMG_1.HEIC", size: 1000 }), null)
  assert.equal(photoFileProblem({ type: "image/gif", size: 1000 }), "Use a JPEG, PNG or WebP photo.")
  assert.equal(photoFileProblem({ type: "image/png", size: 11 * 1024 * 1024 }), "Photos can be up to 10 MB.")
  assert.equal(photoFileProblem({ type: "image/png", size: 0 }), "This file is empty.")
})
