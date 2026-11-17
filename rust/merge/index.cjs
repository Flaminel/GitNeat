// Loads the native module built by `rust-anything build`.
const native = require('./merge.node')

// Structured values cross as JSON text. JSON has no `undefined`, NaN or -0, and Rust strings no
// lone surrogates: those travel as `{"$undefined": true}`, `{"$num": "NaN"}` and
// `{"$utf16": [...]}` (see `js.rs`), so `{ a: undefined }`, `null` and half an emoji survive.
const replacer = (_, v) => v === undefined ? { $undefined: true }
  : typeof v === 'number' ? (Number.isFinite(v) && !Object.is(v, -0) ? v : { $num: Object.is(v, -0) ? '-0' : String(v) })
  : typeof v === 'string' && !v.isWellFormed() ? { $utf16: Array.from({ length: v.length }, (_, i) => v.charCodeAt(i)) }
  : v
const encode = v => JSON.stringify(v, replacer)
const single = (v, key) => Object.keys(v).length === 1 && key in v
const revive = v => Array.isArray(v) ? v.map(revive)
  : v !== null && typeof v === 'object'
    ? (single(v, '$undefined') ? undefined
      : single(v, '$utf16') ? String.fromCharCode(...v.$utf16)
      : single(v, '$num') ? Number(v.$num)
      : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)])))
    : v
// Most results carry no marker: skip the walk unless the text has one.
const decode = text => {
  const value = JSON.parse(text)
  return text.includes('"$') ? revive(value) : value
}
const fromUnits = (units) => {
  let out = ''
  for (let i = 0; i < units.length; i += 8192)
    out += String.fromCharCode.apply(null, Array.prototype.slice.call(units, i, i + 8192))
  return out
}

module.exports = { ...native }
const specs = {
  parseMerge: [[0], 'json', false],
  sideLines: [[1, 0], 'json', false],
  buildOutput: [[1, 1, 0], 'json', false],
  togglePick: [[1, 1], 'json', false],
  sideTaken: [[1, 0, 0], 'raw', false],
  toggleSide: [[1, 0, 0], 'json', false],
  allTaken: [[1, 1, 0], 'raw', false],
  takeAll: [[1, 1, 0], 'json', false],
}
const classes = {

}
const convert = result => result === 'json' ? decode : result === 'units' ? fromUnits : x => x
// An omitted structured argument is `undefined`, not a missing value.
const prepare = (a, structured) => Array.from({ length: Math.max(a.length, structured.length) }, (_, i) => structured[i] ? encode(a[i]) : a[i])
// Functions: [structured arguments, result kind, async].
for (const [name, [structured, result, isAsync]] of Object.entries(specs)) {
  const call = native[name]
  const out = convert(result)
  module.exports[name] = isAsync
    ? async (...a) => out(await call(...prepare(a, structured)))
    : (...a) => out(call(...prepare(a, structured)))
}
// Classes: a JS class around the native one, converting arguments and results.
const INNER = Symbol('native')
for (const [name, [ctor, methods]] of Object.entries(classes)) {
  const Native = native[name]
  const Wrapped = { [name]: class { constructor(...a) { this[INNER] = new Native(...prepare(a, ctor)) } } }[name]
  for (const [method, [structured, result]] of Object.entries(methods)) {
    const out = convert(result)
    Wrapped.prototype[method] = function (...a) { return out(this[INNER][method](...prepare(a, structured))) }
  }
  module.exports[name] = Wrapped
}

// The binary wire (see rust-anything's `wire.rs`): arguments are written into `wIn`, results read
// from `wOut`; both are registered with the native module once.
let wIn = new Uint8Array(1 << 16), wOut = new Uint8Array(1 << 16)
let iv = new DataView(wIn.buffer), ov = new DataView(wOut.buffer), at = 0, p = 0
native.rustAnythingWireInit(wIn, wOut)
const regrow = () => native.rustAnythingWireInit(wIn, wOut)
// Runs a wire function; a result larger than `wOut` is fetched once `wOut` has grown.
const wireCall = fn => {
  const n = fn(at)
  if (Number.isNaN(n)) return false
  if (n < 0) {
    wOut = new Uint8Array(Math.max(wOut.length * 2, -n))
    ov = new DataView(wOut.buffer)
    native.rustAnythingWireInit(wIn, wOut)
    native.rustAnythingWireFlush()
  }
  p = 0
  return true
}

