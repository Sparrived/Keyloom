fn main() {
    let runtime_ready = std::path::Path::new("runtime-bundle/runtime").is_dir()
        && std::path::Path::new("runtime-bundle/install-state.json").is_file();
    let release = std::env::var("PROFILE").is_ok_and(|profile| profile == "release");
    if !release && !runtime_ready && std::env::var_os("TAURI_CONFIG").is_none() {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"resources":[]}}"#);
    }
    tauri_build::build()
}
