#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = gitneat::askpass::client() {
        std::process::exit(code);
    }
    gitneat::run();
}
