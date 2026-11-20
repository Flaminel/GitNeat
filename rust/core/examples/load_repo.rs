use gitneat_core::load::{load_commits, load_repo};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let hidden: Vec<String> = serde_json::from_str(&args[2]).expect("hidden json");
    let solo: Vec<String> = serde_json::from_str(&args[3]).expect("solo json");
    let limit: u32 = args[4].parse().expect("limit");
    let mut data = load_repo(&args[1], &hidden, &solo, limit).await;
    if let Some(page) = args.get(5) {
        let page: u32 = page.parse().expect("page");
        let mut skip = limit;
        loop {
            let next = load_commits(&args[1], &hidden, &solo, skip, page, data.lanes).await;
            data.lanes = next.lanes;
            if next.rows.is_empty() {
                break;
            }
            data.commits.extend(next.commits);
            data.rows.extend(next.rows);
            skip += page;
        }
    }
    println!("{}", serde_json::to_string(&data).expect("serialize"));
}
