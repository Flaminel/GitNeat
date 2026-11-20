use gitneat_core::load::load_repo_cli;
use gitneat_core::load_gix::load_repo_gix;
use std::time::Instant;

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.total_cmp(b));
    v[v.len() / 2]
}

fn main() {
    gitneat_core::stack::run(real_main());
}

async fn real_main() {
    let path = std::env::args().nth(1).expect("repo path");
    let (hidden, solo, limit) = (Vec::new(), Vec::new(), 3000);
    let mut cli = Vec::new();
    let mut gix = Vec::new();
    for run in 0..22 {
        let start = Instant::now();
        let data = load_repo_cli(&path, &hidden, &solo, limit).await;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        std::hint::black_box(data);
        if run >= 2 {
            cli.push(ms);
        }
    }
    for run in 0..22 {
        let start = Instant::now();
        let data = load_repo_gix(&path, &hidden, &solo, limit).expect("gix load");
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        std::hint::black_box(data);
        if run >= 2 {
            gix.push(ms);
        }
    }
    println!("{path}");
    println!("cli median {:.1} ms", median(cli));
    println!("gix median {:.1} ms", median(gix));
}