const need = n => {
  if (at + n <= wIn.length) return
  const grown = new Uint8Array(Math.max(wIn.length * 2, at + n))
  grown.set(wIn)
  wIn = grown
  iv = new DataView(wIn.buffer)
  regrow()
}
const wU8 = v => { need(1); iv.setUint8(at++, v) }
const wU32 = v => { need(4); iv.setUint32(at, v, true); at += 4 }
const wF64 = v => { need(8); iv.setFloat64(at, v, true); at += 8 }
const wUnits = s => {
  need(4 + 2 * s.length)
  iv.setUint32(at, s.length, true)
  at += 4
  for (let i = 0; i < s.length; i++) { iv.setUint16(at, s.charCodeAt(i), true); at += 2 }
}
const wStr = s => { wU8(4); wUnits(s) }
const wDyn = v => {
  switch (typeof v) {
    case 'undefined': wU8(0); return true
    case 'boolean': wU8(v ? 3 : 2); return true
    case 'number': wU8(4); wF64(v); return true
    case 'string': wU8(5); wUnits(v); return true
    case 'object':
      if (v === null) { wU8(1); return true }
      if (Array.isArray(v)) {
        wU8(6); wU32(v.length)
        for (let i = 0; i < v.length; i++) if (!wDyn(v[i])) return false
        return true
      }
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false
      {
        const keys = Object.keys(v)
        wU8(7); wU32(keys.length)
        for (const k of keys) { wUnits(k); if (!wDyn(v[k])) return false }
        return true
      }
  }
  return false
}
const rU8 = () => ov.getUint8(p++)
const rU32 = () => { const v = ov.getUint32(p, true); p += 4; return v }
const rF64 = () => { const v = ov.getFloat64(p, true); p += 8; return v }
// ignoreBOM: a leading U+FEFF is part of the string, not a byte-order mark.
const utf16 = new TextDecoder('utf-16le', { ignoreBOM: true })
const rUnits = (wellFormed) => {
  const n = rU32()
  let s
  if (n > 24 && wellFormed) s = utf16.decode(wOut.subarray(p, p + 2 * n))
  else {
    s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(ov.getUint16(p + 2 * i, true))
  }
  p += 2 * n
  return s
}
// Tag 1: a string from Rust (well-formed); 4: raw code units, lone surrogates included.
const rStr = () => rUnits(rU8() === 1)
const rDyn = () => {
  switch (rU8()) {
    case 0: return undefined
    case 1: return null
    case 2: return false
    case 3: return true
    case 4: return rF64()
    case 5: return rUnits(false)
    case 6: { const n = rU32(); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = rDyn(); return a }
    case 7: { const n = rU32(); const o = {}; for (let i = 0; i < n; i++) { const k = rUnits(false); o[k] = rDyn() } return o }
  }
}

// `parseMerge`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.parseMerge
const call = native.parseMergeWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
if (rU8() === 0) t = null
else {
const n0 = rU32()
const a0 = new Array(n0)
for (let i0 = 0; i0 < n0; i0++) {
let v0
v0 = rDyn()
a0[i0] = v0
}
t = a0
}
return t
}
module.exports.parseMerge = function parseMerge (...a) {
  if (a.length <= 1 && encode(a[0]) && wireCall(call)) {
    return decode()
  }
  return json(...a)
}
}

// `sideLines`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.sideLines
const call = native.sideLinesWire
const encode = (a0, a1) => {
at = 0
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (!wDyn(v0)) return false
}
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
{
const o0 = {}
const n0 = rU8()
for (let j0 = 0; j0 < n0; j0++) {
switch (rU8()) {
case 0: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
v1 = rStr()
a1[i1] = v1
}
v0 = a1
}
o0["lines"] = v0
break
}
case 1: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
v1 = rF64()
a1[i1] = v1
}
v0 = a1
}
o0["starts"] = v0
break
}
default: {
const k0 = rStr()
o0[k0] = rDyn()
}
}
}
t = o0
}
return t
}
module.exports.sideLines = function sideLines (...a) {
  if (a.length <= 2 && encode(a[0], a[1]) && wireCall(call)) {
    return decode()
  }
  return json(...a)
}
}

