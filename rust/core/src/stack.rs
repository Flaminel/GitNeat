use std::future::Future;

const STACK: usize = 16 * 1024 * 1024;

pub fn run<F>(future: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .thread_stack_size(STACK)
                .build()
                .expect("runtime")
                .block_on(future);
        })
        .expect("spawn worker")
        .join()
        .expect("worker panicked");
}
