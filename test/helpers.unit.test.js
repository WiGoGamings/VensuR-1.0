import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampNumberInRange,
  escapeSqlLikePattern,
  isExpired,
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  normalizePhone,
  normalizeProfileVisibility,
  normalizeUsername,
  toBooleanFlag,
  toNumeric,
  toSlugToken,
} from '../server/lib/helpers.js'

test('normalizeUsername limpia y baja a minusculas', () => {
  assert.equal(normalizeUsername('  Maria Jose! '), 'maria_jose')
  assert.equal(normalizeUsername('user@name'), 'username')
})

test('isValidUsername exige 3-24 [a-z0-9_]', () => {
  assert.equal(isValidUsername('ab'), false)
  assert.equal(isValidUsername('buen_usuario1'), true)
  assert.equal(isValidUsername('Mayus'), false)
})

test('isValidEmail y normalizeEmail', () => {
  assert.equal(isValidEmail('a@b.co'), true)
  assert.equal(isValidEmail('sin-arroba'), false)
  assert.equal(normalizeEmail('  A@B.CO '), 'a@b.co')
})

test('normalizeProfileVisibility solo acepta public', () => {
  assert.equal(normalizeProfileVisibility('public'), 'public')
  assert.equal(normalizeProfileVisibility('PUBLIC'), 'public')
  assert.equal(normalizeProfileVisibility('otro'), 'private')
  assert.equal(normalizeProfileVisibility(undefined), 'private')
})

test('escapeSqlLikePattern escapa comodines', () => {
  assert.equal(escapeSqlLikePattern('50%_off\\'), '50\\%\\_off\\\\')
})

test('toBooleanFlag interpreta strings comunes', () => {
  assert.equal(toBooleanFlag('true'), true)
  assert.equal(toBooleanFlag('si'), true)
  assert.equal(toBooleanFlag('0'), false)
  assert.equal(toBooleanFlag(1), true)
})

test('toNumeric y clampNumberInRange', () => {
  assert.equal(toNumeric('abc'), 0)
  assert.equal(toNumeric('12.5'), 12.5)
  assert.equal(clampNumberInRange(99, 0, 10, 5), 10)
  assert.equal(clampNumberInRange('x', 0, 10, 5), 5)
})

test('toSlugToken quita acentos y no alfanumericos', () => {
  assert.equal(toSlugToken('Mérida Ñandú'), 'meridanandu')
})

test('normalizePhone recorta a 28 y filtra simbolos', () => {
  assert.equal(normalizePhone('+58 (212) 555-1234 abc'), '+58 (212) 555-1234 ')
})

test('isExpired', () => {
  assert.equal(isExpired('2000-01-01T00:00:00.000Z'), true)
  assert.equal(isExpired('2999-01-01T00:00:00.000Z'), false)
  assert.equal(isExpired('no-es-fecha'), true)
})