// `buildOutput`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.buildOutput
const call = native.buildOutputWire
const encode = (a0, a1, a2) => {
at = 0
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (!wDyn(v0)) return false
}
if (!Array.isArray(a1)) return false
wU8(1)
wU32(a1.length)
for (let i0 = 0; i0 < a1.length; i0++) {
const v0 = a1[i0]
if (v0 === undefined) {
wU8(0)
} else if (v0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(v0)) return false
wU8(1)
wU32(v0.length)
for (let i1 = 0; i1 < v0.length; i1++) {
const v1 = v0[i1]
if (v1 === null || typeof v1 !== 'object' || Array.isArray(v1)) return false
{
const at2 = at
wU8(0)
let n2 = 0, r2 = 0
for (const k2 in v1) {
switch (k2) {
case "side": {
wU8(0)
r2++
const f2 = v1[k2]
if (typeof f2 !== 'string') return false
wStr(f2)
break
}
case "line": {
wU8(1)
r2++
const f2 = v1[k2]
if (typeof f2 !== 'number') return false
wF64(f2)
break
}
default: return false
}
if (++n2 > 255) return false
}
if (r2 !== 2) return false
iv.setUint8(at2, n2)
}
}
}
}
if (a2 === undefined) {
wU8(0)
} else if (a2 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a2 !== 'boolean') return false
wU8(a2 ? 1 : 0)
}
return true
}
const decode = () => {
let t
{
const o0 = {}
const n0 = rU8()
for (let j0 = 0; j0 < n0; j0++) {
switch (rU8()) {
case 0: {
let v0
v0 = rStr()
o0["text"] = v0
break
}
case 1: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
{
const o2 = {}
const n2 = rU8()
for (let j2 = 0; j2 < n2; j2++) {
switch (rU8()) {
case 0: {
let v2
v2 = rF64()
o2["start"] = v2
break
}
case 1: {
let v2
v2 = rF64()
o2["end"] = v2
break
}
default: {
const k2 = rStr()
o2[k2] = rDyn()
}
}
}
v1 = o2
}
a1[i1] = v1
}
v0 = a1
}
o0["ranges"] = v0
break
}
default: {
const k0 = rStr()
o0[k0] = rDyn()
}
}
}
t = o0
}
return t
}
module.exports.buildOutput = function buildOutput (...a) {
  if (a.length <= 3 && encode(a[0], a[1], a[2]) && wireCall(call)) {
    return decode()
  }
  return json(...a)
}
}

// `togglePick`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.togglePick
const call = native.togglePickWire
const encode = (a0, a1) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "side": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "line": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
}
if (a1 === null || typeof a1 !== 'object' || Array.isArray(a1)) return false
{
const at0 = at
wU8(0)
let n0 = 0, r0 = 0
for (const k0 in a1) {
switch (k0) {
case "side": {
wU8(0)
r0++
const f0 = a1[k0]
if (typeof f0 !== 'string') return false
wStr(f0)
break
}
case "line": {
wU8(1)
r0++
const f0 = a1[k0]
if (typeof f0 !== 'number') return false
wF64(f0)
break
}
default: return false
}
if (++n0 > 255) return false
}
if (r0 !== 2) return false
iv.setUint8(at0, n0)
}
return true
}
const decode = () => {
let t
{
const g0 = rU8()
if (g0 === 0) t = undefined
else if (g0 === 2) t = null
else {
if (rU8() === 0) t = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
{
const o2 = {}
const n2 = rU8()
for (let j2 = 0; j2 < n2; j2++) {
switch (rU8()) {
case 0: {
let v2
v2 = rStr()
o2["side"] = v2
break
}
case 1: {
let v2
v2 = rF64()
o2["line"] = v2
break
}
default: {
const k2 = rStr()
o2[k2] = rDyn()
}
}
}
v1 = o2
}
a1[i1] = v1
}
t = a1
}
}
}
return t
}
module.exports.togglePick = function togglePick (...a) {
  if (a.length <= 2 && encode(a[0], a[1]) && wireCall(call)) {
    return decode()
  }
  return json(...a)
}
}

// `sideTaken`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.sideTaken
const call = native.sideTakenWire
const encode = (a0, a1, a2) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "side": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "line": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
}
if (typeof a1 !== 'string') return false
wStr(a1)
if (typeof a2 !== 'number') return false
wF64(a2)
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.sideTaken = function sideTaken (...a) {
  if (a.length <= 3 && encode(a[0], a[1], a[2]) && wireCall(call)) {
    return decode()
  }
  return json(...a)
}
}

