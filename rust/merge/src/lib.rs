//! JS bindings for `src/merge.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use napi_derive::napi;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into())
}

#[allow(dead_code)]
fn run<T>(f: impl FnOnce() -> Result<T, String>) -> napi::Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(result) => result.map_err(napi::Error::from_reason),
        Err(payload) => Err(napi::Error::from_reason(format!(
            "Rust panic: {}",
            panic_message(&*payload)
        ))),
    }
}

/// `splitLines`.
#[napi(js_name = "splitLines")]
pub fn split_lines(text: String) -> napi::Result<Vec<String>> {
    run(move || {
        let out = port::split_lines(text)?;
        Ok(out)
    })
}

/// `parseMerge`.
#[napi(js_name = "parseMerge")]
pub fn parse_merge(text: String) -> napi::Result<String> {
    run(move || {
        let out = port::parse_merge(text)?;
        crate::js::to_json(&out)
    })
}

/// `sideLines`.
#[napi(js_name = "sideLines")]
pub fn side_lines(segments: String, side: String) -> napi::Result<String> {
    run(move || {
        let segments = crate::js::from_json(&segments)?;
        let out = port::side_lines(segments, side)?;
        crate::js::to_json(&out)
    })
}

/// `buildOutput`.
#[napi(js_name = "buildOutput")]
pub fn build_output(
    segments: String,
    selections: String,
    markers: Option<bool>,
) -> napi::Result<String> {
    run(move || {
        let segments = crate::js::from_json(&segments)?;
        let selections = crate::js::from_json(&selections)?;
        let out = port::build_output(segments, selections, markers)?;
        crate::js::to_json(&out)
    })
}

/// `togglePick`.
#[napi(js_name = "togglePick")]
pub fn toggle_pick(sel: String, p: String) -> napi::Result<String> {
    run(move || {
        let sel = crate::js::from_json(&sel)?;
        let p = crate::js::from_json(&p)?;
        let out = port::toggle_pick(sel, p)?;
        crate::js::to_json(&out)
    })
}

/// `sideTaken`.
#[napi(js_name = "sideTaken")]
pub fn side_taken(sel: String, side: String, count: f64) -> napi::Result<bool> {
    run(move || {
        let sel = crate::js::from_json(&sel)?;
        let out = port::side_taken(sel, side, count)?;
        Ok(out)
    })
}

/// `toggleSide`.
#[napi(js_name = "toggleSide")]
pub fn toggle_side(sel: String, side: String, count: f64) -> napi::Result<String> {
    run(move || {
        let sel = crate::js::from_json(&sel)?;
        let out = port::toggle_side(sel, side, count)?;
        crate::js::to_json(&out)
    })
}

/// `allTaken`.
#[napi(js_name = "allTaken")]
pub fn all_taken(segments: String, sels: String, side: String) -> napi::Result<bool> {
    run(move || {
        let segments = crate::js::from_json(&segments)?;
        let sels = crate::js::from_json(&sels)?;
        let out = port::all_taken(segments, sels, side)?;
        Ok(out)
    })
}

/// `takeAll`.
#[napi(js_name = "takeAll")]
pub fn take_all(segments: String, sels: String, side: String) -> napi::Result<String> {
    run(move || {
        let segments = crate::js::from_json(&segments)?;
        let sels = crate::js::from_json(&sels)?;
        let out = port::take_all(segments, sels, side)?;
        crate::js::to_json(&out)
    })
}

// ---- the binary wire ------------------------------------------------------------------------

