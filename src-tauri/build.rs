use std::env;
use std::path::PathBuf;

fn main() {
    let windows_msvc = env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if !windows_msvc {
        tauri_build::build();
        return;
    }

    // Tauri's menus (muda) and the dialog plugin (rfd) import TaskDialogIndirect, which only
    // Common Controls v6 exports, and an executable gets v6 only through its application
    // manifest. tauri-build links its manifest into the binaries alone
    // (`rustc-link-arg-bins`), so the lib's unit-test executable had none and the loader
    // refused to start it (STATUS_ENTRYPOINT_NOT_FOUND). `rustc-link-arg-tests` would not
    // reach it either: it applies to tests/*.rs only. So the linker embeds the manifest
    // into everything this package links (the app, the unit-test executables, the cdylib),
    // and tauri-build leaves it out of its resource file, so that the app carries it once.
    // The file is tauri-build's default manifest, unchanged.
    let manifest =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    // No UAC section: the manifest stays what tauri-build embedded before.
    println!("cargo:rustc-link-arg=/MANIFESTUAC:NO");

    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