// `toggleSide`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.toggleSide
const call = native.toggleSideWire
const encode = (a0, a1, a2) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "side": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "line": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
}
if (typeof a1 !== 'string') return false
wStr(a1)
if (typeof a2 !== 'number') return false
wF64(a2)
return true
}
const decode = () => {
let t
{
const g0 = rU8()
if (g0 === 0) t = undefined
else if (g0 === 2) t = null
else {
if (rU8() === 0) t = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
{
const o2 = {}
const n2 = rU8()
for (let j2 = 0; j2 < n2; j2++) {
switch (rU8()) {
case 0: {
let v2
v2 = rStr()
o2["side"] = v2
break
}
case 1: {
let v2
v2 = rF64()
o2["line"] = v2
break
}
default: {
const k2 = rStr()
o2[k2] = rDyn()
}
}
}
v1 = o2
}
a1[i1] = v1
}
t = a1
}
}
}
return t
}
module.exports.toggleSide = function toggleSide (...a) {
  if (a.length <= 3 && encode(a[0], a[1], a[2]) && wireCall(call)) {
    return decode()
  }
  return json(...a)
}
}

// `allTaken`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.allTaken
const call = native.allTakenWire
const encode = (a0, a1, a2) => {
at = 0
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (!wDyn(v0)) return false
}
if (!Array.isArray(a1)) return false
wU8(1)
wU32(a1.length)
for (let i0 = 0; i0 < a1.length; i0++) {
const v0 = a1[i0]
if (v0 === undefined) {
wU8(0)
} else if (v0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(v0)) return false
wU8(1)
wU32(v0.length)
for (let i1 = 0; i1 < v0.length; i1++) {
const v1 = v0[i1]
if (v1 === null || typeof v1 !== 'object' || Array.isArray(v1)) return false
{
const at2 = at
wU8(0)
let n2 = 0, r2 = 0
for (const k2 in v1) {
switch (k2) {
case "side": {
wU8(0)
r2++
const f2 = v1[k2]
if (typeof f2 !== 'string') return false
wStr(f2)
break
}
case "line": {
wU8(1)
r2++
const f2 = v1[k2]
if (typeof f2 !== 'number') return false
wF64(f2)
break
}
default: return false
}
if (++n2 > 255) return false
}
if (r2 !== 2) return false
iv.setUint8(at2, n2)
}
}
}
}
if (typeof a2 !== 'string') return false
wStr(a2)
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.allTaken = function allTaken (...a) {
  if (a.length <= 3 && encode(a[0], a[1], a[2]) && wireCall(call)) {
    return decode()
  }
  return json(...a)
}
}

// `takeAll`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.takeAll
const call = native.takeAllWire
const encode = (a0, a1, a2) => {
at = 0
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (!wDyn(v0)) return false
}
if (!Array.isArray(a1)) return false
wU8(1)
wU32(a1.length)
for (let i0 = 0; i0 < a1.length; i0++) {
const v0 = a1[i0]
if (v0 === undefined) {
wU8(0)
} else if (v0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(v0)) return false
wU8(1)
wU32(v0.length)
for (let i1 = 0; i1 < v0.length; i1++) {
const v1 = v0[i1]
if (v1 === null || typeof v1 !== 'object' || Array.isArray(v1)) return false
{
const at2 = at
wU8(0)
let n2 = 0, r2 = 0
for (const k2 in v1) {
switch (k2) {
case "side": {
wU8(0)
r2++
const f2 = v1[k2]
if (typeof f2 !== 'string') return false
wStr(f2)
break
}
case "line": {
wU8(1)
r2++
const f2 = v1[k2]
if (typeof f2 !== 'number') return false
wF64(f2)
break
}
default: return false
}
if (++n2 > 255) return false
}
if (r2 !== 2) return false
iv.setUint8(at2, n2)
}
}
}
}
if (typeof a2 !== 'string') return false
wStr(a2)
return true
}
const decode = () => {
let t
if (rU8() === 0) t = null
else {
const n0 = rU32()
const a0 = new Array(n0)
for (let i0 = 0; i0 < n0; i0++) {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
if (rU8() === 0) v0 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
{
const o3 = {}
const n3 = rU8()
for (let j3 = 0; j3 < n3; j3++) {
switch (rU8()) {
case 0: {
let v3
v3 = rStr()
o3["side"] = v3
break
}
case 1: {
let v3
v3 = rF64()
o3["line"] = v3
break
}
default: {
const k3 = rStr()
o3[k3] = rDyn()
}
}
}
v2 = o3
}
a2[i2] = v2
}
v0 = a2
}
}
}
a0[i0] = v0
}
t = a0
}
return t
}
module.exports.takeAll = function takeAll (...a) {
  if (a.length <= 3 && encode(a[0], a[1], a[2]) && wireCall(call)) {
    return decode()
  }
  return json(...a)
}
}
