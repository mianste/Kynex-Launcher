use kynex_core::skins;
use serde_json::json;
#[tokio::main]
async fn main() {
    let skin = skins::import(&json!({"kind":"username","value":"Notch"}))
        .await
        .unwrap();
    assert_eq!(skin["name"], "Notch");
    assert!(!skin["base64"].as_str().unwrap().is_empty());
    println!(
        "USERNAME_IMPORT_OK name={} model={} png_base64_bytes={}",
        skin["name"],
        skin["model"],
        skin["base64"].as_str().unwrap().len()
    );
    let url = "https://textures.minecraft.net/texture/";
    // Exercise the exact URL route with a known public texture from the official profile.
    let http = reqwest::Client::new();
    let profile:serde_json::Value=http.get("https://sessionserver.mojang.com/session/minecraft/profile/069a79f444e94726a5befca90e38aaf5").send().await.unwrap().json().await.unwrap();
    use base64::Engine;
    let v = profile["properties"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["name"] == "textures")
        .unwrap()["value"]
        .as_str()
        .unwrap();
    let payload: serde_json::Value =
        serde_json::from_slice(&base64::engine::general_purpose::STANDARD.decode(v).unwrap())
            .unwrap();
    let texture = payload["textures"]["SKIN"]["url"]
        .as_str()
        .unwrap()
        .replace("http://", "https://");
    assert!(texture.starts_with(url));
    let direct = skins::import(&json!({"kind":"url","value":texture}))
        .await
        .unwrap();
    assert_eq!(skin["base64"], direct["base64"]);
    println!("URL_IMPORT_OK identical_png=true");
}