thread_local! {
    static WIRE: std::cell::RefCell<Option<(napi::bindgen_prelude::Uint8Array, napi::bindgen_prelude::Uint8Array)>> =
        const { std::cell::RefCell::new(None) };
    static PENDING: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Registers the argument and result buffers `index.cjs` writes to and reads from.
#[napi(js_name = "rustAnythingWireInit")]
pub fn rust_anything_wire_init(
    input: napi::bindgen_prelude::Uint8Array,
    output: napi::bindgen_prelude::Uint8Array,
) {
    WIRE.with(|w| *w.borrow_mut() = Some((input, output)));
}

/// Copies a result that did not fit into the (now larger) result buffer.
#[napi(js_name = "rustAnythingWireFlush")]
pub fn rust_anything_wire_flush() -> f64 {
    let bytes = PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    WIRE.with(|w| {
        let mut w = w.borrow_mut();
        let Some((_, output)) = w.as_mut() else {
            return -1.0;
        };
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = bytes.len().min(out.len());
        out[..n].copy_from_slice(&bytes[..n]);
        n as f64
    })
}

/// Reads `len` argument bytes, runs `f`, and writes its result; a negative return is the size
/// of a result that did not fit, kept for `rustAnythingWireFlush`.
fn wire_io(
    len: u32,
    f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>,
) -> napi::Result<f64> {
    WIRE.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some((input, output)) = guard.as_mut() else {
            return Err(napi::Error::from_reason(
                "rust-anything: the wire buffers are not registered",
            ));
        };
        let len = (len as usize).min(input.len());
        let mut w = wire::Writer::default();
        match run(|| f(&mut wire::Reader::new(&input[..len]), &mut w)) {
            // A result of another shape than the TS type: JS runs the call through JSON.
            Err(e) if e.reason.starts_with(wire::MISMATCH) => return Ok(f64::NAN),
            other => other?,
        }
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = w.0.len();
        if n > out.len() {
            PENDING.with(|p| *p.borrow_mut() = w.0);
            return Ok(-(n as f64));
        }
        out[..n].copy_from_slice(&w.0);
        Ok(n as f64)
    })
}

static S_PARSE_MERGE_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);

/// `parseMerge` over the binary wire.
#[napi(js_name = "parseMergeWire")]
pub fn parse_merge_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let text: String = r.string16()?;
        let out = &port::parse_merge(text)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_PARSE_MERGE_OUT.inner())?;
        }
        Ok(())
    })
}

static S_SIDE_LINES_0: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);
static S_SIDE_LINES_OUT: wire::Schema = wire::Schema::Obj(&[
    ("lines", wire::Schema::List(&wire::Schema::Str16)),
    ("starts", wire::Schema::List(&wire::Schema::Num)),
]);

/// `sideLines` over the binary wire.
#[napi(js_name = "sideLinesWire")]
pub fn side_lines_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let segments: Vec<serde_json::Value> =
            r.list(|r| wire::read_value(r, S_SIDE_LINES_0.inner()))?;
        let side: String = r.string16()?;
        let out = &port::side_lines(segments, side)?;
        wire::write_value(w, out, &S_SIDE_LINES_OUT)?;
        Ok(())
    })
}

static S_BUILD_OUTPUT_0: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);
static S_BUILD_OUTPUT_1: wire::Schema =
    wire::Schema::List(&wire::Schema::OptJs(&wire::Schema::List(
        &wire::Schema::Obj(&[("side", wire::Schema::Str16), ("line", wire::Schema::Num)]),
    )));
static S_BUILD_OUTPUT_OUT: wire::Schema = wire::Schema::Obj(&[
    ("text", wire::Schema::Str16),
    (
        "ranges",
        wire::Schema::List(&wire::Schema::Obj(&[
            ("start", wire::Schema::Num),
            ("end", wire::Schema::Num),
        ])),
    ),
]);

/// `buildOutput` over the binary wire.
#[napi(js_name = "buildOutputWire")]
pub fn build_output_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let segments: Vec<serde_json::Value> =
            r.list(|r| wire::read_value(r, S_BUILD_OUTPUT_0.inner()))?;
        let selections: Vec<Option<Vec<serde_json::Value>>> = r.list(|r| {
            r.opt_js(|r| r.list(|r| wire::read_value(r, S_BUILD_OUTPUT_1.inner().inner().inner())))
        })?;
        let markers: Option<bool> = r.opt_js(|r| r.bool())?;
        let out = &port::build_output(segments, selections, markers)?;
        wire::write_value(w, out, &S_BUILD_OUTPUT_OUT)?;
        Ok(())
    })
}

static S_TOGGLE_PICK_0: wire::Schema =
    wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[
        ("side", wire::Schema::Str16),
        ("line", wire::Schema::Num),
    ])));
static S_TOGGLE_PICK_1: wire::Schema =
    wire::Schema::Obj(&[("side", wire::Schema::Str16), ("line", wire::Schema::Num)]);
static S_TOGGLE_PICK_OUT: wire::Schema =
    wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[
        ("side", wire::Schema::Str16),
        ("line", wire::Schema::Num),
    ])));

/// `togglePick` over the binary wire.
#[napi(js_name = "togglePickWire")]
pub fn toggle_pick_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let sel: Option<Vec<serde_json::Value>> =
            r.opt_js(|r| r.list(|r| wire::read_value(r, S_TOGGLE_PICK_0.inner().inner())))?;
        let p: serde_json::Value = wire::read_value(r, &S_TOGGLE_PICK_1)?;
        let out = &port::toggle_pick(sel, p)?;
        match out {
            Some(x0) => {
                w.tag(1);
                w.tag(1);
                w.count(x0.len());
                for x1 in x0.iter() {
                    wire::write_value(w, x1, S_TOGGLE_PICK_OUT.inner().inner())?;
                }
            }
            None => w.tag(0),
        }
        Ok(())
    })
}

