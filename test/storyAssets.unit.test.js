import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PHOTO_FILTERS,
  TEXT_BACKGROUNDS,
  TEXT_FONTS,
  buildFilterCss,
  clamp,
  createTextLayer,
  defaultAdjustments,
  getBackgroundById,
  getFontById,
} from '../src/components/composer/storyAssets.js'

test('catálogos base no están vacíos', () => {
  assert.ok(PHOTO_FILTERS.length >= 10)
  assert.equal(PHOTO_FILTERS[0].id, 'normal')
  assert.ok(TEXT_BACKGROUNDS.length >= 6)
  assert.ok(TEXT_FONTS.length >= 3)
})

test('buildFilterCss combina preset + ajustes', () => {
  assert.equal(buildFilterCss('normal', defaultAdjustments()), 'none')
  assert.match(buildFilterCss('clarendon', defaultAdjustments()), /saturate\(1\.35\)/)

  const withAdjust = buildFilterCss('normal', { ...defaultAdjustments(), brightness: 1.2, blur: 2 })
  assert.match(withAdjust, /brightness\(1\.2\)/)
  assert.match(withAdjust, /blur\(2px\)/)
})

test('clamp respeta límites y fallback', () => {
  assert.equal(clamp(50, 0, 10, 5), 10)
  assert.equal(clamp(-5, 0, 10, 5), 0)
  assert.equal(clamp('nan', 0, 10, 7), 7)
})

test('createTextLayer trae valores por defecto y un id único', () => {
  const a = createTextLayer()
  const b = createTextLayer({ text: 'hola', align: 'left' })
  assert.notEqual(a.id, b.id)
  assert.equal(b.text, 'hola')
  assert.equal(b.align, 'left')
  assert.equal(a.color, '#ffffff')
})

test('getters caen a un valor válido', () => {
  assert.equal(getFontById('inexistente').id, TEXT_FONTS[0].id)
  assert.equal(getBackgroundById('inexistente').id, TEXT_BACKGROUNDS[0].id)
})
