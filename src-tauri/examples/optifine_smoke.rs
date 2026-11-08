use kynex_core::{engine, optifine, Core, Result};
use serde_json::json;
use std::{path::PathBuf, sync::Arc};
#[tokio::main]
async fn main() -> Result<()> {
    let root = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("dedicated test directory required")?,
    );
    let core = Core::new(root.clone(), Arc::new(|value| println!("{value}")))?;
    let game = "1.20.1";
    let release = optifine::selected(&core, game, "HD_U_I6", Some("47.2.18")).await?;
    assert!(optifine::selected(&core, game, "HD_U_I6", Some("47.3.0"))
        .await
        .is_err());
    let manifest = core.get(engine::MANIFEST).await?;
    let url = manifest["versions"]
        .as_array()
        .ok_or("manifest")?
        .iter()
        .find(|v| v["id"] == game)
        .and_then(|v| v["url"].as_str())
        .ok_or("version")?;
    let mut version = core.get(url).await?;
    let dir = root.join("vanilla-optifine");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    engine::download(
        &core,
        version["downloads"]["client"]["url"].as_str().unwrap(),
        &dir.join("client.jar"),
        version["downloads"]["client"]["sha1"].as_str().unwrap(),
    )
    .await?;
    let java = std::env::var("KXL_TEST_JAVA").unwrap_or_else(|_| "java".into());
    optifine::install(&core, game, &release, false, &java, &dir, &mut version).await?;
    assert_eq!(version["mainClass"], "net.minecraft.launchwrapper.Launch");
    assert!(version["libraries"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v["name"]
            .as_str()
            .unwrap_or("")
            .starts_with("optifine:launchwrapper")));
    std::fs::write(
        dir.join("version.json"),
        serde_json::to_vec_pretty(&version).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    let forge = root.join("forge-optifine");
    std::fs::create_dir_all(&forge).map_err(|e| e.to_string())?;
    let mut forge_profile =
        json!({"mainClass":"cpw.mods.bootstraplauncher.BootstrapLauncher","libraries":[]});
    optifine::install(
        &core,
        game,
        &release,
        true,
        &java,
        &forge,
        &mut forge_profile,
    )
    .await?;
    assert_eq!(
        forge_profile["mainClass"],
        "cpw.mods.bootstraplauncher.BootstrapLauncher"
    );
    assert!(forge.join("mods").join(release.filename).is_file());
    println!("OptiFine: downloaded, patched against real 1.20.1 client, wrapper extracted, Forge mod installed; incompatible pair rejected.");
    Ok(())
}