static S_SIDE_TAKEN_0: wire::Schema =
    wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[
        ("side", wire::Schema::Str16),
        ("line", wire::Schema::Num),
    ])));

/// `sideTaken` over the binary wire.
#[napi(js_name = "sideTakenWire")]
pub fn side_taken_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let sel: Option<Vec<serde_json::Value>> =
            r.opt_js(|r| r.list(|r| wire::read_value(r, S_SIDE_TAKEN_0.inner().inner())))?;
        let side: String = r.string16()?;
        let count: f64 = r.f64()?;
        let out = &port::side_taken(sel, side, count)?;
        w.bool(*out);
        Ok(())
    })
}

static S_TOGGLE_SIDE_0: wire::Schema =
    wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[
        ("side", wire::Schema::Str16),
        ("line", wire::Schema::Num),
    ])));
static S_TOGGLE_SIDE_OUT: wire::Schema =
    wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[
        ("side", wire::Schema::Str16),
        ("line", wire::Schema::Num),
    ])));

/// `toggleSide` over the binary wire.
#[napi(js_name = "toggleSideWire")]
pub fn toggle_side_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let sel: Option<Vec<serde_json::Value>> =
            r.opt_js(|r| r.list(|r| wire::read_value(r, S_TOGGLE_SIDE_0.inner().inner())))?;
        let side: String = r.string16()?;
        let count: f64 = r.f64()?;
        let out = &port::toggle_side(sel, side, count)?;
        match out {
            Some(x0) => {
                w.tag(1);
                w.tag(1);
                w.count(x0.len());
                for x1 in x0.iter() {
                    wire::write_value(w, x1, S_TOGGLE_SIDE_OUT.inner().inner())?;
                }
            }
            None => w.tag(0),
        }
        Ok(())
    })
}

static S_ALL_TAKEN_0: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);
static S_ALL_TAKEN_1: wire::Schema = wire::Schema::List(&wire::Schema::OptJs(&wire::Schema::List(
    &wire::Schema::Obj(&[("side", wire::Schema::Str16), ("line", wire::Schema::Num)]),
)));

/// `allTaken` over the binary wire.
#[napi(js_name = "allTakenWire")]
pub fn all_taken_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let segments: Vec<serde_json::Value> =
            r.list(|r| wire::read_value(r, S_ALL_TAKEN_0.inner()))?;
        let sels: Vec<Option<Vec<serde_json::Value>>> = r.list(|r| {
            r.opt_js(|r| r.list(|r| wire::read_value(r, S_ALL_TAKEN_1.inner().inner().inner())))
        })?;
        let side: String = r.string16()?;
        let out = &port::all_taken(segments, sels, side)?;
        w.bool(*out);
        Ok(())
    })
}

static S_TAKE_ALL_0: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);
static S_TAKE_ALL_1: wire::Schema = wire::Schema::List(&wire::Schema::OptJs(&wire::Schema::List(
    &wire::Schema::Obj(&[("side", wire::Schema::Str16), ("line", wire::Schema::Num)]),
)));
static S_TAKE_ALL_OUT: wire::Schema =
    wire::Schema::List(&wire::Schema::OptJs(&wire::Schema::List(
        &wire::Schema::Obj(&[("side", wire::Schema::Str16), ("line", wire::Schema::Num)]),
    )));

/// `takeAll` over the binary wire.
#[napi(js_name = "takeAllWire")]
pub fn take_all_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let segments: Vec<serde_json::Value> =
            r.list(|r| wire::read_value(r, S_TAKE_ALL_0.inner()))?;
        let sels: Vec<Option<Vec<serde_json::Value>>> = r.list(|r| {
            r.opt_js(|r| r.list(|r| wire::read_value(r, S_TAKE_ALL_1.inner().inner().inner())))
        })?;
        let side: String = r.string16()?;
        let out = &port::take_all(segments, sels, side)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            match x0 {
                Some(x1) => {
                    w.tag(1);
                    w.tag(1);
                    w.count(x1.len());
                    for x2 in x1.iter() {
                        wire::write_value(w, x2, S_TAKE_ALL_OUT.inner().inner().inner())?;
                    }
                }
                None => w.tag(0),
            }
        }
        Ok(())
    })
}
