use gitneat::load::load_repo;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let hidden: Vec<String> = serde_json::from_str(&args[2]).expect("hidden json");
    let solo: Vec<String> = serde_json::from_str(&args[3]).expect("solo json");
    let limit: u32 = args[4].parse().expect("limit");
    let data = load_repo(&args[1], &hidden, &solo, limit).await;
    println!("{}", serde_json::to_string(&data).expect("serialize"));
}
